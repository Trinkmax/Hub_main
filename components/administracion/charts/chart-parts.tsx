import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import {
  formatDayLabel,
  formatDayMonth,
  isRealIsoDay,
  WEEKDAY_NAMES_MIN,
  weekdayOf,
} from '@/lib/dates'
import { cn } from '@/lib/utils'
import { labelIndexes } from './scale'

/**
 * Las piezas que comparten los gráficos de Administración. Todo server-safe:
 * `div`, `span` y SVG calculados en el server, sin efectos ni estado. La única
 * isla cliente es `ChartTip`, que envuelve el dibujo desde cada gráfico.
 *
 * Reglas de la familia (contrato de diseño §5), que viven acá para que ningún
 * gráfico las reinvente:
 * - el texto va SIEMPRE en tinta (`foreground` / `muted-foreground`); el color
 *   de la serie lo lleva un punto o un trazo al lado;
 * - cada marca es una parada de Tab con su `aria-label` completo y trae los
 *   `data-tip-*` que lee `ChartTip`;
 * - la leyenda es una tabla de verdad (etiqueta, parte y monto), no una fila
 *   de colores.
 */

/* ── Marca ──────────────────────────────────────────────────────────────── */

export type ChartMarkProps = {
  /** Con `href` la marca es un link (el día sin cargar lleva a cargarlo). */
  href?: string
  /** Lo que oye un lector de pantalla: el dato entero, con su unidad. */
  label: string
  tipTitle: string
  tipValue?: string
  /** Segunda línea del globito; un `\n` la parte en dos renglones. */
  tipSub?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

const MARK_CLASS =
  'group/mark relative block outline-none focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Una marca del gráfico (una columna, un tramo, un renglón). Su caja es el
 * área de toque: los gráficos la hacen más grande que lo pintado (todo el alto
 * del dibujo para una columna, 28 px para un tramo de 12).
 */
export function ChartMark({
  href,
  label,
  tipTitle,
  tipValue,
  tipSub,
  className,
  style,
  children,
}: ChartMarkProps) {
  const tip = {
    'data-tip-title': tipTitle,
    'data-tip-value': tipValue,
    'data-tip-sub': tipSub,
  }
  if (href) {
    return (
      // Sin prefetch: un mes son 31 marcas y no queremos 31 pedidos al entrar.
      <Link
        href={href}
        prefetch={false}
        aria-label={label}
        className={cn(MARK_CLASS, className)}
        style={style}
        {...tip}
      >
        {children}
      </Link>
    )
  }
  return (
    <span
      role="img"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: cada marca se enfoca con el teclado para leer su dato (contrato de diseño §5); el `aria-label` lo dice entero
      tabIndex={0}
      aria-label={label}
      className={cn(MARK_CLASS, className)}
      style={style}
      {...tip}
    >
      {children}
    </span>
  )
}

/* ── Rayado ─────────────────────────────────────────────────────────────── */

/** Rayado a 135° sobre un relleno (lo que todavía no entró, lo estimado). */
export const HATCH_OVER_FILL: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklch, var(--card) 55%, transparent) 3px 5px)',
}

/**
 * Rayado ámbar sobre un hueco: «acá falta cargar». Siempre con su palabra al
 * lado. La tinta del rayado sale de `--adm-hatch-missing` cuando el tema la
 * define (en oscuro va más tenue: al 30 % le ganaba a las columnas del dato).
 */
export const HATCH_MISSING: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, transparent 0 3px, var(--adm-hatch-missing, color-mix(in oklch, var(--warning) 30%, transparent)) 3px 5px)',
}

/* ── Leyenda-tabla ──────────────────────────────────────────────────────── */

export type LegendGlyph = 'box' | 'line' | 'dashed' | 'tick' | 'up' | 'down' | 'none'

export type LegendRow = {
  key: string
  label: ReactNode
  /** Ya formateado: «$ 1.235», «3 días». */
  value: string
  /** «24 %». Si ninguna fila lo trae, la columna no se dibuja. */
  share?: string
  /** Aclaración chica debajo de la etiqueta. */
  sub?: ReactNode
  /** Clase `bg-*` del color (`bg-adm-s1`). */
  swatch?: string
  /** La forma repite la de la marca: caja para barras, trazo para líneas. */
  glyph?: LegendGlyph
  hatched?: boolean
  /** La fila navega o filtra. */
  href?: string
  muted?: boolean
}

