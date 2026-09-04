import { GlassWater, PartyPopper } from 'lucide-react'
import type { ReservationKind } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * "Esto no es una mesa más": la pastilla que marca un cumpleaños o una reserva
 * especial.
 *
 * Vive en un solo archivo a propósito. El mismo hecho (`kind = 'birthday'`) se
 * dibuja en cuatro pantallas — el calendario del mes, la lista de reservas de
 * un evento, el renglón de hitos del día y el detalle — y cada una con su
 * propia paleta es exactamente como se erosiona un sistema de diseño. Misma
 * familia que `ServiceAlertChips` y `CakeChip`: span pelado, sin estado, con
 * ícono de lucide (nunca emoji: renderiza distinto en Android que en macOS y no
 * hereda el color).
 */
export function CelebrationChip({
  kind,
  compact = false,
  className,
}: {
  kind: ReservationKind
  /** Solo el ícono + el número, para una celda de calendario. */
  compact?: boolean
  className?: string
}) {
  if (kind === 'normal') return null
  const label = kind === 'birthday' ? 'Cumple' : 'Especial'
  const full = kind === 'birthday' ? 'Cumpleaños' : 'Reserva especial'

  return (
    <span
      title={full}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-tight',
        kind === 'birthday'
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-info/30 bg-info/10 text-info',
        className,
      )}
    >
      <PartyPopper className="size-2.5" aria-hidden />
      {compact ? <span className="sr-only">{full}</span> : label}
    </span>
  )
}

/** "🍾 1 champagne" pero con ícono de verdad. Va siempre al lado de la torta. */
export function ChampagneChip({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] leading-tight text-muted-foreground',
        className,
      )}
    >
      <GlassWater className="size-3 shrink-0 text-primary" aria-hidden />
      {count > 1 ? <span className="font-mono tabular-nums">{count}×</span> : null}
      champagne
    </span>
  )
}
