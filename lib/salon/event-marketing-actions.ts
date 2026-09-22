'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { todayInCordoba } from './date-presets'
import type { MarketingActionState } from './event-marketing'
import {
  deleteEventMarketingSchema,
  EVENT_MARKETING_DB_SELECT,
  type EventMarketingDbRow,
  MARKETING_FIELD_MESSAGES,
  markEventWithoutAdsSchema,
  marketingFieldErrors,
  type SaveEventMarketingInput,
  sameStoredRevenue,
  saveEventMarketingSchema,
  toEventMarketingRow,
  toMarketingDbFields,
} from './event-marketing-schemas'
import { getManagerForUser } from './queries'

/**
 * "Pauta en Meta" de «Cómo nos fue»: guardar, marcar sin pauta y borrar.
 *
 * Owner y nadie más, igual que la RLS (`sem_owner_all`) y que la page: es plata
 * del bar. Ninguna de las tres escribe a ciegas:
 *
 * - El ALTA es un `insert` pelado. Si otro dueño cargó la misma fecha un
 *   segundo antes, el unique `sem_one_per_edition` tira 23505 y se devuelve
 *   `stale`: nunca un upsert que pise sus números sin que nadie se entere.
 * - La EDICIÓN y el BORRADO van filtrados por el `updated_at` que el dueño
 *   tenía en pantalla. Si alguien la cambió en el medio, el filtro no matchea,
 *   vuelven 0 filas y también es `stale`. Es atómico: lo resuelve el WHERE, no
 *   una lectura previa que podría quedar vieja.
 *
 * Los logs llevan el `[dominio.op]` y el mensaje de Postgres, nada más. La nota
 * es texto libre (puede tener cualquier cosa) y no se loguea ni se audita.
 */

const COMO_NOS_FUE_PATH = (slug: string) => `/${slug}/estadisticas/como-nos-fue`

const FORBIDDEN = 'No tenés permiso para esa acción.'
const NOT_FOUND = 'No encontramos esa fecha. Puede que la hayan borrado del calendario.'
const INVALID = 'Revisá los números de la pauta.'
const SAVE_FAILED = 'No se pudo guardar la pauta. Probá de nuevo.'
const SAVE_STALE =
  'Otro dueño cambió esta pauta recién. Ya ves sus números: revisalos y guardá de nuevo.'
const NO_ADS_FAILED = 'No se pudo marcar la fecha sin pauta. Probá de nuevo.'
const NO_ADS_STALE = 'Esta fecha ya tiene pauta cargada. Recargá para verla.'
const DELETE_FAILED = 'No se pudo borrar la pauta. Probá de nuevo.'
const DELETE_STALE = 'Otro dueño cambió esta pauta recién. Recargá para ver sus números.'

type Failure = Extract<MarketingActionState, { ok: false }>
type PgError = { code?: string; message: string }

function fail(code: Failure['code'], message: string): Failure {
  return { ok: false, code, message }
}

type OwnerAuth = { ok: true; tenantId: string; userId: string } | { ok: false; state: Failure }

async function authorizeOwner(slug: unknown, op: string): Promise<OwnerAuth> {
  if (typeof slug !== 'string' || slug.length === 0) {
    return { ok: false, state: fail('forbidden', FORBIDDEN) }
  }
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return { ok: true, tenantId: tenant.id, userId: user.id }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return { ok: false, state: fail('forbidden', FORBIDDEN) }
    }
    // Un fallo de red o del RPC no es "no tenés permiso": decirlo así mandaría
    // al dueño a pedir un rol que ya tiene.
    console.error(`[event-marketing.${op}.auth]`, error instanceof Error ? error.message : error)
    return { ok: false, state: fail('error', SAVE_FAILED) }
  }
}

/**
 * Error de escritura → estado. 42501 es la RLS (le sacaron el rol entre la page
 * y el click) y 23503 es la FK compuesta (la fecha se borró del calendario en
 * el medio, o el id es de otro bar).
 */
function writeFailure(op: string, error: PgError, fallback: string): Failure {
  if (error.code === '42501') return fail('forbidden', FORBIDDEN)
  if (error.code === '23503') return fail('not_found', NOT_FOUND)
  console.error(`[event-marketing.${op}]`, error.code, error.message)
  return fail('error', fallback)
}

/**
 * El nombre de quien carga, para la firma «Cargó Nacho B.». Si la lectura
 * falla la pauta se guarda igual: devolver `error` con los números ya escritos
 * haría que el dueño los cargue dos veces.
 */
async function loadManagerName(tenantId: string, userId: string): Promise<string | null> {
  try {
    const manager = await getManagerForUser({ tenantId, userId })
    return manager?.display_name ?? null
  } catch (error) {
    console.error(
      '[event-marketing.managerName]',
      error instanceof Error ? error.message : 'lectura fallida',
    )
    return null
  }
}

