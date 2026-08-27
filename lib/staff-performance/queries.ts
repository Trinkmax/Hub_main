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

  // Un solo hop: antes eran sesiones → (eventos + tickets + ítems) en 2 rondas.
  // Embebemos las tres relaciones bajo table_sessions y filtramos ítems/tickets
  // cancelados en memoria (mismo criterio que tenían los filtros server-side).
  // resolveMembers no depende de las sesiones, así que corre en paralelo.
  const [{ data: sessions, error: sErr }, members] = await Promise.all([
    supabase
      .from('table_sessions')
      .select(
        'id, party_size, total_cents, table_session_events(session_id, created_by_user_id), tickets(id, session_id, created_by_user_id, status, ticket_items(quantity, cancelled_at))',
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'paid')
      .gte('paid_at', fromIso)
      .lte('paid_at', toIso),
    resolveMembers(tenantId),
  ])

  if (sErr || !sessions || sessions.length === 0) {
    if (sErr) console.error('[staff-performance.sessions]', sErr.message)
    return []
  }

  type EventRow = { session_id: string; created_by_user_id: string | null }
  type TicketRow = {
    id: string
    session_id: string
    created_by_user_id: string | null
    status: string
    ticket_items: Array<{ quantity: number; cancelled_at: string | null }> | null
  }
  type SessionRow = {
    id: string
    party_size: number | null
    total_cents: number | null
    table_session_events: EventRow[] | null
    tickets: TicketRow[] | null
  }

  const acc = new Map<string, StaffAccumulator>()
  for (const s of sessions as unknown as SessionRow[]) {
    const events = (s.table_session_events ?? []) as WithStaffUser[]
    const liveTickets = (s.tickets ?? []).filter((t) => t.status !== 'cancelled')
    const staff = staffForSession(events, liveTickets as WithStaffUser[])
    let items = 0
    for (const t of liveTickets) {
      for (const it of t.ticket_items ?? []) {
        if (it.cancelled_at === null) items += it.quantity
      }
    }
    accumulateSession(acc, staff, s.party_size, s.total_cents ?? 0, items)
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

  // Un solo hop: eventos y tickets vienen embebidos en vez de una segunda
  // ronda con .in(sessionIds).
  const { data: sessions } = await supabase
    .from('table_sessions')
    .select(
      'id, opened_at, paid_at, party_size, alias, total_cents, physical_tables(label), table_session_events(session_id, created_by_user_id), tickets(session_id, created_by_user_id, status)',
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'paid')
    .gte('paid_at', fromIso)
    .lte('paid_at', toIso)
    .order('paid_at', { ascending: false })

  if (!sessions || sessions.length === 0) return []

  type Row = (typeof sessions)[number] & {
    alias: string | null
    party_size: number | null
    physical_tables: { label: string } | { label: string }[] | null
    table_session_events: Array<{ session_id: string; created_by_user_id: string | null }> | null
    tickets: Array<{ session_id: string; created_by_user_id: string | null; status: string }> | null
  }

  const staffBySession = new Map<string, Set<string>>()
  for (const s of sessions as unknown as Row[]) {
    for (const e of s.table_session_events ?? []) {
      if (!e.created_by_user_id) continue
      const set = staffBySession.get(s.id) ?? new Set()
      set.add(e.created_by_user_id)
      staffBySession.set(s.id, set)
    }
    for (const t of s.tickets ?? []) {
      if (!t.created_by_user_id || t.status === 'cancelled') continue
      const set = staffBySession.get(s.id) ?? new Set()
      set.add(t.created_by_user_id)
      staffBySession.set(s.id, set)
    }
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

  // Las 5 queries sólo dependen de sessionId: van todas en paralelo (1 hop en
  // vez de 2). Si la sesión no existe descartamos el resto igual que antes.
  const [{ data: session }, eventsRes, ticketsRes, itemsRes, guestsRes] = await Promise.all([
    supabase
      .from('table_sessions')
      .select('id, opened_at, paid_at, party_size, alias, total_cents, physical_tables(label)')
      .eq('id', sessionId)
      .maybeSingle(),
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
  if (!session) return null

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
