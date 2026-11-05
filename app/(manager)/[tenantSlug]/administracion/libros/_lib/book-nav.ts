import { monthOf } from '@/lib/dates'

/**
 * Llevar el período de un libro a otro: del diario de septiembre al mayor de septiembre. Puro.
 *
 * - A un libro de rango (diario, mayor, sumas y saldos, subdiarios, historia) viaja el período tal
 *   cual: `?mes=` o `?desde=&hasta=`.
 * - A un libro mensual (los dos de IVA y la posición) viaja `?mes=`: el mes pedido o, si venías con un
 *   rango, el mes de su «hasta».
 */

/** El período que se está mirando: un mes (`?mes=`) o un rango (`?desde=&hasta=`). */
export type BookPeriod = {
  kind: 'month' | 'range'
  /** `yyyy-MM` cuando `kind === 'month'`. */
  month: string | null
  from: string
  to: string
}

/** Los parámetros del período con que se llega a un libro desde el período actual. */
export function bookPeriodParams(
  book: { period: 'mes' | 'rango' },
  period: BookPeriod,
): { mes?: string; desde?: string; hasta?: string } {
  if (period.kind === 'month' && period.month) return { mes: period.month.slice(0, 7) }
  if (book.period === 'mes') return { mes: monthOf(period.to) }
  return { desde: period.from, hasta: period.to }
}
