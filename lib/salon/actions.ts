'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RESERVATION_OPERATOR_ROLES,
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TEMPLATE_EDIT_ROLES,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import {
  mergeProfileAlerts,
  parseServiceAlerts,
  personScopedAlerts,
  type ServiceAlert,
} from './alerts'
import { eventDateMismatchCode, humanizeSalonError } from './humanize'
import { LAST_MANAGER_COOKIE_MAX_AGE, lastManagerCookieName } from './managers'
import {
  actualGuestsSchema,
  bonusRuleSchema,
  bulkActualGuestsSchema,
  cakeOptionSchema,
  cancelReservationSchema,
  createSalonReservationSchema,
  idOnlySchema,
  managerSchema,
  markPaidSchema,
  moveScheduledEventSchema,
  quickTemplateSchema,
  rateTierSchema,
  scheduledEventSchema,
  scheduledTemplateSchema,
  transitionStatusSchema,
  updateSalonReservationSchema,
  zoneCapacityDefaultsSchema,
  zoneCapacityOverrideSchema,
} from './schemas'
import { uniqueSlugFrom } from './slug-dedupe'
import type { SalonReservationStatus } from './types'

// ──────────────────────────────────────────────────────────
// Tipos comunes
// ──────────────────────────────────────────────────────────

export type ActionState =
  | { ok: true; message?: string; data?: Record<string, unknown> }
  | { ok: false; message: string; code?: string; field?: string }

// biome-ignore lint/suspicious/noExplicitAny: pending generated types
type SBAny = any

// ──────────────────────────────────────────────────────────
// Authorize helpers
// ──────────────────────────────────────────────────────────

async function authorize(
  slug: string,
  allowed: ReadonlyArray<TenantRole>,
): Promise<{ tenant: Tenant; role: TenantRole } | null> {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, allowed)
    return access
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    )
      return null
    throw error
  }
}

const STAFF = RESERVATION_STAFF_ROLES
const OPERATORS = RESERVATION_OPERATOR_ROLES
const TEMPLATE_EDITORS = TEMPLATE_EDIT_ROLES
const OWNER_ONLY = ['owner'] as const satisfies ReadonlyArray<TenantRole>

function noAccess(): ActionState {
  return { ok: false, message: 'No tenés permiso para esa acción.' }
}

function badInput(msg: string, field?: string): ActionState {
  return { ok: false, message: msg, field }
}

function asObject(input: FormData | Record<string, unknown>): Record<string, unknown> {
  if (input instanceof FormData) {
    const obj: Record<string, unknown> = {}
    for (const [key, value] of input.entries()) {
      // Si la key se repite (multi-select), convertirla en array
      if (key in obj) {
        const cur = obj[key]
        obj[key] = Array.isArray(cur) ? [...cur, value] : [cur, value]
      } else {
        obj[key] = value
      }
    }
    return obj
  }
  return input
}

// ──────────────────────────────────────────────────────────
// Helpers de reservas
// ──────────────────────────────────────────────────────────

/**
 * Marca al cliente como "adquirido por reserva".
 *
 * La pestaña Personas → Reservas filtra por `customers.acquisition_channel =
 * 'reservation'`, y ese canal solo se escribía cuando la reserva CREABA el
 * cliente. Si la reserva reusaba un cliente que ya existía (alta por QR del
 * club, walk-in, import), el canal quedaba en el viejo y el cliente nunca
 * aparecía ahí aunque tuviera reservas.
 *
 * Best-effort igual que el insert del cliente: si falla, la reserva se guarda
 * igual. Pero lo logueamos con contexto (sin PII: solo ids) — antes se tragaba
 * el error en silencio y por eso nadie vio el bug durante meses.
 */
async function markCustomerAcquiredByReservation(
  supabase: SBAny,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from('customers')
    .select('acquisition_channel')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle()

  if (readError) {
    console.error('[salon.reservation] no pudimos leer acquisition_channel', {
      tenantId,
      customerId,
      error: readError.message,
    })
    return
  }
  if (
    !current ||
    (current as { acquisition_channel: string | null }).acquisition_channel === 'reservation'
  ) {
    return
  }

  const { error: updateError } = await supabase
    .from('customers')
    .update({ acquisition_channel: 'reservation' })
    .eq('tenant_id', tenantId)
    .eq('id', customerId)

  if (updateError) {
    console.error('[salon.reservation] no pudimos marcar acquisition_channel=reservation', {
      tenantId,
      customerId,
      error: updateError.message,
    })
  }
}

/**
 * Sube a la ficha del cliente los avisos que son de la PERSONA (celíaca,
 * alérgica, vegana, movilidad reducida) — no los de la noche (silla de bebé).
 *
 * Es lo que hace que nadie tenga que acordarse de recargar "celíaca" en cada
 * reserva: el que la carga se entera una vez y el CRM lo recuerda. Aditivo a
 * propósito: desmarcar el chip en la reserva del viernes NO borra la ficha, o
 * un descuido dejaría sin aviso a las otras veinte reservas de esa persona.
 * Para sacarlo de verdad se edita la ficha.
 *
 * Best-effort, igual que el link del cliente: si falla, la reserva se guarda
 * igual con SUS avisos (que es lo que el mozo va a ver esa noche). Se loguea
 * sin PII: solo ids.
 */
