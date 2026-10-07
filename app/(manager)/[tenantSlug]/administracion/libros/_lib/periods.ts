import {
  formatIsoDay,
  formatMonthLabel,
  formatRange,
  isRealYearMonth,
  minIsoDay,
  monthOf,
  periodErrorMessage,
  resolvePeriod,
} from '@/lib/dates'

/**
 * El período de cada libro, leído de la URL (§F.15, H.12): `?mes=yyyy-MM` para
 * los mensuales (IVA, posición, paquete) y `?mes=` o `?desde=&hasta=` para los
 * de rango (diario, mayor, sumas y saldos, subdiarios, historia). Puro: lo
 * usan las páginas (Server Components) y los tests.
 *
 * Un parámetro roto no cae en silencio a otro período (un libro con el período
 * equivocado se lee como verdadero): la página muestra el error y el selector
 * para elegir de nuevo.
 */

export type BookSearchParams = Record<string, string | string[] | undefined>

/** `searchParams` de Next puede traer una lista: vale el primero. */
export function firstParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value
  const trimmed = (v ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** Tope de un rango en pantalla: el mismo que el de los exportes (F.15). */
export const BOOK_MAX_DAYS = 400

export type BookRange =
  | {
      ok: true
      /** `month` si el período es un mes entero pedido como mes; si no, `range`. */
      kind: 'month' | 'range'
      /** `yyyy-MM` cuando `kind === 'month'`. */
      month: string | null
      from: string
      to: string
      /** «Octubre 2026» · «01/10 – 15/10/2026». */
      label: string
    }
  | { ok: false; message: string }

/** Período de un libro de rango: `?mes=` o `?desde=&hasta=`; sin nada, el mes en curso. */
export function resolveBookRange(
  sp: BookSearchParams,
  today: string,
  opts: { maxDays?: number } = {},
): BookRange {
  const maxDays = opts.maxDays ?? BOOK_MAX_DAYS
  const resolved = resolvePeriod(
    {
      mes: firstParam(sp.mes),
      desde: firstParam(sp.desde),
      hasta: firstParam(sp.hasta),
    },
    { today, maxDays },
  )
  if (!resolved.ok) return { ok: false, message: periodErrorMessage(resolved.error, { maxDays }) }
  const { period, from, to } = resolved
  if (period.kind === 'month') {
    return { ok: true, kind: 'month', month: period.month, from, to, label: formatMonthLabel(from) }
  }
  return { ok: true, kind: 'range', month: null, from, to, label: formatRange(from, to) }
}

export type BookMonth =
  | { ok: true; month: string; from: string; to: string; label: string }
  | { ok: false; message: string }

/** Período de un libro mensual: `?mes=yyyy-MM`; sin nada, el mes en curso (o `fallback`). */
export function resolveBookMonth(
  sp: BookSearchParams,
  today: string,
  fallback?: string | null,
): BookMonth {
  const raw = firstParam(sp.mes)
  if (raw !== null && !isRealYearMonth(raw)) {
    return { ok: false, message: periodErrorMessage('mes-invalido') }
  }
  const month = raw ?? (fallback && isRealYearMonth(fallback) ? fallback : monthOf(today))
  const resolved = resolvePeriod({ mes: month }, { today })
  if (!resolved.ok) return { ok: false, message: periodErrorMessage(resolved.error) }
  return {
    ok: true,
    month,
    from: resolved.from,
    to: resolved.to,
    label: formatMonthLabel(month),
  }
}

/**
 * ¿El mes tiene libros? Antes del arranque de Administración no hay nada, y un
 * mes que todavía no empezó tampoco (se puede escribir a mano en la URL): en
 * esos casos la página lo dice en vez de pedirle a la base un mes que no
 * existe (la posición de IVA contestaría «Esa fecha no está dentro de un
 * ejercicio»).
 */
export function monthAvailability(
  month: string,
  today: string,
  booksStartDate: string | null | undefined,
): 'ok' | 'before-start' | 'future' {
  const ym = month.slice(0, 7)
  if (booksStartDate && ym < monthOf(booksStartDate)) return 'before-start'
  if (ym > monthOf(today)) return 'future'
  return 'ok'
}

/** «Octubre 2026 no tiene libros: Administración arranca el 01/10/2026.» y sus pares. */
export function monthAvailabilityMessage(
  availability: 'before-start' | 'future',
  month: string,
  booksStartDate: string | null | undefined,
): string {
  const label = formatMonthLabel(month)
  if (availability === 'future') return `${label} todavía no empezó.`
  return booksStartDate
    ? `${label} no tiene libros: Administración arranca el ${formatIsoDay(booksStartDate)}.`
    : `${label} no tiene libros.`
}

/** El ejercicio en curso hasta hoy («Ejercicio a la fecha»), si hay uno que contenga hoy. */
export function fiscalYearToDate(
  years: ReadonlyArray<{ startDate: string; endDate: string }>,
  today: string,
): { from: string; to: string } | null {
  const current = years.find((y) => y.startDate <= today && today <= y.endDate)
  if (!current) return null
  return { from: current.startDate, to: minIsoDay(current.endDate, today) }
}

/**
 * Un link de la sección con sus parámetros: los `null`/vacíos no van.
 * `bookHref('/hub/administracion/libros/mayor', { cuenta: id, mes: '2026-10' })`.
 */
export function bookHref(
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
export function periodParams(range: {
  kind: 'month' | 'range'
  month: string | null
  from: string
  to: string
}): { mes?: string; desde?: string; hasta?: string } {
  if (range.kind === 'month' && range.month) return { mes: range.month }
  return { desde: range.from, hasta: range.to }
}
