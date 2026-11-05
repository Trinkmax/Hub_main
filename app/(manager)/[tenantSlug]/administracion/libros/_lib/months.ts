import type { MonthStripState } from '@/components/administracion/charts/month-strip'
import {
  capitalizeFirst,
  daysBetween,
  formatDate,
  isoDayInCordoba,
  monthName,
  monthOf,
} from '@/lib/dates'

/**
 * Los meses de los libros: cómo está cada uno (cerrado, falta cerrar, en curso, no empezó) y cuál se
 * abre sin `?mes=`. Puro: sale del período y de la fecha, sin lecturas. Lo usa el Cierre de mes y lo
 * prueban los tests.
 */

/** Lo que hace falta de un período (las filas de `listFiscalYears` lo cumplen). */
export type MonthPeriod = {
  id: string
  kind: 'month' | 'fy_adjustments' | 'fy_opening'
  /** Primer día del mes (`yyyy-MM-01`). */
  month: string
  startsOn: string
  endsOn: string
  status: 'open' | 'closed'
  closedAt: string | null
  closedByName: string | null
}

/** «octubre»: el mes en minúscula, para armar oraciones. */
export function monthNoun(month: string): string {
  return monthName(Number(month.slice(5, 7)))
}

/** «Octubre». */
export function monthTitle(month: string): string {
  return capitalizeFirst(monthNoun(month))
}

/** Solo los meses calendario, en orden (sin «Apertura» ni «Ajustes de cierre»). */
export function monthPeriods<T extends MonthPeriod>(periods: readonly T[]): T[] {
  return periods
    .filter((p) => p.kind === 'month')
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
}

/** Cómo está un mes hoy. */
export function monthState(period: MonthPeriod, today: string): MonthStripState {
  if (period.status === 'closed') return 'closed'
  if (period.startsOn > today) return 'future'
  if (period.endsOn < today) return 'to_close'
  return 'current'
}

/** «Cerrado el 05/10/2026 por Franco». */
export function closedLine(period: Pick<MonthPeriod, 'closedAt' | 'closedByName'>): string {
  const when = period.closedAt ? ` el ${formatDate(period.closedAt)}` : ''
  const who = period.closedByName ? ` por ${period.closedByName}` : ''
  return `Cerrado${when}${who}`
}

/** «Lo cerró Franco el 05/10/2026.» */
export function closedSentence(period: Pick<MonthPeriod, 'closedAt' | 'closedByName'>): string {
  const when = period.closedAt ? ` el ${formatDate(period.closedAt)}` : ''
  return period.closedByName
    ? `Lo cerró ${period.closedByName}${when}.`
    : when
      ? `Se cerró${when}.`
      : 'Ya está cerrado.'
}

/** Cuántos días se queda la pantalla en un mes recién cerrado (para mandar los libros). */
export const JUST_CLOSED_DAYS = 10

/**
 * El mes que se abre sin `?mes=`, para quien cierra: ① el primer mes abierto
 * que ya terminó (el que toca cerrar); ② si no hay, el último cerrado si se
 * cerró hace 10 días o menos (así, al cerrar, la pantalla se queda en ese mes
 * con «Mandale los libros» a mano); ③ si no, el mes de hoy.
 */
export function focusMonth(periods: readonly MonthPeriod[], today: string): string {
  const months = monthPeriods(periods)
  const toClose = months.find((p) => p.status === 'open' && p.endsOn < today)
  if (toClose) return monthOf(toClose.month)
  const lastClosed = [...months].reverse().find((p) => p.status === 'closed')
  if (lastClosed?.closedAt) {
    const closedDay = isoDayInCordoba(lastClosed.closedAt)
    if (closedDay) {
      const age = daysBetween(closedDay, today)
      if (age >= 0 && age <= JUST_CLOSED_DAYS) return monthOf(lastClosed.month)
    }
  }
  return monthOf(today)
}

/** El primer mes abierto anterior a `month` (los meses se cierran en orden). */
export function earlierOpenMonth<T extends MonthPeriod>(
  periods: readonly T[],
  month: string,
): T | null {
  const ym = month.slice(0, 7)
  return monthPeriods(periods).find((p) => p.status === 'open' && monthOf(p.month) < ym) ?? null
}
