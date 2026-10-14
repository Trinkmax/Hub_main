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
 *   el sentido de la barra, las flechas ↑ ↓ del eje y las de la leyenda dicen
 *   cuál es cuál.
 * - 2 px de hueco en el cero entre la barra de arriba y la de abajo.
 * - El eje muestra los montos sin signo de los dos lados, con su flecha:
 *   «↓ $ 2 M», no «−$ 2 M».
 * - **Abajo se reserva solo lo que hace falta**: si salió mucho menos de lo que
 *   entró, el eje baja hasta el primer valor redondo que cubre lo que salió
 *   (no un paso entero del de arriba, que dejaba un tercio del dibujo vacío).
 *   La escala de pesos por píxel sigue siendo una sola.
 * - Las etiquetas de los períodos conviene que sean cortas (`shortLabel`:
 *   «14–20/9»); las que no entran se saltean.
 */

export type InOutBucket = {
  key: string
  /** Para el globito y la tabla: «14 al 20/09», «Octubre». */
  label: string
  /** Para el eje, donde cada carácter cuenta: «14–20/9», «Oct». Por defecto, `label`. */
  shortLabel?: string
  inCents: number
  /** En positivo: cuánto salió. */
  outCents: number
  /**
   * Qué decir en la tabla si en el período no entró ni salió nada («Sin
   * movimientos todavía»). Sin esto la fila muestra `$ 0`, que para un período
   * que todavía no se cargó es un cero que miente.
   */
  emptyText?: string
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

/** Cuánto lugar necesita una marca del eje para no pisarse con la de al lado (10 px de letra). */
const MIN_TICK_GAP = 9

/** Ancho aproximado, en px, de una etiqueta del eje de abajo (10 px de letra) con su aire. */
function tickWidth(label: string): number {
  return label.length * 5.6 + 6
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
    axis: b.shortLabel ?? b.label,
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
  // El paso lo marca el lado de arriba (o el de abajo, si no entró nada).
  const step = niceStep(peakUp > 0 ? peakUp : peakDown, 3)
  const upTop = peakUp > 0 ? Math.ceil(peakUp / step) * step : 0
  // Abajo: el primer valor redondo (1, 2 o 5) que cubre lo que salió, nunca más
  // que lo que daría el paso de arriba.
  const stepDown = Math.ceil(peakDown / step) * step
  const roundDown = niceStep(peakDown, 1)
  const downTop =
    peakDown <= 0
      ? 0
      : peakUp <= 0
        ? stepDown
        : Math.min(stepDown, Math.ceil(peakDown / roundDown) * roundDown)
  const span = upTop + downTop
  const zero = pct(upTop, span)

  const axis: PlotTick[] = []
  for (let v = upTop; v > 0; v -= step) {
    axis.push({ pos: pct(upTop - v, span), label: `↑ ${compactCents(v)}` })
  }
  axis.push({ pos: zero, label: compactCents(0), strong: true })
  if (downTop > 0) {
    // Las marcas intermedias de abajo siguen el paso de arriba; la última es el tope.
    for (let v = step; v < downTop; v += step) {
      if (pct(downTop - v, span) >= MIN_TICK_GAP) {
        axis.push({ pos: pct(upTop + v, span), label: `↓ ${compactCents(v)}` })
      }
    }
    // Si lo de abajo es tan poco que su marca se pisaría con el cero, queda la línea sin número.
    if (upTop === 0 || pct(downTop, span) >= MIN_TICK_GAP) {
      axis.push({ pos: 100, label: `↓ ${compactCents(downTop)}` })
    }
  }

  const net = totalIn - totalOut
  const summary =
    ariaLabel ??
    `${inLabel} ${formatCentsShort(totalIn)} y ${outLabel.toLowerCase()} ${formatCentsShort(totalOut)} en ${
      n === 1 ? 'un período' : `${n} períodos`
    }: diferencia ${signed(net)}.`

  // Las etiquetas son texto libre («14–20/9»): cuántas entran sale de su largo.
  // Tres tandas: las que entran siempre (un celular de 320 px, unos 190 px de
  // dibujo), las que se suman desde 20rem de tarjeta (un celular de 390, media
  // columna en la compu: unos 262 px) y las de una tarjeta ancha (desde 34rem).
  const widths = rows.map((r) => tickWidth(r.axis))
  const needed = widths.reduce((sum, w) => sum + w, 0)
  // Si no entran todas, cuántas: por el ancho promedio (van centradas en su casillero y
  // una larga puede pisar el aire de sus vecinos, que quedan sin etiqueta).
  const average = Math.max(1, needed / Math.max(1, n))
  const pick = (px: number) =>
    new Set(
      needed <= px
        ? rows.map((_, i) => i)
        : labelIndexes(n, Math.max(1, Math.floor(px / average)), [n - 1]),
    )
  const narrow = pick(190)
  const mid = pick(262)
  const wide = pick(470)
  const xTicks: XTick[] = rows.map((r, i) =>
    narrow.has(i)
      ? { key: r.key, bottom: r.axis }
      : mid.has(i)
        ? { key: r.key, bottom: r.axis, midOnly: true }
        : wide.has(i)
          ? { key: r.key, bottom: r.axis, wideOnly: true }
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
    <div className={cn('@container min-w-0 space-y-3', className)}>
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
                  tipValue={`↑ ${inLabel} ${formatCentsShort(r.up)}`}
                  tipSub={`↓ ${outLabel} ${formatCentsShort(r.down)}\nDiferencia ${signed(diff)}`}
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
        <ChartLegend
          caption={`${inLabel} y ${outLabel.toLowerCase()} del período`}
          rows={legend}
          // El tope de ancho es para tarjetas anchas: en media columna la leyenda
          // termina donde termina el dibujo.
          className="max-w-none @min-[48rem]:max-w-[34rem]"
        />
      ) : null}
    </div>
  )
}

