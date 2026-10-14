import { ArrowDown, ArrowUp } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { ChartEmpty, ChartMark, dayTitle } from '@/components/administracion/charts/chart-parts'
import { ChartTip } from '@/components/administracion/charts/chart-tip'
import { calendarWeeks } from '@/lib/dates/calendar-grid'
import { cn } from '@/lib/utils'
import { LinkPending } from './panel-focus'

/**
 * El mes como almanaque de pared: un casillero por día, de lunes a domingo,
 * también en el celular. Es el dibujo de Ventas: cada noche se llena hasta
 * donde se vendió, una raya marca el objetivo de ese día y un punto dorado
 * dice que hubo un evento.
 *
 * Habla el mismo idioma que la tira de cierres del Resumen (`CloseStrip`):
 * contorno punteado ámbar = falta el cierre, anillo = hoy. Nunca depende del
 * color: cada estado lleva su palabra, y el dato entero va en el `label` de
 * cada casillero (lectores de pantalla y globito).
 *
 * - Se dibuja SIEMPRE, también sin nada cargado: un mes entero de «falta» es
 *   justo lo que hay que ver. Solo con `cells` vacío muestra su vacío.
 * - Un día sin cargar no es un cero: no se llena ni dice «$ 0».
 * - Se acomoda al ancho de SU hoja (`@container/almanac`), no al de la ventana:
 *   en una columna angosta el casillero muestra el importe corto y, desde 42rem
 *   de hoja, el importe entero, el porcentaje y el evento.
 * - `size="compact"` es el almanaque chico (la vista previa de «Armar el
 *   objetivo»): siempre con el casillero angosto.
 *
 * Es una tabla de verdad (`th scope="col"`), server-safe; el único hijo cliente
 * es la marca de «ya lo toqué» de cada link (`LinkPending`).
 *
 * Cuándo NO: para una tira de una sola fila (eso es `CloseStrip`), para meses
 * enteros de un año (`MonthStrip`), ni para elegir una fecha en un formulario.
 */

export type MonthGridCell = {
  /** `yyyy-MM-dd`. */
  date: string
  /** `before`: anterior al primer día que se llevan las cuentas (no «falta»). */
  state: 'loaded' | 'missing' | 'today' | 'future' | 'before'
  /** Lo que dice el casillero ancho: «$ 1.138.029», «falta», «hoy». */
  value?: string | null
  /** Lo que dice el casillero angosto: «1,1 M». */
  valueShort?: string | null
  /** Una aclaración chica en gris: «obj. $ 1,5 M». */
  caption?: string | null
  /** El cumplimiento, en su pastilla: «92 %» con su flecha. Solo en el casillero ancho. */
  badge?: { text: string; tone: 'ok' | 'warn' | 'muted'; glyph?: 'up' | 'down' } | null
  /** El evento o la nota del día, en un renglón cortado. Solo en el casillero ancho. */
  note?: string | null
  /** Cuánto se llena, de 0 a 1. */
  fill?: number | null
  /** Dónde va la raya de referencia (el objetivo), de 0 a 1, en la misma escala que `fill`. */
  marker?: number | null
  /** El punto dorado: ese día hay un evento o una nota. */
  dot?: boolean
  /** A dónde lleva tocarlo. Sin `href` no se toca. */
  href?: string
  /** El día elegido. */
  selected?: boolean
  /** Es el día de hoy (para el anillo de un día que ya está cargado). */
  today?: boolean
  /** El dato entero, para lectores y para el globito. */
  label: string
}

export type MonthGridProps = {
  /** `yyyy-MM`. */
  month: string
  cells: readonly MonthGridCell[]
  /** Para lectores de pantalla: «Lo vendido cada noche de octubre». */
  caption: string
  size?: 'auto' | 'compact'
  emptyHint?: ReactNode
  ariaLabel?: string
  className?: string
}

/** Lunes primero: el bar piensa la semana de lunes a domingo. */
const HEAD = [
  { short: 'lu', long: 'lunes' },
  { short: 'ma', long: 'martes' },
  { short: 'mi', long: 'miércoles' },
  { short: 'ju', long: 'jueves' },
  { short: 'vi', long: 'viernes' },
  { short: 'sá', long: 'sábado' },
  { short: 'do', long: 'domingo' },
] as const