export function LegendKey({
  swatch,
  glyph = 'box',
  hatched,
}: {
  swatch?: string
  glyph?: LegendGlyph
  hatched?: boolean
}) {
  if (glyph === 'none') return <span aria-hidden className="w-2.5 shrink-0" />
  if (glyph === 'line') {
    return <span aria-hidden className={cn('h-0.5 w-4 shrink-0 rounded-full', swatch)} />
  }
  if (glyph === 'tick') {
    return (
      <span aria-hidden className="flex w-4 shrink-0 justify-center">
        <span className={cn('h-3 w-0.5 rounded-full', swatch ?? 'bg-foreground/60')} />
      </span>
    )
  }
  if (glyph === 'dashed') {
    return (
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-[3px] border border-dashed border-warning dark:border-warning/60"
        style={HATCH_MISSING}
      />
    )
  }
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-1">
      {glyph === 'up' || glyph === 'down' ? (
        <span className="text-xs leading-none text-muted-foreground">
          {glyph === 'up' ? '↑' : '↓'}
        </span>
      ) : null}
      <span
        className={cn('size-2.5 rounded-[3px]', swatch)}
        style={hatched ? HATCH_OVER_FILL : undefined}
      />
    </span>
  )
}

/**
 * La leyenda ES la tabla del gráfico: qué es, qué parte y cuánto. Nunca depende
 * del color ni de pasar el mouse.
 */