/**
 * Los mismos períodos en filas, para «Ver como tabla». Sin centavos: es un
 * tablero. En una tarjeta ancha son cuatro columnas; en una angosta (el
 * celular, media columna en la compu) cada período ocupa dos renglones (su
 * nombre arriba y sus tres importes abajo, encolumnados), así la diferencia
 * nunca queda cortada contra el borde.
 */
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
  const rows = buckets.map((b) => {
    const up = magnitude(b.inCents)
    const down = magnitude(b.outCents)
    return {
      key: b.key,
      label: b.label,
      up,
      down,
      // Un período sin movimientos dice lo que es, si la pantalla lo sabe decir.
      empty: up <= 0 && down <= 0 && b.emptyText ? b.emptyText : null,
    }
  })
  const totalIn = rows.reduce((sum, r) => sum + r.up, 0)
  const totalOut = rows.reduce((sum, r) => sum + r.down, 0)
  const text = caption ?? `${inLabel} y ${outLabel.toLowerCase()} por período`
  const head =
    'px-1.5 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-3 last:pr-3'
  const cell = 'px-1.5 pb-2 text-right whitespace-nowrap tabular-nums first:pl-3 last:pr-3'

  return (
    <div className="@container min-w-0">
      {/* Angosta: el período es el encabezado de su grupo y abajo van sus importes. */}
      <div className="overflow-hidden rounded-lg border border-border/60 @min-[36rem]:hidden">
        <table className="w-full table-fixed text-[13px]">
          <caption className="sr-only">{text}</caption>
          <thead>
            <tr className="border-b border-border/60 bg-secondary/40">
              <th scope="col" className={head}>
                <span aria-hidden>↑ </span>
                {inLabel}
              </th>
              <th scope="col" className={head}>
                <span aria-hidden>↓ </span>
                {outLabel}
              </th>
              <th scope="col" className={head}>
                Diferencia
              </th>
            </tr>
          </thead>
          {rows.map((r) => (
            <tbody key={r.key} className="border-b border-border/60">
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={3}
                  className="px-3 pt-2 pb-0.5 text-left text-xs font-medium text-muted-foreground"
                >
                  {r.label}
                </th>
              </tr>
              {r.empty ? (
                <tr>
                  <td colSpan={3} className="px-3 pb-2 text-left text-muted-foreground">
                    {r.empty}
                  </td>
                </tr>
              ) : (
                <tr>
                  <td className={cell}>{formatCentsShort(r.up)}</td>
                  <td className={cell}>{formatCentsShort(r.down)}</td>
                  <td className={cn(cell, 'font-medium')}>{signed(r.up - r.down)}</td>
                </tr>
              )}
            </tbody>
          ))}
          <tfoot className="bg-secondary/30 font-semibold">
            <tr>
              <th scope="rowgroup" colSpan={3} className="px-3 pt-2 pb-0.5 text-left text-xs">
                Total
              </th>
            </tr>
            <tr>
              <td className={cell}>{formatCentsShort(totalIn)}</td>
              <td className={cell}>{formatCentsShort(totalOut)}</td>
              <td className={cell}>{signed(totalIn - totalOut)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ChartTable
        className="hidden @min-[36rem]:block"
        caption={text}
        columns={[
          { key: 'periodo', label: 'Período' },
          { key: 'entro', label: inLabel, align: 'right' },
          { key: 'salio', label: outLabel, align: 'right' },
          { key: 'diferencia', label: 'Diferencia', align: 'right' },
        ]}
        rows={rows.map((r) => ({
          key: r.key,
          cells: r.empty
            ? [
                r.label,
                <span key="vacio" className="text-muted-foreground">
                  {r.empty}
                </span>,
                '',
                '',
              ]
            : [r.label, formatCentsShort(r.up), formatCentsShort(r.down), signed(r.up - r.down)],
        }))}
        foot={[
          'Total',
          formatCentsShort(totalIn),
          formatCentsShort(totalOut),
          signed(totalIn - totalOut),
        ]}
      />
    </div>
  )
}
