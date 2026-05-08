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

export type MarkPaidResult =
  | {
      ok: true
      sessionId: string
      idempotent: boolean
      totalCents: number
      visitsCreated: number
      totalPoints: number
    }
  | { ok: false; message: string }

async function authorize(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['waiter', 'cashier', 'owner'])
    return { tenant, role }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

export async function markSessionPaid(slug: string, sessionId: string): Promise<MarkPaidResult> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { data, error } = await supabase.rpc('mark_session_paid', { p_session_id: sessionId })
  if (error) {
    if (error.message.includes('session_not_open')) {
      return { ok: false, message: 'La sesión no está abierta.' }
    }
    if (error.message.includes('session_not_found')) {
      return { ok: false, message: 'Sesión no encontrada.' }
    }
    console.error('[sessions.markPaid]', error.message)
    return { ok: false, message: 'No se pudo cobrar la mesa.' }
  }

  const result = data as {
    session_id: string
    idempotent: boolean
    total_cents: number
    visits_created: number
    total_points: number
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'mark_paid',
    entity: 'table_session',
    entityId: sessionId,
    payload: {
      total_cents: result.total_cents,
      visits_created: result.visits_created,
      total_points: result.total_points,
    },
  })

  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/mesas/${sessionId}`)
  return {
    ok: true,
    sessionId: result.session_id,
    idempotent: result.idempotent,
    totalCents: result.total_cents,
    visitsCreated: result.visits_created,
    totalPoints: result.total_points,
  }
}

export type SessionOpResult = { ok: true; message?: string } | { ok: false; message: string }

async function authorizeOps(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['waiter', 'owner'])
    return { tenant, role }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

export async function markSessionAbandoned(
  slug: string,
  sessionId: string,
  reason: string,
): Promise<SessionOpResult> {
  const access = await authorizeOps(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('mark_session_abandoned', {
    p_session_id: sessionId,
    p_reason: reason,
  })
  if (error) {
    if (error.message.includes('session_not_open')) {
      return { ok: false, message: 'La sesión no está abierta.' }
    }
    console.error('[sessions.abandon]', error.message)
    return { ok: false, message: 'No se pudo marcar como abandonada.' }
  }
  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/mesas/${sessionId}`)
  return { ok: true }
}

export async function mergeSessionsAction(
  slug: string,
  survivorId: string,
  absorbedIds: string[],
): Promise<SessionOpResult> {
  const access = await authorizeOps(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  if (absorbedIds.length === 0) return { ok: false, message: 'Seleccioná al menos una sesión.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('merge_sessions', {
    p_survivor_id: survivorId,
    p_absorbed_ids: absorbedIds,
  })
  if (error) {
    if (error.message.includes('cross_tenant_merge')) {
      return { ok: false, message: 'No podés mergear sesiones de tenants distintos.' }
    }
    console.error('[sessions.merge]', error.message)
    return { ok: false, message: 'No se pudo mergear.' }
  }
  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/mesas/${survivorId}`)
  return { ok: true, message: `${absorbedIds.length} sesión(es) absorbida(s).` }
}

export async function moveSessionAction(
  slug: string,
  sessionId: string,
  newPhysicalTableId: string,
): Promise<SessionOpResult> {
  const access = await authorizeOps(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('move_session', {
    p_session_id: sessionId,
    p_new_physical_table_id: newPhysicalTableId,
  })
  if (error) {
    if (error.message.includes('target_table_busy')) {
      return { ok: false, message: 'La mesa destino ya tiene una sesión abierta.' }
    }
    console.error('[sessions.move]', error.message)
    return { ok: false, message: 'No se pudo mover.' }
  }
  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/mesas/${sessionId}`)
  return { ok: true }
}

export async function splitSessionAction(
  slug: string,
  sourceId: string,
  targetPhysicalTableId: string,
  guestIds: string[],
): Promise<SessionOpResult> {
  const access = await authorizeOps(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  if (guestIds.length === 0) return { ok: false, message: 'Seleccioná al menos un comensal.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('split_session', {
    p_source_id: sourceId,
    p_target_physical_table_id: targetPhysicalTableId,
    p_guest_ids: guestIds,
  })
  if (error) {
    if (error.message.includes('target_table_busy')) {
      return { ok: false, message: 'La mesa destino ya tiene una sesión abierta.' }
    }
    console.error('[sessions.split]', error.message)
    return { ok: false, message: 'No se pudo splitear.' }
  }
  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/mesas/${sourceId}`)
  return { ok: true }
}
