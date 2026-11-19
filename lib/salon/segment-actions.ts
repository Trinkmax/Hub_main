'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import {
  type BranchFilter,
  BranchForbiddenError,
  branchErrorMessage,
  branchFilterOf,
  branchForWrite,
  clampBranchFilter,
} from '@/lib/branches/filter'
import { getBranchScope } from '@/lib/branches/scope'
import type { BranchRef } from '@/lib/branches/types'
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
  branchHasFloors,
  type SegmentBranchScope,
  segmentScopeFromFilter,
  singleBranchSegmentScope,
} from './branch-scope'
import {
  type DayOverview,
  getDayOverview,
  getDaySegmentsSnapshot,
  searchReservationsByGuest,
} from './segment-queries'
import { isMissingTableError, type ReservationSearchResult, toOverrideRows } from './segment-rows'
import {
  branchSeatCapacitySchema,
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
const SEATS_FAILED = 'No se pudo guardar el cupo de la sucursal. Probá de nuevo.'
/**
 * Hasta la tanda 6 de las sucursales las tablas de cupo conservan su regla vieja «una fila por bar»: una segunda
 * sucursal todavía no puede guardar un cupo propio para el mismo servicio y día (o fecha) que ya tiene la principal.
 */
const ONE_PER_BAR_YET =
  'Todavía no se puede guardar un cupo propio para esta sucursal en ese día: por ahora vale el cupo general de la sucursal.'

/** El filtro que manda el navegador: `null` = todo el bar; si no, ids de sucursal. */
const branchFilterSchema = z
  .object({ ids: z.array(z.uuid()).max(50).nullable() })
  .nullable()
  .optional()

/**
 * Lo que mira la pantalla que pide, recortado a las sucursales de la persona (La regla para cada pantalla, punto 2).
 * `null` = el pedido no tiene forma de filtro.
 */
async function readSegmentScope(
  slug: string,
  requested: unknown,
): Promise<{ scope: SegmentBranchScope; filter: BranchFilter } | null> {
  const parsed = branchFilterSchema.safeParse(requested)
  if (!parsed.success) return null
  const branchScope = await getBranchScope(slug)
  const filter = clampBranchFilter(parsed.data ?? null, branchScope)
  return { scope: segmentScopeFromFilter(filter, branchScope.branches), filter }
}

/**
 * La sucursal en la que se guarda un cupo: la pedida (si la persona la ve) o la que se mira. Nunca «Todas»: el cupo
 * es de un lugar.
 */
async function capacityBranchForWrite(
  slug: string,
  requested: string | undefined,
): Promise<{ ok: true; branch: BranchRef } | { ok: false; state: Failure }> {
  const scope = await getBranchScope(slug)
  try {
    const id = branchForWrite(scope, requested)
    const branch = scope.branches.find((b) => b.id === id)
    if (!branch) throw new BranchForbiddenError()
    return { ok: true, branch }
  } catch (error) {
    const message = branchErrorMessage(error)
    if (message) return { ok: false, state: fail(message, 'branch_id') }
    throw error
  }
}

/** 23505 contra la regla vieja (por bar) y no contra la nueva (por sucursal): ver `ONE_PER_BAR_YET`. */
function isOldOnePerBarConflict(error: PgError): boolean {
  if (error.code !== '23505') return false
  const text = error.message ?? ''
  return (
    /ssc_one_per_day|sss_one_per_segment|ssco_one_per_day/.test(text) && !/_branch\b/.test(text)
  )
}

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
  if (isOldOnePerBarConflict(error)) return fail(ONE_PER_BAR_YET)
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
  /** El filtro con el que se dibujó el calendario (`useBranchScope().filter`). */
  branch?: BranchFilter | null,
): Promise<SegmentActionResult<DayOverview>> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return fail(INVALID_DATE, 'date')

  const auth = await authorize(slug, SALON_READ_ROLES, 'dayOverview', DAY_FAILED)
  if (!auth.ok) return auth.state

  try {
    const scoped = await readSegmentScope(slug, branch)
    if (!scoped) return fail(DAY_FAILED)
    const data = await getDayOverview({
      tenantId: auth.access.tenantId,
      date: parsed.data.date,
      scope: scoped.scope,
    })
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
  /**
   * La sucursal de la reserva que se está cargando: su cupo, sus reservas y sus eventos. Sin ella, lo que se mira
   * (en «Todas», sin cupo).
   */
  branchId?: string | null,
): Promise<SegmentActionResult<DaySegmentsSnapshot>> {
  const parsed = dayRequestSchema.safeParse({ date })
  if (!parsed.success) return fail(INVALID_DATE, 'date')
  const branchParsed = z.uuid().nullish().safeParse(branchId)
  if (!branchParsed.success) return fail(DAY_FAILED)

  const auth = await authorize(slug, SALON_READ_ROLES, 'daySegments', DAY_FAILED)
  if (!auth.ok) return auth.state

  try {
    const branchScope = await getBranchScope(slug)
    let scope: SegmentBranchScope
    if (branchParsed.data) {
      const branch = branchScope.branches.find((b) => b.id === branchParsed.data)
      if (!branch) return fail('Esa sucursal no es tuya. Elegí otra.', 'branch_id')
      scope = singleBranchSegmentScope(branch)
    } else {
      scope = segmentScopeFromFilter(branchFilterOf(branchScope), branchScope.branches)
    }
    const data = await getDaySegmentsSnapshot({
      tenantId: auth.access.tenantId,
      date: parsed.data.date,
      scope,
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
  /** El filtro con el que se dibujó el calendario. */
  branch?: BranchFilter | null,
): Promise<SegmentActionResult<ReservationSearchResult[]>> {
  const parsed = reservationSearchSchema.safeParse({ q })
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Escribí al menos 2 letras o números', 'q')
  }

  const auth = await authorize(slug, RESERVATION_STAFF_ROLES, 'search', SEARCH_FAILED)
  if (!auth.ok) return auth.state

  try {
    const scoped = await readSegmentScope(slug, branch)
    if (!scoped) return fail(SEARCH_FAILED)
    const data = await searchReservationsByGuest({
      tenantId: auth.access.tenantId,
      q: parsed.data.q,
      limit: 20,
      branch: scoped.filter,
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
  const target = await capacityBranchForWrite(slug, parsed.data.branch_id)
  if (!target.ok) return target.state
  const branchId = target.branch.id

  const upserts = weekly.flatMap((cell) =>
    cell.capacity === null
      ? []
      : [
          {
            tenant_id: tenantId,
            branch_id: branchId,
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
        .upsert(upserts, { onConflict: 'tenant_id,branch_id,segment,iso_dow' }),
    })
  }
  for (const [segment, dows] of clearedBySegment) {
    writes.push({
      write: { table: 'salon_segment_capacities', op: 'delete', segment, iso_dows: dows },
      run: supabase
        .from('salon_segment_capacities')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('branch_id', branchId)
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
          branch_id: branchId,
          segment: s.segment,
          default_time: s.default_time,
          warn_note: s.warn_note,
        })),
        { onConflict: 'tenant_id,branch_id,segment' },
      ),
    })
  }

  const results = await Promise.all(writes.map((w) => w.run))
  const outcomes = writes.map((w, i) => ({ write: w.write, error: results[i]?.error ?? null }))

  // Solo números y horas. La nota del aviso es texto libre: se registra si
  // hay, no qué dice.
  const auditPayload = {
    branch_id: branchId,
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
  branchId: string,
  date: string,
  segment: SegmentKey,
): Promise<{ row: SegmentOverrideRow | null; error: PgError | null }> {
  const { data, error } = await supabase
    .from('salon_segment_capacity_overrides')
    .select('segment, override_date, capacity, warn_at, reason')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
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
  const target = await capacityBranchForWrite(slug, o.branch_id)
  if (!target.ok) return target.state
  const branchId = target.branch.id

  const supabase = (await createClient()) as SBAny
  const previous = await readOverride(supabase, tenantId, branchId, o.override_date, o.segment)
  if (previous.error) return writeFailure('saveOverride', tenantId, previous.error, OVERRIDE_FAILED)

  const { error } = await supabase.from('salon_segment_capacity_overrides').upsert(
    {
      tenant_id: tenantId,
      branch_id: branchId,
      segment: o.segment,
      override_date: o.override_date,
      capacity: o.capacity,
      warn_at: o.warn_at,
      reason: o.reason,
      updated_by: userId,
    },
    { onConflict: 'tenant_id,branch_id,override_date,segment' },
  )
  if (error) return writeFailure('saveOverride', tenantId, error, OVERRIDE_FAILED)

  await logAudit({
    tenantId,
    userId,
    action: 'salon_segment_override.saved',
    entity: 'salon_segment_override',
    // El motivo es texto libre ("cumple de …"): se registra si hay, no qué dice.
    payload: {
      branch_id: branchId,
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
  const target = await capacityBranchForWrite(slug, parsed.data.branch_id)
  if (!target.ok) return target.state
  const branchId = target.branch.id

  const supabase = (await createClient()) as SBAny
  const previous = await readOverride(supabase, tenantId, branchId, override_date, segment)
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
    .eq('branch_id', branchId)
    .eq('override_date', override_date)
    .eq('segment', segment)
  if (error) return writeFailure('removeOverride', tenantId, error, OVERRIDE_REMOVE_FAILED)

  await logAudit({
    tenantId,
    userId,
    action: 'salon_segment_override.removed',
    entity: 'salon_segment_override',
    payload: {
      branch_id: branchId,
      override_date,
      segment,
      previous_capacity: previous.row.capacity,
      previous_warn_at: previous.row.warn_at,
    },
  })

  revalidateSegmentViews(slug)
  return { ok: true, data: { previous: previous.row }, message: 'Cupo especial quitado.' }
}

// ──────────────────────────────────────────────────────────
// Cupo general de una sucursal sin plantas
// ──────────────────────────────────────────────────────────

/**
 * Las sillas de una sucursal sin plantas (el Cerro): su cupo general, el de cada servicio que no tiene un cupo propio
 * en la grilla. La principal no se edita acá: su cupo general sale de sus plantas («Cupo general por planta»).
 *
 * Solo un dueño, con su sesión: la RLS de `branches` deja actualizar a los dueños del bar.
 */
export async function setBranchSeatCapacity(
  slug: string,
  input: unknown,
): Promise<SegmentActionResult<{ seatCapacity: number | null }>> {
  const auth = await authorize(slug, OWNER_ONLY, 'saveSeats', SEATS_FAILED)
  if (!auth.ok) return auth.state
  const { tenantId, userId } = auth.access

  const parsed = branchSeatCapacitySchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Revisá el cupo.', issue?.path.join('.'))
  }
  const target = await capacityBranchForWrite(slug, parsed.data.branch_id)
  if (!target.ok) return target.state
  if (branchHasFloors(target.branch)) {
    return fail(
      'El cupo general de esta sucursal sale de sus plantas: cambialo en «Cupo general por planta».',
    )
  }

  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('branches')
    .update({ seat_capacity: parsed.data.seat_capacity })
    .eq('tenant_id', tenantId)
    .eq('id', target.branch.id)
    .select('id')
  if (error) return writeFailure('saveSeats', tenantId, error, SEATS_FAILED)
  // Sin fila devuelta: la RLS no dejó (no es dueño de verdad, p. ej. con «Ver como»).
  if (!Array.isArray(data) || data.length === 0) return fail(FORBIDDEN)

  await logAudit({
    tenantId,
    userId,
    action: 'branch.seat_capacity.updated',
    entity: 'branch',
    entityId: target.branch.id,
    payload: {
      seat_capacity: parsed.data.seat_capacity,
      previous_seat_capacity: target.branch.seatCapacity,
    },
  })

  revalidateSegmentViews(slug)
  return {
    ok: true,
    data: { seatCapacity: parsed.data.seat_capacity },
    message: 'Cupo de la sucursal guardado.',
  }
}