async function syncCustomerServiceAlerts(
  supabase: SBAny,
  tenantId: string,
  customerId: string,
  alerts: ReadonlyArray<ServiceAlert> | undefined,
): Promise<void> {
  const incoming = personScopedAlerts(alerts ?? [])
  if (incoming.length === 0) return

  const { data: current, error: readError } = await supabase
    .from('customers')
    .select('service_alerts')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle()

  if (readError || !current) {
    if (readError) {
      console.error('[salon.reservation] no pudimos leer service_alerts del cliente', {
        tenantId,
        customerId,
        error: readError.message,
      })
    }
    return
  }

  const merged = mergeProfileAlerts(
    (current as { service_alerts: unknown }).service_alerts,
    incoming,
  )
  const before = parseServiceAlerts((current as { service_alerts: unknown }).service_alerts)
  if (merged.length === before.length) return // ya los sabía

  const { error: updateError } = await supabase
    .from('customers')
    .update({ service_alerts: merged })
    .eq('tenant_id', tenantId)
    .eq('id', customerId)

  if (updateError) {
    console.error('[salon.reservation] no pudimos guardar los avisos en la ficha', {
      tenantId,
      customerId,
      error: updateError.message,
    })
    return
  }

  // Es un dato de salud y queda pegado a la persona: cuando aparezca el primer
  // "¿quién marcó a este señor como celíaco?" tiene que haber respuesta.
  // Guardamos las claves del aviso, nunca el nombre ni el teléfono.
  await logAudit({
    tenantId,
    userId: null,
    action: 'customer.service_alerts.updated',
    entity: 'customer',
    entityId: customerId,
    payload: { added: merged.filter((a) => !before.includes(a)), source: 'reservation' },
  })
}

/**
 * Chequea que el evento programado sea de este bar y de la MISMA fecha que la
 * reserva. El trigger `trg_validate_reservation_event_date` es la garantía
 * dura; esto lo adelanta para devolver un error de campo (se pinta abajo del
 * combo de evento) en vez de una excepción cruda de Postgres.
 *
 * Devuelve el `ActionState` de error, o `null` si está todo bien.
 */
async function checkEventMatchesDate(
  supabase: SBAny,
  tenantId: string,
  eventId: string,
  reservationDate: string,
): Promise<ActionState | null> {
  const { data, error } = await supabase
    .from('scheduled_events')
    .select('event_date, tenant_id')
    .eq('id', eventId)
    .maybeSingle()

  if (error) {
    console.error('[salon.reservation] no pudimos validar la fecha del evento', {
      tenantId,
      eventId,
      error: error.message,
    })
    // Sin lectura no bloqueamos: el trigger sigue cubriendo el caso.
    return null
  }
  if (!data) {
    return badInput(humanizeSalonError('reservation_event_not_found'), 'scheduled_event_id')
  }

  const row = data as { event_date: string; tenant_id: string }
  if (row.tenant_id !== tenantId) {
    return badInput(humanizeSalonError('reservation_event_tenant_mismatch'), 'scheduled_event_id')
  }
  if (row.event_date !== reservationDate) {
    return badInput(humanizeSalonError(eventDateMismatchCode(row.event_date)), 'scheduled_event_id')
  }
  return null
}

// ──────────────────────────────────────────────────────────
// Reservas — CRUD
// ──────────────────────────────────────────────────────────

