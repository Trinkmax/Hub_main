/**
 * Fechas civiles como strings (`'yyyy-MM-dd'`, `'yyyy-MM'`) y horas del día
 * (`'HH:mm'`), con aritmética entera pura.
 *
 * Por qué strings y no `Date`: un `date` de Postgres es un día del calendario,
 * sin hora ni zona. `new Date('2026-09-15')` lo convierte en la medianoche UTC,
 * que en Córdoba (GMT−3) es el 14 a las 21:00: cualquier getter local corre el
 * día. Acá no se construye ningún `Date` para calcular: los días se cuentan con
 * el algoritmo de días civiles de Howard Hinnant (proléptico gregoriano), igual
 * en el server, en el navegador y en cualquier zona horaria.
 *
 * La única puerta hacia `Date` es `isoDayToLocalNoon` (mediodía LOCAL, para
 * los calendarios de date-fns, que trabajan con campos locales): al mediodía
 * ningún corrimiento de zona cambia el día.
 */

export type CivilDate = { year: number; month: number; day: number }

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/
// `HH:mm`, o `HH:mm:ss` como devuelve Postgres una columna `time`.
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

// Postgres no tiene año 0 y el resto de la app valida 1900–2199 (la misma cota
// que `isRealIsoDay` de `lib/salon/date-presets.ts`): lo que viene de la gente o
// de la URL se acota a ese rango.
const MIN_YEAR = 1900
const MAX_YEAR = 2199

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Días del mes (`month` 1–12). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

/** `{ 2026, 9, 5 }` → `'2026-09-05'`. Solo formatea: no normaliza desbordes. */
export function toIsoDay(year: number, month: number, day: number): string {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`
}

/** `{ 2026, 9 }` → `'2026-09'`. */
export function toYearMonth(year: number, month: number): string {
  return `${pad4(year)}-${pad2(month)}`
}

/** Lee `'yyyy-MM-dd'` si el día existe (cualquier año de 4 cifras), o `null`. */
function readCivil(iso: string): CivilDate | null {
  const m = ISO_DAY_RE.exec(iso)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

/** Lee `'yyyy-MM'` o el mes de un `'yyyy-MM-dd'`, o `null`. */
function readYearMonth(value: string): { year: number; month: number } | null {
  const ym = YEAR_MONTH_RE.exec(value)
  if (ym) {
    const year = Number(ym[1])
    const month = Number(ym[2])
    return month >= 1 && month <= 12 ? { year, month } : null
  }
  const civil = readCivil(value)
  return civil ? { year: civil.year, month: civil.month } : null
}

function requireCivil(iso: string): CivilDate {
  const civil = readCivil(iso)
  if (!civil) throw new RangeError(`Fecha inválida: «${iso}» (se espera yyyy-MM-dd)`)
  return civil
}

function requireYearMonth(value: string): { year: number; month: number } {
  const ym = readYearMonth(value)
  if (!ym) throw new RangeError(`Mes inválido: «${value}» (se espera yyyy-MM)`)
  return ym
}

/**
 * `2026-02-31` y `2026-13-01` tienen forma de fecha pero no existen (Postgres
 * los rechaza con 22008). Además el año va acotado a 1900–2199. Misma regla que
 * `isRealIsoDay` de `lib/salon/date-presets.ts`, sin pasar por `Date`.
 */
export function isRealIsoDay(iso: unknown): iso is string {
  if (typeof iso !== 'string') return false
  const civil = readCivil(iso)
  return civil !== null && civil.year >= MIN_YEAR && civil.year <= MAX_YEAR
}

/** `'2026-09'` real (mes 1–12, año 1900–2199). */
export function isRealYearMonth(ym: unknown): ym is string {
  if (typeof ym !== 'string' || !YEAR_MONTH_RE.test(ym)) return false
  const parsed = readYearMonth(ym)
  return parsed !== null && parsed.year >= MIN_YEAR && parsed.year <= MAX_YEAR
}

/** `'2026-09-15'` → `{ year: 2026, month: 9, day: 15 }`, o `null` si no es un día real. */
export function parseIsoDay(iso: string): CivilDate | null {
  return isRealIsoDay(iso) ? readCivil(iso) : null
}

// ─── Días civiles (Hinnant) ──────────────────────────────────────────────────

/** Días desde el 01/01/1970 (puede ser negativo). Proléptico gregoriano. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** Inversa de `daysFromCivil`. */
export function civilFromDays(days: number): CivilDate {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return { year, month, day }
}

/** `'1970-01-02'` → `1`. */
export function isoDayToEpochDays(iso: string): number {
  const { year, month, day } = requireCivil(iso)
  return daysFromCivil(year, month, day)
}

/** `1` → `'1970-01-02'`. */
export function epochDaysToIsoDay(days: number): string {
  const { year, month, day } = civilFromDays(days)
  return toIsoDay(year, month, day)
}

// ─── Aritmética de días ──────────────────────────────────────────────────────

/** `addDays('2026-02-28', 1)` → `'2026-03-01'`. */
export function addDays(iso: string, days: number): string {
  return epochDaysToIsoDay(isoDayToEpochDays(iso) + days)
}

/**
 * Suma meses conservando el día, recortado al último del mes de llegada:
 * `addMonths('2026-01-31', 1)` → `'2026-02-28'`.
 */
export function addMonths(iso: string, months: number): string {
  const { year, month, day } = requireCivil(iso)
  const target = addMonthsToYearMonth(toYearMonth(year, month), months)
  const { year: ty, month: tm } = requireYearMonth(target)
  return toIsoDay(ty, tm, Math.min(day, daysInMonth(ty, tm)))
}

/** Días de `from` a `to` (`to − from`): `daysBetween('2026-10-01', '2026-10-06')` → `5`. */
export function daysBetween(from: string, to: string): number {
  return isoDayToEpochDays(to) - isoDayToEpochDays(from)
}

/** Orden de dos fechas ISO: −1, 0 o 1. Sirve de comparador para `sort`. */
export function compareIsoDays(a: string, b: string): -1 | 0 | 1 {
  requireCivil(a)
  requireCivil(b)
  // Con la misma forma `yyyy-MM-dd`, el orden de los strings es el del calendario.
  return a < b ? -1 : a > b ? 1 : 0
}

export function minIsoDay(a: string, b: string): string {
  return compareIsoDays(a, b) <= 0 ? a : b
}

export function maxIsoDay(a: string, b: string): string {
  return compareIsoDays(a, b) >= 0 ? a : b
}

/** Día de la semana: 0 = domingo … 6 = sábado (como `Date#getDay`). */
export function weekdayOf(iso: string): number {
  // El 01/01/1970 fue jueves (4).
  return (((isoDayToEpochDays(iso) + 4) % 7) + 7) % 7
}

/** Lunes de la semana de `iso`: el bar piensa la semana de lunes a domingo. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7))
}

/** Domingo de la semana de `iso`. */
export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6)
}

