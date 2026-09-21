'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  SALON_READ_ROLES,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'
import {
  type DayOverview,
  getDayOverview,
  getDaySegmentsSnapshot,
  searchReservationsByGuest,
} from './segment-queries'
import { isMissingTableError, type ReservationSearchResult, toOverrideRows } from './segment-rows'
import {
  dayRequestSchema,
  reservationSearchSchema,
  type SegmentActionResult,
  segmentConfigSaveSchema,
  segmentOverrideKeySchema,
  segmentOverrideSchema,
} from './segment-schemas'
import type { DaySegmentsSnapshot, SegmentKey, SegmentOverrideRow } from './segments'

/**
 * Server actions del cupo por servicio: la vista del día, el snapshot para
 * proyectar una reserva, el buscador del calendario y el CRUD de la config.
 *
 * Archivo 'use server': solo exporta funciones async. Los schemas, el tipo del
 * resultado y `firstParams` viven en `segment-schemas.ts`.
 *
 * - Lecturas: SALON_READ_ROLES (la anfitriona y los mozos ven el cupo).
 * - Buscador: RESERVATION_STAFF_ROLES (trae nombres de clientes).
 * - Config y cupos especiales: solo owner, igual que la RLS de las tablas.
 *
 * Los logs llevan el `[dominio.op]`, el tenant y el código de Postgres. Nunca
 * el texto buscado, nombres ni teléfonos (CLAUDE.md §9).
 */

// Mismo patrón que el resto de lib/salon: el cliente de Supabase sin tipar.
// biome-ignore lint/suspicious/noExplicitAny: pending generated types
type SBAny = any

type Failure = Extract<SegmentActionResult<never>, { ok: false }>
type PgError = { message: string; code?: string }
type Access = { tenantId: string; userId: string; role: TenantRole }

/**
 * Una escritura del "Guardar cupos", descrita solo con claves y números: es lo
 * que va a `audit_log` cuando el guardado queda a medias. Hay un solo upsert
 * por tabla y un delete por servicio, así que esto la identifica sin ambigüedad.
 */
type ConfigWrite =
  | { table: 'salon_segment_capacities'; op: 'upsert' }
  | { table: 'salon_segment_capacities'; op: 'delete'; segment: SegmentKey; iso_dows: number[] }
  | { table: 'salon_segment_settings'; op: 'upsert' }

const OWNER_ONLY = ['owner'] as const satisfies ReadonlyArray<TenantRole>

const FORBIDDEN = 'No tenés permiso para esa acción.'
const INVALID_DATE = 'La fecha no es válida.'
const DAY_FAILED = 'No pudimos leer el día. Probá de nuevo.'
const SEARCH_FAILED = 'No pudimos buscar. Probá de nuevo.'
const CONFIG_FAILED = 'No se pudieron guardar los cupos. Probá de nuevo.'
const OVERRIDE_FAILED = 'No se pudo guardar el cupo especial. Probá de nuevo.'
const OVERRIDE_REMOVE_FAILED = 'No se pudo quitar el cupo especial. Probá de nuevo.'
const NOT_MIGRATED =
  'Los cupos por servicio todavía no están activados en este bar. Avisale al equipo técnico.'
const CHECK_FAILED = 'Revisá los números: el aviso tiene que ser menor o igual al cupo.'

function fail(message: string, field?: string): Failure {
  return field ? { ok: false, message, field } : { ok: false, message }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * Usuario + membership con el rol pedido. Un error de permisos es "no tenés
 * permiso"; cualquier otro (red, RPC) se loguea y se responde como falla
 * transitoria: decir "no tenés permiso" mandaría a pedir un rol que ya tiene.
 */
async function authorize(
  slug: unknown,
  allowed: ReadonlyArray<TenantRole>,
  op: string,
  failedMessage: string,
): Promise<{ ok: true; access: Access } | { ok: false; state: Failure }> {
  if (typeof slug !== 'string' || slug.length === 0) return { ok: false, state: fail(FORBIDDEN) }
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, allowed)
    return { ok: true, access: { tenantId: tenant.id, userId: user.id, role } }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return { ok: false, state: fail(FORBIDDEN) }
    }
    console.error(`[salon.segments.${op}.auth]`, error instanceof Error ? error.message : error)
    return { ok: false, state: fail(failedMessage) }
  }
}

/**
 * Error de escritura en la config → mensaje accionable. 42501 es la RLS (le
 * sacaron el rol entre la carga y el click), 42P01/PGRST205 la migración que
 * todavía no se aplicó y 23514 un CHECK (aviso mayor al cupo) que el zod del
 * borde no debería dejar pasar.
 */