export async function createSalonReservation(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, STAFF)
  if (!access) return noAccess()

  const parsed = createSalonReservationSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny

  // Auto-link cliente existente si el phone matchea uno del tenant.
  let customerId = parsed.data.customer_id ?? null
  if (!customerId && parsed.data.guest_phone) {
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', access.tenant.id)
      .eq('phone', parsed.data.guest_phone)
      .is('deleted_at', null)
      .maybeSingle()
    if (existing) customerId = (existing as { id: string }).id
  }

  // Si no existe el cliente, lo creamos desde la reserva (acquisition='reservation')
  // para que la gente que SOLO reservó aparezca en Personas → Reservas. Best-effort:
  // si falla (RLS/constraint), la reserva igual se crea con customer_id null.
  if (!customerId && parsed.data.guest_phone && parsed.data.guest_name?.trim()) {
    const parts = parsed.data.guest_name.trim().split(/\s+/)
    const firstName = parts[0] ?? parsed.data.guest_name.trim()
    const lastName = parts.slice(1).join(' ') || '—'
    const { data: created } = await supabase
      .from('customers')
      .insert({
        tenant_id: access.tenant.id,
        phone: parsed.data.guest_phone,
        first_name: firstName,
        last_name: lastName,
        source: 'manual',
        acquisition_channel: 'reservation',
      })
      .select('id')
      .maybeSingle()
    if (created) customerId = (created as { id: string }).id
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Reserva especial pidiendo un formato calendarizado (ej. Pizza Libre en una
  // recibida del martes sin pizza libre programada): aseguramos que exista
  // una scheduled_event ese día via helper SQL. Pisa cualquier scheduled_event_id
  // del input — la prioridad de las reservas especiales es el formato pedido.
  let scheduledEventIdFinal = parsed.data.scheduled_event_id ?? null
  if (parsed.data.requested_template_id && parsed.data.kind !== 'normal') {
    const { data: ensuredId, error: ensureErr } = await supabase.rpc(
      'ensure_scheduled_event_for_template',
      {
        p_template_id: parsed.data.requested_template_id,
        p_event_date: parsed.data.reservation_date,
        p_starts_at_local: parsed.data.reservation_time_local,
        p_capacity: null,
      },
    )
    if (ensureErr) {
      return { ok: false, message: humanizeSalonError(ensureErr.message), code: ensureErr.message }
    }
    scheduledEventIdFinal = ensuredId as string
  }

  if (scheduledEventIdFinal) {
    const mismatch = await checkEventMatchesDate(
      supabase,
      access.tenant.id,
      scheduledEventIdFinal,
      parsed.data.reservation_date,
    )
    if (mismatch) return mismatch
  }

  const { data, error } = await supabase
    .from('salon_reservations')
    .insert({
      tenant_id: access.tenant.id,
      customer_id: customerId,
      guest_name: parsed.data.guest_name,
      guest_phone: parsed.data.guest_phone ?? null,
      guest_email: parsed.data.guest_email ?? null,
      kind: parsed.data.kind,
      meal_type: parsed.data.meal_type,
      reservation_date: parsed.data.reservation_date,
      reservation_time_local: parsed.data.reservation_time_local,
      reservation_end_time_local: parsed.data.reservation_end_time_local ?? null,
      zone: parsed.data.zone,
      scheduled_event_id: scheduledEventIdFinal,
      estimated_guests: parsed.data.estimated_guests,
      cake_count: parsed.data.cake_count,
      // Elegir torta sin decir que traen torta deja a la cocina sin cantidad, y
      // la DB lo rechaza con un check. Manda `cake_count`: si es 0, no hay torta
      // y tampoco sabor — así "saqué la torta" limpia las dos cosas de una.
      cake_option_id: parsed.data.cake_count > 0 ? (parsed.data.cake_option_id ?? null) : null,
      champagne_count: parsed.data.champagne_count,
      deposit_cents: parsed.data.deposit_cents,
      origin: parsed.data.origin,
      primary_manager_id: parsed.data.primary_manager_id,
      assistant_manager_id: parsed.data.assistant_manager_id ?? null,
      comments: parsed.data.comments ?? null,
      service_alerts: parsed.data.service_alerts ?? [],
      highlight_comment: parsed.data.highlight_comment ?? false,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, message: humanizeSalonError(error.message), code: error.message }

  const newId = (data as { id: string }).id

  // Recién ahora que la reserva existe: el cliente preexistente (elegido en el
  // combo o matcheado por teléfono) pasa a contarse como adquirido por reserva,
  // así aparece en Personas → Reservas. Va DESPUÉS del insert a propósito — si
  // se marcaba antes, una reserva rechazada (fecha que no coincide con el
  // evento) dejaba al cliente reetiquetado sin tener ninguna reserva.
  if (customerId) {
    await markCustomerAcquiredByReservation(supabase, access.tenant.id, customerId)
    await syncCustomerServiceAlerts(
      supabase,
      access.tenant.id,
      customerId,
      parsed.data.service_alerts,
    )
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user?.id ?? null,
    action: 'salon_reservation.created',
    entity: 'salon_reservation',
    entityId: newId,
    payload: {
      kind: parsed.data.kind,
      meal_type: parsed.data.meal_type,
      estimated_guests: parsed.data.estimated_guests,
      manager: parsed.data.primary_manager_id,
      origin: parsed.data.origin,
    },
  })

  // Memoria del combo de gestores para la próxima carga en este dispositivo.
  // La escribe el server (httpOnly) y la lee /reservas/nuevo, así el default
  // llega resuelto en el HTML y no parpadea al hidratar.
  ;(await cookies()).set(lastManagerCookieName(slug), parsed.data.primary_manager_id, {
    path: '/',
    maxAge: LAST_MANAGER_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  return { ok: true, message: 'Reserva creada.', data: { id: newId } }
}

export async function updateSalonReservation(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, STAFF)
  if (!access) return noAccess()

  const parsed = updateSalonReservationSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const { id, ...patch } = parsed.data

  if (patch.scheduled_event_id) {
    const mismatch = await checkEventMatchesDate(
      supabase,
      access.tenant.id,
      patch.scheduled_event_id,
      patch.reservation_date,
    )
    if (mismatch) return mismatch
  }

  const { error } = await supabase
    .from('salon_reservations')
    .update({
      customer_id: patch.customer_id ?? null,
      guest_name: patch.guest_name,
      guest_phone: patch.guest_phone ?? null,
      guest_email: patch.guest_email ?? null,
      kind: patch.kind,
      meal_type: patch.meal_type,
      reservation_date: patch.reservation_date,
      reservation_time_local: patch.reservation_time_local,
      // Solo si el payload la trae. Ausente ≠ vacía: una edición parcial (el
      // quick-view mueve la hora o las personas) no tiene por qué borrar el fin.
      ...(patch.reservation_end_time_local !== undefined
        ? { reservation_end_time_local: patch.reservation_end_time_local }
        : {}),
      zone: patch.zone,
      scheduled_event_id: patch.scheduled_event_id ?? null,
      estimated_guests: patch.estimated_guests,
      // Ausente ≠ vacío, igual que los avisos y el horario de fin. El form de
      // edición valida con `createSalonReservationSchema`, que NO tiene este
      // campo, así que zod lo strippea del payload: con `?? null`, guardar
      // cualquier cambio de una reserva borraba la asistencia ya registrada y
      // volvía a facturarle al gestor por el estimado.
      ...(patch.actual_guests !== undefined ? { actual_guests: patch.actual_guests } : {}),
      cake_count: patch.cake_count,
      // Ausente ≠ vacío, igual que los avisos: el popup del listado manda un
      // payload completo cada vez que se mueve la hora, y sin esta guarda cada
      // toque borraría qué torta hay que hacer. Con `cake_count` en 0 se limpia
      // siempre (dejaron de traer torta ⇒ no hay sabor que guardar).
      ...(patch.cake_count === 0
        ? { cake_option_id: null }
        : patch.cake_option_id !== undefined
          ? { cake_option_id: patch.cake_option_id }
          : {}),
      champagne_count: patch.champagne_count,
      deposit_cents: patch.deposit_cents,
      origin: patch.origin,
      primary_manager_id: patch.primary_manager_id,
      assistant_manager_id: patch.assistant_manager_id ?? null,
      comments: patch.comments ?? null,
      // Ausente ≠ vacío, igual que el horario de fin: una edición parcial no
      // puede borrar el aviso de que la mesa es celíaca.
      ...(patch.service_alerts !== undefined ? { service_alerts: patch.service_alerts } : {}),
      ...(patch.highlight_comment !== undefined
        ? { highlight_comment: patch.highlight_comment }
        : {}),
    })
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  // Re-vincular un cliente desde la edición cuenta igual que vincularlo al
  // crear: si no, la reserva queda linkeada pero el cliente sigue fuera de
  // Personas → Reservas.
  if (patch.customer_id) {
    await markCustomerAcquiredByReservation(supabase, access.tenant.id, patch.customer_id)
    await syncCustomerServiceAlerts(
      supabase,
      access.tenant.id,
      patch.customer_id,
      patch.service_alerts,
    )
  }

  // Si cambió gestor / actual_guests / meal_type, recalc.
  await supabase.rpc('recalc_reservation_commission', { p_reservation_id: id })

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'salon_reservation.updated',
    entity: 'salon_reservation',
    entityId: id,
  })

  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/reservas/${id}`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  revalidatePath(`/${slug}/operativo`)
  return { ok: true, message: 'Reserva actualizada.' }
}

export async function cancelSalonReservation(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, STAFF)
  if (!access) return noAccess()

  const parsed = cancelReservationSchema.safeParse(asObject(input))
  if (!parsed.success) return badInput('ID inválido')

  const supabase = (await createClient()) as SBAny
  const { error } = await supabase
    .from('salon_reservations')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_reason: parsed.data.reason ?? null,
    })
    .eq('tenant_id', access.tenant.id)
    .eq('id', parsed.data.id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  await supabase.rpc('recalc_reservation_commission', { p_reservation_id: parsed.data.id })

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'salon_reservation.cancelled',
    entity: 'salon_reservation',
    entityId: parsed.data.id,
    payload: { reason: parsed.data.reason ?? null },
  })

  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  revalidatePath(`/${slug}/operativo`)
  revalidatePath(`/${slug}/eventos`)
  return { ok: true, message: 'Reserva cancelada.' }
}

// ──────────────────────────────────────────────────────────
// Reservas — transiciones operativas (waiter incluido)
// ──────────────────────────────────────────────────────────

export async function transitionStatus(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OPERATORS)
  if (!access) return noAccess()

  const parsed = transitionStatusSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase.rpc('transition_reservation_status', {
    p_reservation_id: parsed.data.id,
    p_to: parsed.data.to,
    p_actual_guests: parsed.data.actual_guests ?? null,
  })
  if (error) return { ok: false, message: humanizeSalonError(error.message), code: error.message }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: `salon_reservation.${parsed.data.to}`,
    entity: 'salon_reservation',
    entityId: parsed.data.id,
    payload: { actual_guests: parsed.data.actual_guests ?? null },
  })

  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/reservas/${parsed.data.id}`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  revalidatePath(`/${slug}/operativo`)
  return { ok: true, data: { row: data as unknown as Record<string, unknown> } }
}

