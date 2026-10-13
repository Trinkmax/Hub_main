import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { isRealIsoDay, WEEKDAY_NAMES_MIN, weekdayOf } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ChartEmpty, ChartLegend, ChartMark, dayTitle, type LegendRow } from './chart-parts'
import { ChartTip } from './chart-tip'

/**
 * El almanaque de cierres del mes: de un vistazo, qué días están cargados y
 * cuáles faltan.
 *
 * - **Cargado** = relleno con tilde. **Falta** = contorno punteado ámbar con la
 *   palabra «falta» (y, con `href`, se toca para cargarlo). **Hoy** = anillo.
 *   El futuro y lo anterior al arranque van apagados y no se enfocan.
 * - En una tarjeta angosta (el celular, media columna) es un almanaque de
 *   lunes a domingo con casilleros de 44 px de alto; desde 56rem de tarjeta
 *   entra el mes en una sola tira, con el día de la semana arriba de cada
 *   número.
 * - A diferencia de los demás, este dibujo SIEMPRE se muestra aunque no haya
 *   ningún día cargado: un mes entero de «falta» es justo lo que hay que ver.
 */

export type CloseStripDay = {
  /** `yyyy-MM-dd`. */
  date: string
  dayNumber: number
  /** «lu», «ma»…; si llega un número se ignora y sale de `date`. */
  weekday: string | number
  /** `before`: anterior al primer día que se usa el sistema (no «falta»). */
  state: 'loaded' | 'missing' | 'today' | 'future' | 'before'
  /** Lo vendido ese día, si está cargado. */
  cents?: number | null
  href?: string
  /** Para ponerle el anillo de «hoy» a un día que ya está cargado. */
  isToday?: boolean
}

