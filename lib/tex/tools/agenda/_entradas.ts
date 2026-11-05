import 'server-only'

import { addDays } from '@/lib/dates'
import {
  listScheduledEventsForDateRange,
  type ScheduledEventWithTemplate,
} from '@/lib/salon/queries'
import { collectPages } from '@/lib/salon/segment-rows'
import { createClient } from '@/lib/supabase/server'
import { todayIn } from '@/lib/ticketing/dates'
import type { TexToolContext } from '../types'
import type { ExperienceLite, SeatOrderRow, SeatReservationRow } from './_read-data'

/**
 * Las funciones a la venta, leídas con la sesión del dueño.
 *
 * La pantalla (`getAdminOverview`) y `ticketing_event_seats` usan el cliente de servicio, y Tex no lo
 * usa nunca. Lo que necesita la cuenta sí se puede leer con la sesión: las películas y las compras son
 * del dueño por RLS y las reservas, de los miembros. Por eso esta herramienta es solo del dueño, igual
 * que la pantalla. La cuenta está en `seatCounts`.
 */

// biome-ignore lint/suspicious/noExplicitAny: tablas sin tipos generados, como lib/ticketing/queries
type SBAny = any

const EXPERIENCE_COLUMNS =
  'id, template_id, slug, published, title, price_cents, deposit_cents, cash_price_cents, allow_full_payment, min_party_size, max_party_size'

/** Hasta dónde se miran las funciones: la pantalla no tiene tope, y un año alcanza de sobra. */
const FUNCTIONS_LOOKAHEAD_DAYS = 370

export type CarteleraRead = {
  experiences: ExperienceLite[]
  events: ScheduledEventWithTemplate[]
  reservations: SeatReservationRow[]
  orders: SeatOrderRow[]
}

export async function readCartelera(ctx: TexToolContext): Promise<CarteleraRead> {
  const supabase = (await createClient()) as SBAny
  const today = todayIn()
  const [{ data: rows, error }, allEvents] = await Promise.all([
    supabase
      .from('event_experiences')
      .select(EXPERIENCE_COLUMNS)
      .eq('tenant_id', ctx.tenantId)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
    listScheduledEventsForDateRange({
      tenantId: ctx.tenantId,
      from: today,
      to: addDays(today, FUNCTIONS_LOOKAHEAD_DAYS),
    }),
  ])
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  const experiences = (rows ?? []) as ExperienceLite[]
  const templateIds = new Set(experiences.map((e) => e.template_id))
  const events = allEvents.filter((e) => templateIds.has(e.template_id) && !e.private_group)
  const eventIds = events.map((e) => e.id)
  if (eventIds.length === 0) return { experiences, events, reservations: [], orders: [] }

  const [reservations, orders] = await Promise.all([
    collectPages<SeatReservationRow>((from, to) =>
      supabase
        .from('salon_reservations')
        .select('scheduled_event_id, estimated_guests, actual_guests')
        .eq('tenant_id', ctx.tenantId)
        .in('scheduled_event_id', eventIds)
        .not('status', 'in', '(cancelled,no_show)')
        .order('id', { ascending: true })
        .range(from, to),
    ),
    collectPages<SeatOrderRow>((from, to) =>
      supabase
        .from('ticket_orders')
        .select('scheduled_event_id, party_size, status, hold_expires_at')
        .eq('tenant_id', ctx.tenantId)
        .in('scheduled_event_id', eventIds)
        .in('status', ['approved', 'pending', 'rejected'])
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])
  return { experiences, events, reservations, orders }
}
