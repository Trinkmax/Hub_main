import type { ViewPillItem } from '@/components/administracion/kit/view-pills'
import { monthOf } from '@/lib/dates'
import { bookHref } from './periods'

/**
 * Pasar de un libro a otro sin volver al índice y SIN perder el período: del
 * diario de septiembre al mayor de septiembre en un toque. Puro: arma los
 * `items` de la fila de píldoras (`BookSwitcher`) y lo prueban los tests.
 *
 * - A un libro de rango (diario, mayor, sumas y saldos, subdiarios, historia)
 *   viaja el período tal cual: `?mes=` o `?desde=&hasta=`.
 * - A un libro mensual (los dos de IVA y la posición) viaja `?mes=`: el mes
 *   pedido o, si venías con un rango, el mes de su «hasta».
 * - Los demás filtros (`cuenta`, `tipo`, `quien`, `caja`, `nivel`, `despues`)
 *   NO viajan: son de cada libro.
 */

export type BookKey =
  | 'diario'
  | 'mayor'
  | 'sumas-y-saldos'
  | 'subdiarios'
  | 'iva-compras'
  | 'iva-ventas'
  | 'posicion-iva'
  | 'historia'

type BookDef = {
  key: BookKey
  label: string
  shortLabel?: string
  /** `mes` = un mes entero; `rango` = un mes o `desde`/`hasta`. */
  period: 'mes' | 'rango'
}

export const BOOKS: readonly BookDef[] = [
  { key: 'diario', label: 'Diario', period: 'rango' },
  { key: 'mayor', label: 'Mayor', period: 'rango' },
  { key: 'sumas-y-saldos', label: 'Sumas y saldos', shortLabel: 'Sumas', period: 'rango' },
  { key: 'subdiarios', label: 'Subdiarios', period: 'rango' },
  { key: 'iva-compras', label: 'IVA compras', period: 'mes' },
  { key: 'iva-ventas', label: 'IVA ventas', period: 'mes' },
  { key: 'posicion-iva', label: 'Posición de IVA', shortLabel: 'Posición', period: 'mes' },
  { key: 'historia', label: 'Historia', period: 'rango' },
]

/** El período que se está mirando: un mes (`?mes=`) o un rango (`?desde=&hasta=`). */
export type BookPeriod = {
  kind: 'month' | 'range'
  /** `yyyy-MM` cuando `kind === 'month'`. */
  month: string | null
  from: string
  to: string
}

/** Los parámetros del período con que se llega a `book` desde el período actual. */
export function bookPeriodParams(
  book: Pick<BookDef, 'period'>,
  period: BookPeriod,
): { mes?: string; desde?: string; hasta?: string } {
  if (period.kind === 'month' && period.month) return { mes: period.month.slice(0, 7) }
  if (book.period === 'mes') return { mes: monthOf(period.to) }
  return { desde: period.from, hasta: period.to }
}

/** Las píldoras de «entre libros», con el período puesto y la activa marcada. */
export function bookSwitcherItems(
  /** `/<bar>/administracion/libros`. */
  booksPath: string,
  active: BookKey | null,
  period: BookPeriod,
): ViewPillItem[] {
  return BOOKS.map((book) => ({
    key: book.key,
    label: book.label,
    shortLabel: book.shortLabel,
    href: bookHref(`${booksPath}/${book.key}`, bookPeriodParams(book, period)),
    active: book.key === active,
  }))
}
