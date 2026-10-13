import type { CSSProperties, ReactNode } from 'react'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  ChartEmpty,
  ChartLegend,
  ChartMark,
  ChartTable,
  dayShort,
  dayTicks,
  dayTitle,
  type LegendRow,
  Plot,
  XTicks,
} from './chart-parts'
import { ChartTip } from './chart-tip'
import {
  type ChartPoint,
  compactCents,
  linePaths,
  pct,
  percentLabel,
  round2,
  slotX,
  ticks,
  valueY,
} from './scale'

/**
 * La carrera contra el objetivo: lo vendido acumulado en el mes contra el
 * ritmo que pide el objetivo. Dos líneas, un solo eje.
 *
 * - **Vendido** corta en el último día cargado: el futuro no se dibuja, y un
 *   día sin cargar en el medio parte la línea (no se une por arriba del hueco).
 * - **Objetivo** va más tenue (gris): es la referencia, no el dato.
 * - Una sola etiqueta sobre el dibujo: el punto de hoy (o el último cargado si
 *   se mira un mes pasado). Va del lado contrario a la línea del objetivo para
 *   no quedar encima.
 * - El SVG se estira al ancho de la tarjeta (`preserveAspectRatio="none"`) y
 *   los trazos no se deforman (`non-scaling-stroke`). Los puntos y las
 *   etiquetas son HTML encima, en los mismos porcentajes: un círculo dentro de
 *   un SVG estirado saldría ovalado.
 */

export type TargetRacePoint = {
  /** `yyyy-MM-dd`. */
  date: string
  /** Vendido acumulado hasta ese día; `null` si ese día no está cargado o todavía no llegó. */
  soldAccumCents: number | null
  targetAccumCents: number | null
}

