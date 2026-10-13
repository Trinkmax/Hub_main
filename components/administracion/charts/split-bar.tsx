import type { ReactNode } from 'react'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ChartEmpty, ChartLegend, ChartMark, HATCH_OVER_FILL, type LegendRow } from './chart-parts'
import { ChartTip } from './chart-tip'
import { pct, percentLabel, percentShort, sharePercents } from './scale'

/**
 * Barra partida: un total repartido en sus partes (la plata por caja, una
 * deuda por antigüedad), como la del «Pulso de la noche» de Operativo.
 *
 * - **La leyenda es la tabla**: cada parte con su porcentaje y su monto. Los
 *   porcentajes suman 100 (resto mayor).
 * - **2 px de hueco** entre tramos (se ve la tarjeta), nunca un borde.
 * - Un tramo de menos del 1,5 % igual se ve: mide 6 px como mínimo. El reparto
 *   lo hace flex (`flex-grow` = su parte), así el mínimo de uno le saca el
 *   lugar a los demás y la barra nunca se desborda.
 * - Lo que no suma (cero o negativo: una caja en descubierto) no entra en la
 *   barra, pero sí en la leyenda, con su monto y sin porcentaje.
 * - `hatched`: rayado para lo que todavía no es plata en mano (en camino,
 *   estimado). El rayado acompaña a la palabra, no la reemplaza.
 */

export type SplitBarSegment = {
  key: string
  label: string
  cents: number
  /** Clase `bg-*` del color de la serie: `bg-adm-s1`. */
  swatch: string
  /** La fila de la leyenda y el tramo llevan a su detalle. */
  href?: string
  hatched?: boolean
}

export type SplitBarProps = {
  segments: readonly SplitBarSegment[]
  /** Alto de la barra en px (12 por defecto; hasta 24). */
  height?: number
  /** Con esto la leyenda cierra con el total: «Disponible». */
  totalLabel?: string
  showLegend?: boolean
  /** Qué decir cuando no hay nada que repartir (texto, o un `EmptyTeach` entero). */
  emptyHint?: ReactNode
  /** La conclusión para lectores de pantalla. Por defecto se arma con los datos. */
  ariaLabel?: string
  className?: string
}

/** Un tramo de 12 px no se toca con el dedo: la marca sobresale hasta 28 px. */
const TOUCH_PAD = 'before:absolute before:inset-x-0 before:-inset-y-2 before:content-[""]'

export function SplitBar({
  segments,
  height = 12,
  totalLabel,
  showLegend = true,
  emptyHint,
  ariaLabel,
  className,
}: SplitBarProps) {
  const drawn = segments.filter((s) => Number.isFinite(s.cents) && s.cents > 0)
  const total = drawn.reduce((sum, s) => sum + s.cents, 0)
  if (total <= 0) {
    return (
      <ChartEmpty
        silhouette="split"
        title="Todavía no hay nada para repartir"
        hint={emptyHint}
        className={className}
      />
    )
  }

  const shares = sharePercents(drawn.map((s) => s.cents))
  const shareOf = new Map(drawn.map((s, i) => [s.key, shares[i] ?? 0]))
  const barHeight = Math.min(24, Math.max(6, Math.round(height)))
  const everything = segments.reduce((sum, s) => sum + (Number.isFinite(s.cents) ? s.cents : 0), 0)

  const summary =
    ariaLabel ??
    `${totalLabel ?? 'Total'} ${formatCentsShort(total)}: ${drawn
      .map(
        (s) =>
          `${s.label} ${formatCentsShort(s.cents)} (${percentLabel(shareOf.get(s.key) ?? 0, true)})`,
      )
      .join('; ')}`

  const rows: LegendRow[] = segments.map((s) => {
    const counts = shareOf.has(s.key)
    return {
      key: s.key,
      label: s.label,
      value: formatCentsShort(s.cents),
      share: counts ? percentShort(shareOf.get(s.key) ?? 0, true) : '—',
      swatch: counts ? s.swatch : 'bg-adm-track',
      hatched: s.hatched,
      href: s.href,
      muted: !counts,
    }
  })

  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      <ChartTip>
        <div className="relative" style={{ height: barHeight }}>
          {/* La conclusión, para quien no ve la barra. El riel no tiene hijos:
              las marcas van en una capa hermana para poder enfocarlas. */}
          <div
            role="img"
            aria-label={summary}
            className="absolute inset-0 rounded-full bg-adm-track"
          />
          <div className="rail-grow absolute inset-0 flex gap-[2px]">
            {drawn.map((s) => {
              const share = percentLabel(shareOf.get(s.key) ?? 0, true)
              return (
                <ChartMark
                  key={s.key}
                  href={s.href}
                  label={`${s.label}: ${formatCents(s.cents)}, ${share} del total`}
                  tipTitle={s.label}
                  tipValue={formatCents(s.cents)}
                  tipSub={`${share} del total`}
                  className={cn(
                    'h-full min-w-[6px] basis-0 first:rounded-l-full last:rounded-r-full focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                    'transition-[filter] duration-(--duration-fast) data-[tip-active]:brightness-110 motion-reduce:transition-none',
                    TOUCH_PAD,
                    s.swatch,
                  )}
                  style={{
                    flexGrow: pct(s.cents, total),
                    ...(s.hatched ? HATCH_OVER_FILL : {}),
                  }}
                />
              )
            })}
          </div>
        </div>
      </ChartTip>

      {showLegend ? (
        <ChartLegend
          caption={totalLabel ? `${totalLabel}, por parte` : 'Cómo se reparte'}
          rows={rows}
          total={
            totalLabel ? { label: totalLabel, value: formatCentsShort(everything) } : undefined
          }
        />
      ) : null}
    </div>
  )
}
