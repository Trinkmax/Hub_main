import type { ReactNode } from 'react'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ChartEmpty, ChartMark, LegendKey } from './chart-parts'
import { ChartTip } from './chart-tip'
import { pct, percentLabel } from './scale'

/**
 * Barras horizontales ordenadas de mayor a menor: «¿en qué se va la plata?»,
 * «¿a quién le debo más?». Cada renglón ES su fila de tabla: la etiqueta a la
 * izquierda, el monto a la derecha y la barra entre los dos (debajo, en el
 * celular, para que la etiqueta no se quede sin lugar).
 *
 * - Un solo color para toda la lista (la identidad la da la etiqueta, no hace
 *   falta leyenda); `swatch` por renglón solo si el color significa algo que
 *   ya se usa en otro dibujo de la misma pantalla.
 * - `previousCents`: una marca fina sobre el riel con lo del período anterior.
 *   Si algún renglón la trae, abajo se aclara qué es.
 * - Base recta (a la izquierda), extremo redondeado 4 px, 10 px de alto.
 * - Todo el renglón es la marca: se toca, se enfoca y, con `href`, navega.
 */

export type RankBarsRow = {
  key: string
  label: string
  cents: number
  /** Aclaración chica debajo de la etiqueta: «3 compras», el nombre contable. */
  sub?: string
  href?: string
  /** Clase `bg-*`; por defecto `bg-adm-s1`. */
  swatch?: string
  /** Lo mismo en el período anterior: se dibuja como una marca fina. */
  previousCents?: number | null
}

export type RankBarsProps = {
  rows: readonly RankBarsRow[]
  /** El valor que llena la barra entera. Por defecto, el más grande de la lista. */
  max?: number
  /** `false` para respetar el orden en que llegan (ya vienen ordenadas, o el orden significa algo). */
  sort?: boolean
  /** Cómo se llama la marca fina: «el mes pasado». */
  previousLabel?: string
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

export function RankBars({
  rows,
  max,
  sort = true,
  previousLabel = 'el período anterior',
  emptyHint,
  ariaLabel,
  className,
}: RankBarsProps) {
  const clean = rows.map((r) => ({
    ...r,
    cents: Number.isFinite(r.cents) ? Math.max(0, r.cents) : 0,
    previous:
      typeof r.previousCents === 'number' && Number.isFinite(r.previousCents)
        ? Math.max(0, r.previousCents)
        : null,
  }))
  const total = clean.reduce((sum, r) => sum + r.cents, 0)
  if (total <= 0) {
    return (
      <ChartEmpty
        silhouette="rank"
        title="Todavía no hay nada para comparar"
        hint={emptyHint}
        className={className}
      />
    )
  }

  // Orden estable: a igual monto queda el orden en que llegaron.
  const ordered = sort ? [...clean].sort((a, b) => b.cents - a.cents) : clean
  const top = Math.max(
    max !== undefined && Number.isFinite(max) ? max : 0,
    ...ordered.map((r) => Math.max(r.cents, r.previous ?? 0)),
  )
  const hasPrevious = ordered.some((r) => r.previous !== null)
  const first = ordered[0]
  const summary =
    ariaLabel ??
    (first
      ? `${ordered.length === 1 ? 'Un solo renglón' : `${ordered.length} renglones`}, ${formatCentsShort(total)} en total. El más grande: ${first.label}, ${formatCentsShort(first.cents)} (${percentLabel(Math.round(pct(first.cents, total)), first.cents > 0)}).`
      : '')

  return (
    <div className={cn('@container min-w-0', className)}>
      <p className="sr-only">{summary}</p>
      <ChartTip scrub={false}>
        <ul className="-mx-2">
          {ordered.map((r) => {
            const share = percentLabel(Math.round(pct(r.cents, total)), r.cents > 0)
            const width = pct(r.cents, top)
            const before =
              r.previous !== null ? `\nEn ${previousLabel}: ${formatCents(r.previous)}` : ''
            return (
              <li key={r.key}>
                <ChartMark
                  href={r.href}
                  label={`${r.label}: ${formatCents(r.cents)}, ${share} del total${
                    r.previous !== null ? `. En ${previousLabel}: ${formatCents(r.previous)}` : ''
                  }`}
                  tipTitle={r.label}
                  tipValue={formatCents(r.cents)}
                  tipSub={`${share} del total${before}`}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2',
                    '@min-[34rem]:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]',
                    'transition-[background-color] duration-(--duration-fast) data-[tip-active]:bg-secondary/60 motion-reduce:transition-none',
                    r.href && 'hover:bg-secondary/60',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{r.label}</span>
                    {r.sub ? (
                      <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
                    ) : null}
                  </span>
                  <span className="text-right text-sm font-medium whitespace-nowrap tabular-nums @min-[34rem]:order-3">
                    {formatCentsShort(r.cents)}
                  </span>
                  {/* El riel: la barra y, si hay, la marca del período anterior. */}
                  <span
                    aria-hidden
                    className="relative col-span-2 block h-2.5 @min-[34rem]:order-2 @min-[34rem]:col-span-1"
                  >
                    {r.cents > 0 ? (
                      <span
                        data-tip-anchor
                        className={cn(
                          'rail-grow absolute inset-y-0 left-0 block min-w-[2px] rounded-r-[4px]',
                          r.swatch ?? 'bg-adm-s1',
                        )}
                        style={{ width: `${width}%` }}
                      />
                    ) : null}
                    {r.previous !== null && r.previous > 0 ? (
                      <span
                        className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70 shadow-[0_0_0_1px_var(--card)]"
                        style={{ left: `${pct(r.previous, top)}%` }}
                      />
                    ) : null}
                  </span>
                </ChartMark>
              </li>
            )
          })}
        </ul>
      </ChartTip>
      {hasPrevious ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <LegendKey glyph="tick" />
          {`La raya fina marca ${previousLabel}.`}
        </p>
      ) : null}
    </div>
  )
}
