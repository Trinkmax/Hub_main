import { differenceInCalendarDays, format } from 'date-fns'
import { es } from 'date-fns/locale'

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
  const days = differenceInCalendarDays(now, date)
  if (days <= 0) return format(date, 'HH:mm')
  if (days === 1) return 'ayer'
  if (days < 7) return format(date, 'EEEE', { locale: es })
  return format(date, 'dd/MM/yyyy')
}

/**
 * Pastilla separadora de días del hilo, como WhatsApp:
 * "Hoy" · "Ayer" · "Lunes" (esta semana) · "18 de julio de 2026".
 */
export function formatDaySeparator(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const days = differenceInCalendarDays(now, date)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) {
    const day = format(date, 'EEEE', { locale: es })
    return day.charAt(0).toUpperCase() + day.slice(1)
  }
  return format(date, "d 'de' MMMM 'de' yyyy", { locale: es })
}

/** Clave de agrupación por día calendario ("2026-07-18"). */
export function dayKey(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd')
}

/** "hace 12 días" / "hoy" / "ayer" para última visita en el panel del cliente. */
export function formatRelativeDays(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const days = differenceInCalendarDays(now, date)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? 'hace 1 mes' : `hace ${months} meses`
  const years = Math.floor(days / 365)
  return years === 1 ? 'hace 1 año' : `hace ${years} años`
}
