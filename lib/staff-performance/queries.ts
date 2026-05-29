import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  accumulateSession,
  type StaffAccumulator,
  staffForSession,
  type WithStaffUser,
} from './attribution'
import { type DateRange, toIsoBounds } from './date-range'

export type StaffSummaryRow = {
  user_id: string
  email: string
  full_name: string | null
  sessions_count: number
  party_size_share: number
  revenue_share_cents: number
  items_share: number
}

export type StaffSessionSummary = {
  session_id: string
  opened_at: string
  paid_at: string | null
  table_label: string | null
  alias: string | null
  party_size: number | null
  total_cents: number
  staff_count: number
  share_cents: number
}

export type StaffSessionDetail = {
  session_id: string
  opened_at: string
  paid_at: string | null
  table_label: string | null
  alias: string | null
  party_size: number | null
  total_cents: number
  staff_user_ids: string[]
  customers: Array<{
    first_name: string | null
    last_name: string | null
    phone: string | null
  }>
  items: Array<{
    menu_item_id: string
    name: string
    category_name: string
    quantity: number
    unit_price_cents: number
    line_total_cents: number
  }>
}

type MemberRow = { user_id: string; email: string; full_name: string | null }

async function resolveMembers(tenantId: string): Promise<Map<string, MemberRow>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_tenant_members', { p_tenant: tenantId })
  if (error || !data) {
    console.error('[staff-performance.members]', error?.message)
    return new Map()
  }
  const map = new Map<string, MemberRow>()
  for (const r of data as Array<{ user_id: string; email: string; full_name: string | null }>) {
    map.set(r.user_id, { user_id: r.user_id, email: r.email, full_name: r.full_name })
  }
  return map
}

/**
 * Resumen por mozo en el rango. Sesiones consideradas: las que cerraron `paid`
 * dentro del rango (atribuimos al cierre, no a la apertura).
 *
 * Mozos sin ninguna participación en el rango quedan fuera del resultado.
 */
export async function getStaffSummaries(
  tenantId: string,
  range: DateRange,
): Promise<StaffSummaryRow[]> {
  const supabase = await createClient()
  const { fromIso, toIso } = toIsoBounds(range)

  const { data: sessions, error: sErr } = await supabase
    .from('table_sessions')
    .select('id, party_size, total_cents')
    .eq('tenant_id', tenantId)
    .eq('status', 'paid')
    .gte('paid_at', fromIso)
    .lte('paid_at', toIso)

  if (sErr || !sessions || sessions.length === 0) {
    if (sErr) console.error('[staff-performance.sessions]', sErr.message)
    return []
  }

  const sessionIds = sessions.map((s) => s.id)

  const [eventsRes, ticketsRes, itemsRes, members] = await Promise.all([
    supabase
      .from('table_session_events')
      .select('session_id, created_by_user_id')
      .in('session_id', sessionIds),
    supabase
      .from('tickets')
      .select('id, session_id, created_by_user_id, status')
      .in('session_id', sessionIds),
    supabase
      .from('ticket_items')
      .select('quantity, cancelled_at, ticket_id, tickets!inner(session_id, status)')
      .in('tickets.session_id', sessionIds)
      .is('cancelled_at', null)
      .neq('tickets.status', 'cancelled'),
    resolveMembers(tenantId),
  ])

  type EventRow = { session_id: string; created_by_user_id: string | null }
  type TicketRow = {
    id: string
    session_id: string
    created_by_user_id: string | null
    status: string
  }
  type ItemRow = {
    quantity: number
    cancelled_at: string | null
    ticket_id: string
    tickets: { session_id: string; status: string } | { session_id: string; status: string }[]
  }

  const eventsBySession = new Map<string, EventRow[]>()
  for (const e of (eventsRes.data ?? []) as EventRow[]) {
    const arr = eventsBySession.get(e.session_id) ?? []
    arr.push(e)
    eventsBySession.set(e.session_id, arr)
  }

  const ticketsBySession = new Map<string, TicketRow[]>()
  for (const t of (ticketsRes.data ?? []) as TicketRow[]) {
    const arr = ticketsBySession.get(t.session_id) ?? []
    arr.push(t)
    ticketsBySession.set(t.session_id, arr)
  }

  const itemsBySession = new Map<string, number>()
  for (const raw of (itemsRes.data ?? []) as unknown as ItemRow[]) {
    const tk = Array.isArray(raw.tickets) ? raw.tickets[0] : raw.tickets
    if (!tk) continue
    itemsBySession.set(tk.session_id, (itemsBySession.get(tk.session_id) ?? 0) + raw.quantity)
  }

  const acc = new Map<string, StaffAccumulator>()
  for (const s of sessions) {
    const events = (eventsBySession.get(s.id) ?? []) as WithStaffUser[]
    const tickets = (ticketsBySession.get(s.id) ?? []).filter(
      (t) => t.status !== 'cancelled',
    ) as WithStaffUser[]
    const staff = staffForSession(events, tickets)
    accumulateSession(acc, staff, s.party_size, s.total_cents ?? 0, itemsBySession.get(s.id) ?? 0)
  }

  const rows: StaffSummaryRow[] = []
  for (const [user_id, a] of acc) {
    const m = members.get(user_id)
    rows.push({
      user_id,
      email: m?.email ?? '—',
      full_name: m?.full_name ?? null,
      sessions_count: a.sessions_count,
      party_size_share: a.party_size_share,
      revenue_share_cents: a.revenue_share_cents,
      items_share: a.items_share,
    })
  }
  rows.sort((a, b) => b.revenue_share_cents - a.revenue_share_cents)
  return rows
}