// Wrappers cómodos para llamar desde botones
/**
 * Marca la llegada y, si se lo pasan, registra de una la cantidad real.
 *
 * El `actualGuests` es opcional porque no todos los caminos lo saben: el panel
 * de mozos ahora sí lo pregunta (es el único momento en que alguien tiene la
 * gente adelante), pero el tablero del dueño marca llegadas sueltas. Cuando no
 * viene, `actual_guests` queda en null — que significa "nadie contó", distinto
 * de "vinieron los que reservaron".
 */
export async function markArrived(
  slug: string,
  id: string,
  actualGuests?: number,
): Promise<ActionState> {
  return transitionStatus(slug, {
    id,
    to: 'arrived' as SalonReservationStatus,
    ...(typeof actualGuests === 'number' ? { actual_guests: actualGuests } : {}),
  })
}
export async function markSeated(slug: string, id: string): Promise<ActionState> {
  return transitionStatus(slug, { id, to: 'seated' as SalonReservationStatus })
}
export async function markNoShow(slug: string, id: string): Promise<ActionState> {
  return transitionStatus(slug, { id, to: 'no_show' as SalonReservationStatus })
}
export async function markClosed(
  slug: string,
  id: string,
  actualGuests: number,
): Promise<ActionState> {
  return transitionStatus(slug, {
    id,
    to: 'closed' as SalonReservationStatus,
    actual_guests: actualGuests,
  })
}
export async function revertStatus(
  slug: string,
  id: string,
  to: SalonReservationStatus,
): Promise<ActionState> {
  return transitionStatus(slug, { id, to })
}

