import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { EventStatus, ReservationStatus } from '@/types/database'

export type EventListEntry = {
  id: string
  name: string
  starts_at: string
  ends_at: string
  capacity: number | null
  status: EventStatus
  cover_image_url: string | null
  confirmed_seats: number
  waitlist_count: number
}

export type EventTab = 'upcoming' | 'past' | 'drafts'

/**
 * Lista de eventos con conteos de ocupación. Hacemos N+1 controlado:
 * pedimos seats agregados en una sola query con `select(..., count)` por
 * status, agrupando en TS (las RPC group-by exigen view materializada).
 */
export async function listEvents(opts: {
  tenantId: string
  tab: EventTab
}): Promise<EventListEntry[]> {
  const supabase = await createClient()
  let q = supabase
    .from('events')
    .select('id, name, starts_at, ends_at, capacity, status, cover_image_url')
    .eq('tenant_id', opts.tenantId)

  const now = new Date().toISOString()
  if (opts.tab === 'upcoming') {
    q = q.in('status', ['published']).gte('ends_at', now).order('starts_at', { ascending: true })
  } else if (opts.tab === 'past') {
    q = q
      .in('status', ['finished', 'cancelled', 'published'])
      .lt('ends_at', now)
      .order('starts_at', { ascending: false })
  } else {
    q = q.eq('status', 'draft').order('created_at', { ascending: false })
  }

  const { data, error } = await q
  if (error) throw error
  const events = data ?? []
  if (events.length === 0) return []

  const ids = events.map((e) => e.id)
  const { data: seats } = await supabase
    .from('reservations')
    .select('event_id, status, guests_count')
    .in('event_id', ids)

  const counters = new Map<string, { confirmed: number; waitlist: number }>()
  for (const id of ids) counters.set(id, { confirmed: 0, waitlist: 0 })
  for (const r of seats ?? []) {
    const row = r as unknown as {
      event_id: string
      status: ReservationStatus
      guests_count: number
    }
    const bucket = counters.get(row.event_id)
    if (!bucket) continue
    if (row.status === 'confirmed' || row.status === 'checked_in') {
      bucket.confirmed += row.guests_count
    } else if (row.status === 'waitlist') {
      bucket.waitlist += row.guests_count
    }
  }

  return events.map((e) => {
    const c = counters.get(e.id) ?? { confirmed: 0, waitlist: 0 }
    return {
      ...(e as unknown as Omit<EventListEntry, 'confirmed_seats' | 'waitlist_count'>),
      confirmed_seats: c.confirmed,
      waitlist_count: c.waitlist,
    }
  })
}

export async function getEvent(opts: { tenantId: string; id: string }): Promise<{
  event: {
    id: string
    name: string
    description: string | null
    starts_at: string
    ends_at: string
    capacity: number | null
    waitlist_enabled: boolean
    status: EventStatus
    cover_image_url: string | null
    created_at: string
  }
  confirmed_seats: number
  waitlist_count: number
} | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, name, description, starts_at, ends_at, capacity, waitlist_enabled, status, cover_image_url, created_at',
    )
    .eq('tenant_id', opts.tenantId)
    .eq('id', opts.id)
    .maybeSingle()
  if (error || !data) return null

  const { data: seats } = await supabase
    .from('reservations')
    .select('status, guests_count')
    .eq('event_id', opts.id)

  let confirmed = 0
  let wait = 0
  for (const r of seats ?? []) {
    const row = r as unknown as { status: ReservationStatus; guests_count: number }
    if (row.status === 'confirmed' || row.status === 'checked_in') confirmed += row.guests_count
    else if (row.status === 'waitlist') wait += row.guests_count
  }
  return {
    event: data as unknown as Awaited<ReturnType<typeof getEvent>> extends infer T
      ? T extends { event: infer E }
        ? E
        : never
      : never,
    confirmed_seats: confirmed,
    waitlist_count: wait,
  }
}

export type ReservationRow = {
  id: string
  status: ReservationStatus
  guests_count: number
  waitlist_position: number | null
  checked_in_at: string | null
  customer: {
    id: string
    first_name: string
    last_name: string
    phone: string
  }
}

export async function listReservations(opts: {
  tenantId: string
  eventId: string
}): Promise<ReservationRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reservations')
    .select(
      `id, status, guests_count, waitlist_position, checked_in_at,
       customer:customers(id, first_name, last_name, phone)`,
    )
    .eq('tenant_id', opts.tenantId)
    .eq('event_id', opts.eventId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => {
    const r = row as unknown as Omit<ReservationRow, 'customer'> & {
      customer: ReservationRow['customer'] | ReservationRow['customer'][] | null
    }
    const customer = Array.isArray(r.customer) ? r.customer[0] : r.customer
    return {
      id: r.id,
      status: r.status,
      guests_count: r.guests_count,
      waitlist_position: r.waitlist_position,
      checked_in_at: r.checked_in_at,
      customer: customer ?? { id: '', first_name: '—', last_name: '', phone: '' },
    }
  })
}
