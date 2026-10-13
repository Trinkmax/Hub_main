import type { ReactNode } from 'react'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  ChartEmpty,
  ChartLegend,
  ChartMark,
  ChartTable,
  type LegendRow,
  Plot,
  type PlotTick,
  type XTick,
  XTicks,
} from './chart-parts'
import { ChartTip } from './chart-tip'
import { compactCents, labelIndexes, niceStep, pct } from './scale'

/**
 * Lo que entró y lo que salió por período (semana, mes): entró crece hacia
 * arriba del cero y salió hacia abajo, en la MISMA escala (un peso mide lo
 * mismo en los dos sentidos, así las dos barras se comparan a ojo).
 *
 * - El verde y el terracota no alcanzan solos (se confunden con daltonismo):
 *   el sentido de la barra y las flechas ↑ ↓ de la leyenda dicen cuál es cuál.
 * - 2 px de hueco en el cero entre la barra de arriba y la de abajo.
 * - El eje muestra los montos sin signo de los dos lados: «salió $ 500 mil»,
 *   no «−$ 500 mil».
 * - Las etiquetas de los períodos conviene que sean cortas («Sem 41», «Oct»):
 *   las que no entran se saltean (en una tarjeta ancha entran más).
 */

export type InOutBucket = {
  key: string
  /** Corta: «Sem 41», «Oct». */
  label: string
  inCents: number
  /** En positivo: cuánto salió. */
  outCents: number
}