export async function updateActualGuests(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OPERATORS)
  if (!access) return noAccess()

  const parsed = actualGuestsSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const { error } = await supabase.rpc('update_reservation_actual_guests', {
    p_reservation_id: parsed.data.id,
    p_actual_guests: parsed.data.actual_guests,
  })
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'salon_reservation.actual_guests_updated',
    entity: 'salon_reservation',
    entityId: parsed.data.id,
    payload: { actual_guests: parsed.data.actual_guests },
  })

  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  revalidatePath(`/${slug}/operativo`)
  return { ok: true }
}

/**
 * Guarda de una pasada la asistencia real de varias reservas: es el "Pasar
 * lista" del cierre de la noche.
 *
 * Una reserva en `pending` además pasa a `arrived`: si alguien anota que
 * vinieron 18, vinieron, y dejarla en "pendiente" haría que el registro se
 * contradiga solo. Marcarlas una por una y después contar era justo la fricción
 * que dejó 111 de 137 reservas sin registrar.
 *
 * No mueve comisiones: desde 20260903124825 la liquidación se calcula sobre
 * `estimated_guests`. Ver esa migración para el porqué — en dos palabras, quien
 * escribe el número no puede ser quien lo paga.
 *
 * Va fila por fila y NO aborta al primer error: en un cierre de noche, que se
 * caiga todo el guardado porque una reserva se canceló mientras tanto sería
 * peor que guardar 19 de 20 y decir cuál falló. Devuelve el conteo y los ids
 * que no entraron.
 */
export async function bulkUpdateActualGuests(
  slug: string,
  input: Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OPERATORS)
  if (!access) return noAccess()

  const parsed = bulkActualGuestsSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny

  // Estados actuales en UNA lectura: decide por fila si hay que transicionar a
  // 'arrived' o solo corregir el número. Pedirlos de a uno serían N hops.
  const ids = parsed.data.entries.map((e) => e.id)
  const { data: rows, error: readError } = await supabase
    .from('salon_reservations')
    .select('id, status')
    .eq('tenant_id', access.tenant.id)
    .in('id', ids)
  if (readError) return { ok: false, message: humanizeSalonError(readError.message) }

  const statusById = new Map(
    ((rows ?? []) as Array<{ id: string; status: SalonReservationStatus }>).map((r) => [
      r.id,
      r.status,
    ]),
  )

  let saved = 0
  const failed: string[] = []

  for (const entry of parsed.data.entries) {
    const status = statusById.get(entry.id)
    // No está en este tenant, o se canceló mientras pasaban lista.
    if (!status || status === 'cancelled' || status === 'no_show') {
      failed.push(entry.id)
      continue
    }

    const { error } =
      status === 'pending'
        ? await supabase.rpc('transition_reservation_status', {
            p_reservation_id: entry.id,
            p_to: 'arrived',
            p_actual_guests: entry.actual_guests,
          })
        : await supabase.rpc('update_reservation_actual_guests', {
            p_reservation_id: entry.id,
            p_actual_guests: entry.actual_guests,
          })

    if (error) {
      console.error('[salon.reservation] pasar lista: fila que falló', {
        tenantId: access.tenant.id,
        reservationId: entry.id,
        error: error.message,
      })
      failed.push(entry.id)
    } else {
      saved += 1
    }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'salon_reservation.attendance_roll_call',
    entity: 'salon_reservation',
    entityId: null,
    payload: { saved, failed: failed.length },
  })

  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  revalidatePath(`/${slug}/operativo`)

  if (saved === 0) {
    return { ok: false, message: 'No pudimos guardar ninguna. Recargá y probá de nuevo.' }
  }
  return {
    ok: true,
    message:
      failed.length === 0
        ? `Asistencia guardada en ${saved} ${saved === 1 ? 'reserva' : 'reservas'}.`
        : `Guardamos ${saved}. ${failed.length} quedaron afuera (cancelada o modificada mientras tanto).`,
    data: { saved, failed },
  }
}

// ──────────────────────────────────────────────────────────
// Eventos programados + templates
// ──────────────────────────────────────────────────────────