function writeFailure(op: string, tenantId: string, error: PgError, fallback: string): Failure {
  console.error(`[salon.segments.${op}]`, { tenantId, code: error.code })
  if (error.code === '42501') return fail(FORBIDDEN)
  if (isMissingTableError(error)) return fail(NOT_MIGRATED)
  if (error.code === '23514') return fail(CHECK_FAILED)
  return fail(fallback)
}

/**
 * Todo lo que muestra un cupo: la config, el calendario (mes y día), el
 * tablero operativo y el salón del staff.
 */
function revalidateSegmentViews(slug: string): void {
  revalidatePath(`/${slug}/configuracion/salon`)
  revalidatePath(`/${slug}/eventos/programados`)
  revalidatePath(`/${slug}/operativo`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
}

// ──────────────────────────────────────────────────────────
// Lecturas
// ──────────────────────────────────────────────────────────

/**
 * La vista del día: reservas, eventos, cupos resueltos, ajustes y cuánto
 * conviene subir cada servicio, en UNA invocación. La fecha se valida antes de
 * tocar la base: una fecha rota no gasta ni la lectura de permisos.
 */
export async function fetchDayOverview(
  slug: string,
  date: string,
): Promise<SegmentActionResult<DayOverview>> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return fail(INVALID_DATE, 'date')

  const auth = await authorize(slug, SALON_READ_ROLES, 'dayOverview', DAY_FAILED)
  if (!auth.ok) return auth.state

  try {
    const data = await getDayOverview({ tenantId: auth.access.tenantId, date: parsed.data.date })
    return { ok: true, data }
  } catch (error) {
    console.error('[salon.segments.dayOverview]', {
      tenantId: auth.access.tenantId,
      code: errorCode(error),
    })
    return fail(DAY_FAILED)
  }
}

/**
 * Snapshot mínimo (sin datos personales) para proyectar una reserva. El form
 * lo pide de nuevo al apretar Guardar: con varios cargando a la vez, la
 * confirmación de sobrecupo tiene que salir de números frescos.
 */
export async function fetchDaySegments(
  slug: string,
  date: string,
): Promise<SegmentActionResult<DaySegmentsSnapshot>> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return fail(INVALID_DATE, 'date')

  const auth = await authorize(slug, SALON_READ_ROLES, 'daySegments', DAY_FAILED)
  if (!auth.ok) return auth.state

  try {
    const data = await getDaySegmentsSnapshot({
      tenantId: auth.access.tenantId,
      date: parsed.data.date,
    })
    return { ok: true, data }
  } catch (error) {
    console.error('[salon.segments.daySegments]', {
      tenantId: auth.access.tenantId,
      code: errorCode(error),
    })
    return fail(DAY_FAILED)
  }
}

/** Buscador del calendario: por nombre o teléfono, hasta 20 resultados. */
export async function searchReservations(
  slug: string,
  q: string,
): Promise<SegmentActionResult<ReservationSearchResult[]>> {
  const parsed = reservationSearchSchema.safeParse({ q })
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Escribí al menos 2 letras o números', 'q')
  }

  const auth = await authorize(slug, RESERVATION_STAFF_ROLES, 'search', SEARCH_FAILED)
  if (!auth.ok) return auth.state

  try {
    const data = await searchReservationsByGuest({
      tenantId: auth.access.tenantId,
      q: parsed.data.q,
      limit: 20,
    })
    return { ok: true, data }
  } catch (error) {
    // Sin el texto buscado: puede ser un nombre o un teléfono.
    console.error('[salon.segments.search]', {
      tenantId: auth.access.tenantId,
      code: errorCode(error),
    })
    return fail(SEARCH_FAILED)
  }
}

// ──────────────────────────────────────────────────────────
// Config: grilla semanal + ajustes por servicio
// ──────────────────────────────────────────────────────────

/**
 * "Guardar cupos" de Configuración → Capacidad.
 *
 * - Celda con cupo → upsert de (servicio, día).
 * - Celda vacía (`capacity: null`) → se BORRA la fila y ese día vuelve al cupo
 *   general. Guardar un null en la tabla no se puede (capacity es NOT NULL) y
 *   no significaría nada distinto de "sin fila".
 * - Ajustes (hora sugerida y nota del aviso) → upsert por servicio.
 *
 * Las escrituras tocan filas distintas (el schema rechaza celdas repetidas),
 * así que van en paralelo. Sin RPC no hay transacción: si una falla, se avisa
 * y el editor mantiene lo tipeado para volver a guardar. Si además otra entró,
 * el cupo del bar cambió de verdad y se audita igual, marcado como parcial.
 */
