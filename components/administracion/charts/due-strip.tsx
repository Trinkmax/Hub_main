import type { ReactNode } from 'react'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  ChartEmpty,
  ChartLegend,
  ChartMark,
  ChartTable,
  dayTicks,
  dayTitle,
  type LegendRow,
  Plot,
  XTicks,
} from './chart-parts'
import { ChartTip } from './chart-tip'
import { compactCents, pct, ticks, valueY } from './scale'

/** Pesos sin «,00»: los centavos solo cuando los hay de verdad (globito y tabla, no un ticket). */
function plainMoney(cents: number): string {
  return cents % 100 === 0 ? formatCentsShort(cents) : formatCents(cents)
}

/**
 * Lo que vence en los próximos días (14 por defecto): una columna por día con
 * la plata que hay que tener ese día.
 *
 * - Un día sin vencimientos no dibuja nada (ni una barra en cero ni un foco de
 *   teclado): el hueco ES el dato.
 * - Lo ya vencido va en rojo (`destructive`, que es un color de estado) y
 *   SIEMPRE con la palabra «vencido» en el globito, la leyenda y la tabla.
 * - Una sola etiqueta sobre el dibujo: el día más cargado.
 */

export type DueStripDay = {
  /** `yyyy-MM-dd`. */
  date: string
  /** Para el globito y la tabla: «Lun 12/10». */
  label: string
  cents: number
  /** Cuántos vencimientos hay ese día. */
  count: number
  overdue?: boolean
  /** A dónde lleva tocar el día (la lista filtrada por ese vencimiento). */
  href?: string
}