export async function upsertScheduledEvent(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, STAFF)
  if (!access) return noAccess()

  const parsed = scheduledEventSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const payload = {
    tenant_id: access.tenant.id,
    template_id: parsed.data.template_id,
    name_override: parsed.data.name_override ?? null,
    event_date: parsed.data.event_date,
    starts_at_local: parsed.data.starts_at_local,
    ends_at_local: parsed.data.ends_at_local,
    capacity: parsed.data.capacity,
    meal_type: parsed.data.meal_type,
    full_bonus_active: parsed.data.full_bonus_active,
    attendance_points: parsed.data.attendance_points,
    notes: parsed.data.notes ?? null,
  }

  let id = parsed.data.id
  if (id) {
    const { error } = await supabase
      .from('scheduled_events')
      .update(payload)
      .eq('tenant_id', access.tenant.id)
      .eq('id', id)
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
  } else {
    const { data, error } = await supabase
      .from('scheduled_events')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
    id = (data as { id: string }).id
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: id === parsed.data.id ? 'scheduled_event.updated' : 'scheduled_event.created',
    entity: 'scheduled_event',
    entityId: id ?? null,
  })

  revalidatePath(`/${slug}/eventos/programados`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  return { ok: true, data: { id } }
}

export async function moveScheduledEvent(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, STAFF)
  if (!access) return noAccess()

  const parsed = moveScheduledEventSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny

  // Si hay reservas activas atadas, no se puede mover — quedarían huérfanas
  // en su fecha original mientras el evento vive en otra.
  const { count: linked } = await supabase
    .from('salon_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', access.tenant.id)
    .eq('scheduled_event_id', parsed.data.id)
    .not('status', 'in', '(cancelled,no_show)')

  if ((linked ?? 0) > 0) {
    return {
      ok: false,
      message: `No se puede mover: el evento tiene ${linked} ${
        linked === 1 ? 'reserva activa' : 'reservas activas'
      } atadas. Cancelalas o reasignalas primero.`,
    }
  }

  const { error } = await supabase
    .from('scheduled_events')
    .update({ event_date: parsed.data.event_date })
    .eq('tenant_id', access.tenant.id)
    .eq('id', parsed.data.id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'scheduled_event.moved',
    entity: 'scheduled_event',
    entityId: parsed.data.id,
    payload: { event_date: parsed.data.event_date },
  })

  revalidatePath(`/${slug}/eventos/programados`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  return { ok: true, message: 'Evento movido.' }
}

export async function deleteScheduledEvent(slug: string, id: string): Promise<ActionState> {
  const access = await authorize(slug, STAFF)
  if (!access) return noAccess()

  const parsed = idOnlySchema.safeParse({ id })
  if (!parsed.success) return badInput('ID inválido')

  const supabase = (await createClient()) as SBAny
  // Verificar que no haya reservas activas atadas.
  const { count: linked } = await supabase
    .from('salon_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('scheduled_event_id', id)
    .not('status', 'in', '(cancelled,no_show)')

  if ((linked ?? 0) > 0) {
    return {
      ok: false,
      message: 'No se puede borrar: hay reservas activas atadas a este evento.',
    }
  }

  const { error } = await supabase
    .from('scheduled_events')
    .delete()
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'scheduled_event.deleted',
    entity: 'scheduled_event',
    entityId: id,
  })

  revalidatePath(`/${slug}/eventos/programados`)
  return { ok: true }
}

/**
 * Alta y edición del catálogo de formatos. Owner + host (`TEMPLATE_EDIT_ROLES`):
 * el anfitrión arma la agenda, así que también define los formatos que después
 * arrastra al calendario. Las policies `set_staff_insert` (insert) y
 * `set_host_update` (update) enforcean lo mismo en la DB.
 */
export async function upsertScheduledTemplate(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, TEMPLATE_EDITORS)
  if (!access) return noAccess()

  const parsed = scheduledTemplateSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const payload = {
    tenant_id: access.tenant.id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    consume_special_reservations: parsed.data.consume_special_reservations,
    default_capacity: parsed.data.default_capacity ?? null,
    default_meal_type: parsed.data.default_meal_type,
    color_hex: parsed.data.color_hex,
    active: parsed.data.active,
  }

  let id = parsed.data.id
  const isUpdate = Boolean(id)
  if (id) {
    const { error } = await supabase
      .from('scheduled_event_templates')
      .update(payload)
      .eq('tenant_id', access.tenant.id)
      .eq('id', id)
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
  } else {
    const { data, error } = await supabase
      .from('scheduled_event_templates')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
    id = (data as { id: string }).id
  }

  // El catálogo ya no lo toca solo el dueño: dejamos rastro de quién lo cambió.
  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: isUpdate ? 'scheduled_event_template.updated' : 'scheduled_event_template.created',
    entity: 'scheduled_event_template',
    entityId: id,
    payload: { name: parsed.data.name, slug: parsed.data.slug, role: access.role },
  })

  revalidatePath(`/${slug}/eventos/programados`)
  return { ok: true, data: { id } }
}

/**
 * Alta rápida de formato desde el alta de reservas. A diferencia de
 * `upsertScheduledTemplate` (owner + host), esta la puede usar todo el staff de
 * reservas (owner + cashier + host) — RLS lo permite vía la policy
 * `set_staff_insert`. Solo inserta (nunca edita), genera slug único y devuelve
 * la fila completa para que el form la agregue al combo y la seleccione.
 */