/**
 * Lista de sesiones donde el mozo `userId` participó en el rango.
 */
export async function listStaffSessions(
  tenantId: string,
  userId: string,
  range: DateRange,
): Promise<StaffSessionSummary[]> {
  const supabase = await createClient()
  const { fromIso, toIso } = toIsoBounds(range)

  const { data: sessions } = await supabase
    .from('table_sessions')
    .select('id, opened_at, paid_at, party_size, alias, total_cents, physical_tables(label)')
    .eq('tenant_id', tenantId)
    .eq('status', 'paid')
    .gte('paid_at', fromIso)
    .lte('paid_at', toIso)
    .order('paid_at', { ascending: false })

  if (!sessions || sessions.length === 0) return []
  const sessionIds = sessions.map((s) => s.id)

  const [eventsRes, ticketsRes] = await Promise.all([
    supabase
      .from('table_session_events')
      .select('session_id, created_by_user_id')
      .in('session_id', sessionIds),
    supabase
      .from('tickets')
      .select('session_id, created_by_user_id, status')
      .in('session_id', sessionIds),
  ])

  const staffBySession = new Map<string, Set<string>>()
  for (const e of (eventsRes.data ?? []) as Array<{
    session_id: string
    created_by_user_id: string | null
  }>) {
    if (!e.created_by_user_id) continue
    const set = staffBySession.get(e.session_id) ?? new Set()
    set.add(e.created_by_user_id)
    staffBySession.set(e.session_id, set)
  }
  for (const t of (ticketsRes.data ?? []) as Array<{
    session_id: string
    created_by_user_id: string | null
    status: string
  }>) {
    if (!t.created_by_user_id || t.status === 'cancelled') continue
    const set = staffBySession.get(t.session_id) ?? new Set()
    set.add(t.created_by_user_id)
    staffBySession.set(t.session_id, set)
  }

  type Row = (typeof sessions)[number] & {
    alias: string | null
    party_size: number | null
    physical_tables: { label: string } | { label: string }[] | null
  }

  return sessions
    .filter((s) => staffBySession.get(s.id)?.has(userId))
    .map((s) => {
      const sw = s as unknown as Row
      const pt = Array.isArray(sw.physical_tables) ? sw.physical_tables[0] : sw.physical_tables
      const staffCount = staffBySession.get(s.id)?.size ?? 1
      const total = s.total_cents ?? 0
      return {
        session_id: s.id,
        opened_at: s.opened_at,
        paid_at: s.paid_at,
        table_label: pt?.label ?? null,
        alias: sw.alias ?? null,
        party_size: sw.party_size ?? null,
        total_cents: total,
        staff_count: staffCount,
        share_cents: Math.round(total / staffCount),
      }
    })
}

