/**
 * Períodos de reportes y libros: día, mes, ejercicio y rango (kit §3.2
 * PeriodPicker; Sprint 1 E.1 `resolvePeriod` y F.15).
 *
 * Todo es civil y en strings: un período es un rango de días del calendario del
 * bar, inclusivo. Para filtrar `timestamptz` está `periodBoundsUtc`, que pasa
 * los bordes a instantes de Córdoba. Así todos los reportes comparten el mismo
 * período por URL (`?periodo=2026-09`, o `?mes=` / `?desde=&hasta=` de
 * Administración).
 *
 * El ejercicio se nombra por el año en que EMPIEZA (`ej-2026`). El mes de
 * inicio sale de los ajustes (`fiscalYearStartMonth`, 1–12, default enero); lo
 * contable guarda el mes de CIERRE (`acc_settings.fiscal_year_end_month`) y se
 * convierte con `fiscalYearStartMonthFromEndMonth`.
 */

import {
  addDays,
  addMonthsToYearMonth,
  daysBetween,
  daysInMonth,
  endOfMonth,
  endOfWeek,
  isRealIsoDay,
  isRealYearMonth,
  monthOf,
  startOfMonth,
  startOfWeek,
  toIsoDay,
} from './civil'
import { formatIsoDay, formatMonthLabel, formatRange } from './format'
import { cordobaDayStartUtc, todayInCordoba } from './zone'

// Los nombra la sección E.1 del Sprint 1 en este archivo: se reexportan para
// que `@/lib/dates/period` alcance sin saber en qué módulo viven.
export { addDays, daysBetween, endOfMonth, monthOf, startOfMonth } from './civil'
export { serviceDayInCordoba } from './zone'

export type Period =
  | { kind: 'day'; date: string }
  | { kind: 'month'; month: string }
  | { kind: 'fiscal-year'; year: number }
  | { kind: 'range'; from: string; to: string }

export type PeriodKind = Period['kind']

export const PERIOD_KINDS = [
  'day',
  'month',
  'fiscal-year',
  'range',
] as const satisfies readonly PeriodKind[]

/** Rango civil inclusivo, `yyyy-MM-dd`. */
export type DateRange = { from: string; to: string }

export type PeriodOptions = {
  /** Mes en que empieza el ejercicio, 1–12. Default 1 (año calendario). */
  fiscalYearStartMonth?: number
}

const MIN_YEAR = 1900
const MAX_YEAR = 2199

function startMonthOf(opts?: PeriodOptions): number {
  const month = opts?.fiscalYearStartMonth ?? 1
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`fiscalYearStartMonth inválido: ${month} (va de 1 a 12)`)
  }
  return month
}

// ─── Ejercicio ───────────────────────────────────────────────────────────────

/** Mes de cierre → mes de inicio: diciembre (12) → enero (1); junio (6) → julio (7). */
export function fiscalYearStartMonthFromEndMonth(endMonth: number): number {
  if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) {
    throw new RangeError(`Mes de cierre inválido: ${endMonth} (va de 1 a 12)`)
  }
  return (endMonth % 12) + 1
}

/** El año en que empieza el ejercicio que contiene `iso`. */
export function fiscalYearOf(iso: string, opts?: PeriodOptions): number {
  const start = startMonthOf(opts)
  const year = Number(monthOf(iso).slice(0, 4))
  const month = Number(iso.slice(5, 7))
  return month >= start ? year : year - 1
}

/** Primer y último día del ejercicio que empieza en `year`. */
export function fiscalYearRange(year: number, opts?: PeriodOptions): DateRange {
  const start = startMonthOf(opts)
  const from = toIsoDay(year, start, 1)
  const lastMonth = start === 1 ? 12 : start - 1
  const lastYear = start === 1 ? year : year + 1
  return { from, to: toIsoDay(lastYear, lastMonth, daysInMonth(lastYear, lastMonth)) }
}

