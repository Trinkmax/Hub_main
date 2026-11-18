/**
 * El pulso del bar: cuánta gente vino de verdad, día por día. PURO (sin base ni react), para que la
 * cuenta se pueda probar sola (`tests/lib/stats-pulse.test.ts`).
 *
 * Es lo que muestra el Resumen del dueño. Antes el Resumen contaba «visitas» y «facturación», que
 * salen solo de los consumos a los que alguien les cargó puntos (uno o dos por día): en un bar que
 * vive de reservas y eventos, esos números no decían nada. La gente que vino sale de las reservas
 * que se marcaron «Llegó».
 */

import { addDays } from '@/lib/dates/civil'

/** Lo mínimo de una reserva para esta cuenta: sin nombre ni teléfono. */
export type PulseRow = {
  reservation_date: string
  status: string
  estimated_guests: number | null
  actual_guests: number | null
}

export type PulseDay = {
  /** `2026-11-18`. */
  day: string
  /** Reservas que llegaron ese día. */
  arrived: number
  /** Personas de esas reservas (las que se contaron; si nadie contó, las que reservaron). */
  covers: number
}

export type PulseWindow = {
  arrived: number
  covers: number
  noShows: number
  /**
   * Reservas de días que ya pasaron y que nadie marcó (ni «Llegó» ni «No vino»). No se sabe si
   * vinieron: quedan afuera de la gente y de la asistencia, y se avisan aparte.
   */
  unmarked: number
  /** De las que se marcaron, qué parte vino (0 a 1). `null` si no se marcó ninguna. */
  attendance: number | null
}

export type BarPulse = {
  /** La ventana actual, un renglón por día (también los días sin nadie), del más viejo a hoy. */
  days: PulseDay[]
  current: PulseWindow
  /** La ventana anterior, del mismo largo: contra qué se compara. */
  previous: PulseWindow
}

const ARRIVED = new Set(['arrived', 'seated', 'closed'])

/** El primer día que hace falta leer para armar las dos ventanas que terminan en `today`. */
export function pulseSince(today: string, windowDays = 30): string {
  return addDays(today, -(windowDays * 2 - 1))
}

function emptyWindow(): PulseWindow & { marked: number } {
  return { arrived: 0, covers: 0, noShows: 0, unmarked: 0, attendance: null, marked: 0 }
}

/**
 * Junta las reservas en dos ventanas de `windowDays` días: la que termina hoy y la anterior.
 *
 * - Una cancelada no cuenta para nada.
 * - «Llegó» (y los viejos «sentada» / «cerrada») suma la reserva y su gente.
 * - «No vino» cuenta para la asistencia.
 * - Una pendiente de un día que ya pasó es una reserva sin marcar; una pendiente de hoy es normal
 *   (todavía puede llegar) y no cuenta como nada.
 * - Lo que cae fuera de las dos ventanas (o después de hoy) se ignora.
 */
export function tallyPulse(
  rows: ReadonlyArray<PulseRow>,
  today: string,
  windowDays = 30,
): BarPulse {
  const size = Math.max(1, Math.floor(windowDays))
  const currentFrom = addDays(today, -(size - 1))
  const previousFrom = addDays(today, -(size * 2 - 1))

  const byDay = new Map<string, PulseDay>()
  for (let i = 0; i < size; i++) {
    const day = addDays(currentFrom, i)
    byDay.set(day, { day, arrived: 0, covers: 0 })
  }

  const current = emptyWindow()
  const previous = emptyWindow()

  for (const row of rows) {
    const day = row.reservation_date
    if (day > today || day < previousFrom) continue
    if (row.status === 'cancelled') continue
    const window = day >= currentFrom ? current : previous

    if (ARRIVED.has(row.status)) {
      const people = Math.max(0, row.actual_guests ?? row.estimated_guests ?? 0)
      window.arrived += 1
      window.covers += people
      window.marked += 1
      const slot = byDay.get(day)
      if (slot) {
        slot.arrived += 1
        slot.covers += people
      }
    } else if (row.status === 'no_show') {
      window.noShows += 1
      window.marked += 1
    } else if (row.status === 'pending' && day < today) {
      window.unmarked += 1
    }
  }

  const close = ({ marked, ...window }: PulseWindow & { marked: number }): PulseWindow => ({
    ...window,
    attendance: marked > 0 ? window.arrived / marked : null,
  })

  return { days: [...byDay.values()], current: close(current), previous: close(previous) }
}

/** Cuánto cambió contra la ventana anterior, en porcentaje entero. `null` si no hay contra qué. */
export function pulseDelta(current: number, previous: number): number | null {
  if (previous <= 0) return current <= 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 100)
}
