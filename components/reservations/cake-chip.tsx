import { Cake } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { type CakeOptionSummary, describeCake } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * "Lleva torta" en una sola pieza, para todas las pantallas donde se lee una
 * reserva. Antes había un ícono 🎂 suelto que decía cuántas y nunca cuál — y
 * cuál es el único dato que la cocina necesita, porque la torta la hace el bar.
 *
 * Tres estados, los tres distintos a propósito:
 *   · elegida  → "Opción 2 · Bizcochuelo de chocolate" (etiqueta de marca)
 *   · sin definir → etiqueta de aviso, porque es una tarea pendiente del bar
 *   · sin torta → no se renderiza nada
 *
 * Es la `Badge` del kit (fondo suave + texto del tono, 12 px): el color nunca
 * va solo, la palabra dice qué pasa.
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
    <Badge
      tone={pending ? 'warning' : 'brand'}
      icon={Cake}
      title={
        option
          ? describeCake(option)
          : pending
            ? 'Lleva torta pero todavía no eligieron cuál'
            : 'La torta ya está elegida — abrí la reserva para ver cuál'
      }
      className={cn('max-w-full justify-start', className)}
    >
      {count > 1 ? <span className="tabular-nums">{count}×</span> : null}
      <span className="min-w-0 truncate">{label}</span>
      {detailed && option ? (
        <span className="min-w-0 truncate font-normal opacity-80">
          · {option.base}
          {option.fillings.length > 0 ? ` · ${option.fillings.join(' y ')}` : ''}
        </span>
      ) : null}
    </Badge>
  )
}
