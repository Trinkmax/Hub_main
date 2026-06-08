import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type WaiterSessionDetail = {
  id: string
  status: string
  opened_at: string
  paid_at: string | null
  total_cents: number
  table_label: string | null
  party_size: number | null
  alias: string | null
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
  // party_size y alias se agregan en migraciones 20260527/20260528 — cast hasta regenerar types.
  const { data: session } = await supabase
    .from('table_sessions')
    .select(
      'id, status, opened_at, paid_at, total_cents, party_size, alias, physical_tables(label)',
    )
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
    party_size: number | null
    alias: string | null
    physical_tables: { label: string } | { label: string }[] | null
  }
  const sw = session as unknown as SessionWithTable
  const pt = Array.isArray(sw.physical_tables) ? sw.physical_tables[0] : sw.physical_tables

  return {
    id: session.id,
    status: session.status,
    opened_at: session.opened_at,
    paid_at: session.paid_at,
    total_cents: session.total_cents ?? 0,
    table_label: pt?.label ?? null,
    party_size: sw.party_size ?? null,
    alias: sw.alias ?? null,
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

export type SalonOccupancy = {
  totalSeats: number | null
  occupiedSeats: number
  availableSeats: number | null
  openSessions: number
  overCapacity: boolean
}

export async function getSalonOccupancy(tenantId: string): Promise<SalonOccupancy> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_salon_occupancy', { p_tenant_id: tenantId })
  if (error || !data) {
    console.error('[sessions-waiter.occupancy]', error?.message)
    return {
      totalSeats: null,
      occupiedSeats: 0,
      availableSeats: null,
      openSessions: 0,
      overCapacity: false,
    }
  }
  const result = data as {
    total_seats: number | null
    occupied_seats: number
    available_seats: number | null
    open_sessions: number
    over_capacity: boolean
  }
  return {
    totalSeats: result.total_seats,
    occupiedSeats: result.occupied_seats,
    availableSeats: result.available_seats,
    openSessions: result.open_sessions,
    overCapacity: result.over_capacity,
  }
}

export type SalonTableRow = {
  physical_table_id: string
  label: string
  capacity: number | null
  session: {
    id: string
    opened_at: string
    party_size: number | null
    alias: string | null
    customer_names: string[]
    total_cents: number
    guest_count: number
    pending_tickets: number
    bill_requested: boolean
  } | null
}

/**
 * Devuelve todas las mesas físicas activas del tenant, con su sesión open (si tiene).
 * Pensado para la grilla unificada de `/salon/mesas` donde se ven libres + activas.
 */
export async function listSalonTables(tenantId: string): Promise<SalonTableRow[]> {
  const supabase = await createClient()

  const { data: tables, error: tablesErr } = await supabase
    .from('physical_tables')
    .select('id, label, capacity')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('label', { ascending: true })

  if (tablesErr || !tables) {
    console.error('[sessions-waiter.listSalonTables]', tablesErr?.message)
    return []
  }

  const tableIds = tables.map((t) => t.id)
  if (tableIds.length === 0) return []

  // party_size y alias se agregan en migraciones 20260527/20260528 — cast hasta regenerar.
  const { data: rawSessions } = await supabase
    .from('table_sessions')
    .select('id, physical_table_id, opened_at, total_cents, party_size, alias')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .in('physical_table_id', tableIds)

  type SessionRow = {
    id: string
    physical_table_id: string | null
    opened_at: string
    total_cents: number
    party_size: number | null
    alias: string | null
  }
  const sessions = ((rawSessions ?? []) as unknown as SessionRow[]).filter(
    (s) => s.physical_table_id !== null,
  )
  const sessionsByTable = new Map<string, SessionRow>()
  for (const s of sessions) {
    if (s.physical_table_id) sessionsByTable.set(s.physical_table_id, s)
  }

  const sessionIds = sessions.map((s) => s.id)

  type Counters = {
    guests: Map<string, number>
    pendings: Map<string, number>
    bills: Set<string>
    customerNames: Map<string, string[]>
  }
  const counters: Counters = {
    guests: new Map(),
    pendings: new Map(),
    bills: new Set(),
    customerNames: new Map(),
  }

  if (sessionIds.length > 0) {
    const [{ data: guests }, { data: pendings }, { data: events }, { data: namedGuests }] =
      await Promise.all([
        supabase.from('session_guests').select('session_id').in('session_id', sessionIds),
        supabase
          .from('tickets')
          .select('session_id')
          .in('session_id', sessionIds)
          .eq('status', 'pending'),
        supabase
          .from('table_session_events')
          .select('session_id')
          .in('session_id', sessionIds)
          .eq('type', 'bill_requested'),
        // Nombres de customers asociados (para el buscador). Solo guests con customer_id.
        supabase
          .from('session_guests')
          .select('session_id, customers(first_name, last_name)')
          .in('session_id', sessionIds)
          .not('customer_id', 'is', null),
      ])
    for (const g of guests ?? []) {
      counters.guests.set(g.session_id, (counters.guests.get(g.session_id) ?? 0) + 1)
    }
    for (const p of pendings ?? []) {
      counters.pendings.set(p.session_id, (counters.pendings.get(p.session_id) ?? 0) + 1)
    }
    for (const e of events ?? []) {
      counters.bills.add(e.session_id)
    }
    type NamedRow = {
      session_id: string
      customers: { first_name: string | null; last_name: string | null } | null
    }
    for (const raw of (namedGuests ?? []) as unknown as NamedRow[]) {
      if (!raw.customers) continue
      const full = [raw.customers.first_name, raw.customers.last_name]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join(' ')
        .trim()
      if (!full) continue
      const arr = counters.customerNames.get(raw.session_id) ?? []
      arr.push(full)
      counters.customerNames.set(raw.session_id, arr)
    }
  }

  return tables.map((t) => {
    const sess = sessionsByTable.get(t.id)
    if (!sess) {
      return {
        physical_table_id: t.id,
        label: t.label,
        capacity: t.capacity ?? null,
        session: null,
      }
    }
    return {
      physical_table_id: t.id,
      label: t.label,
      capacity: t.capacity ?? null,
      session: {
        id: sess.id,
        opened_at: sess.opened_at,
        party_size: sess.party_size,
        alias: sess.alias,
        customer_names: counters.customerNames.get(sess.id) ?? [],
        total_cents: sess.total_cents ?? 0,
        guest_count: counters.guests.get(sess.id) ?? 0,
        pending_tickets: counters.pendings.get(sess.id) ?? 0,
        bill_requested: counters.bills.has(sess.id),
      },
    }
  })
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

export type SessionGuestLite = {
  id: string
  display_name: string | null
  customer_id: string | null
}

/**
 * Comensales de una sesión (para el selector de reasignación al mover ítems).
 * RLS SELECT en session_guests: abierta a miembros del tenant.
 */
export async function listSessionGuests(sessionId: string): Promise<SessionGuestLite[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('session_guests')
    .select('id, display_name, customer_id')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })
  if (error) {
    console.error('[sessions-waiter.listSessionGuests]', error.message)
    return []
  }
  return (data ?? []).map((g) => ({
    id: g.id,
    display_name: g.display_name,
    customer_id: g.customer_id,
  }))
}
