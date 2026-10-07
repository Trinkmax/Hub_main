import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Presets de fecha para el listado de reservas ("Hoy", "Esta semana",
 * "Este mes").
 *
 * OJO — no reusar `lib/staff-performance/date-range.ts`: esos presets miran
 * HACIA ATRÁS y cortan en hoy (sirven para medir lo que ya pasó). Las reservas
 * se planifican HACIA ADELANTE: "esta semana" tiene que llegar hasta el domingo
 * aunque hoy sea martes, y "este mes" hasta el último día del mes.
 *
 * Todo se resuelve en el calendario del bar (America/Argentina/Cordoba) y se
 * devuelve como `yyyy-MM-dd`, que es el tipo real de `salon_reservations.
 * reservation_date` (date, sin hora) y lo que viaja en ?from/?to.
 *
 * La aritmética se hace sobre `Date.UTC` a propósito: las funciones de date-fns
 * operan sobre los campos LOCALES del runtime, así que un rango calculado en un
 * server con otro TZ podía correrse un día en los bordes (justo lo que rompe un
 * "esta semana"). Acá date-fns-tz resuelve "qué día es hoy en Córdoba" y el
 * resto es aritmética de calendario pura, idéntica en cualquier runtime.
 */

export const SALON_TZ = 'America/Argentina/Cordoba'

export type DatePresetRange = { from: string; to: string }

export const RESERVATION_DATE_PRESETS = ['today', 'week', 'month', 'range'] as const
export type ReservationDatePreset = (typeof RESERVATION_DATE_PRESETS)[number]

/** Día calendario en curso en Córdoba, como `yyyy-MM-dd`. */
export function todayInCordoba(now: Date = new Date()): string {
  return formatInTimeZone(now, SALON_TZ, 'yyyy-MM-dd')
}

function parseIsoDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function shiftDays(d: Date, delta: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta))
}

/**
 * Semana en curso: lunes → domingo (el bar piensa en fines de semana, así que
 * arrancar el domingo partiría el finde en dos).
 */
export function thisWeek(now: Date = new Date()): DatePresetRange {
  const today = parseIsoDay(todayInCordoba(now))
  // getUTCDay(): 0=domingo … 6=sábado. Queremos lunes como día 0 de la semana.
  const offsetFromMonday = (today.getUTCDay() + 6) % 7
  const monday = shiftDays(today, -offsetFromMonday)
  return { from: toIsoDay(monday), to: toIsoDay(shiftDays(monday, 6)) }
}

/** Mes en curso: día 1 → último día (28/29/30/31 según corresponda). */
export function thisMonth(now: Date = new Date()): DatePresetRange {
  const today = parseIsoDay(todayInCordoba(now))
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  // Día 0 del mes siguiente = último día de este mes (cubre bisiestos solo).
  const last = new Date(Date.UTC(y, m + 1, 0))
  return { from: toIsoDay(new Date(Date.UTC(y, m, 1))), to: toIsoDay(last) }
}

/**
 * Qué chip hay que pintar como activo dado el ?from/?to de la URL. Devuelve
 * 'range' cuando hay fechas pero no coinciden con ningún preset, y 'today'
 * cuando no hay rango (la lista arranca en modo día).
 */
export function detectPreset(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): ReservationDatePreset {
  if (!from && !to) return 'today'
  const week = thisWeek(now)
  if (from === week.from && to === week.to) return 'week'
  const month = thisMonth(now)
  if (from === month.from && to === month.to) return 'month'
  return 'range'
}

/**
 * Instante UTC (ISO) de las 00:00 de `iso` en el calendario del bar.
 *
 * Hace falta para filtrar columnas `timestamptz` (p. ej. `created_at`): el
 * Postgres del proyecto corre en UTC, así que una reserva cargada a las 21:30
 * de Córdoba ya figura al día siguiente si se compara contra un `yyyy-MM-dd`
 * pelado. Con este borde el filtro habla del día del bar, no del día del server.
 */
export function cordobaDayStartUtc(iso: string): string {
  return fromZonedTime(`${iso}T00:00:00`, SALON_TZ).toISOString()
}

/** Día siguiente a `iso`, como `yyyy-MM-dd`. */
export function nextIsoDay(iso: string): string {
  return toIsoDay(shiftDays(parseIsoDay(iso), 1))
}

/** A qué día del calendario del bar pertenece un `timestamptz`. */
export function isoDayInCordoba(timestamp: string): string {
  return formatInTimeZone(new Date(timestamp), SALON_TZ, 'yyyy-MM-dd')
}

/**
 * `2026-02-31` y `2026-13-01` matchean cualquier regex de forma `yyyy-MM-dd`
 * pero no existen: Postgres los rechaza con un 22008 y `fromZonedTime` devuelve
 * un `Invalid Date`. El round-trip por `Date` los caza (el 31 de febrero rola
 * al 2 de marzo y deja de coincidir consigo mismo).
 */
export function isRealIsoDay(iso: string): boolean {
  // El año va acotado además del round-trip: `0000-01-01` vuelve idéntico de un
  // `Date` pero Postgres no tiene año 0 y lo rechaza igual que a un 32 de marzo.
  if (!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/**
 * Todos los días del rango, inclusive y en orden.
 *
 * El tope es una red para que un `from`/`to` absurdo no cuelgue un render, no
 * un filtro de datos: quien agregue sobre esta lista tiene que tolerar que un
 * rango más largo se quede sin relleno de ceros (ver `aggregateDepositsByDay`,
 * que crea el bucket que falte en vez de perder la fila). 800 ≈ dos años y
 * pico, que cubre el histórico completo de un bar sin llegar a ser una lista
 * que valga la pena dibujar día por día.
 */
export const MAX_DENSE_DAYS = 800

export function eachIsoDayInclusive(from: string, to: string): string[] {
  const days: string[] = []
  const end = parseIsoDay(to).getTime()
  let cursor = parseIsoDay(from)
  while (cursor.getTime() <= end && days.length < MAX_DENSE_DAYS) {
    days.push(toIsoDay(cursor))
    cursor = shiftDays(cursor, 1)
  }
  return days
}

/** `2026-07-31` → `Vie 31/07` (para subheaders y barras de rango). */
export function formatDayLabel(iso: string): string {
  const d = parseIsoDay(iso)
  const weekday = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })
    .format(d)
    .replace('.', '')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}/${month}`
}