// Las medidas van escritas enteras (Tailwind no ve clases armadas por partes).
// El texto arranca siempre a la derecha del carril del termómetro (la columna y la raya del
// objetivo viven en los primeros 5 px del angosto y 8 px del ancho): nada lo tacha.
// `--cell-top`: el renglón del número del día. El relleno y la raya se miden en lo que queda
// debajo: la columna nunca sube hasta el número.
const BOX_AUTO =
  '[--cell-top:16px] @[42rem]/almanac:[--cell-top:22px] h-14 py-1 pr-0 pl-1.5 @[28rem]/almanac:h-16 @[28rem]/almanac:pr-1 @[28rem]/almanac:pl-2 @[42rem]/almanac:h-24 @[42rem]/almanac:py-1.5 @[42rem]/almanac:pr-1.5 @[42rem]/almanac:pl-2.5'
const BOX_COMPACT = '[--cell-top:16px] h-12 py-1 pr-0.5 pl-1.5'
/** Una semana entera anterior al arranque: solo los números, en un renglón bajo. */
const BOX_SHORT = 'h-6 py-0.5 pr-0 pl-1.5 @[42rem]/almanac:pl-2.5'
const WIDE_ONLY = 'hidden @[42rem]/almanac:flex'
const NARROW_ONLY = '@[42rem]/almanac:hidden'

/** Hoy: un anillo fino (el contorno grueso con fondo es el del día que estás mirando). */
const TODAY_RING = 'ring-[1.5px] ring-foreground/75 ring-inset'

const STATE_BOX: Readonly<Record<MonthGridCell['state'], string>> = {
  loaded: 'border border-adm-s1/30 bg-card',
  missing: 'border border-dashed border-warning bg-warning/10',
  today: `bg-card ${TODAY_RING}`,
  future: 'border border-border/50',
  before: '',
}

/** El día que estás mirando: fondo propio y contorno afuera, para no confundirlo con «hoy». */
const SELECTED_BOX = 'bg-accent/60 outline-2 outline-offset-2 outline-primary'

const BADGE_TONE = {
  ok: 'text-success',
  warn: 'text-warning-text',
  muted: 'text-muted-foreground',
} as const