export function ChartLegend({
  caption,
  rows,
  total,
  className,
}: {
  /** Para lectores de pantalla: «Disponible por caja». */
  caption: string
  rows: readonly LegendRow[]
  total?: { label: string; value: string }
  className?: string
}) {
  const withShare = rows.some((r) => r.share !== undefined)
  return (
    // Tope de ancho: en la compu los números quedan cerca de su etiqueta.
    <table className={cn('w-full max-w-[34rem] text-sm', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Qué es</th>
          {withShare ? <th scope="col">Parte</th> : null}
          <th scope="col">Importe</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.map((r) => {
          const label = (
            <span className="inline-flex min-w-0 items-center gap-2">
              <LegendKey swatch={r.swatch} glyph={r.glyph} hatched={r.hatched} />
              <span className="min-w-0 break-words">{r.label}</span>
            </span>
          )
          return (
            <tr key={r.key} className={cn(r.muted && 'text-muted-foreground')}>
              <th scope="row" className="py-1.5 pr-3 text-left align-middle font-normal">
                {r.href ? (
                  <Link
                    href={r.href}
                    className="-my-1.5 inline-flex min-h-9 items-center rounded-sm underline-offset-4 outline-none hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {label}
                  </Link>
                ) : (
                  label
                )}
                {r.sub ? (
                  <span className="block pl-[1.125rem] text-xs text-muted-foreground">{r.sub}</span>
                ) : null}
              </th>
              {withShare ? (
                <td className="w-px py-1.5 pr-3 text-right align-middle text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                  {r.share ?? ''}
                </td>
              ) : null}
              <td
                className={cn(
                  'w-px py-1.5 text-right align-middle whitespace-nowrap tabular-nums',
                  !r.muted && 'font-medium',
                )}
              >
                {r.value}
              </td>
            </tr>
          )
        })}
      </tbody>
      {total ? (
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <th scope="row" className="py-2 pr-3 text-left">
              {total.label}
            </th>
            {withShare ? <td /> : null}
            <td className="py-2 text-right whitespace-nowrap tabular-nums">{total.value}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  )
}

/* ── Lienzo con eje ─────────────────────────────────────────────────────── */

export type PlotTick = {
  /** 0 = arriba del lienzo, 100 = abajo. */
  pos: number
  label: string
  /** La línea del cero: un escalón más marcada. */
  strong?: boolean
}

/**
 * El lienzo de un gráfico con UN eje: las marcas de plata a la izquierda (el
 * margen mide lo que mide su etiqueta más larga, sin anchos a ojo), la grilla
 * sólida y muy tenue, y abajo el eje de los días. Arriba quedan 20 px de aire
 * para la etiqueta de la marca más alta.
 */
export function Plot({
  ticks,
  heightClass = 'h-40 sm:h-48',
  xAxis,
  onHero = false,
  children,
  className,
}: {
  ticks: readonly PlotTick[]
  heightClass?: string
  xAxis?: ReactNode
  /** Sobre el panel verde del héroe: la tinta y la grilla cambian de token. */
  onHero?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('@container grid grid-cols-[auto_minmax(0,1fr)] gap-x-2', className)}>
      <div
        aria-hidden
        className={cn(
          'relative mt-5 text-[10px] leading-none tabular-nums',
          onHero ? 'text-adm-hero-muted' : 'text-muted-foreground',
          heightClass,
        )}
      >
        {/* Fantasmas: no se ven ni ocupan alto, pero le dan al margen el ancho
            de la etiqueta más larga. */}
        {ticks.map((t) => (
          <span
            key={`ghost-${t.pos}`}
            className="invisible block h-0 overflow-hidden whitespace-nowrap"
          >
            {t.label}
          </span>
        ))}
        {ticks.map((t) => (
          <span
            key={t.pos}
            className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
            style={{ top: `${t.pos}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
      <div className={cn('relative mt-5 min-w-0', heightClass)}>
        {ticks.map((t) => (
          <span
            key={t.pos}
            aria-hidden
            className={cn(
              'absolute inset-x-0 h-px',
              onHero
                ? t.strong
                  ? 'bg-adm-hero-fg/30'
                  : 'bg-adm-hero-fg/12'
                : t.strong
                  ? 'bg-border'
                  : 'bg-border/50',
            )}
            style={{ top: `${t.pos}%` }}
          />
        ))}
        {children}
      </div>
      {xAxis ? (
        <>
          <span aria-hidden />
          {xAxis}
        </>
      ) : null}
    </div>
  )
}

export type XTick = {
  key: string
  /** Renglón de arriba, más chico: el día de la semana. */
  top?: string
  bottom?: string
  /** Hoy. */
  strong?: boolean
  /** Solo entra cuando la tarjeta es ancha (desde 34rem); en el celular se saltea. */
  wideOnly?: boolean
  /** Entra desde 20rem de tarjeta (un celular de 390 px); en uno de 320 se saltea. */
  midOnly?: boolean
}

/**
 * El eje de abajo: un casillero por dato, del mismo ancho que su columna. La
 * etiqueta va centrada y puede pasarse de su casillero (por eso se ralean con
 * `labelIndexes`): nunca se corta ni se rota.
 */
export function XTicks({ items, onHero = false }: { items: readonly XTick[]; onHero?: boolean }) {
  return (
    <div aria-hidden className="mt-1.5 flex">
      {items.map((t) => (
        <span key={t.key} className="flex min-w-0 flex-1 justify-center">
          {t.top || t.bottom ? (
            <span
              className={cn(
                'flex-col items-center text-[10px] leading-tight whitespace-nowrap tabular-nums',
                t.wideOnly
                  ? 'hidden @min-[34rem]:flex'
                  : t.midOnly
                    ? 'hidden @min-[20rem]:flex'
                    : 'flex',
                t.strong && 'font-semibold',
                onHero
                  ? t.strong
                    ? 'text-adm-hero-fg'
                    : 'text-adm-hero-muted'
                  : t.strong
                    ? 'text-foreground'
                    : 'text-muted-foreground',
              )}
            >
              {t.top ? <span className="text-[9px]">{t.top}</span> : null}
              {t.bottom ? <span>{t.bottom}</span> : null}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

/** Hasta cuántos días llevan TODOS su etiqueta en el eje. */
const MAX_FULL_DAY_TICKS = 10
/** Hasta cuántos días la etiqueta lleva el día de la semana arriba («lu» / «12»). */
const MAX_WEEKDAY_TICKS = 16
/** Hasta cuántos días llevan todos su número cuando la tarjeta es ancha (desde 34rem). */
const MAX_WIDE_DAY_TICKS = 31
/** Cuántas etiquetas entran, raleadas, en el eje de un celular de 320 px. */
const MAX_THINNED_TICKS = 7

/**
 * La etiqueta de un día en el eje, sacada de la fecha y no del `label` que
 * manda la pantalla: «Lun 12/10» no entra en un casillero de 14 px, «lu / 12»
 * sí. Si `date` no es un día real, va el `fallback` tal cual.
 */
function dayTick(
  date: string,
  fallback: string,
  opts: { weekday: boolean; today?: boolean },
): XTick {
  if (!isRealIsoDay(date)) return { key: date, bottom: fallback, strong: opts.today }
  const dayNumber = String(Number(date.slice(8, 10)))
  if (opts.today) {
    return { key: date, top: opts.weekday ? 'hoy' : undefined, bottom: dayNumber, strong: true }
  }
  return {
    key: date,
    top: opts.weekday ? WEEKDAY_NAMES_MIN[weekdayOf(date)] : undefined,
    bottom: dayNumber,
  }
}

/**
 * El eje de los días de un gráfico: hasta 10 días van todos, con el día de la
 * semana arriba; de 11 a 16 se saltean (cada uno necesita unos 28 px y en el
 * celular hay 14); un mes entero deja 7 números. Hoy va siempre, en negrita.
 */
export function dayTicks(
  days: ReadonlyArray<{ date: string; label: string }>,
  todayIndex: number,
): XTick[] {
  const n = days.length
  const weekday = n <= MAX_WEEKDAY_TICKS
  const shown = new Set(
    n <= MAX_FULL_DAY_TICKS
      ? days.map((_, i) => i)
      : labelIndexes(n, MAX_THINNED_TICKS, [todayIndex]),
  )
  // Hasta un mes, los días salteados vuelven cuando la tarjeta es ancha: en la
  // compu cada columna tiene su número y se puede decir «el 17».
  const wideAll = n <= MAX_WIDE_DAY_TICKS
  return days.map((d, i) => {
    if (shown.has(i)) return dayTick(d.date, d.label, { weekday, today: i === todayIndex })
    if (!wideAll) return { key: d.date }
    return { ...dayTick(d.date, d.label, { weekday }), wideOnly: true }
  })
}

/** «Vie 31/07» para el globito y la tabla; el `fallback` si no es un día real. */
export function dayTitle(date: string, fallback?: string): string {
  return formatDayLabel(date) || fallback || date
}

/** «31/07» para una etiqueta corta sobre el dibujo. */
export function dayShort(date: string, fallback?: string): string {
  return formatDayMonth(date) || fallback || date
}

/* ── Sin datos ──────────────────────────────────────────────────────────── */

export type SilhouetteKind = 'bars' | 'split' | 'rank' | 'line' | 'area' | 'inout' | 'strip'

const SILHOUETTE_BARS = [28, 44, 36, 58, 50, 72, 46, 64, 82, 56, 70, 92] as const
const SILHOUETTE_RANK = [92, 66, 44, 24] as const
const SILHOUETTE_INOUT = [
  [70, 40],
  [48, 62],
  [86, 30],
  [58, 52],
  [76, 44],
  [40, 26],
] as const
const SILHOUETTE_STRIP = Array.from({ length: 14 }, (_, i) => i)
const SILHOUETTE_FILL = 'bg-adm-neutral/35'

/**
 * La silueta tenue de un gráfico, para el estado vacío: muestra QUÉ va a
 * aparecer ahí sin inventar un solo número (por eso no lleva el rótulo
 * «ejemplo»). Decorativa: `aria-hidden`.
 */
export function ChartSilhouette({ kind, className }: { kind: SilhouetteKind; className?: string }) {
  if (kind === 'split') {
    return (
      <div aria-hidden className={cn('flex h-3 w-full gap-[2px]', className)}>
        <span className={cn('h-full w-1/2 rounded-l-full', SILHOUETTE_FILL)} />
        <span className="h-full w-[30%] bg-adm-neutral/25" />
        <span className="h-full flex-1 rounded-r-full bg-adm-neutral/15" />
      </div>
    )
  }
  if (kind === 'rank') {
    return (
      <div aria-hidden className={cn('space-y-2.5', className)}>
        {SILHOUETTE_RANK.map((w) => (
          <span
            key={w}
            className={cn('block h-2.5 rounded-r-[4px]', SILHOUETTE_FILL)}
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    )
  }
  if (kind === 'line' || kind === 'area') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className={cn('block h-20 w-full', className)}
      >
        {kind === 'area' ? (
          <path
            d="M0 70 H12 V58 H24 V64 H36 V40 H48 V46 H60 V28 H72 V36 H84 V18 H100 V100 H0 Z"
            fill="var(--adm-neutral)"
            opacity={0.14}
          />
        ) : (
          <path
            d="M0 92 L100 14"
            fill="none"
            stroke="var(--adm-neutral)"
            strokeWidth={2}
            opacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={
            kind === 'area'
              ? 'M0 70 H12 V58 H24 V64 H36 V40 H48 V46 H60 V28 H72 V36 H84 V18 H100'
              : 'M0 92 L14 84 L28 78 L42 62 L56 54 L70 38'
          }
          fill="none"
          stroke="var(--adm-neutral)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.6}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  }
  if (kind === 'inout') {
    return (
      <div aria-hidden className={cn('flex h-20 gap-[2px]', className)}>
        {SILHOUETTE_INOUT.map(([up, down]) => (
          <span key={`${up}-${down}`} className="flex h-full min-w-0 flex-1 flex-col items-center">
            <span className="flex h-[58%] w-full max-w-6 items-end pb-px">
              <span
                className={cn('w-full rounded-t-[4px]', SILHOUETTE_FILL)}
                style={{ height: `${up}%` }}
              />
            </span>
            <span className="flex h-[42%] w-full max-w-6 items-start pt-px">
              <span
                className="w-full rounded-b-[4px] bg-adm-neutral/20"
                style={{ height: `${down}%` }}
              />
            </span>
          </span>
        ))}
      </div>
    )
  }
  if (kind === 'strip') {
    return (
      <div aria-hidden className={cn('grid grid-cols-7 gap-1', className)}>
        {SILHOUETTE_STRIP.map((i) => (
          <span
            key={i}
            className={cn(
              'h-7 rounded-md',
              i % 5 === 3
                ? 'border border-dashed border-adm-neutral/60'
                : i < 9
                  ? SILHOUETTE_FILL
                  : 'bg-adm-neutral/15',
            )}
          />
        ))}
      </div>
    )
  }
  return (
    <div aria-hidden className={cn('flex h-20 items-end', className)}>
      {SILHOUETTE_BARS.map((h) => (
        <span key={h} className="flex h-full min-w-0 flex-1 items-end justify-center px-px">
          <span
            className={cn('w-full max-w-6 rounded-t-[4px]', SILHOUETTE_FILL)}
            style={{ height: `${h}%` }}
          />
        </span>
      ))}
    </div>
  )
}

/**
 * Lo que muestra un gráfico cuando no hay nada que dibujar. Nunca ceros: un
 * mes sin cierres no «vendió $ 0», le falta cargar.
 *
 * - `hint` como texto: el `EmptyTeach` del kit con la silueta del gráfico al
 *   lado, un título y la oración que dice qué va a aparecer y cómo se llena.
 *   Va `plain` (sin marco): el gráfico ya vive adentro de un `Panel`.
 * - `hint` como elemento (un `EmptyTeach` armado por la pantalla, con su botón
 *   del paso siguiente): va tal cual. La pantalla sabe cuál es el paso
 *   siguiente; el gráfico no. Para repetir la silueta ahí, `ChartSilhouette`.
 */
export function ChartEmpty({
  title,
  hint,
  silhouette,
  className,
}: {
  title: string
  hint?: ReactNode
  silhouette: SilhouetteKind
  className?: string
}) {
  const isText = hint === undefined || hint === null || typeof hint !== 'object'
  if (!isText) return <div className={cn('min-w-0', className)}>{hint}</div>
  return (
    <EmptyTeach
      plain
      title={title}
      illustration={<ChartSilhouette kind={silhouette} />}
      className={cn('min-w-0', className)}
    >
      {hint || null}
    </EmptyTeach>
  )
}

/* ── «Ver como tabla» ───────────────────────────────────────────────────── */

export type ChartTableColumn = { key: string; label: string; align?: 'left' | 'right' }

export type ChartTableRow = {
  key: string
  /** Una celda por columna, en orden. La primera es el encabezado de la fila. */
  cells: readonly ReactNode[]
  muted?: boolean
}

/**
 * Los mismos números del gráfico, en filas: lo que se pasa como `table` a
 * `ChartFrame`. Si no entra de ancho en el celular se desliza adentro de su
 * caja, nunca la página.
 */
export function ChartTable({
  caption,
  columns,
  rows,
  foot,
  className,
}: {
  caption: string
  columns: readonly ChartTableColumn[]
  rows: readonly ChartTableRow[]
  /** Fila de totales: una celda por columna. */
  foot?: readonly ReactNode[]
  className?: string
}) {
  const align = (i: number) => (columns[i]?.align === 'right' ? 'text-right' : 'text-left')
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border/60', className)}>
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border/60 bg-secondary/40">
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground',
                  align(i),
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.key} className={cn(r.muted && 'text-muted-foreground')}>
              {r.cells.map((cell, i) =>
                i === 0 ? (
                  <th
                    key={columns[i]?.key ?? i}
                    scope="row"
                    className="px-3 py-2 text-left font-normal whitespace-nowrap tabular-nums"
                  >
                    {cell}
                  </th>
                ) : (
                  <td
                    key={columns[i]?.key ?? i}
                    className={cn('px-3 py-2 whitespace-nowrap tabular-nums', align(i))}
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {foot ? (
          <tfoot>
            <tr className="border-t border-border bg-secondary/30 font-semibold">
              {foot.map((cell, i) =>
                i === 0 ? (
                  <th
                    key={columns[i]?.key ?? i}
                    scope="row"
                    className="px-3 py-2 text-left text-xs whitespace-nowrap"
                  >
                    {cell}
                  </th>
                ) : (
                  <td
                    key={columns[i]?.key ?? i}
                    className={cn('px-3 py-2 whitespace-nowrap tabular-nums', align(i))}
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}