export type TargetRaceProps = {
  points: readonly TargetRacePoint[]
  /** El índice de hoy en `points`; `null` o fuera de rango si se mira otro mes. */
  todayIndex?: number | null
  soldLabel?: string
  targetLabel?: string
  showLegend?: boolean
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

function amount(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
}

/** «$ 120.000 arriba» / «$ 80.000 abajo»: la brecha con signo en palabras. */
function gapWords(sold: number, target: number): string {
  return sold >= target
    ? `${formatCentsShort(sold - target)} arriba`
    : `${formatCentsShort(target - sold)} abajo`
}

function gapPercent(sold: number, target: number): string {
  const diff = Math.abs(sold - target)
  return percentLabel(Math.round(pct(diff, target)), diff > 0)
}

export function TargetRace({
  points,
  todayIndex = null,
  soldLabel = 'Vendido',
  targetLabel = 'Objetivo',
  showLegend = true,
  emptyHint,
  ariaLabel,
  className,
}: TargetRaceProps) {
  const n = points.length
  const sold = points.map((p) => amount(p.soldAccumCents))
  const target = points.map((p) => amount(p.targetAccumCents))
  const lastSold = sold.reduce<number>((last, v, i) => (v !== null ? i : last), -1)
  const peakSold = Math.max(0, ...sold.map((v) => v ?? 0))
  if (lastSold < 0 || peakSold <= 0) {
    return (
      <ChartEmpty
        silhouette="line"
        title="Todavía no hay ventas cargadas para comparar"
        hint={emptyHint}
        className={className}
      />
    )
  }

  const today =
    typeof todayIndex === 'number' &&
    Number.isInteger(todayIndex) &&
    todayIndex >= 0 &&
    todayIndex < n
      ? todayIndex
      : -1
  // El punto que se rotula: hoy si ya tiene dato; si no, el último cargado.
  const focus = today >= 0 && sold[today] !== null ? today : lastSold
  const focusIsToday = focus === today
  const focusPoint = points[focus]
  const focusSold = sold[focus] ?? 0
  const focusTarget = target[focus] ?? null

  const peak = Math.max(peakSold, ...target.map((v) => v ?? 0))
  const axis = ticks(peak, 3)
  const top = axis[axis.length - 1] ?? peak
  const at = (value: number | null, i: number): ChartPoint | null =>
    value === null ? null : { x: slotX(i, n), y: valueY(value, 0, top) }
  const soldPoints = sold.map(at)
  const targetPoints = target.map(at)
  const soldLine = linePaths(soldPoints)
  const targetLine = linePaths(targetPoints)

  const when = focusIsToday ? 'hasta hoy' : `al ${dayShort(focusPoint?.date ?? '')}`
  const lastTarget = target.reduce<number>((last, v, i) => (v !== null ? i : last), -1)
  const periodTarget = lastTarget >= 0 ? (target[lastTarget] ?? null) : null

  const summary =
    ariaLabel ??
    [
      `${soldLabel} acumulado ${when}: ${formatCentsShort(focusSold)}.`,
      focusTarget !== null && focusTarget > 0
        ? `${targetLabel} a esa fecha: ${formatCentsShort(focusTarget)}. Vas ${gapWords(focusSold, focusTarget)} (${gapPercent(focusSold, focusTarget)}).`
        : '',
    ]
      .filter(Boolean)
      .join(' ')

  const xTicks = dayTicks(
    points.map((p) => ({ date: p.date, label: dayShort(p.date) })),
    today,
  )

  const rows: LegendRow[] = [
    {
      key: 'vendido',
      label: `${soldLabel} ${when}`,
      value: formatCentsShort(focusSold),
      glyph: 'line',
      swatch: 'bg-adm-s1',
    },
  ]
  if (focusTarget !== null && focusTarget > 0) {
    rows.push({
      key: 'objetivo',
      label: `${targetLabel} a esa fecha`,
      value: formatCentsShort(focusTarget),
      sub: `Vas ${gapWords(focusSold, focusTarget)} (${gapPercent(focusSold, focusTarget)})`,
      glyph: 'line',
      swatch: 'bg-adm-neutral',
    })
  }
  if (periodTarget !== null && periodTarget > 0 && lastTarget !== focus) {
    rows.push({
      key: 'objetivo-total',
      label: `${targetLabel} de todo el período`,
      value: formatCentsShort(periodTarget),
      glyph: 'none',
      muted: true,
    })
  }

  // Dónde va la etiqueta del punto: arriba, salvo que la línea del objetivo pase
  // justo por ahí (vas abajo por poco). En ese caso baja y se corre a la
  // derecha, que es el único lado siempre libre: lo vendido viene subiendo
  // desde abajo a la izquierda.
  const focusXY = soldPoints[focus]
  const targetXY = targetPoints[focus]
  const targetAbove = focusXY && targetXY ? focusXY.y - targetXY.y : 0
  const labelBelow = targetAbove > 0 && targetAbove < 18
  let labelStyle: CSSProperties = {}
  if (focusXY) {
    if (labelBelow) {
      labelStyle =
        focusXY.x <= 70
          ? { left: `calc(${focusXY.x}% + 9px)`, top: `calc(${focusXY.y}% + 3px)` }
          : { right: `${round2(100 - focusXY.x)}%`, top: `calc(${focusXY.y}% + 9px)` }
    } else {
      const side: CSSProperties =
        focusXY.x < 25
          ? { left: `${focusXY.x}%` }
          : focusXY.x > 75
            ? { right: `${round2(100 - focusXY.x)}%` }
            : { left: `${focusXY.x}%`, transform: 'translateX(-50%)' }
      labelStyle = { ...side, bottom: `calc(${round2(100 - focusXY.y)}% + 9px)` }
    }
  }

  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      <ChartTip>
        <Plot
          ticks={axis.map((t) => ({
            pos: valueY(t, 0, top),
            label: compactCents(t),
            strong: t === 0,
          }))}
          xAxis={<XTicks items={xTicks} />}
        >
          <svg
            role="img"
            aria-label={summary}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {targetLine.paths.map((d) => (
              <path
                key={`objetivo-${d}`}
                d={d}
                fill="none"
                stroke="var(--adm-neutral)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {soldLine.paths.map((d) => (
              <path
                key={`vendido-${d}`}
                d={d}
                fill="none"
                stroke="var(--adm-s1)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {/* Un día cargado entre dos sin cargar: no hay línea que trazar, va el punto. */}
          {targetLine.lonely.map((p) => (
            <span
              key={`objetivo-${p.x}-${p.y}`}
              aria-hidden
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-adm-neutral"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            />
          ))}
          {soldLine.lonely.map((p) => (
            <span
              key={`${p.x}-${p.y}`}
              aria-hidden
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-adm-s1"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            />
          ))}

          <div className="absolute inset-0 flex">
            {points.map((p, i) => {
              const s = sold[i] ?? null
              const t = target[i] ?? null
              if (s === null && t === null) {
                return <span key={p.date} aria-hidden className="min-w-0 flex-1" />
              }
              const title = `${dayTitle(p.date)}${i === today ? ' (hoy)' : ''}`
              const soldText = s !== null ? `${soldLabel} ${formatCents(s)}` : 'Sin cargar'
              const targetText = t !== null ? `${targetLabel} ${formatCents(t)}` : ''
              const gapText = s !== null && t !== null && t > 0 ? `Vas ${gapWords(s, t)}` : ''
              const y = s !== null ? valueY(s, 0, top) : null
              return (
                <ChartMark
                  key={p.date}
                  label={[`${title}: ${soldText.toLowerCase()}`, targetText.toLowerCase(), gapText]
                    .filter(Boolean)
                    .join(', ')}
                  tipTitle={title}
                  tipValue={soldText}
                  tipSub={[targetText, gapText].filter(Boolean).join('\n') || undefined}
                  className="h-full min-w-0 flex-1 rounded-[3px]"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/25 opacity-0 group-data-[tip-active]/mark:opacity-100"
                  />
                  {y !== null ? (
                    <span
                      data-tip-anchor
                      aria-hidden
                      className="absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-adm-s1 opacity-0 shadow-[0_0_0_2px_var(--card)] group-data-[tip-active]/mark:opacity-100"
                      style={{ top: `${y}%` }}
                    />
                  ) : null}
                </ChartMark>
              )
            })}
          </div>

          {focusXY ? (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-adm-s1 shadow-[0_0_0_2px_var(--card)]"
                style={{ left: `${focusXY.x}%`, top: `${focusXY.y}%` }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute z-[2] rounded-sm bg-card/85 px-1 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap tabular-nums text-foreground"
                style={labelStyle}
              >
                {focusIsToday ? 'Hoy' : dayShort(focusPoint?.date ?? '')} ·{' '}
                {compactCents(focusSold)}
              </span>
            </>
          ) : null}
        </Plot>
      </ChartTip>

      {showLegend ? (
        <ChartLegend
          caption={`${soldLabel} acumulado contra ${targetLabel.toLowerCase()}`}
          rows={rows}
        />
      ) : null}
    </div>
  )
}

/** Los mismos días en filas, para «Ver como tabla». */
export function TargetRaceTable({
  points,
  soldLabel = 'Vendido',
  targetLabel = 'Objetivo',
  caption,
}: {
  points: readonly TargetRacePoint[]
  soldLabel?: string
  targetLabel?: string
  caption?: string
}) {
  return (
    <ChartTable
      caption={caption ?? `${soldLabel} acumulado contra ${targetLabel.toLowerCase()}, por día`}
      columns={[
        { key: 'dia', label: 'Día' },
        { key: 'vendido', label: `${soldLabel} acumulado`, align: 'right' },
        { key: 'objetivo', label: `${targetLabel} acumulado`, align: 'right' },
      ]}
      rows={points.map((p) => {
        const s = amount(p.soldAccumCents)
        const t = amount(p.targetAccumCents)
        return {
          key: p.date,
          cells: [
            dayTitle(p.date),
            s !== null ? formatCents(s) : '—',
            t !== null ? formatCents(t) : '—',
          ],
          muted: s === null,
        }
      })}
    />
  )
}
