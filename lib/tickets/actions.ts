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
