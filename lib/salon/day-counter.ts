/**
 * El contador del día de la lista /reservas, POR SERVICIO.
 *
 * Cuando la lista volvió al menú (22/09/2026) el dueño fue explícito: nunca
 * más el "171/130" del total del día contra PA + PB. El contador muestra cada
 * servicio con actividad (almuerzo, merienda, cena) contra SU cupo, con la
 * misma cuenta que el calendario (`computeDaySegments`): si la lista dijera un
 * número y el calendario otro para la misma cena, el dueño deja de creerle a
 * los dos. Acá solo se ELIGE qué mostrar; los números salen de segments.ts.
 *
 * Puro (sin supabase, next ni react): lo usa el RSC de la lista y se prueba en
 * Vitest. Acá vive también la cuenta del modo rango (`tallyRangeTotals`), que
 * no tiene cupo.
 */

import { formatDayLabel } from './date-presets'
import { type DaySegments, eventLoadsById, SEGMENT_KEYS, type SegmentLoad } from './segments'

/**
 * Los servicios del día que tienen algo (reservas activas o un evento
 * programado), en orden del día. Un servicio vacío no se muestra: "Almuerzo
 * 0/70" todos los días es ruido, y la lista ya dice "No hay reservas este día".
 */
export function activeDaySegments(day: DaySegments): SegmentLoad[] {
  return SEGMENT_KEYS.map((key) => day.segments[key]).filter((s) => s.hasActivity)
}

/**
 * Gente ya vendida por evento (id → personas), para el renglón de hitos de la
 * lista. Sale de la misma cuenta que el chip del evento en el calendario
 * (reales si ya se contaron, si no estimados; sin canceladas ni "no vino").
 */
export function eventUsedById(day: DaySegments): Map<string, number> {
  const loads = eventLoadsById({ [day.date]: day })
  return new Map(Object.values(loads).map((load) => [load.id, load.used]))
}

/** 'jue 10/09', para el aria-label del chip ("Cena, jue 10/09: 46 de 120 personas…"). */
export function counterDayLabel(iso: string): string {
  const label = formatDayLabel(iso)
  return label.charAt(0).toLowerCase() + label.slice(1)
}

/** Una fila activa (sin canceladas ni "no vino") del rango de la lista. */
export type RangeTotalsRow = {
  estimated_guests: number
  actual_guests: number | null
  scheduled_event_id: string | null
  kind: string
  cake_count: number
}

export type RangeTotals = {
  reservations: number
  guests: number
  salon: number
  eventos: number
  /** Tortas comprometidas en el período: lo que el bar tiene que producir. */
  cakes: number
  birthdays: number
}

/**
 * El contador del modo rango de la lista ("12 reservas activas · 80 cubiertos
 * (50 salón · 30 eventos)"). Sin cupo a propósito: un rango no tiene uno.
 *
 * "Eventos" lo decide `scheduled_event_id`, NUNCA la zona: desde el 22/09/2026
 * una reserva de Pizza libre puede sentarse en Planta Alta, y contarla por
 * zona la pasaba a "salón" aunque siga ocupando cupo del evento.
 */
export function tallyRangeTotals(rows: ReadonlyArray<RangeTotalsRow>): RangeTotals {
  let salon = 0
  let eventos = 0
  let cakes = 0
  let birthdays = 0
  for (const r of rows) {
    const guests = r.actual_guests ?? r.estimated_guests ?? 0
    if (r.scheduled_event_id) eventos += guests
    else salon += guests
    cakes += r.cake_count
    if (r.kind === 'birthday') birthdays += 1
  }
  return { reservations: rows.length, guests: salon + eventos, salon, eventos, cakes, birthdays }
}