export async function quickCreateScheduledTemplate(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, STAFF)
  if (!access) return noAccess()

  const parsed = quickTemplateSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny

  const { data: existingRows } = await supabase
    .from('scheduled_event_templates')
    .select('slug')
    .eq('tenant_id', access.tenant.id)
  const existing = ((existingRows ?? []) as Array<{ slug: string }>).map((r) => r.slug)
  const finalSlug = uniqueSlugFrom(parsed.data.name, existing)

  const { data, error } = await supabase
    .from('scheduled_event_templates')
    .insert({
      tenant_id: access.tenant.id,
      name: parsed.data.name,
      slug: finalSlug,
      consume_special_reservations: false,
      default_capacity: parsed.data.default_capacity,
      default_meal_type: parsed.data.default_meal_type,
      color_hex: parsed.data.color_hex,
      active: true,
    })
    .select('*')
    .single()

  if (error) return { ok: false, message: humanizeSalonError(error.message), code: error.message }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'scheduled_event_template.created',
    entity: 'scheduled_event_template',
    entityId: (data as { id: string }).id,
    payload: { name: parsed.data.name, source: 'quick_create' },
  })

  revalidatePath(`/${slug}/eventos/programados`)
  return {
    ok: true,
    message: 'Formato creado.',
    data: { template: data as Record<string, unknown> },
  }
}

// ──────────────────────────────────────────────────────────
// Gestores
// ──────────────────────────────────────────────────────────

export async function upsertManager(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()

  const parsed = managerSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const payload = {
    tenant_id: access.tenant.id,
    user_id: parsed.data.user_id ?? null,
    display_name: parsed.data.display_name,
    phone: parsed.data.phone ?? null,
    email: parsed.data.email ?? null,
    commission_eligible: parsed.data.commission_eligible,
    active: parsed.data.active,
    notes: parsed.data.notes ?? null,
  }

  let id = parsed.data.id
  if (id) {
    const { error } = await supabase
      .from('reservation_managers')
      .update(payload)
      .eq('tenant_id', access.tenant.id)
      .eq('id', id)
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
  } else {
    const { data, error } = await supabase
      .from('reservation_managers')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
    id = (data as { id: string }).id
  }

  revalidatePath(`/${slug}/configuracion/comisiones`)
  return { ok: true, data: { id } }
}

// ──────────────────────────────────────────────────────────
// Comisiones — tarifas, bonus, pagos
// ──────────────────────────────────────────────────────────

export async function upsertRateTier(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()

  const parsed = rateTierSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const payload = {
    tenant_id: access.tenant.id,
    meal_type: parsed.data.meal_type,
    min_guests: parsed.data.min_guests,
    max_guests: parsed.data.max_guests,
    rate_per_guest_cents: parsed.data.rate_per_guest_cents,
    active: parsed.data.active,
  }

  let id = parsed.data.id
  if (id) {
    const { error } = await supabase
      .from('commission_rate_tiers')
      .update(payload)
      .eq('tenant_id', access.tenant.id)
      .eq('id', id)
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
  } else {
    const { data, error } = await supabase
      .from('commission_rate_tiers')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
    id = (data as { id: string }).id
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'commission.tier_changed',
    entity: 'commission_rate_tier',
    entityId: id ?? null,
    payload: {
      meal_type: parsed.data.meal_type,
      min_guests: parsed.data.min_guests,
      rate_cents: parsed.data.rate_per_guest_cents,
    },
  })

  revalidatePath(`/${slug}/configuracion/comisiones`)
  return { ok: true, data: { id } }
}

export async function removeRateTier(slug: string, id: string): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()
  const parsed = idOnlySchema.safeParse({ id })
  if (!parsed.success) return badInput('ID inválido')

  const supabase = (await createClient()) as SBAny
  const { error } = await supabase
    .from('commission_rate_tiers')
    .delete()
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  revalidatePath(`/${slug}/configuracion/comisiones`)
  return { ok: true }
}

export async function upsertBonusRule(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()
  const parsed = bonusRuleSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  // Idempotente: upsert por (tenant, scope) único.
  const { error } = await supabase.from('commission_bonus_rules').upsert(
    {
      tenant_id: access.tenant.id,
      scope: parsed.data.scope,
      bonus_per_guest_cents: parsed.data.bonus_per_guest_cents,
      active: parsed.data.active,
    },
    { onConflict: 'tenant_id,scope' },
  )
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  revalidatePath(`/${slug}/configuracion/comisiones`)
  return { ok: true }
}

export async function markCommissionPaid(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()

  const parsed = markPaidSchema.safeParse(asObject(input))
  if (!parsed.success) return badInput('IDs inválidos')

  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase.rpc('mark_commission_paid', {
    p_ledger_ids: parsed.data.ledger_ids,
    p_paid_at: parsed.data.paid_at ?? new Date().toISOString(),
  })
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'commission.paid',
    entity: 'commission_ledger',
    payload: { count: data, ledger_ids: parsed.data.ledger_ids },
  })

  revalidatePath(`/${slug}/estadisticas/comisiones`)
  return { ok: true, message: `${data ?? 0} entries marcadas como pagadas.` }
}

