import type { ReservationKind, SalonReservationStatus, SalonZone } from './types'

export type MonthCapacity = {
  /** Tope total del salón (PA + PB) sin overrides, para días sin entrada propia. */
  defaultTotal: number
  /** Por fecha YYYY-MM-DD con reservas u overrides: cubiertos usados y tope del día. */
  days: Record<string, { used: number; total: number }>
  /** Cubiertos anotados por evento programado (`scheduled_events.id`). */
  events: Record<string, number>
  /**
   * Festejos por día: cuántos cumpleaños hay y cuántas tortas tiene que hacer
   * el bar. Va en el calendario porque el moco que motivó todo esto fue
   * enterarse el mismo lunes 21 de que había un cumple con torta metido adentro
   * de "Pizza libre" — a nivel mes no se veía nada.
   */
  celebrations: Record<string, { birthdays: number; cakes: number }>
}

type AggregateInput = {
  reservations: Array<{
    reservation_date: string
    zone: SalonZone
    estimated_guests: number
    actual_guests: number | null
    status: SalonReservationStatus
    scheduled_event_id?: string | null
    kind?: ReservationKind
    cake_count?: number
  }>
  overrides: Array<{ override_date: string; zone: 'planta_alta' | 'planta_baja'; capacity: number }>
  defaults: { planta_alta: number; planta_baja: number }
}

/**
 * Agrega, para un mes, los cubiertos reservados por día y el tope del día.
 *
 * - `used` = TODA reserva activa del día, sin importar la zona: las mesas a la
 *   carta más las atadas a un evento (`event_floating`). Antes el badge del
 *   calendario excluía las de evento y mostraba 30 en un día de 30 + 12, igual
 *   que el contador de /reservas — y el dueño terminaba con dos números
 *   distintos para el mismo día. Esa gente igual se sienta en el salón.
 * - `total` = cap(PA) + cap(PB) con override por fecha aplicado por zona. Los
 *   cubiertos de evento no traen tope propio: el que les aplica es el del salón.
 * - `events[id]` = cubiertos anotados en cada evento programado: TODA reserva
 *   activa colgada del evento, sin importar zona ni tipo. Es el mismo criterio
 *   que el detalle del evento ("N/cupo personas reservadas"), para que el
 *   calendario y el detalle nunca muestren números distintos.
 *
 * Los dos contadores usan `actual_guests ?? estimated_guests` — el comensal real
 * pesa apenas la mesa lo carga, sin esperar al `closed`. Es el mismo criterio
 * que el RPC `evaluate_day_capacity`, así que el badge del mes y el contador de
 * /reservas dan siempre el mismo número para el mismo día.
 *
 * Puro y determinístico — testeable sin DB. La query `getMonthCapacity`
 * le pasa filas crudas de Supabase.
 */
export function aggregateMonthCapacity(input: AggregateInput): MonthCapacity {
  const defaultTotal = input.defaults.planta_alta + input.defaults.planta_baja
  const days: Record<string, { used: number; total: number }> = {}
  const events: Record<string, number> = {}
  const celebrations: Record<string, { birthdays: number; cakes: number }> = {}

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

    const guests = r.actual_guests ?? r.estimated_guests

    if (r.scheduled_event_id) {
      events[r.scheduled_event_id] = (events[r.scheduled_event_id] ?? 0) + guests
    }

    // Toda reserva activa suma al día: la zona dice DÓNDE se sienta, no si
    // cuenta. Cada reserva tiene exactamente una zona, así que no hay doble
    // conteo con el contador por evento (son ejes ortogonales).
    ensure(r.reservation_date).used += guests

    if (r.kind === 'birthday' || (r.cake_count ?? 0) > 0) {
      const c = celebrations[r.reservation_date] ?? { birthdays: 0, cakes: 0 }
      if (r.kind === 'birthday') c.birthdays += 1
      c.cakes += r.cake_count ?? 0
      celebrations[r.reservation_date] = c
    }
  }

  return { defaultTotal, days, events, celebrations }
}