/** `'Ejercicio 2026'` (año calendario) o `'Ejercicio 2026/27'` (cruza de año). */
export function fiscalYearLabel(year: number, opts?: PeriodOptions): string {
  if (startMonthOf(opts) === 1) return `Ejercicio ${year}`
  return `Ejercicio ${year}/${String((year + 1) % 100).padStart(2, '0')}`
}

/**
 * Cierre del PRIMER ejercicio de los libros: el último día del mes de cierre
 * igual o siguiente al de `iso` (el `books_start_date`), como
 * `acc_ensure_fiscal_year`. Libros desde el 01/10/2026 y cierre en diciembre →
 * `'2026-12-31'`; desde el 10/01/2027 → `'2027-12-31'`.
 */
export function fiscalYearEndOnOrAfter(iso: string, endMonth: number): string {
  fiscalYearStartMonthFromEndMonth(endMonth)
  const year = Number(iso.slice(0, 4))
  const month = Number(monthOf(iso).slice(5, 7))
  const endYear = month <= endMonth ? year : year + 1
  return toIsoDay(endYear, endMonth, daysInMonth(endYear, endMonth))
}

// ─── Serializar y leer ───────────────────────────────────────────────────────

/** `'2026-09-15'` · `'2026-09'` · `'ej-2026'` · `'2026-09-01..2026-09-30'`. */
export function serializePeriod(p: Period): string {
  switch (p.kind) {
    case 'day':
      return p.date
    case 'month':
      return p.month
    case 'fiscal-year':
      return `ej-${p.year}`
    case 'range':
      return `${p.from}..${p.to}`
  }
}

/**
 * Lee un período serializado (o la clave de un atajo, como `este-mes`). `null`
 * si no es válido: fecha que no existe, rango al revés, año fuera de 1900–2199.
 */
export function parsePeriod(
  value: string | null | undefined,
  opts: PeriodOptions & { today?: string } = {},
): Period | null {
  const s = (value ?? '').trim()
  if (s === '') return null
  if (isPeriodPresetKey(s)) {
    return presetPeriod(s, { ...opts, today: opts.today ?? todayInCordoba() })
  }
  if (isRealIsoDay(s)) return { kind: 'day', date: s }
  if (isRealYearMonth(s)) return { kind: 'month', month: s }
  const fy = /^ej-(\d{4})$/.exec(s)
  if (fy) {
    const year = Number(fy[1])
    return year >= MIN_YEAR && year <= MAX_YEAR ? { kind: 'fiscal-year', year } : null
  }
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(s)
  if (range) {
    const from = range[1] ?? ''
    const to = range[2] ?? ''
    if (!isRealIsoDay(from) || !isRealIsoDay(to) || from > to) return null
    return { kind: 'range', from, to }
  }
  return null
}

// ─── Rango, bordes, etiqueta y desplazamiento ────────────────────────────────

/** El rango civil inclusivo de un período. */
export function periodRange(p: Period, opts?: PeriodOptions): DateRange {
  switch (p.kind) {
    case 'day':
      return { from: p.date, to: p.date }
    case 'month':
      return { from: startOfMonth(p.month), to: endOfMonth(p.month) }
    case 'fiscal-year':
      return fiscalYearRange(p.year, opts)
    case 'range':
      return { from: p.from, to: p.to }
  }
}

/**
 * `[inicio, fin + 1)` como instantes UTC de Córdoba, para filtrar `timestamptz`:
 * `.gte(col, gte).lt(col, lt)`.
 */
export function periodBoundsUtc(p: Period, opts?: PeriodOptions): { gte: string; lt: string } {
  const { from, to } = periodRange(p, opts)
  return { gte: cordobaDayStartUtc(from), lt: cordobaDayStartUtc(addDays(to, 1)) }
}

