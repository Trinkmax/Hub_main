import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays } from '@/lib/dates/civil'
import { listScheduledEventsForDateRange } from '@/lib/salon/queries'
import { collectPages } from '@/lib/salon/segment-rows'
import { eventDisplayName } from '@/lib/salon/segments'
import { createClient } from '@/lib/supabase/server'
import { type BarPulse, type PulseRow, pulseSince, tallyPulse } from './pulse'

// `salon_reservations` todavía no está en los tipos generados con todas sus columnas: se lee sin
// tipar y se acota acá, en el borde (como el resto de `lib/salon`).
async function untyped(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

/**
 * La gente que vino en los últimos `windowDays` días y en los anteriores (para comparar). Lee con el
 * cliente de la persona: las políticas de la tabla deciden qué ve, y la consulta filtra por el bar.
 *
 * Trae solo cuatro columnas por reserva, sin nombres ni teléfonos, y de a páginas: PostgREST corta
 * cada respuesta en 1000 filas y dos meses de temporada pasan ese tope.
 */
export async function getBarPulse(opts: {
  tenantId: string
  /** Hoy en la zona del bar, `AAAA-MM-DD`. */
  today: string
  windowDays?: number
}): Promise<BarPulse> {
  const windowDays = opts.windowDays ?? 30
  const supabase = await untyped()
  const since = pulseSince(opts.today, windowDays)

  const rows = await collectPages<PulseRow>((from, to) =>
    supabase
      .from('salon_reservations')
      .select('reservation_date, status, estimated_guests, actual_guests')
      .eq('tenant_id', opts.tenantId)
      .gte('reservation_date', since)
      .lte('reservation_date', opts.today)
      // Orden estable (fecha + id): sin él, dos páginas pueden repetir o saltearse filas.
      .order('reservation_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
  return tallyPulse(rows, opts.today, windowDays)
}

export type UpcomingEvent = {
  id: string
  /** `2026-11-22`. */
  date: string
  /** `21:00`. */
  time: string
  name: string
  /** El color del formato en el calendario. */
  color: string | null
  capacity: number
  /** Personas con reserva en pie (sin canceladas ni ausentes). */
  reserved: number
  privateGroup: boolean
}

/**
 * Los eventos del calendario de hoy a `days` días, con cuánta gente tienen anotada. Para la lista
 * «Lo que viene» del Resumen: ver de un vistazo qué fecha está llena y cuál hay que empujar.
 */
export async function listUpcomingEvents(opts: {
  tenantId: string
  today: string
  days?: number
}): Promise<UpcomingEvent[]> {
  const until = addDays(opts.today, (opts.days ?? 7) - 1)
  const events = await listScheduledEventsForDateRange({
    tenantId: opts.tenantId,
    from: opts.today,
    to: until,
  })
  if (events.length === 0) return []

  const supabase = await untyped()
  const rows = await collectPages<{
    scheduled_event_id: string | null
    estimated_guests: number | null
    actual_guests: number | null
  }>((from, to) =>
    supabase
      .from('salon_reservations')
      .select('scheduled_event_id, estimated_guests, actual_guests')
      .eq('tenant_id', opts.tenantId)
      .in(
        'scheduled_event_id',
        events.map((event) => event.id),
      )
      .not('status', 'in', '(cancelled,no_show)')
      .order('id', { ascending: true })
      .range(from, to),
  )

  const reserved = new Map<string, number>()
  for (const row of rows) {
    if (!row.scheduled_event_id) continue
    const people = Math.max(0, row.actual_guests ?? row.estimated_guests ?? 0)
    reserved.set(row.scheduled_event_id, (reserved.get(row.scheduled_event_id) ?? 0) + people)
  }

  return events.map((event) => ({
    id: event.id,
    date: event.event_date,
    time: event.starts_at_local.slice(0, 5),
    name: eventDisplayName(event),
    color: event.template?.color_hex ?? null,
    capacity: event.capacity,
    reserved: reserved.get(event.id) ?? 0,
    privateGroup: event.private_group,
  }))
}

/** Clientes del bar: cuántos hay y cuántos se sumaron desde `since` (un instante ISO). */
export async function getCustomerGrowth(opts: {
  tenantId: string
  since: string
}): Promise<{ total: number; added: number }> {
  const supabase = await untyped()
  const [total, added] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', opts.tenantId)
      .is('deleted_at', null),
    supabase
      .from('customers')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', opts.tenantId)
      .is('deleted_at', null)
      .gte('created_at', opts.since),
  ])
  if (total.error) throw total.error
  return { total: total.count ?? 0, added: added.error ? 0 : (added.count ?? 0) }
}
