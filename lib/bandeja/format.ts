import { differenceInCalendarDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatInTimeZone } from 'date-fns-tz'

/**
 * Todo en el reloj del bar. El servidor corre en UTC y el navegador no: sin esto la lista salía del servidor con
 * tres horas de más y React tiraba abajo lo que había dibujado (`Hydration failed`).
 */
const TZ = 'America/Argentina/Cordoba'

function inBar(date: Date, pattern: string): string {
  return formatInTimeZone(date, TZ, pattern, { locale: es })
}

function calendarDaysBetween(now: Date, date: Date): number {
  return differenceInCalendarDays(
    parseISO(inBar(now, 'yyyy-MM-dd')),
    parseISO(inBar(date, 'yyyy-MM-dd')),
  )
}

/**
 * Timestamp de la lista de chats, calcado de WhatsApp:
 * hoy → "22:15" · ayer → "ayer" · esta semana → "lunes" · antes → "18/07/2026".
 * "Hoy"/"ayer" se calculan contra `now` (no contra el reloj del sistema) para
 * que la función sea pura y testeable.
 */
export function formatListTimestamp(iso: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const days = calendarDaysBetween(now, date)
  if (days <= 0) return inBar(date, 'HH:mm')
  if (days === 1) return 'ayer'
  if (days < 7) return inBar(date, 'EEEE')
  return inBar(date, 'dd/MM/yyyy')
}

/**
 * Pastilla separadora de días del hilo, como WhatsApp:
 * "Hoy" · "Ayer" · "Lunes" (esta semana) · "18 de julio de 2026".
 */
export function formatDaySeparator(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const days = calendarDaysBetween(now, date)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) {
    const day = inBar(date, 'EEEE')
    return day.charAt(0).toUpperCase() + day.slice(1)
  }
  return inBar(date, "d 'de' MMMM 'de' yyyy")
}

/** Clave de agrupación por día calendario ("2026-07-18"). */
export function dayKey(iso: string): string {
  return inBar(new Date(iso), 'yyyy-MM-dd')
}

/** "hace 12 días" / "hoy" / "ayer" para última visita en el panel del cliente. */
export function formatRelativeDays(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const days = calendarDaysBetween(now, date)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? 'hace 1 mes' : `hace ${months} meses`
  const years = Math.floor(days / 365)
  return years === 1 ? 'hace 1 año' : `hace ${years} años`
}