export type DueStripProps = {
  days: readonly DueStripDay[]
  /** El índice de hoy en `days`, para marcarlo en el eje. */
  todayIndex?: number | null
  /** Cómo se llama cada cosa que vence: `['pago', 'pagos']`. */
  unit?: readonly [singular: string, plural: string]
  showLegend?: boolean
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

const DEFAULT_UNIT = ['vencimiento', 'vencimientos'] as const

function countText(count: number, unit: readonly [string, string]): string {
  return count === 1 ? `1 ${unit[0]}` : `${count} ${unit[1]}`
}

function clean(day: DueStripDay) {
  return {
    day,
    cents: Number.isFinite(day.cents) ? Math.max(0, day.cents) : 0,
    count: Number.isFinite(day.count) ? Math.max(0, Math.round(day.count)) : 0,
    title: dayTitle(day.date, day.label),
  }
}

export function DueStrip({
  days,
  todayIndex = null,
  unit = DEFAULT_UNIT,
  showLegend = true,
  emptyHint,
  ariaLabel,
  className,
}: DueStripProps) {
  const slots = days.map(clean)
  const total = slots.reduce((sum, s) => sum + s.cents, 0)
  if (total <= 0) {
    return (
      <ChartEmpty
        silhouette="bars"
        title="No hay vencimientos cargados para estos días"
        hint={emptyHint}
        className={className}
      />
    )
  }

  const n = slots.length
  const peak = Math.max(...slots.map((s) => s.cents))
  const axis = ticks(peak, 2)
  const top = axis[axis.length - 1] ?? peak
  const maxIndex = slots.reduce((best, s, i) => (s.cents > (slots[best]?.cents ?? 0) ? i : best), 0)
  const busiest = slots[maxIndex]
  const today =
    typeof todayIndex === 'number' &&
    Number.isInteger(todayIndex) &&
    todayIndex >= 0 &&
    todayIndex < n
      ? todayIndex
      : -1

  const overdue = slots.filter((s) => s.day.overdue && s.cents > 0)
  const upcoming = slots.filter((s) => !s.day.overdue && s.cents > 0)
  const overdueCents = overdue.reduce((sum, s) => sum + s.cents, 0)
  const upcomingCents = upcoming.reduce((sum, s) => sum + s.cents, 0)
  const sumCount = (list: typeof slots) => list.reduce((sum, s) => sum + s.count, 0)

  const summary =
    ariaLabel ??
    [
      upcomingCents > 0
        ? `En estos ${n} días vencen ${formatCentsShort(upcomingCents)} (${countText(sumCount(upcoming), unit)}).`
        : '',
      overdueCents > 0
        ? `Ya vencido: ${formatCentsShort(overdueCents)} (${countText(sumCount(overdue), unit)}).`
        : '',
      busiest ? `El día más cargado: ${busiest.title}, ${formatCentsShort(busiest.cents)}.` : '',
    ]
      .filter(Boolean)
      .join(' ')

  const xTicks = dayTicks(
    slots.map((s) => s.day),
    today,
  )

  const rows: LegendRow[] = []
  if (upcomingCents > 0) {
    rows.push({
      key: 'vence',
      label: 'Vence en estos días',
      sub: countText(sumCount(upcoming), unit),
      value: formatCentsShort(upcomingCents),
      swatch: 'bg-adm-s1',
    })
  }
  if (overdueCents > 0) {
    rows.push({
      key: 'vencido',
      label: 'Ya vencido',
      sub: countText(sumCount(overdue), unit),
      value: formatCentsShort(overdueCents),
      swatch: 'bg-destructive',
    })
  }

  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      <ChartTip>
        <Plot
          heightClass="h-28 sm:h-32"
          ticks={axis.map((t) => ({
            pos: valueY(t, 0, top),
            label: compactCents(t),
            strong: t === 0,
          }))}
          xAxis={<XTicks items={xTicks} />}
        >
          <div role="img" aria-label={summary} className="absolute inset-0" />
          <div className="absolute inset-0 flex">
            {slots.map((s, i) => {
              if (s.cents <= 0) {
                return (
                  <span
                    key={s.day.date}
                    aria-hidden
                    className={cn('min-w-0 flex-1', i === today && 'bg-foreground/[0.04]')}
                  />
                )
              }
              const height = pct(s.cents, top)
              const title = `${s.title}${i === today ? ' (hoy)' : ''}`
              const state = s.day.overdue ? 'Vencido' : ''
              // Contra los bordes la etiqueta se apoya en su casillero para no salirse
              // del dibujo; en el medio va centrada sobre la barra.
              const center = (i + 0.5) / n
              const edge =
                center < 0.12 ? 'left-0' : center > 0.88 ? 'right-0' : 'left-1/2 -translate-x-1/2'
              return (
                <ChartMark
                  key={s.day.date}
                  href={s.day.href}
                  label={`${title}: ${formatCentsShort(s.cents)}, ${countText(s.count, unit)}${state ? `, ${state.toLowerCase()}` : ''}`}
                  tipTitle={title}
                  tipValue={formatCentsShort(s.cents)}
                  tipSub={[countText(s.count, unit), state].filter(Boolean).join('\n')}
                  className={cn(
                    'h-full min-w-0 flex-1 rounded-[3px] data-[tip-active]:bg-foreground/[0.07]',
                    i === today && 'bg-foreground/[0.04]',
                  )}
                >
                  <span
                    data-tip-anchor
                    aria-hidden
                    className={cn(
                      'absolute bottom-0 left-1/2 min-h-[2px] w-[calc(100%-2px)] max-w-6 min-w-[2px] -translate-x-1/2 rounded-t-[4px]',
                      s.day.overdue ? 'bg-destructive' : 'bg-adm-s1',
                    )}
                    style={{ height: `${height}%` }}
                  />
                  {i === maxIndex ? (
                    <span
                      aria-hidden
                      className={cn(
                        'pointer-events-none absolute z-[2] mb-1 text-[10px] leading-none font-medium whitespace-nowrap tabular-nums text-foreground',
                        edge,
                      )}
                      style={{ bottom: `${height}%` }}
                    >
                      {compactCents(s.cents)}
                    </span>
                  ) : null}
                </ChartMark>
              )
            })}
          </div>
        </Plot>
      </ChartTip>

      {showLegend ? <ChartLegend caption="Lo que vence, por día" rows={rows} /> : null}
    </div>
  )
}

/** Los mismos días en filas (solo los que tienen algo), para «Ver como tabla». */
export function DueStripTable({
  days,
  unit = DEFAULT_UNIT,
  caption,
}: {
  days: readonly DueStripDay[]
  unit?: readonly [singular: string, plural: string]
  caption?: string
}) {
  const slots = days.map(clean).filter((s) => s.cents > 0)
  const total = slots.reduce((sum, s) => sum + s.cents, 0)
  const count = slots.reduce((sum, s) => sum + s.count, 0)
  return (
    <ChartTable
      caption={caption ?? 'Lo que vence, por día'}
      columns={[
        { key: 'dia', label: 'Día' },
        { key: 'cuantos', label: 'Cuántos', align: 'right' },
        { key: 'importe', label: 'Importe', align: 'right' },
      ]}
      rows={slots.map((s) => ({
        key: s.day.date,
        cells: [
          s.day.overdue ? `${s.title} · vencido` : s.title,
          countText(s.count, unit),
          plainMoney(s.cents),
        ],
      }))}
      foot={['Total', countText(count, unit), plainMoney(total)]}
    />
  )
}
