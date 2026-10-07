import type { StatusMap } from '@/components/ui/status-badge'
import { addDays, formatDate, formatDateTime, formatTime, isoDayInCordoba } from '@/lib/dates'

/**
 * Estado de una página HTML para `StatusBadge` (kit HUB §3.4). Lo comparten el
 * listado y el editor.
 *
 * El kit pide este mapa en `lib/landings/status-meta.ts`; vive acá porque el
 * lote del panel no toca `lib/`.
 */
export type LandingStatus = 'published' | 'draft'

export const LANDING_STATUS: StatusMap<LandingStatus> = {
  published: {
    label: 'Publicada',
    tone: 'success',
    description: 'Cualquiera con el link la puede abrir.',
  },
  draft: {
    label: 'Borrador',
    tone: 'neutral',
    description: 'Todavía no está publicada: el link no abre.',
  },
}

export function landingStatus(published: boolean): LandingStatus {
  return published ? 'published' : 'draft'
}

/**
 * Cuándo pasó algo, en hora de Córdoba y escrito a mano: «Hoy 14:32», «Ayer
 * 09:10» o «07/10/2026» (con `withTime`, «07/10/2026 14:32»). `today` llega
 * resuelto desde el server: así el HTML del server y el del navegador dicen lo
 * mismo (con `formatDistanceToNow` el «hace 5 minutos» podía cambiar entre los
 * dos y romper la hidratación).
 */
export function whenLabel(
  value: string | null | undefined,
  today: string,
  opts: { withTime?: boolean; lowercase?: boolean } = {},
): string {
  if (!value) return '—'
  const day = isoDayInCordoba(value)
  if (!day) return '—'
  let label: string
  if (day === today) label = `Hoy ${formatTime(value)}`
  else if (day === addDays(today, -1)) label = `Ayer ${formatTime(value)}`
  else label = opts.withTime ? formatDateTime(value) : formatDate(value)
  return opts.lowercase ? label.charAt(0).toLowerCase() + label.slice(1) : label
}
