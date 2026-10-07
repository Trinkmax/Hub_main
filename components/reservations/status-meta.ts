import type { StatusMap } from '@/components/ui/status-badge'
import { type SalonReservationStatus, STATUS_LABELS } from '@/lib/salon/types'

/**
 * El estado de una reserva como etiqueta del kit (`StatusBadge`), en un solo
 * mapa para todas las pantallas del panel: la lista, la vista rápida, el día
 * del calendario y el buscador dicen lo mismo con el mismo tono.
 *
 * Los textos salen de `STATUS_LABELS` (lib/salon/types): el mapa solo agrega
 * el tono y qué significa cada estado (va en el `title`).
 *
 * TODO(kit §3.4): el lugar natural es `lib/salon/status-meta.ts`; vive acá
 * mientras `lib/**` no es de este lote.
 */
export const RESERVATION_STATUS: StatusMap<SalonReservationStatus> = {
  pending: {
    label: STATUS_LABELS.pending,
    tone: 'warning',
    description: 'Todavía no llegaron',
  },
  arrived: {
    label: STATUS_LABELS.arrived,
    tone: 'info',
    description: 'Ya están en el bar',
  },
  seated: {
    label: STATUS_LABELS.seated,
    tone: 'success',
    description: 'Están sentados en su mesa',
  },
  closed: {
    label: STATUS_LABELS.closed,
    tone: 'neutral',
    description: 'La mesa ya se cerró',
  },
  no_show: {
    label: STATUS_LABELS.no_show,
    tone: 'danger',
    description: 'Tenían reserva y no vinieron',
  },
  cancelled: {
    label: STATUS_LABELS.cancelled,
    tone: 'neutral',
    description: 'La reserva se canceló: no ocupa lugar',
  },
}
