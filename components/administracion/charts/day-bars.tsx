import Link from 'next/link'
import type { ReactNode } from 'react'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  ChartEmpty,
  ChartLegend,
  ChartMark,
  ChartTable,
  type ChartTableColumn,
  dayTicks,
  dayTitle,
  HATCH_MISSING,
  type LegendRow,
  Plot,
  XTicks,
} from './chart-parts'
import { ChartTip } from './chart-tip'
import { compactCents, pct, percentLabel, ticks, valueY } from './scale'

/**
 * Una columna por día: lo vendido (o lo que sea) contra el objetivo de ese día.
 *
 * - **Un día sin cargar no es un día en cero.** Se dibuja como una columna
 *   hueca, punteada y rayada en ámbar, hasta la altura del objetivo si lo hay;
 *   la leyenda dice «Falta cargar» con la cantidad y abajo van los días que
 *   faltan como píldoras para tocar. Hasta 8 días, además, cada hueco lleva la
 *   palabra «falta» debajo.
 * - **El objetivo** es una marca fina horizontal sobre cada día, en la misma
 *   escala (un solo eje).
 * - **Etiquetas selectivas**: el día más alto y hoy. El resto se lee en el eje,
 *   en el globito y en la tabla (`DayBarsTable`).
 * - **Todo el alto del casillero es la marca**: en un mes de 31 días la barra
 *   mide 5 px, pero se toca la columna entera (y `ChartTip` toma la más
 *   cercana).
 * - El futuro no se dibuja: solo queda la marca del objetivo.
 */

export type DayBarsDay = {
  /** `yyyy-MM-dd`. */
  date: string
  /** Para el globito y la tabla: «Lun 12/10». */
  label: string
  /** `null` = no hay dato. Nunca se dibuja como cero. */
  cents: number | null
  targetCents?: number | null
  state: 'ok' | 'missing' | 'today' | 'future'
  /** A dónde lleva tocar el día (cargar el cierre que falta, ver el cargado). */
  href?: string
}

