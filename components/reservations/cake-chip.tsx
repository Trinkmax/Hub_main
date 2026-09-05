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
  optionId,
  detailed = false,
  className,
}: {
  count: number
  option: CakeOptionSummary | null
  /**
   * La columna cruda. Hace falta además del objeto porque el panel del salón se
   * actualiza por Realtime y el payload de Postgres NO trae los joins: ahí llega
   * `cake_option_id` con `cake_option` viejo o ausente. Sin este dato, una
   * reserva con la torta ya elegida se pintaba en ámbar "Falta elegir torta"
   * apenas entraba por Realtime — el aviso contrario al real.
   */
  optionId?: string | null
  /** Suma los rellenos debajo. Para el detalle de una reserva, no para una fila. */
  detailed?: boolean
  className?: string
}) {
  if (count <= 0) return null

  // `optionId` manda cuando está: "no eligieron" ≠ "el join no vino".
  const chosen = optionId !== undefined ? Boolean(optionId) : Boolean(option)
  const pending = !chosen
  const label = option ? option.name : pending ? 'Falta elegir torta' : 'Torta elegida'

  return (
    <span
      title={
        option
          ? describeCake(option)
          : pending
            ? 'Lleva torta pero todavía no eligieron cuál'
            : 'La torta ya está elegida — abrí la reserva para ver cuál'
      }
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight',
        // `text-warning-foreground` es para ir sobre el ámbar SÓLIDO: sobre un
        // tinte al 10% queda casi negro sobre casi negro en dark (1.3:1). El
        // patrón de la casa sobre tinte es texto en `foreground` con el ícono
        // tintado — el mismo que ya usan los chips de aviso de servicio.
        pending
          ? 'border-warning/50 bg-warning/10 text-foreground'
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
