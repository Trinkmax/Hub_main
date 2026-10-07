import { formatDayMonth } from '@/lib/dates/format'
import { cordobaDateTime } from '@/lib/dates/zone'

/**
 * `'2026-09-15T00:45:00Z'` → `'14/09 21:45'`: día y hora de Córdoba, armados a
 * mano (sin `toLocaleString`: el ICU del server y el del navegador no
 * coinciden, y el TZ del navegador puede no ser el del bar). `—` si no se lee.
 */
export function shortDateTime(iso: string | null | undefined): string {
  const parts = cordobaDateTime(iso)
  return parts ? `${formatDayMonth(parts.date)} ${parts.time}` : '—'
}

/** Cuánto estuvo abierta la mesa: `'45 min'`, `'2 h'`, `'1 h 20 min'`. Vacío sin cierre. */
export function elapsed(opened: string, paid: string | null): string {
  if (!paid) return ''
  const ms = new Date(paid).getTime() - new Date(opened).getTime()
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem === 0 ? `${h} h` : `${h} h ${rem} min`
}