/**
 * Detalle de una sesión: ítems agrupados, comensales registrados, mozos que
 * participaron. Pensado para el drawer de drilldown.
 */
export async function getStaffSessionDetail(sessionId: string): Promise<StaffSessionDetail | null> {
  const supabase = await createClient()

  const { data: session } = await supabase
    .from('table_sessions')
    .select('id, opened_at, paid_at, party_size, alias, total_cents, physical_tables(label)')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return null

  const [eventsRes, ticketsRes, itemsRes, guestsRes] = await Promise.all([
    supabase.from('table_session_events').select('created_by_user_id').eq('session_id', sessionId),
    supabase.from('tickets').select('id, created_by_user_id, status').eq('session_id', sessionId),
    supabase
      .from('ticket_items')
      .select(
        'quantity, unit_price_cents, line_total_cents, cancelled_at, menu_items(id, name, menu_categories(name)), tickets!inner(session_id, status)',
      )
      .eq('tickets.session_id', sessionId)
      .neq('tickets.status', 'cancelled')
      .is('cancelled_at', null),
    supabase
      .from('session_guests')
      .select('customers(first_name, last_name, phone)')
      .eq('session_id', sessionId)
      .not('customer_id', 'is', null),
  ])

  const events = ((eventsRes.data ?? []) as Array<{ created_by_user_id: string | null }>).map(
    (e) => ({ created_by_user_id: e.created_by_user_id }),
  )
  const tickets = (
    (ticketsRes.data ?? []) as Array<{
      id: string
      created_by_user_id: string | null
      status: string
    }>
  )
    .filter((t) => t.status !== 'cancelled')
    .map((t) => ({ created_by_user_id: t.created_by_user_id }))
  const staffUserIds = staffForSession(events, tickets)

  type ItemRow = {
    quantity: number
    unit_price_cents: number
    line_total_cents: number
    menu_items: {
      id: string
      name: string
      menu_categories: { name: string } | { name: string }[] | null
    } | null
  }
  const itemsMap = new Map<string, StaffSessionDetail['items'][number]>()
  for (const raw of (itemsRes.data ?? []) as unknown as ItemRow[]) {
    const mi = raw.menu_items
    if (!mi) continue
    const cat = Array.isArray(mi.menu_categories) ? mi.menu_categories[0] : mi.menu_categories
    const key = mi.id
    const cur = itemsMap.get(key)
    if (cur) {
      cur.quantity += raw.quantity
      cur.line_total_cents += raw.line_total_cents
    } else {
      itemsMap.set(key, {
        menu_item_id: mi.id,
        name: mi.name,
        category_name: cat?.name ?? '—',
        quantity: raw.quantity,
        unit_price_cents: raw.unit_price_cents,
        line_total_cents: raw.line_total_cents,
      })
    }
  }
  const items = Array.from(itemsMap.values()).sort(
    (a, b) => a.category_name.localeCompare(b.category_name) || b.quantity - a.quantity,
  )

  type GuestRow = {
    customers: { first_name: string | null; last_name: string | null; phone: string | null } | null
  }
  const customers: StaffSessionDetail['customers'] = []
  for (const raw of (guestsRes.data ?? []) as unknown as GuestRow[]) {
    if (raw.customers) customers.push(raw.customers)
  }

  type SessRow = typeof session & {
    alias: string | null
    party_size: number | null
    physical_tables: { label: string } | { label: string }[] | null
  }
  const sw = session as unknown as SessRow
  const pt = Array.isArray(sw.physical_tables) ? sw.physical_tables[0] : sw.physical_tables

  return {
    session_id: session.id,
    opened_at: session.opened_at,
    paid_at: session.paid_at,
    table_label: pt?.label ?? null,
    alias: sw.alias ?? null,
    party_size: sw.party_size ?? null,
    total_cents: session.total_cents ?? 0,
    staff_user_ids: staffUserIds,
    customers,
    items,
  }
}