function tipSub(cell: MonthGridCell): string | undefined {
  const parts = [
    cell.badge ? `${cell.badge.text} del objetivo` : null,
    cell.caption ?? null,
    cell.note ?? null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('\n') : undefined
}

/** La altura de un nivel (0 a 1) medida debajo del renglón del día (`--cell-top`). */
function level(value: number): string {
  return `calc((100% - var(--cell-top, 0px)) * ${Math.round(value * 1000) / 1000})`
}

function CellBody({ cell, day, compact }: { cell: MonthGridCell; day: number; compact: boolean }) {
  const fill = typeof cell.fill === 'number' && cell.fill > 0 ? Math.min(1, cell.fill) : null
  const marker =
    typeof cell.marker === 'number' && cell.marker > 0 ? Math.min(1, cell.marker) : null
  const word = cell.state === 'missing' || cell.state === 'today'
  const wordClass = cn(
    'text-[10px] leading-none',
    // «hoy» en negrita: junto con su anillo fino, no se confunde con el día que estás mirando.
    cell.state === 'missing' ? 'font-medium text-warning-text' : 'font-semibold text-foreground',
  )
  // «806 mil», «1,1 M»: el número va en grande y la unidad chica al lado. En el casillero angosto
  // del celular (43 px) el número va en 12 px y apretado, así «806 mil» entra entero.
  const [shortNumber, shortUnit] = (cell.valueShort ?? '').split(/[\s\u00a0]+/, 2)
  const wideCurrency = /^\$\s/.test(cell.value ?? '')
  const wideAmount = wideCurrency ? (cell.value ?? '').replace(/^\$\s/, '') : cell.value
  const numberClass = cn(
    'font-serif font-semibold leading-none tabular-nums text-foreground',
    cell.state === 'future' && 'text-muted-foreground',
  )
  return (
    <>
      {/* El casillero se llena desde abajo: un lavado suave y, en el borde, la columna que marca
          el nivel. Ninguna raya cruza el número (una línea a media altura lo tachaba). */}
      {fill !== null ? (
        <>
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 bg-adm-s1/12 dark:bg-adm-s1/25"
            style={{ height: level(fill) } as CSSProperties}
          />
          <span
            aria-hidden
            className="absolute bottom-0 left-0 w-[3px] rounded-tr-full bg-adm-s1 @[42rem]/almanac:w-1"
            style={{ height: level(fill) } as CSSProperties}
          />
        </>
      ) : null}
      {/* El objetivo de la noche: una marca corta pegada a la columna, en la misma escala. Vive en
          el carril de la columna (5 px en el angosto, 8 en el ancho) y el texto arranca después:
          a cualquier altura, nunca tacha un número. */}
      {marker !== null ? (
        <span
          aria-hidden
          className="absolute left-0 w-[5px] rounded-r-full border-t-2 border-foreground/75 @[42rem]/almanac:w-2"
          style={{ bottom: `calc(${level(marker)} - 1px)` } as CSSProperties}
        />
      ) : null}
      {cell.dot ? (
        <span
          aria-hidden
          className="absolute top-1 right-1 size-1.5 rounded-full bg-adm-s2 ring-1 ring-card @[42rem]/almanac:top-1.5 @[42rem]/almanac:right-1.5 @[42rem]/almanac:size-2"
        />
      ) : null}

      <span
        className={cn(
          'relative text-[10px] leading-none tabular-nums',
          !compact && '@[42rem]/almanac:text-xs',
          cell.today || cell.state === 'today'
            ? 'font-semibold text-foreground'
            : cell.state === 'before'
              ? 'text-muted-foreground/50'
              : 'text-muted-foreground',
        )}
      >
        {day}
      </span>

      {/* Casillero angosto: una sola línea abajo, el importe corto o la palabra. */}
      <span className={cn('relative mt-auto flex min-w-0 items-baseline', !compact && NARROW_ONLY)}>
        {word ? (
          <span className={wordClass}>{cell.valueShort ?? cell.value}</span>
        ) : cell.valueShort ? (
          <span
            className={cn(
              numberClass,
              'whitespace-nowrap',
              compact
                ? 'text-[13px]'
                : 'text-[12px] tracking-[-0.03em] @[28rem]/almanac:text-[13px] @[28rem]/almanac:tracking-normal',
            )}
          >
            {compact ? null : (
              <span className="hidden font-sans text-[10px] font-normal text-muted-foreground @[28rem]/almanac:inline">
                ${' '}
              </span>
            )}
            {shortNumber}
            {shortUnit ? (
              <span
                className={cn(
                  'font-sans font-medium tracking-normal text-muted-foreground',
                  compact
                    ? 'ml-px text-[9px]'
                    : 'text-[8px] @[28rem]/almanac:ml-px @[28rem]/almanac:text-[9px]',
                  // En una hoja de menos de 304 px (un teléfono de 320) «mil» no entra: se esconde
                  // antes que cortarse («82 mi»). El importe entero está en el globito y el lector.
                  !compact && shortUnit === 'mil' && '@max-[19rem]/almanac:hidden',
                )}
              >
                {shortUnit}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>

      {/* Casillero ancho: importe entero, cumplimiento y evento. */}
      {compact ? null : (
        <span className={cn(WIDE_ONLY, 'relative mt-1 min-h-0 flex-1 flex-col gap-1')}>
          {word ? (
            <span className={cn(wordClass, 'text-xs')}>{cell.value}</span>
          ) : cell.value ? (
            // El «$» va chico y gris adelante: un importe de siete cifras entra entero.
            <span className={cn(numberClass, 'whitespace-nowrap text-[13px] tracking-tight')}>
              {wideCurrency ? (
                <span className="mr-0.5 font-sans text-[10px] font-normal tracking-normal text-muted-foreground">
                  $
                </span>
              ) : null}
              {wideAmount}
            </span>
          ) : null}
          {cell.badge ? (
            <span
              className={cn(
                'inline-flex w-fit items-center gap-0.5 rounded-full bg-card/80 px-1.5 py-px text-[11px] font-medium leading-tight tabular-nums',
                BADGE_TONE[cell.badge.tone],
              )}
            >
              {cell.badge.text}
              {cell.badge.glyph === 'up' ? (
                <ArrowUp aria-hidden className="size-3" strokeWidth={2.5} />
              ) : cell.badge.glyph === 'down' ? (
                <ArrowDown aria-hidden className="size-3" strokeWidth={2.5} />
              ) : null}
            </span>
          ) : cell.caption ? (
            <span className="truncate text-[11px] leading-tight text-muted-foreground">
              {cell.caption}
            </span>
          ) : null}
          {cell.note ? (
            <span className="mt-auto truncate text-[11px] leading-tight text-muted-foreground">
              {cell.note}
            </span>
          ) : null}
        </span>
      )}
    </>
  )
}

function Cell({
  cell,
  day,
  compact,
  short = false,
}: {
  cell: MonthGridCell
  day: number
  compact: boolean
  /** La semana entera es de antes del arranque: el casillero se achica a un renglón. */
  short?: boolean
}) {
  const box = cn(
    'group/cell relative flex w-full flex-col overflow-hidden rounded-lg text-left',
    short ? BOX_SHORT : compact ? BOX_COMPACT : BOX_AUTO,
    STATE_BOX[cell.state],
    // El día de hoy conserva su anillo aunque ya tenga el cierre cargado.
    cell.today && cell.state === 'loaded' && TODAY_RING,
    cell.selected && SELECTED_BOX,
  )
  const body = <CellBody cell={cell} day={day} compact={compact} />

  // Anterior al arranque: solo el número, apagado. No se enfoca ni se toca.
  if (cell.state === 'before') return <span className={box}>{body}</span>
  // Un día por venir que no lleva a ningún lado (la vista previa de un objetivo): es texto de
  // la tabla, no una parada de Tab. Treinta y un casilleros enfocables antes de «Guardar» no van.
  if (cell.state === 'future' && !cell.href) {
    return (
      <span className={box} title={cell.label}>
        {body}
      </span>
    )
  }

  const title = dayTitle(cell.date, String(day))
  const tipValue = cell.value ?? cell.caption ?? (cell.state === 'future' ? 'Todavía no llegó' : '')
  if (cell.href) {
    return (
      // Sin prefetch: un mes son 31 casilleros y no queremos 31 pedidos al entrar.
      // `replace` y sin scroll: elegir una noche no suma historial ni salta arriba.
      <Link
        href={cell.href}
        prefetch={false}
        replace
        scroll={false}
        aria-label={cell.label}
        aria-current={cell.selected ? 'date' : undefined}
        data-tip-title={title}
        data-tip-value={tipValue}
        data-tip-sub={tipSub(cell)}
        className={cn(
          box,
          // `focus-visible:outline-none` y no `outline-none`: el contorno del día elegido se queda.
          'transition-[background-color,border-color] duration-(--duration-fast) hover:bg-cream-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
          cell.state === 'missing' && 'hover:bg-warning/20',
        )}
      >
        {body}
        <LinkPending />
      </Link>
    )
  }
  return (
    <ChartMark
      label={cell.label}
      tipTitle={title}
      tipValue={tipValue}
      tipSub={tipSub(cell)}
      className={box}
    >
      {body}
    </ChartMark>
  )
}

export function MonthGrid({
  month,
  cells,
  caption,
  size = 'auto',
  emptyHint,
  ariaLabel,
  className,
}: MonthGridProps) {
  if (cells.length === 0) {
    return (
      <ChartEmpty
        silhouette="strip"
        title="Todavía no hay días para mostrar"
        hint={emptyHint}
        className={className}
      />
    )
  }
  const compact = size === 'compact'
  const byDate = new Map(cells.map((cell) => [cell.date, cell]))
  const weeks = calendarWeeks(month, { fixedWeeks: false })

  return (
    <div className={cn('@container/almanac min-w-0', className)}>
      {ariaLabel ? <p className="sr-only">{ariaLabel}</p> : null}
      <ChartTip scrub={false}>
        <table
          // En el celular, 3 px entre casilleros (no 4): cada uno gana un píxel y «828 mil» entra
          // entero también en un teléfono de 360 px.
          className={cn(
            'w-full table-fixed border-separate',
            compact
              ? 'border-spacing-1'
              : 'border-spacing-[3px] @[28rem]/almanac:border-spacing-1 @[42rem]/almanac:border-spacing-1.5',
          )}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {HEAD.map((head) => (
                <th
                  key={head.long}
                  scope="col"
                  abbr={head.long}
                  className="pb-0.5 text-center text-[10px] font-medium uppercase leading-none tracking-[0.12em] text-muted-foreground"
                >
                  {head.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              // Una semana entera de antes de que se lleven las cuentas no se carga ni se toca:
              // a lo alto de una semana normal eran dos filas de casilleros vacíos en un bar
              // recién arrancado. Va en un renglón bajo, con los números apagados.
              const short = week.every(
                (day) => !day.inMonth || byDate.get(day.iso)?.state === 'before',
              )
              return (
                <tr key={week[0]?.iso}>
                  {week.map((day) => {
                    const cell = day.inMonth ? byDate.get(day.iso) : undefined
                    if (!cell) return <td key={day.iso} aria-hidden="true" className="p-0" />
                    return (
                      <td key={day.iso} className="p-0 align-top">
                        <Cell cell={cell} day={day.day} compact={compact} short={short} />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </ChartTip>
    </div>
  )
}