export type InOutBarsProps = {
  buckets: readonly InOutBucket[]
  /** «Entró» / «Salió»; en la tarjeta de crédito, «Pagos» / «Consumos». */
  inLabel?: string
  outLabel?: string
  showLegend?: boolean
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

function magnitude(value: number): number {
  return Number.isFinite(value) ? Math.abs(value) : 0
}

function signed(cents: number): string {
  return formatCentsShort(cents, { sign: 'always' })
}

export function InOutBars({
  buckets,
  inLabel = 'Entró',
  outLabel = 'Salió',
  showLegend = true,
  emptyHint,
  ariaLabel,
  className,
}: InOutBarsProps) {
  const rows = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    up: magnitude(b.inCents),
    down: magnitude(b.outCents),
  }))
  const totalIn = rows.reduce((sum, r) => sum + r.up, 0)
  const totalOut = rows.reduce((sum, r) => sum + r.down, 0)
  if (totalIn <= 0 && totalOut <= 0) {
    return (
      <ChartEmpty
        silhouette="inout"
        title="Todavía no hay movimientos para comparar"
        hint={emptyHint}
        className={className}
      />
    )
  }

  const n = rows.length
  const peakUp = Math.max(...rows.map((r) => r.up))
  const peakDown = Math.max(...rows.map((r) => r.down))
  // Un solo paso para los dos lados: es un solo eje que cruza el cero.
  const step = niceStep(Math.max(peakUp, peakDown), 3)
  const upTop = peakUp > 0 ? Math.ceil(peakUp / step) * step : 0
  const downTop = peakDown > 0 ? Math.ceil(peakDown / step) * step : 0
  const span = upTop + downTop
  const zero = pct(upTop, span)

  const axis: PlotTick[] = []
  for (let v = upTop; v >= -downTop; v -= step) {
    axis.push({ pos: pct(upTop - v, span), label: compactCents(Math.abs(v)), strong: v === 0 })
  }

  const net = totalIn - totalOut
  const summary =
    ariaLabel ??
    `${inLabel} ${formatCentsShort(totalIn)} y ${outLabel.toLowerCase()} ${formatCentsShort(totalOut)} en ${
      n === 1 ? 'un período' : `${n} períodos`
    }: diferencia ${signed(net)}.`

  // Las etiquetas son texto libre («Sem 41»): cuántas entran sale de su largo.
  // Dos tandas: las que entran en el celular (unos 190 px de dibujo) y las que
  // se suman cuando la tarjeta es ancha (desde 34rem, unos 470 px).
  const longest = Math.max(1, ...rows.map((r) => r.label.length))
  const roomFor = (px: number) => Math.max(1, Math.floor(px / (longest * 6 + 10)))
  const pick = (px: number) =>
    new Set(n <= roomFor(px) ? rows.map((_, i) => i) : labelIndexes(n, roomFor(px), [n - 1]))
  const narrow = pick(190)
  const wide = pick(470)
  const xTicks: XTick[] = rows.map((r, i) =>
    narrow.has(i)
      ? { key: r.key, bottom: r.label }
      : wide.has(i)
        ? { key: r.key, bottom: r.label, wideOnly: true }
        : { key: r.key },
  )

  const legend: LegendRow[] = [
    {
      key: 'entro',
      label: inLabel,
      value: formatCentsShort(totalIn),
      glyph: 'up',
      swatch: 'bg-adm-in',
    },
    {
      key: 'salio',
      label: outLabel,
      value: formatCentsShort(totalOut),
      glyph: 'down',
      swatch: 'bg-adm-out',
    },
    { key: 'diferencia', label: 'Diferencia', value: signed(net), glyph: 'none' },
  ]

  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      <ChartTip>
        <Plot ticks={axis} xAxis={<XTicks items={xTicks} />}>
          <div role="img" aria-label={summary} className="absolute inset-0" />
          <div className="absolute inset-0 flex">
            {rows.map((r) => {
              if (r.up <= 0 && r.down <= 0) {
                return <span key={r.key} aria-hidden className="min-w-0 flex-1" />
              }
              const diff = r.up - r.down
              return (
                <ChartMark
                  key={r.key}
                  label={`${r.label}: ${inLabel.toLowerCase()} ${formatCents(r.up)}, ${outLabel.toLowerCase()} ${formatCents(r.down)}, diferencia ${formatCents(diff, { sign: 'always' })}`}
                  tipTitle={r.label}
                  tipValue={`↑ ${inLabel} ${formatCents(r.up)}`}
                  tipSub={`↓ ${outLabel} ${formatCents(r.down)}\nDiferencia ${formatCents(diff, { sign: 'always' })}`}
                  className="h-full min-w-0 flex-1 rounded-[3px] data-[tip-active]:bg-foreground/[0.06]"
                >
                  {r.up > 0 ? (
                    <span
                      data-tip-anchor
                      aria-hidden
                      className="absolute left-1/2 min-h-[2px] w-[calc(100%-2px)] max-w-6 min-w-[2px] -translate-x-1/2 rounded-t-[4px] bg-adm-in"
                      style={{
                        bottom: `calc(${pct(downTop, span)}% + 1px)`,
                        height: `calc(${pct(r.up, span)}% - 1px)`,
                      }}
                    />
                  ) : null}
                  {r.down > 0 ? (
                    <span
                      data-tip-anchor={r.up > 0 ? undefined : true}
                      aria-hidden
                      className="absolute left-1/2 min-h-[2px] w-[calc(100%-2px)] max-w-6 min-w-[2px] -translate-x-1/2 rounded-b-[4px] bg-adm-out"
                      style={{
                        top: `calc(${zero}% + 1px)`,
                        height: `calc(${pct(r.down, span)}% - 1px)`,
                      }}
                    />
                  ) : null}
                </ChartMark>
              )
            })}
          </div>
        </Plot>
      </ChartTip>

      {showLegend ? (
        <ChartLegend caption={`${inLabel} y ${outLabel.toLowerCase()} del período`} rows={legend} />
      ) : null}
    </div>
  )
}

/** Los mismos períodos en filas, para «Ver como tabla». */
export function InOutBarsTable({
  buckets,
  inLabel = 'Entró',
  outLabel = 'Salió',
  caption,
}: {
  buckets: readonly InOutBucket[]
  inLabel?: string
  outLabel?: string
  caption?: string
}) {
  const totalIn = buckets.reduce((sum, b) => sum + magnitude(b.inCents), 0)
  const totalOut = buckets.reduce((sum, b) => sum + magnitude(b.outCents), 0)
  return (
    <ChartTable
      caption={caption ?? `${inLabel} y ${outLabel.toLowerCase()} por período`}
      columns={[
        { key: 'periodo', label: 'Período' },
        { key: 'entro', label: inLabel, align: 'right' },
        { key: 'salio', label: outLabel, align: 'right' },
        { key: 'diferencia', label: 'Diferencia', align: 'right' },
      ]}
      rows={buckets.map((b) => {
        const up = magnitude(b.inCents)
        const down = magnitude(b.outCents)
        return {
          key: b.key,
          cells: [
            b.label,
            formatCents(up),
            formatCents(down),
            formatCents(up - down, { sign: 'always' }),
          ],
        }
      })}
      foot={[
        'Total',
        formatCents(totalIn),
        formatCents(totalOut),
        formatCents(totalIn - totalOut, { sign: 'always' }),
      ]}
    />
  )
}
