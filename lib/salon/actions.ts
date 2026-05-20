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
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { humanizeSalonError } from './humanize'
import {
  actualGuestsSchema,
  bonusRuleSchema,
  cancelReservationSchema,
  createSalonReservationSchema,
  idOnlySchema,
  managerSchema,
  markPaidSchema,
  rateTierSchema,
  scheduledEventSchema,
  scheduledTemplateSchema,
  transitionStatusSchema,
  updateSalonReservationSchema,
  zoneCapacityDefaultsSchema,
  zoneCapacityOverrideSchema,
} from './schemas'
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

const STAFF = ['owner', 'cashier'] as const satisfies ReadonlyArray<TenantRole>
const OPERATORS = ['owner', 'cashier', 'waiter'] as const satisfies ReadonlyArray<TenantRole>
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

  const {
    data: { user },
  } = await supabase.auth.getUser()

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
      zone: parsed.data.zone,
      scheduled_event_id: parsed.data.scheduled_event_id ?? null,
      estimated_guests: parsed.data.estimated_guests,
      cake_count: parsed.data.cake_count,
      champagne_count: parsed.data.champagne_count,
      deposit_cents: parsed.data.deposit_cents,
      origin: parsed.data.origin,
      primary_manager_id: parsed.data.primary_manager_id,
      assistant_manager_id: parsed.data.assistant_manager_id ?? null,
      comments: parsed.data.comments ?? null,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, message: humanizeSalonError(error.message), code: error.message }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user?.id ?? null,
    action: 'salon_reservation.created',
    entity: 'salon_reservation',
    entityId: (data as { id: string }).id,
    payload: {
      kind: parsed.data.kind,
      meal_type: parsed.data.meal_type,
      estimated_guests: parsed.data.estimated_guests,
      manager: parsed.data.primary_manager_id,
      origin: parsed.data.origin,
    },
  })

  revalidatePath(`/${slug}/reservas`)
  revalidatePath(`/${slug}/salon/reservas-operativo`)
  return { ok: true, message: 'Reserva creada.', data: { id: (data as { id: string }).id } }
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
      zone: patch.zone,
      scheduled_event_id: patch.scheduled_event_id ?? null,
      estimated_guests: patch.estimated_guests,
      actual_guests: patch.actual_guests ?? null,
      cake_count: patch.cake_count,
      champagne_count: patch.champagne_count,
      deposit_cents: patch.deposit_cents,
      origin: patch.origin,
      primary_manager_id: patch.primary_manager_id,
      assistant_manager_id: patch.assistant_manager_id ?? null,
      comments: patch.comments ?? null,
    })
    .eq('tenant_id', access.tenant.id)
    .eq('id', id)
  if (error) return { ok: false, message: humanizeSalonError(error.message) }

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
  return { ok: true, data: { row: data as unknown as Record<string, unknown> } }
}

// Wrappers cómodos para llamar desde botones
export async function markArrived(slug: string, id: string): Promise<ActionState> {
  return transitionStatus(slug, { id, to: 'arrived' as SalonReservationStatus })
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
  return { ok: true }
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

export async function upsertScheduledTemplate(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, OWNER_ONLY)
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

  revalidatePath(`/${slug}/eventos/templates`)
  revalidatePath(`/${slug}/eventos/programados`)
  return { ok: true, data: { id } }
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
