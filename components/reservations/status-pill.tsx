import { StatusBadge } from '@/components/ui/status-badge'
import type { SalonReservationStatus } from '@/lib/salon/types'
import { RESERVATION_STATUS } from './status-meta'

/**
 * El estado de una reserva: la `StatusBadge` del kit con el mapa de
 * `status-meta.ts` (fondo suave del tono + punto + la palabra). Antes eran 36
 * clases de paleta cruda con `dark:` a mano.
 *
 * Mismo nombre y props de siempre: la lista, la vista rápida, el día del
 * calendario y el buscador la siguen importando igual.
 */
export function StatusPill({
  status,
  className,
}: {
  status: SalonReservationStatus
  className?: string
}) {
  return <StatusBadge status={status} map={RESERVATION_STATUS} className={className} />
}
