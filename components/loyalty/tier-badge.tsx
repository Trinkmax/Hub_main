import { Badge, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type TierLike = { name: string; color: string | null }

/**
 * El nivel del socio (Classic, Gold…) como etiqueta de solo lectura (kit §3.4).
 *
 * El color del nivel lo carga el bar y no se sabe si contrasta como texto, así
 * que va solo en el punto; el nombre va en tinta sobre la etiqueta neutra.
 * Es el único: lo usan Club (aliados), el operativo y Acreditar, así el nivel
 * se lee igual en todo el panel.
 */
export function TierBadge({
  tier,
  className,
  ...props
}: Omit<BadgeProps, 'children' | 'tone' | 'dot'> & { tier: TierLike }) {
  return (
    <Badge tone="neutral" className={className} {...props}>
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full border border-border-strong',
          !tier.color && 'bg-subtle-foreground',
        )}
        style={tier.color ? { backgroundColor: tier.color } : undefined}
      />
      {tier.name}
    </Badge>
  )
}
