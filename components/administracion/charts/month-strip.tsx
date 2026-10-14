import { Circle, CircleDot, Lock, LockOpen, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { formatMonthLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { ChartEmpty, ChartLegend, type LegendGlyph, type LegendRow } from './chart-parts'
import { ChartTip } from './chart-tip'

/**
 * El año como una fila de pestañas: una por mes, cada una con su nombre corto y
 * su estado escrito. Sirve a la vez de navegación (`?mes=`) y de tablero: de un
 * vistazo se ve qué meses están cerrados, cuál toca cerrar y en cuál estamos.
 *
 * Habla el mismo idioma que `CloseStrip` (los días), un escalón más arriba:
 * - **Cerrado** = relleno suave + candado (el mismo candado del sello «CERRADO»).
 * - **Falta cerrar** = contorno punteado ámbar: el mes ya terminó y es el que toca.
 * - **En curso** = anillo en tinta: el mes de hoy.
 * - **Abierto** = hueco: abierto sin más (un período de ajustes, por ejemplo).
 * - **No empezó** = atenuada y sin link: todavía no hay nada que mirar ahí.
 *
 * El estado va SIEMPRE con ícono y palabra, nunca solo con color. `selected`
 * rellena en tinta la píldora del nombre (es la pestaña de lo que se ve abajo)
 * y pone `aria-current`; `alert` suma un punto rojo con la palabra «Aviso».
 * `title` es el detalle que no entra en la pestaña («Cerrado el 05/10/2026 por
 * Franco»): sale en el globito y lo oye un lector de pantalla.
 *
 * En angosto es una grilla de cuatro (doce meses = tres filas, todo a la vista
 * sin deslizar); desde 34rem de ancho propio, una sola fila.
 *
 * Cuándo NO: para días (eso es `CloseStrip`), para elegir un rango de fechas
 * (`RangeFilter`), ni para moverse entre vistas que no son meses (`ViewPills`).
 * No dibuja tarjeta: va suelta arriba de un `Panel` o adentro de uno.
 */

export type MonthStripState = 'closed' | 'open' | 'to_close' | 'current' | 'future'

export type MonthStripMonth = {
  /** `yyyy-MM`, o la clave del período si no es un mes calendario (el de ajustes de cierre). */
  key: string
  /** El nombre corto que se ve: «Oct». */
  label: string
  state: MonthStripState
  /** El detalle del estado: «Cerrado el 05/10/2026 por Franco». Va al globito y al lector. */
  title?: string
  /** A dónde lleva tocarlo. Un mes `future` nunca es un link, lo traiga o no. */
  href?: string
  /** El mes que se está viendo: píldora rellena en tinta + `aria-current`. */
  selected?: boolean
  /** Hay algo para revisar en ese mes: punto rojo + «Aviso». */
  alert?: boolean
}

export type MonthStripProps = {
  months: readonly MonthStripMonth[]
  /**
   * La tabla «cuántos meses en cada estado» debajo de la fila. Apagada por
   * defecto: cada pestaña ya dice su estado con palabras, y como navegación la
   * fila va pegada al panel del mes.
   */
  showLegend?: boolean
  emptyHint?: ReactNode
  /** La conclusión, para lectores de pantalla. Si falta, se arma con los meses. */
  ariaLabel?: string
  className?: string
}

type StateLook = {
  /** La palabra que se ve en la pestaña. */
  word: string
  icon: LucideIcon
  /** El casillero: relleno, contorno o anillo. */
  cell: string
  iconInk: string
  wordInk: string
}

/**
 * Cómo se ve cada estado. La palabra va en tinta o en el ámbar de texto (AA
 * sobre su fondo); el verde y el ámbar puros quedan para el ícono y el borde.
 * «En curso» usa `inset-ring` para no pelearse con el anillo de foco.
 */
const LOOK: Readonly<Record<MonthStripState, StateLook>> = {
  closed: {
    word: 'Cerrado',
    icon: Lock,
    cell: 'border-success/25 bg-success/10',
    iconInk: 'text-success',
    wordInk: 'text-foreground/80',
  },
  to_close: {
    word: 'Falta cerrar',
    icon: LockOpen,
    cell: 'border-dashed border-warning bg-warning/10 dark:border-warning/60',
    iconInk: 'text-warning-text',
    wordInk: 'text-warning-text',
  },
  current: {
    word: 'En curso',
    icon: CircleDot,
    cell: 'border-foreground/80 bg-card inset-ring-1 inset-ring-foreground/80',
    iconInk: 'text-foreground',
    wordInk: 'text-foreground',
  },
  open: {
    word: 'Abierto',
    icon: LockOpen,
    cell: 'border-border bg-card',
    iconInk: 'text-muted-foreground',
    wordInk: 'text-muted-foreground',
  },
  future: {
    word: 'No empezó',
    icon: Circle,
    cell: 'border-border/50',
    iconInk: 'text-muted-foreground/60',
    wordInk: 'text-muted-foreground',
  },
}

/** El orden en que se cuentan los estados en el resumen y en la leyenda. */
const STATE_ORDER = ['closed', 'to_close', 'current', 'open', 'future'] as const

const LEGEND: Readonly<
  Record<MonthStripState, { label: string; swatch?: string; glyph?: LegendGlyph; muted?: boolean }>
> = {
  closed: { label: 'Cerrados', swatch: 'bg-success' },
  to_close: { label: 'Falta cerrar', glyph: 'dashed' },
  current: { label: 'En curso', swatch: 'inset-ring-2 inset-ring-foreground/80' },
  open: { label: 'Abiertos', swatch: 'border border-border' },
  future: { label: 'No empezaron', swatch: 'border border-border/60', muted: true },
}

/** Cuántos meses se nombran de corrido antes de decir «y otros». */
const MAX_NAMED = 4

/** «Octubre 2026» si la clave es un mes; si no (un período de ajustes), el nombre corto. */
function fullName(month: MonthStripMonth): string {
  return formatMonthLabel(month.key) || month.label
}

function monthsText(count: number): string {
  return count === 1 ? '1 mes' : `${count} meses`
}

function namesText(months: readonly MonthStripMonth[]): string {
  const names = months.slice(0, MAX_NAMED).map(fullName)
  if (months.length > MAX_NAMED) return `${names.join(', ')} y otros`
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/** Un mes solo se nombra; varios se cuentan. */
function countOrName(months: readonly MonthStripMonth[]): string {
  const [only] = months
  return months.length === 1 && only ? fullName(only) : monthsText(months.length)
}

/**
 * El casillero. Con esquinas de pestaña (más redondas arriba): es un separador
 * que asoma sobre el panel del mes. Su `<li>` es un contenedor (`@container/cell`):
 * adentro, el ícono y la palabra van en un renglón si el casillero es ancho, y
 * uno sobre otro si no.
 */
const CELL =
  'group/mark relative flex min-h-11 w-full min-w-0 flex-col items-center gap-1 rounded-t-xl rounded-b-md border px-0.5 pt-1.5 pb-2 text-center @min-[4rem]/cell:px-1'

/** Lo que se toca o se enfoca: foco visible, y un relieve corto al pasar o al apretar. */
const TOUCHABLE =
  'outline-none transition-[box-shadow,transform] duration-(--duration-fast) ease-(--ease-out) focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[tip-active]:shadow-sm motion-reduce:transition-none'

const PRESSABLE = 'hover:shadow-sm active:scale-[0.97] motion-reduce:active:scale-100'

function CellBody({ month, link }: { month: MonthStripMonth; link: boolean }) {
  const look = LOOK[month.state]
  const Icon = look.icon
  const future = month.state === 'future'
  return (
    <>
      <span
        className={cn(
          // En un casillero angosto (doce meses en una tablet) la píldora se achica de costado:
          // «May» tiene que entrar entero en 44 px.
          'inline-flex h-7 max-w-full items-center rounded-full px-1 text-xs leading-none transition-colors duration-(--duration-fast) motion-reduce:transition-none @min-[4rem]/cell:px-2.5',
          month.selected
            ? 'bg-foreground font-semibold text-background'
            : future
              ? 'font-medium text-muted-foreground'
              : 'font-semibold text-foreground',
          link && !month.selected && 'group-hover/mark:bg-foreground/8',
        )}
      >
        <span className="truncate">{month.label}</span>
      </span>
      <span
        className={cn(
          'flex max-w-full flex-col items-center gap-0.5 text-[10px] leading-[1.15] font-medium @min-[5.5rem]/cell:flex-row @min-[5.5rem]/cell:gap-1',
          look.wordInk,
        )}
      >
        <Icon aria-hidden className={cn('size-3 shrink-0', look.iconInk)} strokeWidth={2.25} />
        <span className="text-balance">{look.word}</span>
      </span>
      {month.alert ? (
        <span className="flex max-w-full items-center gap-1 text-[10px] leading-[1.15] font-semibold text-foreground">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
          Aviso
        </span>
      ) : null}
    </>
  )
}

function MonthCell({ month }: { month: MonthStripMonth }) {
  const look = LOOK[month.state]
  const name = fullName(month)
  const future = month.state === 'future'
  const href = future ? undefined : month.href
  const state = `${look.word.toLowerCase()}${month.alert ? ', con un aviso' : ''}`
  const spoken = `${name}: ${state}${month.title ? `. ${month.title}` : ''}`
  const current = month.selected ? (href ? 'page' : 'true') : undefined
  const tip = {
    'data-tip-title': name,
    'data-tip-value': month.alert ? `${look.word} · con aviso` : look.word,
    'data-tip-sub': month.title,
  }

  if (href) {
    return (
      // Sin prefetch: son doce pestañas y cada una es una pantalla con sus lecturas.
      <Link
        href={href}
        prefetch={false}
        aria-label={spoken}
        aria-current={current}
        className={cn(CELL, look.cell, TOUCHABLE, PRESSABLE)}
        {...tip}
      >
        <CellBody month={month} link />
      </Link>
    )
  }

  // Sin link pero con detalle: se enfoca para poder leerlo (con el teclado o el dedo).
  if (!future && month.title) {
    return (
      <span
        role="img"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: la pestaña se enfoca para leer su detalle en el globito (contrato de diseño §5); el `aria-label` lo dice entero
        tabIndex={0}
        aria-label={spoken}
        aria-current={current}
        className={cn(CELL, look.cell, TOUCHABLE)}
        {...tip}
      >
        <CellBody month={month} link={false} />
      </span>
    )
  }

  // Todo lo que hay para decir ya está escrito en la pestaña: no se enfoca. El lector de
  // pantalla oye la misma oración que en las demás («Noviembre 2026: no empezó»).
  return (
    <span aria-current={current} title={month.title} className={cn(CELL, look.cell)}>
      <span className="sr-only">{spoken}</span>
      <span aria-hidden className="contents">
        <CellBody month={month} link={false} />
      </span>
    </span>
  )
}

export function MonthStrip({
  months,
  showLegend = false,
  emptyHint,
  ariaLabel,
  className,
}: MonthStripProps) {
  if (months.length === 0) {
    return (
      <ChartEmpty
        silhouette="strip"
        title="Todavía no hay meses para mostrar"
        hint={emptyHint}
        className={className}
      />
    )
  }

  const by = (state: MonthStripState) => months.filter((m) => m.state === state)
  const closed = by('closed')
  const toClose = by('to_close')
  const current = by('current')
  const open = by('open')
  const flagged = months.filter((m) => m.alert)

  const summary =
    ariaLabel ??
    [
      closed.length > 0
        ? `${monthsText(closed.length)} ${closed.length === 1 ? 'cerrado' : 'cerrados'}.`
        : 'Ningún mes cerrado todavía.',
      toClose.length > 0 ? `Falta cerrar ${namesText(toClose)}.` : '',
      current.length > 0 ? `En curso: ${namesText(current)}.` : '',
      open.length > 0
        ? `${monthsText(open.length)} ${open.length === 1 ? 'abierto' : 'abiertos'}.`
        : '',
      flagged.length > 0 ? `Con aviso: ${namesText(flagged)}.` : '',
    ]
      .filter(Boolean)
      .join(' ')

  const rows: LegendRow[] = STATE_ORDER.flatMap((state) => {
    const group = by(state)
    if (group.length === 0) return []
    const legend = LEGEND[state]
    return {
      key: state,
      label: legend.label,
      value: countOrName(group),
      swatch: legend.swatch,
      glyph: legend.glyph,
      muted: legend.muted,
    }
  })
  if (flagged.length > 0) {
    rows.push({
      key: 'aviso',
      label: 'Con aviso',
      value: countOrName(flagged),
      swatch: 'rounded-full bg-destructive',
    })
  }

  return (
    <div className={cn('@container/strip min-w-0 space-y-3', className)}>
      <p className="sr-only">{summary}</p>
      <ChartTip scrub={false}>
        <ol className="grid grid-cols-4 gap-1.5 @min-[34rem]/strip:flex @min-[34rem]/strip:gap-1">
          {months.map((month) => (
            <li
              key={month.key}
              // `flex`: la pestaña ocupa todo el alto de la fila (la más alta manda).
              className="@container/cell flex min-w-0 @min-[34rem]/strip:max-w-28 @min-[34rem]/strip:flex-1"
            >
              <MonthCell month={month} />
            </li>
          ))}
        </ol>
      </ChartTip>

      {showLegend ? <ChartLegend caption="Los meses, por estado" rows={rows} /> : null}
    </div>
  )
}
