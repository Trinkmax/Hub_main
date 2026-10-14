import { cn } from '@/lib/utils'
import type { ArrivalStop } from '../_lib/incoming'

/**
 * «¿Cuándo te paga cada medio?»: una línea con paradas. Cada parada es un
 * plazo («En el momento», «Al otro día», «A los 14 días») y debajo van los
 * medios de cobro que paran ahí. Son cuatro o cinco plazos: se ven de un
 * vistazo, y dicen con los datos reales del bar cuándo llega cada cosa.
 *
 * En el celular la línea baja (una parada por renglón); desde `sm` va de
 * izquierda a derecha. La parada rellena es plata que ya tenés; la hueca, la
 * que llega después. Nunca depende del color: cada parada lleva su palabra.
 *
 * Cuándo NO: para plata con importe (eso es la tira de «Cuándo llega»): acá no
 * hay montos, solo la regla.
 */
export function ArrivalRule({
  stops,
  className,
}: {
  stops: readonly ArrivalStop[]
  className?: string
}) {
  if (stops.length === 0) return null
  return (
    <ol
      aria-label="Cuándo te paga cada medio de cobro"
      className={cn(
        'relative grid gap-y-5 sm:grid-flow-col sm:auto-cols-fr sm:gap-x-3',
        // La línea: vertical en el celular, horizontal desde `sm`.
        "before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border before:content-[''] sm:before:inset-x-0 sm:before:top-[5px] sm:before:bottom-auto sm:before:h-px sm:before:w-auto",
        className,
      )}
    >
      {stops.map((stop) => (
        <li key={stop.key} className="relative min-w-0 pl-6 sm:pt-6 sm:pl-0">
          <span
            aria-hidden
            className={cn(
              'absolute top-1 left-0 size-[11px] rounded-full border-2 border-adm-s1 sm:top-0',
              stop.inHand ? 'bg-adm-s1' : 'bg-card',
            )}
          />
          <p className="text-sm font-semibold leading-snug text-balance">{stop.label}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {stop.methods.map((name) => (
              <li
                key={name}
                className="rounded-full bg-secondary px-2 py-0.5 text-xs leading-snug text-foreground"
              >
                {name}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
