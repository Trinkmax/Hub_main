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
import { reservationIdSchema, reserveSchema } from './schemas'

export type ReservationActionState =
  | {
      ok: true
      message?: string
      status?: 'confirmed' | 'waitlist'
      waitlist_position?: number | null
    }
  | { ok: false; message: string; code?: string }

export type CancelActionState =
  | { ok: true; promoted_id: string | null }
  | { ok: false; message: string }

async function authorizeStaff(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner', 'cashier', 'waiter'])
    return tenant
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

function humanize(message: string): string {
  if (message.includes('event_not_open')) return 'El evento no está abierto a reservas.'
  if (message.includes('event_not_found')) return 'El evento no existe.'
  if (message.includes('customer_invalid')) return 'El cliente no es válido.'
  if (message.includes('capacity_reached')) return 'Sin cupo y waitlist deshabilitada.'
  if (message.includes('guests_exceed_capacity'))
    return 'La cantidad de invitados supera el cupo total.'
  if (message.includes('invalid_guests')) return 'Cantidad inválida.'
  if (message.includes('not_confirmed')) return 'Solo se puede check-in a reservas confirmadas.'
  if (message.includes('reservation_not_found')) return 'La reserva no existe.'
  if (message.includes('forbidden')) return 'No tenés permiso.'
  return 'No pudimos completar la acción.'
}

export async function createReservation(
  slug: string,
  payload: { event_id: string; customer_id: string; guests: number },
): Promise<ReservationActionState> {
  const tenant = await authorizeStaff(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = reserveSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_reservation', {
    p_event_id: parsed.data.event_id,
    p_customer_id: parsed.data.customer_id,
    p_guests: parsed.data.guests,
  })
  if (error) return { ok: false, message: humanize(error.message), code: error.message }

  const result = Array.isArray(data) ? data[0] : data
  if (!result) return { ok: false, message: 'No pudimos crear la reserva.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'reservation.created',
    entity: 'reservation',
    entityId: result.reservation_id,
    payload: { status: result.status, guests: parsed.data.guests },
  })

  revalidatePath(`/${slug}/eventos/${parsed.data.event_id}`)
  return {
    ok: true,
    status: result.status as 'confirmed' | 'waitlist',
    waitlist_position: result.waitlist_position,
  }
}

export async function cancelReservation(
  slug: string,
  reservationId: string,
): Promise<CancelActionState> {
  const tenant = await authorizeStaff(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = reservationIdSchema.safeParse({ reservation_id: reservationId })
  if (!parsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_reservation', {
    p_reservation_id: parsed.data.reservation_id,
  })
  if (error) return { ok: false, message: humanize(error.message) }

  const result = Array.isArray(data) ? data[0] : data

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'reservation.cancelled',
    entity: 'reservation',
    entityId: parsed.data.reservation_id,
    payload: { promoted_id: result?.promoted_id ?? null },
  })

  revalidatePath(`/${slug}/eventos`)
  return { ok: true, promoted_id: result?.promoted_id ?? null }
}

export async function checkInReservation(
  slug: string,
  reservationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const tenant = await authorizeStaff(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = reservationIdSchema.safeParse({ reservation_id: reservationId })
  if (!parsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('check_in_reservation', {
    p_reservation_id: parsed.data.reservation_id,
  })
  if (error) return { ok: false, message: humanize(error.message) }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'reservation.checked_in',
    entity: 'reservation',
    entityId: parsed.data.reservation_id,
  })

  revalidatePath(`/${slug}/eventos`)
  return { ok: true }
}