function auditNumbers(row: EventMarketingDbRow) {
  return {
    ad_spend_usd_cents: Number(row.ad_spend_usd_cents),
    messages: row.messages === null ? null : Number(row.messages),
    reach: row.reach === null ? null : Number(row.reach),
    revenue_ars_cents: row.revenue_ars_cents === null ? null : Number(row.revenue_ars_cents),
    usd_ars_rate: row.usd_ars_rate === null ? null : Number(row.usd_ars_rate),
    // La plata por persona también queda en la historia: es con la que se
    // calcula el resultado de la noche, y si mañana cambia hay que poder decir
    // con qué números estaba hecha la cuenta de ayer.
    revenue_per_guest_ars_cents:
      row.revenue_per_guest_ars_cents === null ? null : Number(row.revenue_per_guest_ars_cents),
    cost_per_guest_ars_cents:
      row.cost_per_guest_ars_cents === null ? null : Number(row.cost_per_guest_ars_cents),
  }
}

export async function saveEventMarketing(
  slug: string,
  input: SaveEventMarketingInput,
): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug, 'save')
  if (!auth.ok) return auth.state

  const parsed = saveEventMarketingSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors = marketingFieldErrors(parsed.error)
    const first = Object.values(fieldErrors)[0]
    return {
      ok: false,
      code: 'invalid',
      message: first ?? parsed.error.issues[0]?.message ?? INVALID,
      fieldErrors,
    }
  }
  const values = parsed.data

  const supabase = await createClient()
  // La edición tiene que ser de ESTE bar (la FK compuesta lo garantiza igual,
  // pero así el dueño lee "no encontramos esa fecha" y no un error de
  // Postgres), y hace falta su fecha para la regla de la facturación. El nombre
  // no depende de nada: va en paralelo.
  const [eventRes, managerName] = await Promise.all([
    supabase
      .from('scheduled_events')
      .select('id, event_date')
      .eq('tenant_id', auth.tenantId)
      .eq('id', values.scheduledEventId)
      .maybeSingle(),
    loadManagerName(auth.tenantId, auth.userId),
  ])
  if (eventRes.error) {
    console.error('[event-marketing.save.event]', eventRes.error.code, eventRes.error.message)
    return fail('error', SAVE_FAILED)
  }
  const event = eventRes.data as { id: string; event_date: string } | null
  if (!event) return fail('not_found', NOT_FOUND)

  const fields = toMarketingDbFields(values)

  // Hoy SÍ deja: la noche ya arrancó y el dueño puede tener la caja cerrada.
  // Una fecha futura todavía no facturó nada: ahí no se carga ni se cambia la
  // facturación. La única excepción es la que YA estaba guardada (la edición se
  // movió a una fecha futura): viaja tal cual y se deja, si no corregir una nota
  // obligaba a borrarla.
  //
  // El ingreso y el costo POR PERSONA no entran en esta regla: son lo que el
  // dueño estima de antemano («el ramen sale 27 mil y me cuesta 15 mil»), no un
  // número de la caja. Cargarlos antes de la fecha es exactamente para lo que
  // sirven.
  if (values.revenueArs !== null && event.event_date > todayInCordoba()) {
    let unchanged = false
    if (values.expectedUpdatedAt !== null) {
      // Contra la versión que el dueño tenía delante. Si otro dueño la cambió
      // después de esta lectura, el update de abajo (mismo filtro) rebota igual.
      const storedRes = await supabase
        .from('scheduled_event_marketing')
        .select('revenue_ars_cents')
        .eq('tenant_id', auth.tenantId)
        .eq('scheduled_event_id', values.scheduledEventId)
        .eq('updated_at', values.expectedUpdatedAt)
        .maybeSingle()
      if (storedRes.error) {
        console.error(
          '[event-marketing.save.revenue]',
          storedRes.error.code,
          storedRes.error.message,
        )
        return fail('error', SAVE_FAILED)
      }
      if (!storedRes.data) return fail('stale', SAVE_STALE)
      unchanged = sameStoredRevenue(
        fields,
        storedRes.data as Pick<EventMarketingDbRow, 'revenue_ars_cents'>,
      )
    }
    if (!unchanged) {
      return {
        ok: false,
        code: 'invalid',
        message: MARKETING_FIELD_MESSAGES.revenueInFuture,
        fieldErrors: { revenueArs: MARKETING_FIELD_MESSAGES.revenueInFuture },
      }
    }
  }

  const hadRow = values.expectedUpdatedAt !== null
  let saved: EventMarketingDbRow

  if (values.expectedUpdatedAt === null) {
    const { data, error } = await supabase
      .from('scheduled_event_marketing')
      .insert({
        tenant_id: auth.tenantId,
        scheduled_event_id: values.scheduledEventId,
        ...fields,
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select(EVENT_MARKETING_DB_SELECT)
      .single()
    if (error) {
      if (error.code === '23505') return fail('stale', SAVE_STALE)
      return writeFailure('save.insert', error, SAVE_FAILED)
    }
    saved = data as EventMarketingDbRow
  } else {
    const { data, error } = await supabase
      .from('scheduled_event_marketing')
      .update({ ...fields, updated_by: auth.userId })
      .eq('tenant_id', auth.tenantId)
      .eq('scheduled_event_id', values.scheduledEventId)
      .eq('updated_at', values.expectedUpdatedAt)
      .select(EVENT_MARKETING_DB_SELECT)
      .maybeSingle()
    if (error) return writeFailure('save.update', error, SAVE_FAILED)
    // 0 filas: otro dueño la editó (cambió `updated_at`) o la borró.
    if (!data) return fail('stale', SAVE_STALE)
    saved = data as EventMarketingDbRow
  }

  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'scheduled_event_marketing.saved',
    entity: 'scheduled_event',
    entityId: values.scheduledEventId,
    payload: { ...auditNumbers(saved), had_row: hadRow },
  })

  revalidatePath(COMO_NOS_FUE_PATH(slug))
  return { ok: true, row: toEventMarketingRow(saved, managerName) }
}