/** `'15/09/2026'` · `'Septiembre 2026'` · `'Ejercicio 2026/27'` · `'01/09 – 30/09/2026'`. */
export function periodLabel(p: Period, opts?: PeriodOptions): string {
  switch (p.kind) {
    case 'day':
      return formatIsoDay(p.date)
    case 'month':
      return formatMonthLabel(p.month)
    case 'fiscal-year':
      return fiscalYearLabel(p.year, opts)
    case 'range':
      return formatRange(p.from, p.to)
  }
}

/** ¿Es un rango de meses enteros (del 1 al último día)? */
function wholeMonths(from: string, to: string): number | null {
  if (from !== startOfMonth(from) || to !== endOfMonth(to)) return null
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
    1
  return months
}

/**
 * El período anterior (`-1`) o siguiente (`+1`). Un rango se corre su propio
 * largo; si son meses enteros, se corre de a meses (septiembre–octubre → julio–
 * agosto, no 61 días antes). `_opts` queda por simetría con el resto de la API
 * (kit: `shiftPeriod(p, ±1, opts)`): correr un ejercicio no depende de su mes.
 */
export function shiftPeriod(p: Period, delta: number, _opts?: PeriodOptions): Period {
  switch (p.kind) {
    case 'day':
      return { kind: 'day', date: addDays(p.date, delta) }
    case 'month':
      return { kind: 'month', month: addMonthsToYearMonth(p.month, delta) }
    case 'fiscal-year':
      return { kind: 'fiscal-year', year: p.year + delta }
    case 'range': {
      const months = wholeMonths(p.from, p.to)
      if (months !== null) {
        const fromMonth = addMonthsToYearMonth(monthOf(p.from), delta * months)
        const toMonth = addMonthsToYearMonth(monthOf(p.to), delta * months)
        return { kind: 'range', from: startOfMonth(fromMonth), to: endOfMonth(toMonth) }
      }
      const length = daysBetween(p.from, p.to) + 1
      return {
        kind: 'range',
        from: addDays(p.from, delta * length),
        to: addDays(p.to, delta * length),
      }
    }
  }
}

/** ¿El día `iso` cae dentro del período? */
export function periodContains(p: Period, iso: string, opts?: PeriodOptions): boolean {
  const { from, to } = periodRange(p, opts)
  return from <= iso && iso <= to
}

/** Días del período, inclusive. */
export function periodDays(p: Period, opts?: PeriodOptions): number {
  const { from, to } = periodRange(p, opts)
  return daysBetween(from, to) + 1
}

/** Mismo período (misma clase y mismos valores). */
export function isSamePeriod(a: Period, b: Period): boolean {
  return serializePeriod(a) === serializePeriod(b)
}

/**
 * Recorta un rango a `[min, max]` (p. ej. al inicio de los libros o a hoy).
 * `null` si no queda nada adentro.
 */
export function clampRange(
  range: DateRange,
  bounds: { min?: string; max?: string },
): DateRange | null {
  const from = bounds.min && bounds.min > range.from ? bounds.min : range.from
  const to = bounds.max && bounds.max < range.to ? bounds.max : range.to
  return from <= to ? { from, to } : null
}

// ─── Atajos ──────────────────────────────────────────────────────────────────

export const PERIOD_PRESET_KEYS = [
  'hoy',
  'ayer',
  'esta-semana',
  'semana-pasada',
  'este-mes',
  'mes-pasado',
  'ultimos-30-dias',
  'este-ejercicio',
  'ejercicio-a-la-fecha',
  'ejercicio-anterior',
] as const

export type PeriodPresetKey = (typeof PERIOD_PRESET_KEYS)[number]

export type PeriodPreset = { key: PeriodPresetKey; label: string; period: Period }

