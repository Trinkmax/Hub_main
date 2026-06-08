'use server'

import { revalidatePath } from 'next/cache'
import type { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  type TenantRole,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  acceptTicketSchema,
  addStaffTicketSchema,
  cancelTicketItemSchema,
  moveTicketItemsSchema,
  rejectTicketSchema,
  updateTicketStatusSchema,
} from './schemas'

export type TicketActionState =
  | { ok: true; message?: string; ticketId?: string; status?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

async function authorize(slug: string, allowed: ReadonlyArray<TenantRole>) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, allowed)
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

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function acceptTicket(slug: string, ticketId: string): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = acceptTicketSchema.safeParse({ ticket_id: ticketId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('accept_ticket', {
    p_ticket_id: parsed.data.ticket_id,
  })
  if (error) {
    console.error('[tickets.accept]', error.message)
    return { ok: false, message: 'No se pudo aceptar la comanda.' }
  }
  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/cocina`)
  return {
    ok: true,
    ticketId: parsed.data.ticket_id,
    status: (data as { status: string }).status,
  }
}

export async function rejectTicket(
  slug: string,
  ticketId: string,
  reason: string,
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = rejectTicketSchema.safeParse({ ticket_id: ticketId, reason })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('reject_ticket', {
    p_ticket_id: parsed.data.ticket_id,
    p_reason: parsed.data.reason,
  })
  if (error) {
    console.error('[tickets.reject]', error.message)
    return { ok: false, message: 'No se pudo rechazar.' }
  }
  revalidatePath(`/${slug}/salon/mesas`)
  return { ok: true, ticketId: parsed.data.ticket_id }
}

export async function updateTicketStatus(
  slug: string,
  ticketId: string,
  newStatus: 'preparing' | 'ready' | 'served',
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner', 'kitchen'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateTicketStatusSchema.safeParse({
    ticket_id: ticketId,
    new_status: newStatus,
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_ticket_status', {
    p_ticket_id: parsed.data.ticket_id,
    p_new_status: parsed.data.new_status,
  })
  if (error) {
    if (error.message.includes('invalid_transition_or_role')) {
      return { ok: false, message: 'No podés cambiar el estado a ese.' }
    }
    console.error('[tickets.updateStatus]', error.message)
    return { ok: false, message: 'No se pudo actualizar el estado.' }
  }
  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/cocina`)
  return { ok: true, ticketId: parsed.data.ticket_id, status: parsed.data.new_status }
}

