import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type TicketRow = {
  id: string
  status: string
  submitted_at: string
  accepted_at: string | null
  prepared_at: string | null
  served_at: string | null
  total_cents: number
  cancellation_reason: string | null
  created_by_guest_id: string | null
  created_by_user_id: string | null
  session_id?: string
}

export type TicketItemRow = {
  id: string
  ticket_id: string
  menu_item_id: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  assigned_to_guest_id: string | null
  notes: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  menu_item_name?: string
}

export async function listTicketsForSession(sessionId: string): Promise<TicketRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tickets')
    .select(
      'id, status, submitted_at, accepted_at, prepared_at, served_at, total_cents, cancellation_reason, created_by_guest_id, created_by_user_id',
    )
    .eq('session_id', sessionId)
    .order('submitted_at', { ascending: true })
  if (error) {
    console.error('[tickets.listForSession]', error.message)
    return []
  }
  return (data ?? []) as TicketRow[]
}

export async function listTicketItemsForTickets(ticketIds: string[]): Promise<TicketItemRow[]> {
  if (ticketIds.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ticket_items')
    .select(
      'id, ticket_id, menu_item_id, quantity, unit_price_cents, line_total_cents, assigned_to_guest_id, notes, cancelled_at, cancellation_reason, menu_items(name)',
    )
    .in('ticket_id', ticketIds)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[tickets.listItemsForTickets]', error.message)
    return []
  }
  type Joined = TicketItemRow & {
    menu_items: { name: string } | { name: string }[] | null
  }
  return (data ?? []).map((row) => {
    const r = row as Joined
    const menuItem = Array.isArray(r.menu_items) ? r.menu_items[0] : r.menu_items
    return { ...r, menu_item_name: menuItem?.name }
  })
}

export async function listKitchenQueue(tenantId: string): Promise<TicketRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tickets')
    .select(
      'id, status, submitted_at, accepted_at, prepared_at, served_at, total_cents, cancellation_reason, created_by_guest_id, created_by_user_id, session_id',
    )
    .eq('tenant_id', tenantId)
    .in('status', ['accepted', 'preparing', 'ready'])
    .order('submitted_at', { ascending: true })
  if (error) {
    console.error('[tickets.listKitchenQueue]', error.message)
    return []
  }
  return (data ?? []) as TicketRow[]
}

/**
 * Lee el flag kitchen_flow_enabled del tenant. Cualquier miembro (waiter,
 * cashier, owner, kitchen) puede leerlo — RLS sobre tenants permite SELECT a
 * los miembros. Default false si no se puede leer.
 */
export async function getKitchenFlowEnabled(tenantId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select('kitchen_flow_enabled')
    .eq('id', tenantId)
    .maybeSingle()
  return Boolean((data as { kitchen_flow_enabled?: boolean } | null)?.kitchen_flow_enabled)
}
