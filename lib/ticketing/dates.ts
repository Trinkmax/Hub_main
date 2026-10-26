import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Fechas de las funciones, en castellano rioplatense.
 *
 * Las fechas llegan como 'YYYY-MM-DD' (día calendario del bar, sin hora) y se
 * leen con Date.UTC + getters UTC: `new Date('2026-12-01')` es la medianoche
 * UTC, que en Córdoba todavía es el 30 de noviembre, y en Vercel (UTC) o en el
 * celular de alguien en otro huso el día se corría. Mismo criterio que
 * lib/salon/date-presets.ts.
 */

export const DEFAULT_TZ = 'America/Argentina/Cordoba'

const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const
const WEEKDAYS_LONG = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const
const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const
const MONTHS_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

function parts(date: string): { y: number; m: number; d: number; dow: number } {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return { y, m, d, dow }
}

/** «Mar» */
export function weekdayShort(date: string): string {
  return WEEKDAYS_SHORT[parts(date).dow] ?? ''
}

/** «martes» */
export function weekdayLong(date: string): string {
  return WEEKDAYS_LONG[parts(date).dow] ?? ''
}

/** «dic» */
export function monthShort(date: string): string {
  return MONTHS_SHORT[parts(date).m - 1] ?? ''
}

/** «diciembre» */
export function monthLong(date: string): string {
  return MONTHS_LONG[parts(date).m - 1] ?? ''
}

/** «01» */
export function dayNumber(date: string): string {
  return String(parts(date).d).padStart(2, '0')
}

/** «21:00» (la base devuelve «21:00:00»). */
export function formatTime(time: string): string {
  return time.slice(0, 5)
}

/** «Mar 01 dic» */
export function formatShortDate(date: string): string {
  return `${weekdayShort(date)} ${dayNumber(date)} ${monthShort(date)}`
}

/** «martes 1 de diciembre» */
export function formatLongDate(date: string): string {
  const { d } = parts(date)
  return `${weekdayLong(date)} ${d} de ${monthLong(date)}`
}

/** «01/12» */
export function formatDayMonth(date: string): string {
  const { d, m } = parts(date)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

/** «Diciembre 2026» */
export function monthTitle(date: string): string {
  const { y } = parts(date)
  const name = monthLong(date)
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
}

/** «YYYY-MM-DD» de hoy en el bar. */
export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd')
}

/** «YYYY-MM-DD HH:mm» de ahora en el bar (para comparar con fecha + hora). */
export function nowLocalIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd HH:mm')
}

/** «Hoy» / «Mañana» / null. */
export function relativeDay(date: string, today: string): string | null {
  if (date === today) return 'Hoy'
  const t = parts(today)
  const tomorrow = new Date(Date.UTC(t.y, t.m - 1, t.d + 1)).toISOString().slice(0, 10)
  return date === tomorrow ? 'Mañana' : null
}

/** Instante UTC del inicio de una función (para el calendario del celular). */
export function functionStartUtc(date: string, time: string, tz: string = DEFAULT_TZ): Date {
  return fromZonedTime(`${date}T${formatTime(time)}:00`, tz)
}

function icsStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/([,;])/g, '\\$1')
}

/**
 * Un evento .ics para «Agendar»: funciona igual en iPhone, Android y Google
 * Calendar sin pedir permisos. Duración por defecto: tres horas (película +
 * pasos).
 */
export function buildIcs(input: {
  uid: string
  title: string
  date: string
  time: string
  tz?: string
  durationMinutes?: number
  location?: string | null
  description?: string | null
  url?: string | null
  now?: Date
}): string {
  const start = functionStartUtc(input.date, input.time, input.tz ?? DEFAULT_TZ)
  const end = new Date(start.getTime() + (input.durationMinutes ?? 180) * 60_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HUB//Entradas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(input.now ?? new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(input.title)}`,
  ]
  if (input.location) lines.push(`LOCATION:${icsEscape(input.location)}`)
  if (input.description) lines.push(`DESCRIPTION:${icsEscape(input.description)}`)
  if (input.url) lines.push(`URL:${input.url}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}