export type DayBarsProps = {
  days: readonly DayBarsDay[]
  /** Cómo se llama lo que mide la columna. */
  seriesLabel?: string
  targetLabel?: string
  /** Clase `bg-*` de las columnas. */
  swatch?: string
  showLegend?: boolean
  /**
   * Las píldoras «Falta cargar» de abajo. `false` cuando la pantalla ya lista
   * esos días al lado (la tira de cierres): los huecos del dibujo y el renglón
   * de la leyenda quedan igual.
   */
  missingPills?: boolean
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

type Kind = 'value' | 'missing' | 'open' | 'future'

type Slot = {
  day: DayBarsDay
  kind: Kind
  value: number | null
  target: number | null
  title: string
}

function toSlot(day: DayBarsDay): Slot {
  const target =
    typeof day.targetCents === 'number' && Number.isFinite(day.targetCents) && day.targetCents > 0
      ? day.targetCents
      : null
  const hasValue = typeof day.cents === 'number' && Number.isFinite(day.cents)
  const title = dayTitle(day.date, day.label)
  if (day.state === 'future') return { day, kind: 'future', value: null, target, title }
  if (day.state === 'missing' || (day.state === 'ok' && !hasValue)) {
    return { day, kind: 'missing', value: null, target, title }
  }
  if (!hasValue) return { day, kind: 'open', value: null, target, title }
  return { day, kind: 'value', value: Math.max(0, day.cents ?? 0), target, title }
}

function daysText(count: number): string {
  return count === 1 ? '1 día' : `${count} días`
}

/** Cuántas píldoras de «falta cargar» se muestran antes de resumir. */
const MAX_MISSING_PILLS = 6
/** Altura del hueco de un día sin cargar cuando no hay objetivo que la marque. */
const MISSING_STUB = 30

export function DayBars({
  days,
  seriesLabel = 'Vendido',
  targetLabel = 'Objetivo',
  swatch = 'bg-adm-s1',
  showLegend = true,
  missingPills = true,
  emptyHint,
  ariaLabel,
  className,
}: DayBarsProps) {
  const slots = days.map(toSlot)
  const loaded = slots.filter((s) => s.kind === 'value')
  const total = loaded.reduce((sum, s) => sum + (s.value ?? 0), 0)
  if (total <= 0) {
    return (
      <ChartEmpty
        silhouette="bars"
        title="Todavía no hay días cargados"
        hint={emptyHint}
        className={className}
      />
    )
  }

  const n = slots.length
  const peak = Math.max(...slots.map((s) => Math.max(s.value ?? 0, s.target ?? 0)))
  const axis = ticks(peak, 3)
  const top = axis[axis.length - 1] ?? peak
  const missing = slots.filter((s) => s.kind === 'missing')
  const todayIndex = slots.findIndex((s) => s.day.state === 'today')
  const maxIndex = slots.reduce(
    (best, s, i) => ((s.value ?? -1) > (slots[best]?.value ?? -1) ? i : best),
    0,
  )
  // Hoy lleva su etiqueta si tiene dato y no queda pegado al máximo.
  const labelToday =
    todayIndex >= 0 &&
    todayIndex !== maxIndex &&
    slots[todayIndex]?.kind === 'value' &&
    Math.abs(todayIndex - maxIndex) >= Math.max(2, Math.ceil(n * 0.25))
  const labelled = new Set(labelToday ? [maxIndex, todayIndex] : [maxIndex])

  const loadedTarget = loaded.reduce((sum, s) => sum + (s.target ?? 0), 0)
  const best = slots[maxIndex]
  const gap = total - loadedTarget
  const gapText =
    loadedTarget > 0
      ? gap >= 0
        ? `${percentLabel(Math.round(pct(gap, loadedTarget)), gap > 0)} arriba`
        : `${percentLabel(Math.round(pct(-gap, loadedTarget)), true)} abajo`
      : null

  const summary =
    ariaLabel ??
    [
      `${seriesLabel} ${formatCentsShort(total)} en ${daysText(loaded.length)} ${loaded.length === 1 ? 'cargado' : 'cargados'}.`,
      best ? `El día más alto: ${best.title}, ${formatCentsShort(best.value)}.` : '',
      loadedTarget > 0
        ? `${targetLabel} de esos días ${formatCentsShort(loadedTarget)}: ${gapText}.`
        : '',
      missing.length > 0 ? `Falta cargar ${daysText(missing.length)}.` : '',
    ]
      .filter(Boolean)
      .join(' ')

  const xTicks = dayTicks(
    slots.map((s) => s.day),
    todayIndex,
  )

  const rows: LegendRow[] = [
    {
      key: 'serie',
      label: seriesLabel,
      value: formatCentsShort(total),
      sub: `${daysText(loaded.length)} ${loaded.length === 1 ? 'cargado' : 'cargados'}`,
      swatch,
    },
  ]
  if (loadedTarget > 0) {
    rows.push({
      key: 'objetivo',
      label: `${targetLabel} de esos días`,
      value: formatCentsShort(loadedTarget),
      sub: gapText ? `Vas ${gapText}` : undefined,
      glyph: 'line',
      swatch: 'bg-foreground/60',
    })
  }
  if (missing.length > 0) {
    rows.push({
      key: 'falta',
      label: 'Falta cargar',
      value: daysText(missing.length),
      glyph: 'dashed',
    })
  }

  const pills = missing.slice(-MAX_MISSING_PILLS)
  const hiddenPills = missing.length - pills.length

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
          {/* La conclusión, para quien no ve el dibujo. Sin hijos: las columnas
              van en la capa de al lado, cada una enfocable. */}
          <div role="img" aria-label={summary} className="absolute inset-0" />
          <div className="absolute inset-0 flex">
            {slots.map((s, i) => {
              const key = s.day.date
              const targetTick =
                s.target !== null ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-px z-[1] h-0.5 -translate-y-1/2 bg-foreground/60 shadow-[0_0_0_1px_var(--card)]"
                    style={{ top: `${valueY(s.target, 0, top)}%` }}
                  />
                ) : null
              // El futuro sin objetivo no tiene nada que decir: ni marca ni foco.
              if (s.kind === 'future' && s.target === null) {
                return <span key={key} aria-hidden className="min-w-0 flex-1" />
              }
              const targetSub = s.target !== null ? `${targetLabel} ${formatCents(s.target)}` : ''
              const today = i === todayIndex
              const title = today ? `${s.title} (hoy)` : s.title

              let label = `${title}: ${targetSub || 'sin dato'}`
              let tipValue: string | undefined
              let tipSub: string | undefined = targetSub || undefined
              if (s.kind === 'value') {
                label = `${title}: ${formatCents(s.value)}${targetSub ? `, ${targetSub.toLowerCase()}` : ''}`
                tipValue = formatCents(s.value)
              } else if (s.kind === 'missing') {
                label = `${title}: falta cargar${s.day.href ? '. Abre la carga de ese día' : ''}`
                tipValue = 'Falta cargar'
                tipSub = [s.day.href ? 'Tocá para cargarlo' : '', targetSub]
                  .filter(Boolean)
                  .join('\n')
              } else if (s.kind === 'open') {
                label = `${title}: todavía sin cargar`
                tipValue = 'Todavía sin cargar'
              }

              const height = pct(s.value ?? 0, top)
              // Contra los bordes la etiqueta se apoya en su casillero para no salirse
              // del dibujo; en el medio va centrada sobre la barra.
              const center = (i + 0.5) / n
              const edge =
                center < 0.12 ? 'left-0' : center > 0.88 ? 'right-0' : 'left-1/2 -translate-x-1/2'
              return (
                <ChartMark
                  key={key}
                  href={s.day.href}
                  label={label}
                  tipTitle={title}
                  tipValue={tipValue}
                  tipSub={tipSub || undefined}
                  className={cn(
                    'h-full min-w-0 flex-1 rounded-[3px]',
                    today && 'bg-foreground/[0.04]',
                    'data-[tip-active]:bg-foreground/[0.07]',
                  )}
                >
                  {s.kind === 'value' ? (
                    <span
                      data-tip-anchor
                      aria-hidden
                      className={cn(
                        'absolute bottom-0 left-1/2 min-h-[2px] w-[calc(100%-2px)] max-w-6 min-w-[2px] -translate-x-1/2 rounded-t-[4px]',
                        swatch,
                      )}
                      style={{ height: `${height}%` }}
                    />
                  ) : null}
                  {s.kind === 'missing' ? (
                    <span
                      data-tip-anchor
                      aria-hidden
                      className="absolute bottom-0 left-1/2 w-[calc(100%-2px)] max-w-6 min-w-[3px] -translate-x-1/2 rounded-t-[4px] border border-b-0 border-dashed border-warning"
                      style={{
                        height: `${s.target !== null ? Math.max(12, pct(s.target, top)) : MISSING_STUB}%`,
                        ...HATCH_MISSING,
                      }}
                    />
                  ) : null}
                  {targetTick}
                  {s.kind === 'value' && labelled.has(i) ? (
                    <span
                      aria-hidden
                      className={cn(
                        'pointer-events-none absolute z-[2] mb-1 text-[10px] leading-none font-medium whitespace-nowrap tabular-nums text-foreground',
                        edge,
                      )}
                      style={{ bottom: `${height}%` }}
                    >
                      {compactCents(s.value ?? 0)}
                    </span>
                  ) : null}
                  {s.kind === 'missing' && n <= 8 ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] leading-none font-medium text-warning-text"
                    >
                      falta
                    </span>
                  ) : null}
                </ChartMark>
              )
            })}
          </div>
        </Plot>
      </ChartTip>

      {showLegend ? <ChartLegend caption={`${seriesLabel} por día`} rows={rows} /> : null}

      {missingPills && missing.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-muted-foreground">Falta cargar:</span>
          {hiddenPills > 0 ? (
            <span className="text-xs text-muted-foreground">
              {hiddenPills === 1 ? '1 día anterior y' : `${hiddenPills} días anteriores y`}
            </span>
          ) : null}
          {pills.map((s) =>
            s.day.href ? (
              <Link
                key={s.day.date}
                href={s.day.href}
                prefetch={false}
                className="inline-flex h-9 items-center rounded-full border border-dashed border-warning/80 bg-card px-3 text-xs font-medium whitespace-nowrap text-foreground transition-[background-color] duration-(--duration-fast) hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {s.title}
              </Link>
            ) : (
              <span
                key={s.day.date}
                className="inline-flex h-9 items-center rounded-full border border-dashed border-warning/80 px-3 text-xs font-medium whitespace-nowrap"
              >
                {s.title}
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Los mismos días en filas, para «Ver como tabla». */
export function DayBarsTable({
  days,
  seriesLabel = 'Vendido',
  targetLabel = 'Objetivo',
  caption,
}: {
  days: readonly DayBarsDay[]
  seriesLabel?: string
  targetLabel?: string
  caption?: string
}) {
  const slots = days.map(toSlot)
  const hasTarget = slots.some((s) => s.target !== null)
  const columns: ChartTableColumn[] = [
    { key: 'dia', label: 'Día' },
    { key: 'valor', label: seriesLabel, align: 'right' },
  ]
  if (hasTarget) columns.push({ key: 'objetivo', label: targetLabel, align: 'right' })
  const loaded = slots.filter((s) => s.kind === 'value')
  const total = loaded.reduce((sum, s) => sum + (s.value ?? 0), 0)
  const loadedTarget = loaded.reduce((sum, s) => sum + (s.target ?? 0), 0)
  return (
    <ChartTable
      caption={caption ?? `${seriesLabel} por día`}
      columns={columns}
      rows={slots.map((s) => {
        const value =
          s.kind === 'value' ? (
            formatCents(s.value)
          ) : s.kind === 'missing' ? (
            <span key="falta" className="text-warning-text">
              Falta cargar
            </span>
          ) : s.kind === 'open' ? (
            'Todavía sin cargar'
          ) : (
            '—'
          )
        const cells: ReactNode[] = [s.title, value]
        if (hasTarget) cells.push(s.target !== null ? formatCents(s.target) : '—')
        return { key: s.day.date, cells, muted: s.kind === 'future' }
      })}
      foot={
        hasTarget
          ? ['Días cargados', formatCents(total), formatCents(loadedTarget)]
          : ['Días cargados', formatCents(total)]
      }
    />
  )
}
