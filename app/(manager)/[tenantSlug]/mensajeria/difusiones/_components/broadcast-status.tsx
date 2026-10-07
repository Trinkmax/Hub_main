import { Ban, Check, Clock3, PencilLine, Send, TriangleAlert, X } from 'lucide-react'
import { StatusBadge, type StatusMap } from '@/components/ui/status-badge'
import {
  formatDayMonth,
  formatDateTime as formatFullDateTime,
  formatTime,
  isoDayInCordoba,
} from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import type { BroadcastStatus, RecipientStatus } from '@/types/database'

/**
 * Estados de una difusión y de cada destinatario, para `StatusBadge`. Viven
 * acá hasta que exista `lib/broadcasts/status-meta.ts` (el lote no toca
 * `lib/`). Sin íconos que giren: el kit no anima estados.
 */
export const BROADCAST_STATUS: StatusMap<BroadcastStatus> = {
  draft: { label: 'Borrador', tone: 'neutral', icon: PencilLine },
  scheduled: { label: 'Programada', tone: 'info', icon: Clock3 },
  sending: { label: 'Enviando', tone: 'warning', icon: Send },
  sent: { label: 'Enviada', tone: 'success', icon: Check },
  partial: {
    label: 'Enviada con fallas',
    tone: 'warning',
    icon: TriangleAlert,
    description: 'A algunos clientes no les llegó: mirá el motivo en el detalle.',
  },
  failed: { label: 'Fallida', tone: 'danger', icon: X },
  cancelled: { label: 'Cancelada', tone: 'neutral', icon: Ban },
}

export const RECIPIENT_STATUS: StatusMap<RecipientStatus> = {
  pending: { label: 'En cola', tone: 'neutral' },
  sending: { label: 'Enviando', tone: 'warning' },
  sent: { label: 'Enviado', tone: 'neutral' },
  delivered: { label: 'Entregado', tone: 'info' },
  read: { label: 'Leído', tone: 'success' },
  replied: { label: 'Respondió', tone: 'brand' },
  failed: { label: 'Falló', tone: 'danger' },
}

/** Badge de estado de una difusión (un estado desconocido se ve tal cual, en neutro). */
export function BroadcastStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status as BroadcastStatus} map={BROADCAST_STATUS} />
}

/**
 * Una fecha ISO para mostrar: `dd/MM HH:mm` (o `dd/MM/yyyy HH:mm` con
 * `withYear`). Siempre en hora de Córdoba y escrita a mano (sin `Intl`).
 */
export function broadcastDateTime(iso: string, { withYear = false }: { withYear?: boolean } = {}) {
  if (withYear) return formatFullDateTime(iso)
  const day = isoDayInCordoba(iso)
  return day ? `${formatDayMonth(day)} ${formatTime(iso)}` : ''
}

/** "1 cliente" / "42 clientes" con separador de miles es-AR. */
export function clientesLabel(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? 'cliente' : 'clientes'}`
}
