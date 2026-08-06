import type { SalonReservationStatus, SalonZone } from './types'

export type MonthCapacity = {
  /** Tope total del salón (PA + PB) sin overrides, para días sin entrada propia. */
  defaultTotal: number
  /** Por fecha YYYY-MM-DD con reservas u overrides: cubiertos usados y tope del día. */
  days: Record<string, { used: number; total: number }>
  /** Cubiertos anotados por evento programado (`scheduled_events.id`). */
  events: Record<string, number>
}

type AggregateInput = {
  reservations: Array<{
    reservation_date: string
    zone: SalonZone
    estimated_guests: number
    actual_guests: number | null
    status: SalonReservationStatus
    scheduled_event_id?: string | null
  }>
  overrides: Array<{ override_date: string; zone: 'planta_alta' | 'planta_baja'; capacity: number }>
  defaults: { planta_alta: number; planta_baja: number }
}

/**
 * Agrega, para un mes, los cubiertos reservados por día y el tope del día.
 *
 * - `used` = suma de comensales de reservas activas en zonas físicas
 *   (PA + PB). Usa `actual_guests` si la reserva está `closed`, si no
 *   `estimated_guests`. Excluye `cancelled`/`no_show` y `event_floating`
 *   (esas consumen el cupo de su evento, no el del salón).
 * - `total` = cap(PA) + cap(PB) con override por fecha aplicado por zona.
 * - `events[id]` = cubiertos anotados en cada evento programado: TODA reserva
 *   activa colgada del evento, sin importar zona ni tipo. Es el mismo criterio
 *   que el detalle del evento ("N/cupo personas reservadas"), para que el
 *   calendario y el detalle nunca muestren números distintos. Ojo: acá el
 *   comensal real (`actual_guests`) pesa apenas la mesa lo carga, mientras que
 *   el conteo de salón espera al `closed` — son dos contadores con criterios
 *   distintos a propósito, no unificar sin pensarlo.
 *
 * Puro y determinístico — testeable sin DB. La query `getMonthCapacity`
 * le pasa filas crudas de Supabase.
 */
export function aggregateMonthCapacity(input: AggregateInput): MonthCapacity {
  const defaultTotal = input.defaults.planta_alta + input.defaults.planta_baja
  const days: Record<string, { used: number; total: number }> = {}
  const events: Record<string, number> = {}

  const ensure = (date: string) => {
    const cur = days[date]
    if (cur) return cur
    const fresh = { used: 0, total: defaultTotal }
    days[date] = fresh
    return fresh
  }

  // Overrides: armamos cap por zona por fecha, partiendo de los defaults.
  const zoneCaps: Record<string, { planta_alta: number; planta_baja: number }> = {}
  for (const o of input.overrides) {
    const entry = zoneCaps[o.override_date] ?? { ...input.defaults }
    entry[o.zone] = o.capacity
    zoneCaps[o.override_date] = entry
  }
  for (const [date, caps] of Object.entries(zoneCaps)) {
    ensure(date).total = caps.planta_alta + caps.planta_baja
  }

  for (const r of input.reservations) {
    if (r.status === 'cancelled' || r.status === 'no_show') continue

    if (r.scheduled_event_id) {
      events[r.scheduled_event_id] =
        (events[r.scheduled_event_id] ?? 0) + (r.actual_guests ?? r.estimated_guests)
    }

    if (r.zone !== 'planta_alta' && r.zone !== 'planta_baja') continue
    const guests =
      r.status === 'closed' && r.actual_guests != null ? r.actual_guests : r.estimated_guests
    ensure(r.reservation_date).used += guests
  }

  return { defaultTotal, days, events }
}
