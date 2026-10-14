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
  compactCents,
  niceDomain,
  round2,
  slotX,
  stepAreaPath,
  stepLinePath,
  valueY,
} from './scale'

/**
 * El saldo en el tiempo: cuánta plata hubo al cierre de cada día.
 *
 * - **Escalonada**, no en diagonal: el saldo de un día vale todo ese día y
 *   salta al siguiente. Una línea inclinada entre dos días diría que la plata
 *   «fue subiendo» y no es así.
 * - **Lavado al 10 %** hasta el cero (el área siempre arranca en cero; si la
 *   caja queda en descubierto, el cero se ve como una línea más marcada).
 * - **Dos etiquetas como mucho**: hoy (o el último día) y el punto más bajo, que
 *   es lo que se viene a mirar («¿llego a mitad de mes?»).
 * - Lo que viene después de hoy va atenuado y la leyenda lo llama «estimado».
 * - `compact`: sin ejes, sin etiquetas y sin marcas, para acompañar al número
 *   héroe. `tone="onHero"`: sobre el panel verde, en dorado.
 * - Un día con `href` se toca: lleva a lo que pasó ese día (los movimientos de
 *   la caja). Sin `href` el día solo se lee, como siempre. En `compact` no hay
 *   marcas, así que no hay nada que tocar.
 */

export type BalanceAreaPoint = {
  /** `yyyy-MM-dd`. */
  date: string
  cents: number
  /** A dónde lleva tocar ese día (sus movimientos). Opcional: sin esto, el día no es un link. */
  href?: string
}