export async function saveSegmentConfig(
  slug: string,
  input: unknown,
): Promise<SegmentActionResult<null>> {
  const auth = await authorize(slug, OWNER_ONLY, 'saveConfig', CONFIG_FAILED)
  if (!auth.ok) return auth.state
  const { tenantId, userId } = auth.access

  const parsed = segmentConfigSaveSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Revisá los cupos.', issue?.path.join('.'))
  }
  const { weekly, settings } = parsed.data

  const upserts = weekly.flatMap((cell) =>
    cell.capacity === null
      ? []
      : [
          {
            tenant_id: tenantId,
            segment: cell.segment,
            iso_dow: cell.iso_dow,
            capacity: cell.capacity,
            warn_at: cell.warn_at,
          },
        ],
  )
  const clearedBySegment = new Map<SegmentKey, number[]>()
  for (const cell of weekly) {
    if (cell.capacity !== null) continue
    const list = clearedBySegment.get(cell.segment) ?? []
    list.push(cell.iso_dow)
    clearedBySegment.set(cell.segment, list)
  }

  const supabase = (await createClient()) as SBAny
  // Cada escritura viaja con su descripción: si el guardado queda a medias, la
  // auditoría tiene que decir cuáles entraron y cuáles no.
  const writes: Array<{ write: ConfigWrite; run: PromiseLike<{ error: PgError | null }> }> = []
  if (upserts.length > 0) {
    writes.push({
      write: { table: 'salon_segment_capacities', op: 'upsert' },
      run: supabase
        .from('salon_segment_capacities')
        .upsert(upserts, { onConflict: 'tenant_id,segment,iso_dow' }),
    })
  }
  for (const [segment, dows] of clearedBySegment) {
    writes.push({
      write: { table: 'salon_segment_capacities', op: 'delete', segment, iso_dows: dows },
      run: supabase
        .from('salon_segment_capacities')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('segment', segment)
        .in('iso_dow', dows),
    })
  }
  if (settings.length > 0) {
    writes.push({
      write: { table: 'salon_segment_settings', op: 'upsert' },
      run: supabase.from('salon_segment_settings').upsert(
        settings.map((s) => ({
          tenant_id: tenantId,
          segment: s.segment,
          default_time: s.default_time,
          warn_note: s.warn_note,
        })),
        { onConflict: 'tenant_id,segment' },
      ),
    })
  }

  const results = await Promise.all(writes.map((w) => w.run))
  const outcomes = writes.map((w, i) => ({ write: w.write, error: results[i]?.error ?? null }))

  // Solo números y horas. La nota del aviso es texto libre: se registra si
  // hay, no qué dice.
  const auditPayload = {
    weekly: weekly.map((c) => ({
      segment: c.segment,
      iso_dow: c.iso_dow,
      capacity: c.capacity,
      warn_at: c.warn_at,
    })),
    settings: settings.map((s) => ({
      segment: s.segment,
      default_time: s.default_time,
      has_warn_note: s.warn_note !== null,
    })),
  }

  const failed = outcomes.find((o) => o.error)?.error
  if (failed) {
    const applied = outcomes.filter((o) => !o.error).map((o) => o.write)
    if (applied.length > 0) {
      // Otra escritura sí entró: el cupo del bar cambió aunque el dueño vea un
      // error, y si no vuelve a guardar no queda rastro (CLAUDE.md §4.8). Mismo
      // action que el guardado completo, marcado como parcial, con lo que entró
      // y lo que no (solo el código de Postgres, sin el mensaje).
      await logAudit({
        tenantId,
        userId,
        action: 'salon_segment_config.updated',
        entity: 'salon_segment_config',
        payload: {
          ...auditPayload,
          partial: true,
          applied,
          failed: outcomes.flatMap((o) =>
            o.error ? [{ ...o.write, code: o.error.code ?? null }] : [],
          ),
        },
      })
      // Las pantallas tienen que mostrar lo que quedó guardado de verdad, no
      // lo de antes.
      revalidateSegmentViews(slug)
    }
    return writeFailure('saveConfig', tenantId, failed, CONFIG_FAILED)
  }

  await logAudit({
    tenantId,
    userId,
    action: 'salon_segment_config.updated',
    entity: 'salon_segment_config',
    payload: auditPayload,
  })

  revalidateSegmentViews(slug)
  return { ok: true, data: null, message: 'Cupos guardados.' }
}

// ──────────────────────────────────────────────────────────
// Cupo especial por fecha
// ──────────────────────────────────────────────────────────

