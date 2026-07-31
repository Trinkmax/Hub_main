import { formatInTimeZone } from 'date-fns-tz'

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
