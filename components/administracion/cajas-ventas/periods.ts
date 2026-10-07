/**
 * El período de las pantallas de Ventas y Cajas, leído de la URL igual que
 * en Libros: `?mes=yyyy-MM` o `?desde=&hasta=` (fechas reales, desde ≤ hasta,
 * hasta 400 días: lo mismo que acepta el exporte, F.15). Puro: lo usan las
 * páginas (Server Components).
 *
 * Un parámetro roto no cae en silencio a otro período (una lista con el
 * período equivocado se lee como verdadera): la página muestra el error y el
 * selector para elegir de nuevo.
 */

import {
  formatMonthLabel,
  formatRange,
  isRealYearMonth,
  maxIsoDay,
  monthOf,
  type Period,
  periodErrorMessage,
  resolvePeriod,
} from '@/lib/dates'

export type PageSearchParams = Record<string, string | string[] | undefined>

/** `searchParams` de Next puede traer una lista: vale el primero. */
export function firstParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value
  const trimmed = (v ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** Tope de un rango en pantalla: el mismo que el de los exportes. */
export const MAX_RANGE_DAYS = 400

export type RangeValue = {
  /** `month` si el período es un mes entero pedido como mes; si no, `range`. */
  kind: 'month' | 'range'
  /** `yyyy-MM` cuando `kind === 'month'`. */
  month: string | null
  from: string
  to: string
  /** «Octubre 2026» · «01/10 – 15/10/2026». */
  label: string
}

export type ResolvedRange = ({ ok: true } & RangeValue) | { ok: false; message: string }

/** `?mes=` o `?desde=&hasta=`; sin nada, `fallback` (o el mes en curso). */
export function resolveRange(
  sp: PageSearchParams,
  today: string,
  fallback?: Period,
): ResolvedRange {
  const resolved = resolvePeriod(
    { mes: firstParam(sp.mes), desde: firstParam(sp.desde), hasta: firstParam(sp.hasta) },
    { today, maxDays: MAX_RANGE_DAYS, fallback },
  )
  if (!resolved.ok) {
    return { ok: false, message: periodErrorMessage(resolved.error, { maxDays: MAX_RANGE_DAYS }) }
  }
  const { period, from, to } = resolved
  if (period.kind === 'month') {
    return { ok: true, kind: 'month', month: period.month, from, to, label: formatMonthLabel(from) }
  }
  return { ok: true, kind: 'range', month: null, from, to, label: formatRange(from, to) }
}

export type ResolvedMonth =
  | { ok: true; month: string; from: string; to: string; label: string }
  | { ok: false; message: string }

/** `?mes=yyyy-MM`; sin nada, el mes de `today`. */
export function resolveMonth(sp: PageSearchParams, today: string): ResolvedMonth {
  const raw = firstParam(sp.mes)
  if (raw !== null && !isRealYearMonth(raw)) {
    return { ok: false, message: periodErrorMessage('mes-invalido') }
  }
  const month = raw ?? monthOf(today)
  const resolved = resolvePeriod({ mes: month }, { today })
  if (!resolved.ok) return { ok: false, message: periodErrorMessage(resolved.error) }
  return { ok: true, month, from: resolved.from, to: resolved.to, label: formatMonthLabel(month) }
}

/**
 * Un link con sus parámetros: los `null`/vacíos no van.
 * `hrefWith('/hub/administracion/cajas', { tab: 'flujo', mes: '2026-10' })`.
 */
export function hrefWith(
  path: string,
  params: Readonly<Record<string, string | number | null | undefined>> = {},
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

/** Los parámetros del período para un link (`mes` o `desde`+`hasta`). */
export function periodParams(range: RangeValue): { mes?: string; desde?: string; hasta?: string } {
  if (range.kind === 'month' && range.month) return { mes: range.month }
  return { desde: range.from, hasta: range.to }
}

/**
 * El primer día que se puede cargar: el inicio de las cuentas o, si hay meses
 * cerrados, el primer día abierto (un cobro o un movimiento de caja no se
 * corren de mes: la fecha es la del hecho).
 */
export function firstLoadableDay(catalog: {
  booksStartDate: string
  firstOpenDate: string | null
}): string {
  return catalog.firstOpenDate
    ? maxIsoDay(catalog.booksStartDate, catalog.firstOpenDate)
    : catalog.booksStartDate
}
