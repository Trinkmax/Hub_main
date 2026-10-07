/**
 * Lo que necesita el PeriodPicker del kit (§3.2) además de `period.ts`, puro:
 * los links del modo URL, las etiquetas de las flechas, qué se puede elegir
 * dentro de `[min, max]` y la lista de ejercicios.
 */

import { addMonthsToYearMonth, endOfMonth, startOfMonth } from './civil'
import {
  fiscalYearOf,
  fiscalYearRange,
  type Period,
  type PeriodOptions,
  periodLabel,
  periodRange,
  serializePeriod,
  shiftPeriod,
} from './period'

export type PeriodBounds = { min?: string | null; max?: string | null }

/**
 * La URL actual con `?<param>=<período>`, conservando el resto de los
 * parámetros: `periodHref('/hub/libros', 'tab=iva', 'periodo', mes)` →
 * `'/hub/libros?tab=iva&periodo=2026-09'`. Es lo que arma cada `<Link>` del
 * modo URL (una función no cruza de un Server Component a uno cliente, así que
 * el picker recibe el nombre del parámetro y arma los links él).
 */
export function periodHref(
  pathname: string,
  search: string | URLSearchParams | null | undefined,
  param: string,
  period: Period,
): string {
  const params = new URLSearchParams(
    typeof search === 'string' ? search.replace(/^\?/, '') : (search ?? undefined),
  )
  params.set(param, serializePeriod(period))
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/** `'Agosto 2026'` → `'agosto 2026'`: la etiqueta adentro de una frase. */
export function periodInlineLabel(p: Period, opts?: PeriodOptions): string {
  const label = periodLabel(p, opts)
  return label.charAt(0).toLowerCase() + label.slice(1)
}

/** ¿Queda algo del período adentro de `[min, max]`? */
export function periodTouchesBounds(
  p: Period,
  bounds: PeriodBounds,
  opts?: PeriodOptions,
): boolean {
  const { from, to } = periodRange(p, opts)
  if (bounds.min && to < bounds.min) return false
  if (bounds.max && from > bounds.max) return false
  return true
}

/** ¿Se puede ir al período anterior (−1) o siguiente (+1) sin salirse de `[min, max]`? */
export function canShiftPeriod(
  p: Period,
  delta: number,
  bounds: PeriodBounds,
  opts?: PeriodOptions,
): boolean {
  return periodTouchesBounds(shiftPeriod(p, delta, opts), bounds, opts)
}

/** `'Período anterior: agosto 2026'` · `'Período siguiente: octubre 2026'`. */
export function periodStepLabel(p: Period, delta: -1 | 1, opts?: PeriodOptions): string {
  const target = periodInlineLabel(shiftPeriod(p, delta, opts), opts)
  return `${delta < 0 ? 'Período anterior' : 'Período siguiente'}: ${target}`
}

/** ¿Se puede elegir el mes `yyyy-MM`? (algún día suyo adentro de `[min, max]`). */
export function isMonthInBounds(month: string, bounds: PeriodBounds): boolean {
  if (bounds.max && startOfMonth(month) > bounds.max) return false
  if (bounds.min && endOfMonth(month) < bounds.min) return false
  return true
}

/** ¿Está cerrado el mes? `closedMonths` viene como `yyyy-MM`. */
export function isClosedMonth(month: string, closedMonths?: readonly string[] | null): boolean {
  return Boolean(closedMonths?.includes(month.slice(0, 7)))
}

/**
 * Los ejercicios que ofrece la lista, del más nuevo al más viejo: el en curso y
 * los `count − 1` anteriores, sin los que quedan enteros afuera de `[min, max]`.
 */
export function fiscalYearChoices(
  opts: PeriodOptions & PeriodBounds & { today: string; count?: number },
): number[] {
  const current = fiscalYearOf(opts.today, opts)
  const count = Math.max(1, opts.count ?? 5)
  const years: number[] = []
  for (let year = current; years.length < count && year > current - 50; year--) {
    const { from, to } = fiscalYearRange(year, opts)
    if (opts.max && from > opts.max) continue
    if (opts.min && to < opts.min) break
    years.push(year)
  }
  return years
}

/**
 * El mes que conviene mostrar al abrir la grilla de un período: el de su
 * inicio (o el de hoy si no hay período).
 */
export function anchorMonthOf(p: Period | null, today: string, opts?: PeriodOptions): string {
  if (!p) return today.slice(0, 7)
  return periodRange(p, opts).from.slice(0, 7)
}

/** El año de la grilla de meses que sigue o precede a `month` (para los botones del año). */
export function shiftYearMonth(month: string, years: number): string {
  return addMonthsToYearMonth(month.slice(0, 7), years * 12)
}
