import { Cake } from 'lucide-react'
import { type CakeOptionSummary, describeCake } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * "Lleva torta" en una sola pieza, para todas las pantallas donde se lee una
 * reserva. Antes había un ícono 🎂 suelto que decía cuántas y nunca cuál — y
 * cuál es el único dato que la cocina necesita, porque la torta la hace el bar.
 *
 * Tres estados, los tres distintos a propósito:
 *   · elegida  → "Opción 2 · Bizcochuelo de chocolate"
 *   · sin definir → se ve en ámbar, porque es una tarea pendiente del bar
 *   · sin torta → no se renderiza nada
 */
export function CakeChip({
  count,
  option,
  detailed = false,
  className,
}: {
  count: number
  option: CakeOptionSummary | null
  /** Suma los rellenos debajo. Para el detalle de una reserva, no para una fila. */
  detailed?: boolean
  className?: string
}) {
  if (count <= 0) return null

  const pending = !option
  const label = option ? option.name : 'Falta elegir torta'

  return (
    <span
      title={option ? describeCake(option) : 'Traen torta pero todavía no eligieron cuál'}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight',
        pending
          ? 'border-warning/50 bg-warning/10 text-warning-foreground'
          : 'border-primary/30 bg-primary/10 text-foreground',
        className,
      )}
    >
      <Cake
        className={cn('size-3 shrink-0', pending ? 'text-warning' : 'text-primary')}
        aria-hidden
      />
      {count > 1 ? <span className="font-mono tabular-nums">{count}×</span> : null}
      <span className="truncate">{label}</span>
      {detailed && option ? (
        <span className="truncate font-normal text-muted-foreground">
          · {option.base}
          {option.fillings.length > 0 ? ` · ${option.fillings.join(' y ')}` : ''}
        </span>
      ) : null}
    </span>
  )
}