// ──────────────────────────────────────────────────────────
// Capacidades por zona
// ──────────────────────────────────────────────────────────

export async function setZoneCapacityDefaults(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()

  const parsed = zoneCapacityDefaultsSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  // Leemos settings actuales y mergeamos.
  const { data: current } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', access.tenant.id)
    .maybeSingle()
  const currentSettings = ((current?.settings ?? {}) as Record<string, unknown>) || {}
  const nextSettings = {
    ...currentSettings,
    salon_capacities: parsed.data,
  }
  const { error } = await supabase
    .from('tenants')
    .update({ settings: nextSettings })
    .eq('id', access.tenant.id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  revalidatePath(`/${slug}/configuracion/salon`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  return { ok: true, message: 'Capacidades actualizadas.' }
}

export async function upsertZoneOverride(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()

  const parsed = zoneCapacityOverrideSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const { error } = await supabase.from('salon_zone_capacity_overrides').upsert(
    {
      tenant_id: access.tenant.id,
      zone: parsed.data.zone,
      override_date: parsed.data.override_date,
      capacity: parsed.data.capacity,
      reason: parsed.data.reason ?? null,
    },
    { onConflict: 'tenant_id,zone,override_date' },
  )
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  revalidatePath(`/${slug}/configuracion/salon`)
  return { ok: true }
}

export async function removeZoneOverride(slug: string, id: string): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()
  const parsed = idOnlySchema.safeParse({ id })
  if (!parsed.success) return badInput('ID inválido')

  const supabase = (await createClient()) as SBAny
  const { error } = await supabase
    .from('salon_zone_capacity_overrides')
    .delete()
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  revalidatePath(`/${slug}/configuracion/salon`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// Tortas de cumpleaños — el menú del bar
// ──────────────────────────────────────────────────────────

/**
 * Alta y edición de una opción del menú de tortas. Solo el dueño: qué tortas
 * hace el bar es una decisión de carta, no de servicio (el cajero y el anfitrión
 * las ELIGEN al cargar la reserva, pero no las inventan).
 */
export async function upsertCakeOption(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()

  const parsed = cakeOptionSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny
  const payload = {
    tenant_id: access.tenant.id,
    name: parsed.data.name,
    base: parsed.data.base,
    fillings: parsed.data.fillings,
    position: parsed.data.position,
    active: parsed.data.active,
  }

  let id = parsed.data.id
  const isUpdate = Boolean(id)
  if (id) {
    const { error } = await supabase
      .from('cake_options')
      .update(payload)
      .eq('tenant_id', access.tenant.id)
      .eq('id', id)
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
  } else {
    const { data, error } = await supabase
      .from('cake_options')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
    id = (data as { id: string }).id
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: isUpdate ? 'cake_option.updated' : 'cake_option.created',
    entity: 'cake_option',
    entityId: id,
    payload: { name: parsed.data.name, active: parsed.data.active },
  })

  revalidatePath(`/${slug}/configuracion/tortas`)
  revalidatePath(`/${slug}/reservas/nuevo`)
  return { ok: true, data: { id }, message: 'Torta guardada.' }
}

/**
 * Borrado real. La FK es `restrict` a propósito: si alguna reserva ya eligió
 * esta torta, Postgres frena y `humanizeSalonError` explica que hay que
 * desactivarla. Borrar es para la opción que se cargó mal y nadie usó.
 */
export async function deleteCakeOption(slug: string, id: string): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()
  const parsed = idOnlySchema.safeParse({ id })
  if (!parsed.success) return badInput('ID inválido')

  const supabase = (await createClient()) as SBAny
  const { error } = await supabase
    .from('cake_options')
    .delete()
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'cake_option.deleted',
    entity: 'cake_option',
    entityId: id,
  })

  revalidatePath(`/${slug}/configuracion/tortas`)
  revalidatePath(`/${slug}/reservas/nuevo`)
  return { ok: true, message: 'Torta eliminada.' }
}

/**
 * Reordena el menú completo. El operador elige de memoria ("la 2"), así que el
 * orden del selector tiene que ser el que el dueño decidió — no el alfabeto ni
 * la fecha de carga.
 */
export async function reorderCakeOptions(slug: string, ids: string[]): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
  if (!access) return noAccess()
  if (!Array.isArray(ids) || ids.length === 0) return badInput('Nada para ordenar')
  if (ids.length > 50) return badInput('Demasiadas tortas')
  for (const id of ids) {
    if (!idOnlySchema.safeParse({ id }).success) return badInput('ID inválido')
  }

  const supabase = (await createClient()) as SBAny
  // Una por una y no un upsert masivo: el upsert necesitaría mandar la fila
  // entera (nombre, base, rellenos) y un reorder no tiene por qué poder pisar
  // el contenido de una torta.
  for (const [index, id] of ids.entries()) {
    const { error } = await supabase
      .from('cake_options')
      .update({ position: index + 1 })
      .eq('tenant_id', access.tenant.id)
      .eq('id', id)
    if (error) return { ok: false, message: humanizeSalonError(error.message) }
  }

  revalidatePath(`/${slug}/configuracion/tortas`)
  revalidatePath(`/${slug}/reservas/nuevo`)
  return { ok: true }
}