/**
 * «No tuvo pauta»: una fila con gasto 0 y nada más. La plata de esa noche
 * orgánica (ingreso y costo por persona) se suma después con «Sumar la plata»,
 * que pasa por `saveEventMarketing`. Solo alta: si la fecha ya tiene fila,
 * alguien cargó algo y no se pisa.
 */
export async function markEventWithoutAds(
  slug: string,
  scheduledEventId: string,
): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug, 'noAds')
  if (!auth.ok) return auth.state

  const parsed = markEventWithoutAdsSchema.safeParse({ scheduledEventId })
  if (!parsed.success) return fail('invalid', parsed.error.issues[0]?.message ?? INVALID)
  const eventId = parsed.data.scheduledEventId

  const supabase = await createClient()
  // La edición tiene que ser de ESTE bar ANTES del insert, igual que en
  // `saveEventMarketing`. Sin esta lectura, con el id de una fecha de otro bar
  // el unique global `sem_one_per_edition` (23505 → «ya tiene pauta») salta
  // antes que la FK compuesta (23503 → not_found), y la diferencia le cuenta a
  // cualquier dueño si ese otro bar cargó pauta para esa fecha.
  const [eventRes, managerName] = await Promise.all([
    supabase
      .from('scheduled_events')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('id', eventId)
      .maybeSingle(),
    loadManagerName(auth.tenantId, auth.userId),
  ])
  if (eventRes.error) {
    console.error('[event-marketing.noAds.event]', eventRes.error.code, eventRes.error.message)
    return fail('error', NO_ADS_FAILED)
  }
  if (!eventRes.data) return fail('not_found', NOT_FOUND)

  // La FK compuesta sigue cubriendo una fecha borrada entre la lectura y el insert.
  const insertRes = await supabase
    .from('scheduled_event_marketing')
    .insert({
      tenant_id: auth.tenantId,
      scheduled_event_id: eventId,
      ad_spend_usd_cents: 0,
      created_by: auth.userId,
      updated_by: auth.userId,
    })
    .select(EVENT_MARKETING_DB_SELECT)
    .single()
  if (insertRes.error) {
    if (insertRes.error.code === '23505') return fail('stale', NO_ADS_STALE)
    return writeFailure('noAds.insert', insertRes.error, NO_ADS_FAILED)
  }
  const saved = insertRes.data as EventMarketingDbRow

  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'scheduled_event_marketing.no_ads',
    entity: 'scheduled_event',
    entityId: eventId,
    payload: { ad_spend_usd_cents: 0 },
  })

  revalidatePath(COMO_NOS_FUE_PATH(slug))
  return { ok: true, row: toEventMarketingRow(saved, managerName) }
}

/**
 * Borra la pauta de una fecha, solo si sigue siendo la versión que el dueño
 * vio. También es el «Deshacer» de «No tuvo pauta».
 */
export async function deleteEventMarketing(
  slug: string,
  scheduledEventId: string,
  expectedUpdatedAt: string,
): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug, 'delete')
  if (!auth.ok) return auth.state

  const parsed = deleteEventMarketingSchema.safeParse({ scheduledEventId, expectedUpdatedAt })
  if (!parsed.success) return fail('invalid', parsed.error.issues[0]?.message ?? INVALID)

  const supabase = await createClient()
  // `delete … returning` en vez de leer y después borrar: los números que van
  // al audit son EXACTAMENTE los de la fila que se borró, sin carrera entre
  // las dos lecturas.
  const { data, error } = await supabase
    .from('scheduled_event_marketing')
    .delete()
    .eq('tenant_id', auth.tenantId)
    .eq('scheduled_event_id', parsed.data.scheduledEventId)
    .eq('updated_at', parsed.data.expectedUpdatedAt)
    .select(EVENT_MARKETING_DB_SELECT)
  if (error) return writeFailure('delete', error, DELETE_FAILED)
  const deleted = ((data ?? []) as EventMarketingDbRow[])[0]
  if (!deleted) return fail('stale', DELETE_STALE)

  // La plata borrada queda en `audit_log`: la pantalla la pierde, la historia no.
  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'scheduled_event_marketing.deleted',
    entity: 'scheduled_event',
    entityId: parsed.data.scheduledEventId,
    payload: { ...auditNumbers(deleted), had_notes: deleted.notes !== null },
  })

  revalidatePath(COMO_NOS_FUE_PATH(slug))
  return { ok: true, row: null }
}