export type BalanceAreaProps = {
  points: readonly BalanceAreaPoint[]
  /** El índice de hoy en `points`. Lo que sigue se dibuja como estimado. */
  todayIndex?: number | null
  /** Sin ejes ni etiquetas: la mini línea del héroe. */
  compact?: boolean
  tone?: 'default' | 'onHero'
  /** Cómo se llama lo que se mide: «Saldo», «Disponible», «Deuda de la tarjeta». */
  label?: string
  /** Por defecto: sí en la versión completa sobre tarjeta, no en el héroe. */
  showLegend?: boolean
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

const TONES = {
  default: { stroke: 'var(--adm-s1)', ring: 'var(--card)', wash: 0.1, swatch: 'bg-adm-s1' },
  onHero: { stroke: 'var(--adm-gold)', ring: 'var(--adm-hero)', wash: 0.16, swatch: 'bg-adm-gold' },
} as const

/** Dónde se apoya una etiqueta según el tercio del dibujo en que cae su punto. */
function sideOf(x: number): CSSProperties {
  if (x < 25) return { left: `${x}%` }
  if (x > 75) return { right: `${round2(100 - x)}%` }
  return { left: `${x}%`, transform: 'translateX(-50%)' }
}

export function BalanceArea({
  points,
  todayIndex = null,
  compact = false,
  tone = 'default',
  label = 'Saldo',
  showLegend,
  emptyHint,
  ariaLabel,
  className,
}: BalanceAreaProps) {
  const n = points.length
  const values = points.map((p) => (Number.isFinite(p.cents) ? p.cents : 0))
  if (n === 0 || values.every((v) => v === 0)) {
    // En el héroe no hay lugar para un cartel: sin datos, la mini línea no va.
    if (compact) return null
    return (
      <ChartEmpty
        silhouette="area"
        title="Todavía no hay movimientos para dibujar"
        hint={emptyHint}
        className={className}
      />
    )
  }

  const colors = TONES[tone]
  const onHero = tone === 'onHero'
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const domain = niceDomain(lowest, highest, 3)
  const ys = values.map((v) => valueY(v, domain.min, domain.max))
  const zeroY = valueY(0, domain.min, domain.max)

  const today =
    typeof todayIndex === 'number' &&
    Number.isInteger(todayIndex) &&
    todayIndex >= 0 &&
    todayIndex < n
      ? todayIndex
      : -1
  const focus = today >= 0 ? today : n - 1
  const hasFuture = today >= 0 && today < n - 1
  const focusValue = values[focus] ?? 0
  const focusX = slotX(focus, n)
  const focusY = ys[focus] ?? zeroY
  const lowIndex = values.indexOf(lowest)
  const highIndex = values.indexOf(highest)
  const when = today >= 0 ? 'hoy' : `al ${dayShort(points[focus]?.date ?? '')}`

  const summary =
    ariaLabel ??
    [
      `${label} ${when}: ${formatCentsShort(focusValue)}.`,
      n > 1
        ? `Lo más bajo del período: ${formatCentsShort(lowest)} (${dayTitle(points[lowIndex]?.date ?? '')}); lo más alto: ${formatCentsShort(highest)} (${dayTitle(points[highIndex]?.date ?? '')}).`
        : '',
      hasFuture ? 'Lo que sigue a hoy es estimado.' : '',
    ]
      .filter(Boolean)
      .join(' ')

  const area = stepAreaPath(ys, zeroY)
  const line = stepLinePath(ys)
  const past = hasFuture ? stepLinePath(ys, 0, today + 1) : null

  const drawing = (
    <svg
      role="img"
      aria-label={summary}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full overflow-visible"
    >
      {area ? <path d={area} fill={colors.stroke} fillOpacity={colors.wash} /> : null}
      {line ? (
        <path
          d={line}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          // Con futuro, la línea entera va atenuada y lo ya pasado se repasa encima.
          strokeOpacity={past ? 0.4 : 1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {past ? (
        <path
          d={past}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )

  const focusDot = (
    <span
      aria-hidden
      className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        left: `${focusX}%`,
        top: `${focusY}%`,
        backgroundColor: colors.stroke,
        boxShadow: `0 0 0 2px ${colors.ring}`,
      }}
    />
  )

  if (compact) {
    return (
      <div className={cn('relative h-14 w-full min-w-0', className)}>
        {drawing}
        {focusDot}
      </div>
    )
  }

  const xTicks = dayTicks(
    points.map((p) => ({ date: p.date, label: dayShort(p.date) })),
    today,
  )

  // La etiqueta de hoy va arriba del punto, salvo que por ese lado el saldo
  // venga de más alto (la línea pasaría por encima del texto): ahí baja al
  // lavado. Se miran los días que tapa la etiqueta según de qué lado se apoya.
  const reach = Math.max(1, Math.ceil(n * 0.25))
  const half = Math.ceil(reach / 2)
  const nearFrom = focusX > 75 ? focus - reach : focusX < 25 ? focus : focus - half
  const nearTo = focusX > 75 ? focus : focusX < 25 ? focus + reach : focus + half
  const highestNear = Math.min(...ys.slice(Math.max(0, nearFrom), Math.min(n, nearTo + 1)))
  const focusBelow = focusY - highestNear > 8 && focusY < 84

  // El punto más bajo se rotula si dice algo distinto de «hoy» y no queda encima.
  const lowX = slotX(lowIndex, n)
  const lowY = ys[lowIndex] ?? zeroY
  const farAcross = Math.abs(lowIndex - focus) >= Math.max(2, Math.ceil(n * 0.3))
  const farDown = Math.abs(lowY - focusY) >= 30 && !focusBelow
  const labelLow = lowIndex !== focus && lowest < focusValue && (farAcross || farDown)
  const ink = onHero ? 'text-adm-hero-fg' : 'bg-card/85 text-foreground'

  const rows: LegendRow[] = [
    {
      key: 'foco',
      label: `${label} ${when}`,
      value: formatCentsShort(focusValue),
      glyph: 'line',
      swatch: colors.swatch,
    },
  ]
  if (n > 1 && lowest !== highest) {
    rows.push(
      {
        key: 'bajo',
        label: 'Lo más bajo',
        sub: dayTitle(points[lowIndex]?.date ?? ''),
        value: formatCentsShort(lowest),
        glyph: 'none',
      },
      {
        key: 'alto',
        label: 'Lo más alto',
        sub: dayTitle(points[highIndex]?.date ?? ''),
        value: formatCentsShort(highest),
        glyph: 'none',
      },
    )
  }
  if (hasFuture) {
    rows.push({
      key: 'futuro',
      label: 'Después de hoy',
      value: 'estimado',
      glyph: 'line',
      swatch: cn(colors.swatch, 'opacity-40'),
      muted: true,
    })
  }

  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      <ChartTip>
        <Plot
          onHero={onHero}
          ticks={domain.ticks.map((t) => ({
            pos: valueY(t, domain.min, domain.max),
            label: compactCents(t),
            strong: t === 0,
          }))}
          xAxis={<XTicks items={xTicks} onHero={onHero} />}
        >
          {drawing}
          {today >= 0 ? (
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-y-0 w-px -translate-x-1/2',
                onHero ? 'bg-adm-hero-fg/35' : 'bg-foreground/25',
              )}
              style={{ left: `${focusX}%` }}
            />
          ) : null}

          <div className="absolute inset-0 flex">
            {points.map((p, i) => {
              const value = values[i] ?? 0
              const title = `${dayTitle(p.date)}${i === today ? ' (hoy)' : ''}`
              const estimated = today >= 0 && i > today
              return (
                <ChartMark
                  key={p.date}
                  href={p.href}
                  label={`${title}: ${label.toLowerCase()} ${formatCents(value)}${estimated ? ', estimado' : ''}${p.href ? '. Abre lo que pasó ese día' : ''}`}
                  tipTitle={title}
                  tipValue={formatCents(value)}
                  tipSub={`${estimated ? `${label} estimado` : label}${p.href ? '\nTocá para ver ese día' : ''}`}
                  className="h-full min-w-0 flex-1 rounded-[3px]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 opacity-0 group-data-[tip-active]/mark:opacity-100',
                      onHero ? 'bg-adm-hero-fg/35' : 'bg-foreground/25',
                    )}
                  />
                  <span
                    data-tip-anchor
                    aria-hidden
                    className="absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 group-data-[tip-active]/mark:opacity-100"
                    style={{
                      top: `${ys[i] ?? zeroY}%`,
                      backgroundColor: colors.stroke,
                      boxShadow: `0 0 0 2px ${colors.ring}`,
                    }}
                  />
                </ChartMark>
              )
            })}
          </div>

          {focusDot}
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute z-[2] rounded-sm px-1 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap tabular-nums',
              ink,
            )}
            style={{
              ...sideOf(focusX),
              ...(focusBelow
                ? { top: `calc(${focusY}% + 9px)` }
                : { bottom: `calc(${round2(100 - focusY)}% + 9px)` }),
            }}
          >
            {today >= 0 ? 'Hoy' : dayShort(points[focus]?.date ?? '')} · {compactCents(focusValue)}
          </span>
          {labelLow ? (
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute z-[2] rounded-sm px-1 py-0.5 text-[10px] leading-none whitespace-nowrap tabular-nums',
                ink,
              )}
              style={{
                ...sideOf(lowX),
                // Debajo del escalón; si el escalón ya está contra el piso, arriba.
                ...(lowY > 86
                  ? { bottom: `calc(${round2(100 - lowY)}% + 6px)` }
                  : { top: `calc(${lowY}% + 6px)` }),
              }}
            >
              Más bajo · {compactCents(lowest)}
            </span>
          ) : null}
        </Plot>
      </ChartTip>

      {(showLegend ?? !onHero) ? <ChartLegend caption={`${label} por día`} rows={rows} /> : null}
    </div>
  )
}

/** Los mismos días en filas, para «Ver como tabla». */
export function BalanceAreaTable({
  points,
  todayIndex = null,
  label = 'Saldo',
  caption,
}: {
  points: readonly BalanceAreaPoint[]
  todayIndex?: number | null
  label?: string
  caption?: string
}) {
  const today = typeof todayIndex === 'number' ? todayIndex : -1
  return (
    <ChartTable
      caption={caption ?? `${label} al cierre de cada día`}
      columns={[
        { key: 'dia', label: 'Día' },
        { key: 'saldo', label, align: 'right' },
      ]}
      rows={points.map((p, i) => {
        const estimated = today >= 0 && i > today
        return {
          key: p.date,
          cells: [
            `${dayTitle(p.date)}${i === today ? ' (hoy)' : ''}`,
            `${formatCents(Number.isFinite(p.cents) ? p.cents : null)}${estimated ? ' (estimado)' : ''}`,
          ],
          muted: estimated,
        }
      })}
    />
  )
}
