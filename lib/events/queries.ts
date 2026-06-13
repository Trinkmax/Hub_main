import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { ReservationStatus } from '@/types/database'

export type HubEventOption = {
  id: string
  name: string
  starts_at: string
  capacity: number | null
  confirmed_seats: number
  waitlist_enabled: boolean
}

/**
 * Eventos publicados y futuros del tenant, con asientos confirmados agregados.
 * Único consumidor vivo de la tabla `events`: el alta de reservas puede asociar
 * una reserva a un evento publicado (capacidad/lista de espera).
 */
export async function listLinkableHubEvents(opts: { tenantId: string }): Promise<HubEventOption[]> {
  const supabase = await createClient()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, starts_at, capacity, waitlist_enabled')
    .eq('tenant_id', opts.tenantId)
    .eq('status', 'published')
    .gte('ends_at', now)
    .order('starts_at', { ascending: true })
  if (error) throw error
  const events = data ?? []
  if (events.length === 0) return []

  const ids = events.map((e) => e.id)
  const { data: seats } = await supabase
    .from('event_attendees')
    .select('event_id, status, guests_count')
    .in('event_id', ids)

  const confirmed = new Map<string, number>()
  for (const id of ids) confirmed.set(id, 0)
  for (const r of seats ?? []) {
    const row = r as unknown as {
      event_id: string
      status: ReservationStatus
      guests_count: number
    }
    if (row.status === 'confirmed' || row.status === 'checked_in') {
      confirmed.set(row.event_id, (confirmed.get(row.event_id) ?? 0) + row.guests_count)
    }
  }

  return events.map((e) => ({
    ...(e as unknown as Omit<HubEventOption, 'confirmed_seats'>),
    confirmed_seats: confirmed.get(e.id) ?? 0,
  }))
}