export async function cancelTicketItem(
  slug: string,
  ticketItemId: string,
  reason: string,
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner', 'kitchen'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = cancelTicketItemSchema.safeParse({ ticket_item_id: ticketItemId, reason })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_ticket_item', {
    p_ticket_item_id: parsed.data.ticket_item_id,
    p_reason: parsed.data.reason,
  })
  if (error) {
    console.error('[tickets.cancelItem]', error.message)
    return { ok: false, message: 'No se pudo cancelar el ítem.' }
  }
  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/cocina`)
  return { ok: true }
}

export async function addStaffTicket(
  slug: string,
  input: {
    sessionId: string
    items: Array<{
      menu_item_id: string
      quantity: number
      notes?: string | null
      assigned_to_guest_id?: string | null
    }>
    assignedToGuestId?: string | null
  },
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = addStaffTicketSchema.safeParse({
    session_id: input.sessionId,
    items: input.items,
    assigned_to_guest_id: input.assignedToGuestId,
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { data, error } = await supabase.rpc('add_staff_ticket', {
    p_session_id: parsed.data.session_id,
    p_items: parsed.data.items.map((i) => ({
      menu_item_id: i.menu_item_id,
      quantity: i.quantity,
      notes: i.notes ?? null,
      assigned_to_guest_id: i.assigned_to_guest_id ?? null,
    })),
    p_assigned_to_guest_id: parsed.data.assigned_to_guest_id ?? null,
  })
  if (error) {
    console.error('[tickets.addStaff]', error.message)
    return { ok: false, message: 'No se pudo agregar la comanda.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'add_staff',
    entity: 'ticket',
    entityId: (data as { ticket_id: string }).ticket_id,
    payload: {
      session_id: parsed.data.session_id,
      items_count: parsed.data.items.length,
    },
  })

  revalidatePath(`/${slug}/salon/mesas`)
  return { ok: true, ticketId: (data as { ticket_id: string }).ticket_id }
}

export type MoveTicketItemsState =
  | { ok: true; targetSessionId: string; targetTicketId: string; movedCount: number }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

export async function moveTicketItemsAction(
  slug: string,
  input: {
    sourceSessionId: string
    targetTableId: string
    moves: Array<{ ticketItemId: string; quantity: number; assign?: string }>
    idempotencyKey?: string
  },
): Promise<MoveTicketItemsState> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = moveTicketItemsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { data, error } = await supabase.rpc('move_ticket_items', {
    p_source_session_id: parsed.data.sourceSessionId,
    p_target_table_id: parsed.data.targetTableId,
    p_moves: parsed.data.moves.map((m) => ({
      ticket_item_id: m.ticketItemId,
      quantity: m.quantity,
      assign: m.assign ?? 'auto',
    })),
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  })
  if (error) {
    const msg = error.message
    if (msg.includes('session_not_open')) {
      return { ok: false, message: 'La mesa de origen ya no está abierta.' }
    }
    if (msg.includes('session_not_found')) {
      return { ok: false, message: 'Sesión de origen no encontrada.' }
    }
    if (msg.includes('invalid_target_table')) {
      return { ok: false, message: 'La mesa destino no es válida.' }
    }
    if (msg.includes('same_table_move')) {
      return { ok: false, message: 'Elegí una mesa distinta a la actual.' }
    }
    if (msg.includes('item_not_in_session')) {
      return { ok: false, message: 'Alguno de los ítems no pertenece a esta mesa.' }
    }
    if (msg.includes('item_cancelled')) {
      return { ok: false, message: 'No se pueden mover ítems cancelados.' }
    }
    if (msg.includes('invalid_quantity')) {
      return { ok: false, message: 'Cantidad a mover inválida.' }
    }
    if (msg.includes('invalid_assigned_guest')) {
      return { ok: false, message: 'El comensal destino no es válido.' }
    }
    if (msg.includes('no_moves')) {
      return { ok: false, message: 'Seleccioná al menos un ítem.' }
    }
    if (msg.includes('role_not_allowed') || msg.includes('forbidden')) {
      return { ok: false, message: 'No tenés permiso para mover ítems.' }
    }
    console.error('[tickets.moveItems]', msg)
    return { ok: false, message: 'No se pudieron mover los ítems.' }
  }

  const result = data as {
    target_session_id: string
    target_ticket_id: string
    moved_count: number
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'ticket.items_moved',
    entity: 'table_session',
    entityId: parsed.data.sourceSessionId,
    payload: {
      target_session_id: result.target_session_id,
      target_ticket_id: result.target_ticket_id,
      target_table_id: parsed.data.targetTableId,
      moves: parsed.data.moves,
    },
  })

  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/mesas/${parsed.data.sourceSessionId}`)
  revalidatePath(`/${slug}/salon/mesas/${result.target_session_id}`)
  revalidatePath(`/${slug}/salon/cocina`)
  return {
    ok: true,
    targetSessionId: result.target_session_id,
    targetTicketId: result.target_ticket_id,
    movedCount: result.moved_count,
  }
}

export async function loadItemMoveTargetsAction(
  slug: string,
  sourceSessionId: string,
): Promise<
  | { ok: true; targets: import('@/lib/floor-plan/queries').ItemMoveTarget[] }
  | { ok: false; message: string }
> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const { getItemMoveTargets } = await import('@/lib/floor-plan/queries')
  const targets = await getItemMoveTargets(access.tenant.id, sourceSessionId)
  return { ok: true, targets }
}

export async function loadSessionGuestsAction(
  slug: string,
  sessionId: string,
): Promise<
  | { ok: true; guests: import('@/lib/sessions-waiter/queries').SessionGuestLite[] }
  | { ok: false; message: string }
> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const { listSessionGuests } = await import('@/lib/sessions-waiter/queries')
  const guests = await listSessionGuests(sessionId)
  return { ok: true, guests }
}