/**
 * Todos los días de `from` a `to`, inclusive. El tope es una red para que un
 * rango absurdo no cuelgue un render (como `MAX_DENSE_DAYS` de date-presets).
 */
export function eachIsoDay(from: string, to: string, max = 800): string[] {
  const start = isoDayToEpochDays(from)
  const end = isoDayToEpochDays(to)
  const days: string[] = []
  for (let d = start; d <= end && days.length < max; d++) days.push(epochDaysToIsoDay(d))
  return days
}

// ─── Meses ───────────────────────────────────────────────────────────────────

/** `'2026-09-15'` → `'2026-09'`. */
export function monthOf(iso: string): string {
  const { year, month } = requireCivil(iso)
  return toYearMonth(year, month)
}

/** `'2026-09'` → `'2026-11'` con `+2`; cruza años para los dos lados. */
export function addMonthsToYearMonth(ym: string, months: number): string {
  const { year, month } = requireYearMonth(ym)
  const index = year * 12 + (month - 1) + months
  return toYearMonth(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1)
}

/** Primer día del mes de `'2026-09'` o de `'2026-09-15'` → `'2026-09-01'`. */
export function startOfMonth(value: string): string {
  const { year, month } = requireYearMonth(value)
  return toIsoDay(year, month, 1)
}

/** Último día del mes de `'2026-02'` o de `'2026-02-10'` → `'2026-02-28'` (bisiestos incluidos). */
export function endOfMonth(value: string): string {
  const { year, month } = requireYearMonth(value)
  return toIsoDay(year, month, daysInMonth(year, month))
}

/** `{ from: '2026-09-01', to: '2026-09-30' }` para `'2026-09'` (o un día de ese mes). */
export function monthRange(value: string): { from: string; to: string } {
  return { from: startOfMonth(value), to: endOfMonth(value) }
}

// ─── Puente con date-fns ─────────────────────────────────────────────────────

/**
 * `new Date(y, m − 1, d, 12)`: el mediodía LOCAL de ese día, para los
 * calendarios de date-fns (que leen campos locales). Al mediodía ningún
 * corrimiento de zona cambia el día. Nunca `new Date('yyyy-MM-dd')`.
 */
export function isoDayToLocalNoon(iso: string): Date {
  const { year, month, day } = requireCivil(iso)
  const date = new Date(2000, 0, 1, 12)
  // `setFullYear` y no el constructor: `new Date(26, …)` sería 1926.
  date.setFullYear(year, month - 1, day)
  return date
}

/** El día civil de un `Date` armado con campos locales (lo que devuelve date-fns). */
export function localDateToIsoDay(date: Date): string {
  return toIsoDay(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

// ─── Hora del día ────────────────────────────────────────────────────────────

/** `'21:30'` (o `'21:30:00'` de Postgres) → `1290`, o `null` si no es una hora válida. */
export function timeToMinutes(time: string): number | null {
  const m = TIME_RE.exec(time)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** `1290` → `'21:30'`. Da la vuelta al reloj: `1500` → `'01:00'`, `-30` → `'23:30'`. */
export function minutesToTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/** `shiftTime('23:45', 30)` → `'00:15'`. `null` si la hora no es válida. */
export function shiftTime(time: string, minutes: number): string | null {
  const base = timeToMinutes(time)
  return base === null ? null : minutesToTime(base + minutes)
}
