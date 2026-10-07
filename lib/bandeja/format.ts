import {
  capitalizeFirst,
  daysBetween,
  formatIsoDay,
  formatTime,
  isoDayInCordoba,
  isRealIsoDay,
  monthName,
  readDateValue,
  todayInCordoba,
  weekdayName,
} from '@/lib/dates'

/**
 * Fechas de la bandeja (lista de chats, hilo y ficha del contacto) en el
 * calendario y la hora del bar (America/Argentina/Cordoba), armadas a mano con
 * `lib/dates`.
 *
 * Antes salían de date-fns sobre `new Date(iso)`, que lee los campos en la zona
 * del runtime: el server (Vercel, en UTC) pintaba la hora tres horas corrida
 * («01:15» en vez de «22:15»), cortaba los días a las 21:00 de Córdoba, y al
 * hidratar en el navegador el texto cambiaba (hydration mismatch). Ahora el
 * server y el navegador dan el mismo string en cualquier zona; para alguien en
 * Córdoba la salida es la de siempre.
 *
 * "Hoy"/"ayer" se calculan contra `now` (no contra el reloj del sistema) para
 * que las funciones sean puras y testeables.
 */

/** El "ahora" contra el que se cuentan los días: un `Date` o epoch ms. */
type Now = Date | number

/**
 * El día de Córdoba de un valor: un `timestamptz` cae en el día del bar en que
 * pasó (las 23:30 siguen siendo "hoy" aunque en UTC ya sea mañana); un `date`
 * civil o una hora sin zona ya son de Córdoba. `null` si no se lee.
 */
function cordobaDay(value: string | null | undefined): string | null {
  const read = readDateValue(value)
  if (!read) return null
  const day = read.kind === 'instant' ? isoDayInCordoba(read.ms) : read.date
  return day !== null && isRealIsoDay(day) ? day : null
}

/** Días calendario de Córdoba entre `day` y hoy (0 = hoy, 1 = ayer, negativo = futuro). */
function daysAgo(day: string, now: Now): number {
  return daysBetween(day, todayInCordoba(now))
}

/**
 * Timestamp de la lista de chats, calcado de WhatsApp:
 * hoy → "22:15" · ayer → "ayer" · esta semana → "lunes" · antes → "18/07/2026".
 */
export function formatListTimestamp(iso: string | null, now: Now = new Date()): string {
  const day = cordobaDay(iso)
  if (!day) return ''
  const days = daysAgo(day, now)
  if (days <= 0) return formatTime(iso)
  if (days === 1) return 'ayer'
  if (days < 7) return weekdayName(day)
  return formatIsoDay(day)
}

/**
 * Pastilla separadora de días del hilo, como WhatsApp:
 * "Hoy" · "Ayer" · "Lunes" (esta semana) · "18 de julio de 2026".
 */
export function formatDaySeparator(iso: string, now: Now = new Date()): string {
  const day = cordobaDay(iso)
  if (!day) return ''
  const days = daysAgo(day, now)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) return capitalizeFirst(weekdayName(day))
  return `${Number(day.slice(8, 10))} de ${monthName(Number(day.slice(5, 7)))} de ${day.slice(0, 4)}`
}

/** Clave de agrupación por día calendario de Córdoba ("2026-07-18"). Vacía si no se lee. */
export function dayKey(iso: string): string {
  return cordobaDay(iso) ?? ''
}

/** "hace 12 días" / "hoy" / "ayer" para última visita en el panel del cliente. */
export function formatRelativeDays(iso: string | null, now: Now = new Date()): string | null {
  const day = cordobaDay(iso)
  if (!day) return null
  const days = daysAgo(day, now)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? 'hace 1 mes' : `hace ${months} meses`
  const years = Math.floor(days / 365)
  return years === 1 ? 'hace 1 año' : `hace ${years} años`
}
