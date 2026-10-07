import { Cake, GlassWater, PartyPopper } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ReservationKind } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * "Esto no es una mesa más": la etiqueta que marca un cumpleaños o una reserva
 * especial.
 *
 * Vive en un solo archivo a propósito. El mismo hecho (`kind = 'birthday'`) se
 * dibuja en cuatro pantallas — el calendario del mes, la lista de reservas de
 * un evento, el renglón de hitos del día y el detalle — y cada una con su
 * propia paleta es exactamente como se erosiona un sistema de diseño. Misma
 * familia que `ServiceAlertChips` y `CakeChip`: la `Badge` del kit, sin estado,
 * con ícono de lucide (nunca emoji: renderiza distinto en Android que en macOS
 * y no hereda el color).
 */
/** Los tres motivos por los que una mesa deja de ser una mesa más. */
export type CelebrationKind = 'birthday' | 'special' | 'cake'

const KIND_COPY: Record<CelebrationKind, { short: string; full: string }> = {
  birthday: { short: 'Cumple', full: 'Cumpleaños' },
  special: { short: 'Especial', full: 'Reserva especial' },
  cake: { short: 'Con torta', full: 'Lleva torta (sin marcar como cumpleaños)' },
}

export function CelebrationChip({
  kind,
  compact = false,
  className,
}: {
  kind: ReservationKind | CelebrationKind
  /** Solo el ícono, para una celda de calendario. */
  compact?: boolean
  className?: string
}) {
  if (kind === 'normal') return null
  const copy = KIND_COPY[kind]

  return (
    <Badge
      tone={kind === 'special' ? 'info' : 'brand'}
      icon={kind === 'cake' ? Cake : PartyPopper}
      title={copy.full}
      className={cn(compact && 'px-1', className)}
    >
      {compact ? <span className="sr-only">{copy.full}</span> : copy.short}
    </Badge>
  )
}

/** "🍾 1 champagne" pero con ícono de verdad. Va siempre al lado de la torta. */
export function ChampagneChip({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <Badge tone="neutral" icon={GlassWater} className={className}>
      {count > 1 ? <span className="tabular-nums">{count}×</span> : null}
      champagne
    </Badge>
  )
}