export const PERIOD_PRESET_LABELS: Readonly<Record<PeriodPresetKey, string>> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  'esta-semana': 'Esta semana',
  'semana-pasada': 'Semana pasada',
  'este-mes': 'Este mes',
  'mes-pasado': 'Mes pasado',
  'ultimos-30-dias': 'Últimos 30 días',
  'este-ejercicio': 'Este ejercicio',
  'ejercicio-a-la-fecha': 'Ejercicio a la fecha',
  'ejercicio-anterior': 'Ejercicio anterior',
}

/** Los atajos del PeriodPicker (kit §3.2), en su orden. «Ejercicio a la fecha» es de Sumas y saldos. */
export const DEFAULT_PERIOD_PRESET_KEYS: readonly PeriodPresetKey[] = [
  'hoy',
  'ayer',
  'esta-semana',
  'semana-pasada',
  'este-mes',
  'mes-pasado',
  'ultimos-30-dias',
  'este-ejercicio',
  'ejercicio-anterior',
]

export function isPeriodPresetKey(value: string): value is PeriodPresetKey {
  return (PERIOD_PRESET_KEYS as readonly string[]).includes(value)
}

/**
 * El período de un atajo, relativo a `today` (que tiene que venir de
 * `todayInCordoba()`, nunca del reloj UTC del server). La semana va de lunes a
 * domingo y el mes entero: son períodos de calendario, no "hasta hoy".
 */
export function presetPeriod(
  key: PeriodPresetKey,
  opts: PeriodOptions & { today: string },
): Period {
  const { today } = opts
  switch (key) {
    case 'hoy':
      return { kind: 'day', date: today }
    case 'ayer':
      return { kind: 'day', date: addDays(today, -1) }
    case 'esta-semana':
      return { kind: 'range', from: startOfWeek(today), to: endOfWeek(today) }
    case 'semana-pasada': {
      const lastWeek = addDays(today, -7)
      return { kind: 'range', from: startOfWeek(lastWeek), to: endOfWeek(lastWeek) }
    }
    case 'este-mes':
      return { kind: 'month', month: monthOf(today) }
    case 'mes-pasado':
      return { kind: 'month', month: addMonthsToYearMonth(monthOf(today), -1) }
    case 'ultimos-30-dias':
      return { kind: 'range', from: addDays(today, -29), to: today }
    case 'este-ejercicio':
      return { kind: 'fiscal-year', year: fiscalYearOf(today, opts) }
    case 'ejercicio-a-la-fecha':
      return {
        kind: 'range',
        from: fiscalYearRange(fiscalYearOf(today, opts), opts).from,
        to: today,
      }
    case 'ejercicio-anterior':
      return { kind: 'fiscal-year', year: fiscalYearOf(today, opts) - 1 }
  }
}

const PRESET_KIND: Readonly<Record<PeriodPresetKey, PeriodKind>> = {
  hoy: 'day',
  ayer: 'day',
  'esta-semana': 'range',
  'semana-pasada': 'range',
  'este-mes': 'month',
  'mes-pasado': 'month',
  'ultimos-30-dias': 'range',
  'este-ejercicio': 'fiscal-year',
  'ejercicio-a-la-fecha': 'range',
  'ejercicio-anterior': 'fiscal-year',
}

/**
 * Los atajos con su etiqueta y su período. `kinds` deja solo los de esas
 * clases (un selector de meses no ofrece «Ayer»).
 */
export function periodPresets(
  opts: PeriodOptions & {
    today: string
    keys?: readonly PeriodPresetKey[]
    kinds?: readonly PeriodKind[]
  },
): PeriodPreset[] {
  const keys = opts.keys ?? DEFAULT_PERIOD_PRESET_KEYS
  return keys
    .filter((key) => !opts.kinds || opts.kinds.includes(PRESET_KIND[key]))
    .map((key) => ({ key, label: PERIOD_PRESET_LABELS[key], period: presetPeriod(key, opts) }))
}