export type CloseStripProps = {
  days: readonly CloseStripDay[]
  showLegend?: boolean
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

/** Lunes primero: el bar piensa la semana de lunes a domingo. */
const WEEK_HEAD = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'] as const
const COL_START = [
  'col-start-1',
  'col-start-2',
  'col-start-3',
  'col-start-4',
  'col-start-5',
  'col-start-6',
  'col-start-7',
] as const

function weekdayText(day: CloseStripDay): string {
  if (typeof day.weekday === 'string' && day.weekday.trim()) return day.weekday
  return isRealIsoDay(day.date) ? (WEEKDAY_NAMES_MIN[weekdayOf(day.date)] ?? '') : ''
}

function daysText(count: number): string {
  return count === 1 ? '1 día' : `${count} días`
}

/** Cuántos días que faltan se nombran en el resumen para lectores de pantalla. */
const MAX_NAMED = 6

const CELL =
  'flex h-11 min-w-6 flex-col items-center justify-center gap-0.5 rounded-lg @min-[56rem]:h-14 @min-[56rem]:flex-1'

export function CloseStrip({
  days,
  showLegend = true,
  emptyHint,
  ariaLabel,
  className,
}: CloseStripProps) {
  if (days.length === 0) {
    return (
      <ChartEmpty
        silhouette="strip"
        title="Todavía no hay días para mostrar"
        hint={emptyHint}
        className={className}
      />
    )
  }

  const loaded = days.filter((d) => d.state === 'loaded')
  const missing = days.filter((d) => d.state === 'missing')
  const openToday = days.find((d) => d.state === 'today')
  const soldCents = loaded.reduce(
    (sum, d) => sum + (typeof d.cents === 'number' && Number.isFinite(d.cents) ? d.cents : 0),
    0,
  )
  const first = days[0]
  const startColumn =
    first && isRealIsoDay(first.date) ? COL_START[(weekdayOf(first.date) + 6) % 7] : undefined

  const summary =
    ariaLabel ??
    [
      loaded.length > 0
        ? `${daysText(loaded.length)} ${loaded.length === 1 ? 'cargado' : 'cargados'}.`
        : 'Ningún día cargado todavía.',
      missing.length > 0
        ? `Falta cargar ${daysText(missing.length)}: ${missing
            .slice(-MAX_NAMED)
            .map((d) => dayTitle(d.date, String(d.dayNumber)))
            .join(', ')}${missing.length > MAX_NAMED ? ' y otros anteriores' : ''}.`
        : '',
      openToday ? 'Hoy todavía está sin cargar.' : '',
    ]
      .filter(Boolean)
      .join(' ')

  const rows: LegendRow[] = [
    {
      key: 'cargados',
      label: 'Cargados',
      sub: soldCents > 0 ? `${formatCentsShort(soldCents)} en total` : undefined,
      value: daysText(loaded.length),
      swatch: 'bg-adm-s1',
      muted: loaded.length === 0,
    },
  ]
  if (missing.length > 0) {
    rows.push({
      key: 'falta',
      label: 'Falta cargar',
      value: daysText(missing.length),
      glyph: 'dashed',
    })
  }

  return (
    <div className={cn('@container min-w-0 space-y-3', className)}>
      <p className="sr-only">{summary}</p>
      <ChartTip scrub={false}>
        <div className="grid grid-cols-7 gap-1 @min-[56rem]:flex">
          {startColumn
            ? WEEK_HEAD.map((w) => (
                <span
                  key={w}
                  aria-hidden
                  className="pb-0.5 text-center text-[10px] leading-none text-muted-foreground @min-[56rem]:hidden"
                >
                  {w}
                </span>
              ))
            : null}
          {days.map((d, i) => {
            const weekday = (
              <span className="hidden text-[9px] leading-none opacity-80 @min-[56rem]:block">
                {weekdayText(d)}
              </span>
            )
            const number = (
              <span className="text-xs leading-none font-medium tabular-nums">{d.dayNumber}</span>
            )
            const place = i === 0 ? startColumn : undefined
            const title = dayTitle(d.date, String(d.dayNumber))

            if (d.state === 'future' || d.state === 'before') {
              return (
                <span
                  key={d.date}
                  aria-hidden
                  className={cn(
                    CELL,
                    place,
                    '@min-[56rem]:col-start-auto',
                    d.state === 'future'
                      ? 'border border-border/50 text-muted-foreground'
                      : 'text-muted-foreground/50',
                  )}
                >
                  {weekday}
                  {number}
                  <span className="h-3" />
                </span>
              )
            }

            if (d.state === 'loaded') {
              const hasCents = typeof d.cents === 'number' && Number.isFinite(d.cents)
              return (
                <ChartMark
                  key={d.date}
                  href={d.href}
                  label={`${title}${d.isToday ? ' (hoy)' : ''}: cargado${hasCents ? `, ${formatCents(d.cents)}` : ''}`}
                  tipTitle={`${title}${d.isToday ? ' (hoy)' : ''}`}
                  tipValue={hasCents ? formatCents(d.cents) : 'Cargado'}
                  tipSub={hasCents ? 'Cargado' : undefined}
                  className={cn(
                    CELL,
                    place,
                    '@min-[56rem]:col-start-auto',
                    'bg-adm-s1 text-adm-hero-fg data-[tip-active]:brightness-110',
                    d.isToday && 'ring-2 ring-foreground ring-offset-2 ring-offset-card',
                  )}
                >
                  {weekday}
                  {number}
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                </ChartMark>
              )
            }

            const isMissing = d.state === 'missing'
            return (
              <ChartMark
                key={d.date}
                href={d.href}
                label={
                  isMissing
                    ? `${title}: falta cargar${d.href ? '. Abre la carga de ese día' : ''}`
                    : `${title} (hoy): todavía sin cargar${d.href ? '. Abre la carga de hoy' : ''}`
                }
                tipTitle={isMissing ? title : `${title} (hoy)`}
                tipValue={isMissing ? 'Falta cargar' : 'Todavía sin cargar'}
                tipSub={d.href ? 'Tocá para cargarlo' : undefined}
                className={cn(
                  CELL,
                  place,
                  '@min-[56rem]:col-start-auto',
                  'transition-[background-color] duration-(--duration-fast) motion-reduce:transition-none',
                  isMissing
                    ? 'border border-dashed border-warning bg-warning/10 data-[tip-active]:bg-warning/20'
                    : 'ring-2 ring-foreground/80 ring-inset data-[tip-active]:bg-secondary/60',
                )}
              >
                {weekday}
                {number}
                <span
                  className={cn(
                    'text-[9px] leading-none font-medium',
                    isMissing ? 'text-warning-text' : 'text-muted-foreground',
                  )}
                >
                  {isMissing ? 'falta' : 'hoy'}
                </span>
              </ChartMark>
            )
          })}
        </div>
      </ChartTip>

      {showLegend ? <ChartLegend caption="Días cargados y días que faltan" rows={rows} /> : null}
    </div>
  )
}
