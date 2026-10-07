import type { TrafficLight } from '@/lib/accounting/aging'
import { cn } from '@/lib/utils'

const TONE: Readonly<Record<TrafficLight, { dot: string; text: string }>> = {
  red: { dot: 'bg-destructive', text: 'text-destructive' },
  yellow: { dot: 'bg-warning', text: 'text-warning-text' },
  green: { dot: 'bg-success', text: 'text-muted-foreground' },
  none: { dot: 'bg-muted-foreground/30', text: 'text-muted-foreground' },
}

/**
 * El semáforo de un cliente o plataforma (F.7) con la forma de `DueStatus`:
 * punto + texto, nunca solo color («PedidosYa está atrasada 5 días», «Se
 * acredita en 3 días», «Al día», «Sin deuda»). Server-safe.
 */
export function TrafficStatus({
  light,
  text,
  className,
}: {
  light: TrafficLight
  text: string
  className?: string
}) {
  const tone = TONE[light]
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs tabular-nums', tone.text, className)}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} />
      {text}
    </span>
  )
}