/**
 * El especial vigente de (fecha, servicio), para devolverlo como `previous`:
 * el toast "Deshacer" lo restaura tal cual (o borra si no había ninguno).
 */
async function readOverride(
  supabase: SBAny,
  tenantId: string,
  date: string,
  segment: SegmentKey,
): Promise<{ row: SegmentOverrideRow | null; error: PgError | null }> {
  const { data, error } = await supabase
    .from('salon_segment_capacity_overrides')
    .select('segment, override_date, capacity, warn_at, reason')
    .eq('tenant_id', tenantId)
    .eq('override_date', date)
    .eq('segment', segment)
    .maybeSingle()
  if (error) return { row: null, error }
  return { row: data ? (toOverrideRows([data])[0] ?? null) : null, error: null }
}

/**
 * Crear o cambiar el cupo especial de un servicio en una fecha ("abrimos la
 * terraza", feriado). Lo usan el editor de Configuración, el "Cupo del día" y
 * el "Subir a N hoy" de la vista del día.
 */
export async function upsertSegmentOverride(
  slug: string,
  input: unknown,
): Promise<SegmentActionResult<{ previous: SegmentOverrideRow | null }>> {
  const auth = await authorize(slug, OWNER_ONLY, 'saveOverride', OVERRIDE_FAILED)
  if (!auth.ok) return auth.state
  const { tenantId, userId } = auth.access

  const parsed = segmentOverrideSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Revisá el cupo especial.', issue?.path.join('.'))
  }
  const o = parsed.data

  const supabase = (await createClient()) as SBAny
  const previous = await readOverride(supabase, tenantId, o.override_date, o.segment)
  if (previous.error) return writeFailure('saveOverride', tenantId, previous.error, OVERRIDE_FAILED)

  const { error } = await supabase.from('salon_segment_capacity_overrides').upsert(
    {
      tenant_id: tenantId,
      segment: o.segment,
      override_date: o.override_date,
      capacity: o.capacity,
      warn_at: o.warn_at,
      reason: o.reason,
      updated_by: userId,
    },
    { onConflict: 'tenant_id,override_date,segment' },
  )
  if (error) return writeFailure('saveOverride', tenantId, error, OVERRIDE_FAILED)

  await logAudit({
    tenantId,
    userId,
    action: 'salon_segment_override.saved',
    entity: 'salon_segment_override',
    // El motivo es texto libre ("cumple de …"): se registra si hay, no qué dice.
    payload: {
      override_date: o.override_date,
      segment: o.segment,
      capacity: o.capacity,
      warn_at: o.warn_at,
      has_reason: o.reason !== null,
      previous_capacity: previous.row?.capacity ?? null,
    },
  })

  revalidateSegmentViews(slug)
  return { ok: true, data: { previous: previous.row }, message: 'Cupo especial guardado.' }
}

/** Quitar el cupo especial: ese servicio vuelve al cupo del día de la semana. */
export async function removeSegmentOverride(
  slug: string,
  input: unknown,
): Promise<SegmentActionResult<{ previous: SegmentOverrideRow | null }>> {
  const auth = await authorize(slug, OWNER_ONLY, 'removeOverride', OVERRIDE_REMOVE_FAILED)
  if (!auth.ok) return auth.state
  const { tenantId, userId } = auth.access

  const parsed = segmentOverrideKeySchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Revisá la fecha y el servicio.', issue?.path.join('.'))
  }
  const { override_date, segment } = parsed.data

  const supabase = (await createClient()) as SBAny
  const previous = await readOverride(supabase, tenantId, override_date, segment)
  if (previous.error) {
    return writeFailure('removeOverride', tenantId, previous.error, OVERRIDE_REMOVE_FAILED)
  }
  // Ya no estaba (otro dueño lo quitó, o doble click): el resultado que quería
  // el dueño ya está, no es un error.
  if (!previous.row) return { ok: true, data: { previous: null } }

  const { error } = await supabase
    .from('salon_segment_capacity_overrides')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('override_date', override_date)
    .eq('segment', segment)
  if (error) return writeFailure('removeOverride', tenantId, error, OVERRIDE_REMOVE_FAILED)

  await logAudit({
    tenantId,
    userId,
    action: 'salon_segment_override.removed',
    entity: 'salon_segment_override',
    payload: {
      override_date,
      segment,
      previous_capacity: previous.row.capacity,
      previous_warn_at: previous.row.warn_at,
    },
  })

  revalidateSegmentViews(slug)
  return { ok: true, data: { previous: previous.row }, message: 'Cupo especial quitado.' }
}
