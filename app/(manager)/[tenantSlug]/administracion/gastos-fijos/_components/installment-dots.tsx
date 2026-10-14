import { cn } from '@/lib/utils'

/**
 * Las cuotas de un gasto fijo, un punto por cuota: las pagas rellenas, la que
 * toca con anillo y las que faltan huecas. Es el lenguaje de las sillas del
 * muro de mesas: la unidad se cuenta con el ojo.
 *
 * NO escribe números: las palabras («cuota 2 de 6») las pone la pantalla al
 * lado, y este dibujo queda fuera de la lectura (`aria-hidden`).
 *
 * - Con el total: `current − 1` pagas, la actual y las que faltan.
 * - Sin el total (no se sabe de cuántas era): solo las que faltan, la primera
 *   como actual.
 * - Más de `max` puntos no entran en un renglón: pasa a una barrita fina con la
 *   parte que ya se pagó.
 *
 * Cuándo NO: para un avance de plata (eso es `Meter`) ni sin las palabras al lado.
 */
export function InstallmentDots({
  current,
  total,
  remaining,
  max = 12,
  size = 'sm',
  className,
}: {
  /** Qué cuota es la que toca (`null` = no se sabe de cuántas). */
  current: number | null
  total: number | null
  /** Cuántas faltan contando la que toca. */
  remaining: number
  max?: number
  size?: 'sm' | 'md'
  className?: string
}) {
  const known = current !== null && total !== null && total >= 1 && current >= 1
  const count = known ? total : Math.max(0, remaining)
  if (count < 1) return null
  const paid = known ? Math.min(total, current - 1) : 0

  if (count > max) {
    // Demasiadas para contarlas: la misma idea, como un riel fino.
    const paidShare = known ? Math.round((paid / total) * 100) : 0
    return (
      <span
        aria-hidden
        className={cn(
          'relative inline-block h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-foreground/12',
          className,
        )}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
          style={{ width: `${paidShare}%` }}
        />
        <span
          className="absolute inset-y-0 w-1.5 rounded-full bg-primary"
          style={{ left: `min(calc(100% - 0.375rem), ${paidShare}%)` }}
        />
      </span>
    )
  }

  const dot = size === 'md' ? 'size-3' : 'size-2'
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 flex-wrap items-center gap-1', className)}
    >
      {Array.from({ length: count }, (_, index) => {
        const isPaid = index < paid
        const isCurrent = index === paid
        return (
          <span
            // Los puntos son una fila fija: el índice ES la cuota.
            // biome-ignore lint/suspicious/noArrayIndexKey: fila fija, sin reordenar
            key={index}
            data-dot={isPaid ? 'paid' : isCurrent ? 'current' : 'left'}
            className={cn(
              'rounded-full',
              dot,
              isPaid && 'bg-foreground/70',
              isCurrent && 'bg-primary ring-2 ring-primary/25',
              !isPaid && !isCurrent && 'border border-foreground/30',
            )}
          />
        )
      })}
    </span>
  )
}
