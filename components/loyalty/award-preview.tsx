import { Sparkles, TriangleAlert } from 'lucide-react'
import { formatNumber } from '@/lib/format/number-kind'
import type { EarnRate } from '@/lib/points/earn-rate'
import { describeEarnRate } from '@/lib/points/preview'

/**
 * La devolución en vivo debajo del monto: cuántos puntos suma lo que se está
 * tipeando, la tasa del bar si todavía no hay monto, o el aviso de que el bar
 * no configuró reglas. Así el que cobra se lo puede decir al cliente antes de
 * tocar nada.
 *
 * Va como `hint` del `Field` del monto (queda en su `aria-describedby`); el
 * `aria-live` cortés lo anuncia cuando cambia, sin cortar al lector.
 */
export function AwardPreview({
  points,
  earnRate,
}: {
  /** `previewPoints()` del monto actual. */
  points: number | null
  /** `null` = el bar no tiene una tasa que se pueda prometer. */
  earnRate: EarnRate | null
}) {
  return (
    <span aria-live="polite" className="inline-flex items-start gap-1.5">
      {earnRate === null ? (
        <>
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-warning-text"
          />
          <span className="text-warning-text">
            Este bar todavía no configuró cómo se suman puntos.
          </span>
        </>
      ) : points !== null && points > 0 ? (
        <>
          <Sparkles aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span className="font-medium text-foreground">
            Suma {formatNumber(points)} {points === 1 ? 'punto' : 'puntos'}
          </span>
        </>
      ) : (
        <span>{describeEarnRate(earnRate) ?? 'Los puntos salen de las reglas del Club.'}</span>
      )}
    </span>
  )
}

/** «Sumar 12 puntos» cuando hay preview; si no, «Sumar puntos». */
export function awardButtonLabel(points: number | null): string {
  return points !== null && points > 0
    ? `Sumar ${formatNumber(points)} ${points === 1 ? 'punto' : 'puntos'}`
    : 'Sumar puntos'
}
