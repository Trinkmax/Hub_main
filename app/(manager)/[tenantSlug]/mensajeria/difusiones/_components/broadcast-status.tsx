import type { LucideIcon } from 'lucide-react'
import { Ban, Check, Clock3, Loader2, PencilLine, TriangleAlert, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { BroadcastStatus } from '@/types/database'

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info'
  | 'muted'

type StatusMeta = {
  label: string
  variant: BadgeVariant
  icon?: LucideIcon
  spin?: boolean
}

const STATUS_META: Record<BroadcastStatus, StatusMeta> = {
  draft: { label: 'Borrador', variant: 'outline', icon: PencilLine },
  scheduled: { label: 'Programada', variant: 'info', icon: Clock3 },
  sending: { label: 'Enviando', variant: 'warning', icon: Loader2, spin: true },
  sent: { label: 'Enviada', variant: 'success', icon: Check },
  partial: { label: 'Enviada con fallas', variant: 'warning', icon: TriangleAlert },
  failed: { label: 'Fallida', variant: 'destructive', icon: X },
  cancelled: { label: 'Cancelada', variant: 'muted', icon: Ban },
}

/** Badge de estado de una difusión con color semántico e ícono. */
export function BroadcastStatusBadge({ status }: { status: string }) {
  const meta = (STATUS_META as Partial<Record<string, StatusMeta>>)[status] ?? {
    label: status,
    variant: 'outline' as const,
  }
  const Icon = meta.icon
  return (
    <Badge variant={meta.variant}>
      {Icon ? <Icon className={meta.spin ? 'animate-spin' : undefined} aria-hidden /> : null}
      {meta.label}
    </Badge>
  )
}

const TZ = 'America/Argentina/Cordoba'

/**
 * Formatea una fecha ISO para mostrar: `dd/MM HH:mm` (o `dd/MM/yyyy HH:mm`
 * con `withYear`). Siempre en horario de Córdoba, sin depender del TZ del server.
 */
export function formatDateTime(iso: string, { withYear = false }: { withYear?: boolean } = {}) {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: 'numeric' as const } : {}),
  }).format(d)
  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d)
  return `${date} ${time}`
}

/** "1 cliente" / "42 clientes" con separador de miles es-AR. */
export function clientesLabel(n: number): string {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? 'cliente' : 'clientes'}`
}