/** Qué atajo coincide con `p` (para pintar el chip activo), o `null`. */
export function matchPeriodPreset(
  p: Period,
  opts: PeriodOptions & { today: string; keys?: readonly PeriodPresetKey[] },
): PeriodPresetKey | null {
  const keys = opts.keys ?? DEFAULT_PERIOD_PRESET_KEYS
  return keys.find((key) => isSamePeriod(presetPeriod(key, opts), p)) ?? null
}

// ─── Período desde la URL ────────────────────────────────────────────────────

type ParamValue = string | readonly string[] | null | undefined

export type PeriodSearchParams = {
  periodo?: ParamValue
  mes?: ParamValue
  desde?: ParamValue
  hasta?: ParamValue
}

export type PeriodError =
  | 'periodo-invalido'
  | 'mes-invalido'
  | 'fecha-invalida'
  | 'rango-incompleto'
  | 'rango-invertido'
  | 'rango-muy-largo'

export type ResolvedPeriod =
  | { ok: true; period: Period; from: string; to: string }
  | { ok: false; error: PeriodError }

/** `searchParams` de Next puede traer un string o una lista: vale el primero. */
function firstParam(value: ParamValue): string {
  const v = typeof value === 'string' ? value : value?.[0]
  return (v ?? '').trim()
}

/**
 * El período que pide la URL, validado (Sprint 1 F.15: fechas reales,
 * desde ≤ hasta, tope de días, `mes` `yyyy-MM`). Gana el primero que venga:
 * `periodo` (el del PeriodPicker), `mes`, `desde`+`hasta`. Sin nada, `fallback`
 * o el mes de `today`. Un parámetro roto da error en vez de caer en silencio a
 * otro período: un reporte con el período equivocado se lee como verdadero.
 */
export function resolvePeriod(
  params: PeriodSearchParams,
  opts: PeriodOptions & { today: string; maxDays?: number; fallback?: Period },
): ResolvedPeriod {
  const periodo = firstParam(params.periodo)
  const mes = firstParam(params.mes)
  const desde = firstParam(params.desde)
  const hasta = firstParam(params.hasta)

  let period: Period
  if (periodo) {
    const parsed = parsePeriod(periodo, opts)
    if (!parsed) return { ok: false, error: 'periodo-invalido' }
    period = parsed
  } else if (mes) {
    if (!isRealYearMonth(mes)) return { ok: false, error: 'mes-invalido' }
    period = { kind: 'month', month: mes }
  } else if (desde || hasta) {
    if (!desde || !hasta) return { ok: false, error: 'rango-incompleto' }
    if (!isRealIsoDay(desde) || !isRealIsoDay(hasta)) return { ok: false, error: 'fecha-invalida' }
    if (desde > hasta) return { ok: false, error: 'rango-invertido' }
    period = { kind: 'range', from: desde, to: hasta }
  } else {
    period = opts.fallback ?? { kind: 'month', month: monthOf(opts.today) }
  }

  const { from, to } = periodRange(period, opts)
  if (opts.maxDays !== undefined && daysBetween(from, to) + 1 > opts.maxDays) {
    return { ok: false, error: 'rango-muy-largo' }
  }
  return { ok: true, period, from, to }
}

/** El mensaje de un error de período, para la pantalla o un 400. */
export function periodErrorMessage(error: PeriodError, opts: { maxDays?: number } = {}): string {
  switch (error) {
    case 'periodo-invalido':
      return 'No entendemos ese período. Elegilo de nuevo.'
    case 'mes-invalido':
      return 'Ese mes no existe. Elegilo de nuevo.'
    case 'fecha-invalida':
      return 'Esa fecha no existe.'
    case 'rango-incompleto':
      return 'Elegí las dos fechas: desde y hasta.'
    case 'rango-invertido':
      return 'El «hasta» no puede ser anterior al «desde».'
    case 'rango-muy-largo':
      return opts.maxDays
        ? `El período puede tener hasta ${opts.maxDays} días. Elegí uno más corto.`
        : 'El período es demasiado largo. Elegí uno más corto.'
  }
}
