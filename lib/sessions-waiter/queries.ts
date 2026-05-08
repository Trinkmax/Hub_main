import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type WaiterSessionRow = {
  id: string
  table_label: string | null
  opened_at: string
  total_cents: number
  guest_count: number
  pending_tickets: number
  bill_requested: boolean
}

export async function listOpenSessions(tenantId: string): Promise<WaiterSessionRow[]> {
  const supabase = await createClient()

  const { data: sessions, error } = await supabase
    .from('table_sessions')
    .select('id, opened_at, total_cents, physical_table_id, physical_tables(label)')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })

  if (error || !sessions) {
    console.error('[sessions-waiter.list]', error?.message)
    return []
  }

  const sessionIds = sessions.map((s) => s.id)
  if (sessionIds.length === 0) return []

  const [{ data: guests }, { data: pendings }, { data: events }] = await Promise.all([
    supabase.from('session_guests').select('session_id').in('session_id', sessionIds),
    supabase
      .from('tickets')
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('status', 'pending'),
    supabase
      .from('table_session_events')
      .select('session_id, created_at')
      .in('session_id', sessionIds)
      .eq('type', 'bill_requested')
      .order('created_at', { ascending: false }),
  ])

  const guestCounts = new Map<string, number>()
  for (const g of guests ?? []) {
    guestCounts.set(g.session_id, (guestCounts.get(g.session_id) ?? 0) + 1)
  }
  const pendingCounts = new Map<string, number>()
  for (const p of pendings ?? []) {
    pendingCounts.set(p.session_id, (pendingCounts.get(p.session_id) ?? 0) + 1)
  }
  const billRequested = new Set<string>()
  for (const e of events ?? []) {
    billRequested.add(e.session_id)
  }

  type SessionWithTable = (typeof sessions)[number] & {
    physical_tables: { label: string } | { label: string }[] | null
  }
  return sessions.map((s) => {
    const sw = s as SessionWithTable
    const pt = Array.isArray(sw.physical_tables) ? sw.physical_tables[0] : sw.physical_tables
    return {
      id: s.id,
      table_label: pt?.label ?? null,
      opened_at: s.opened_at,
      total_cents: s.total_cents ?? 0,
      guest_count: guestCounts.get(s.id) ?? 0,
      pending_tickets: pendingCounts.get(s.id) ?? 0,
      bill_requested: billRequested.has(s.id),
    }
  })
}

export type WaiterSessionDetail = {
  id: string
  status: string
  opened_at: string
  paid_at: string | null
  total_cents: number
  table_label: string | null
  guests: Array<{
    id: string
    display_name: string | null
    customer_id: string | null
    last_activity_at: string
  }>
  bill_requested: boolean
}

export async function getSessionForWaiter(sessionId: string): Promise<WaiterSessionDetail | null> {
  const supabase = await createClient()
  const { data: session } = await supabase
    .from('table_sessions')
    .select('id, status, opened_at, paid_at, total_cents, physical_tables(label)')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return null

  const { data: guests } = await supabase
    .from('session_guests')
    .select('id, display_name, customer_id, last_activity_at')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  const { data: billEvent } = await supabase
    .from('table_session_events')
    .select('id')
    .eq('session_id', sessionId)
    .eq('type', 'bill_requested')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  type SessionWithTable = typeof session & {
    physical_tables: { label: string } | { label: string }[] | null
  }
  const sw = session as SessionWithTable
  const pt = Array.isArray(sw.physical_tables) ? sw.physical_tables[0] : sw.physical_tables

  return {
    id: session.id,
    status: session.status,
    opened_at: session.opened_at,
    paid_at: session.paid_at,
    total_cents: session.total_cents ?? 0,
    table_label: pt?.label ?? null,
    guests: guests ?? [],
    bill_requested: Boolean(billEvent),
  }
}

export type CobroBreakdownGuest = {
  guest_id: string
  customer_id: string | null
  display_name: string | null
  total_cents: number
  items: Array<{ name: string; quantity: number; line_total_cents: number }>
}

export type CobroBreakdown = {
  session_id: string
  total_cents: number
  guests: CobroBreakdownGuest[]
  shared_total_cents: number
  shared_items: Array<{ name: string; quantity: number; line_total_cents: number }>
}

export async function getCobroBreakdown(sessionId: string): Promise<CobroBreakdown | null> {
  const supabase = await createClient()
  const { data: session } = await supabase
    .from('table_sessions')
    .select('id, total_cents')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return null

  const { data: guests } = await supabase
    .from('session_guests')
    .select('id, display_name, customer_id')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  const { data: items } = await supabase
    .from('ticket_items')
    .select(
      'quantity, line_total_cents, assigned_to_guest_id, cancelled_at, menu_items(name), tickets!inner(session_id, status)',
    )
    .eq('tickets.session_id', sessionId)
    .neq('tickets.status', 'cancelled')
    .is('cancelled_at', null)

  type Joined = {
    quantity: number
    line_total_cents: number
    assigned_to_guest_id: string | null
    cancelled_at: string | null
    menu_items: { name: string } | { name: string }[] | null
  }

  const byGuest = new Map<string, CobroBreakdownGuest>()
  for (const g of guests ?? []) {
    byGuest.set(g.id, {
      guest_id: g.id,
      customer_id: g.customer_id,
      display_name: g.display_name,
      total_cents: 0,
      items: [],
    })
  }

  let sharedTotal = 0
  const sharedItems: CobroBreakdown['shared_items'] = []

  for (const raw of items ?? []) {
    const r = raw as unknown as Joined
    const mi = Array.isArray(r.menu_items) ? r.menu_items[0] : r.menu_items
    const name = mi?.name ?? 'Ítem'
    const line = { name, quantity: r.quantity, line_total_cents: r.line_total_cents }
    if (r.assigned_to_guest_id && byGuest.has(r.assigned_to_guest_id)) {
      const g = byGuest.get(r.assigned_to_guest_id)
      if (g) {
        g.items.push(line)
        g.total_cents += r.line_total_cents
      }
    } else {
      sharedItems.push(line)
      sharedTotal += r.line_total_cents
    }
  }

  return {
    session_id: session.id,
    total_cents: session.total_cents,
    guests: Array.from(byGuest.values()),
    shared_total_cents: sharedTotal,
    shared_items: sharedItems,
  }
}
