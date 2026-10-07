'use client'

import { Slot, Slottable } from '@radix-ui/react-slot'
import { Check, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { formatNumber } from '@/lib/format/number-kind'
import { cn } from '@/lib/utils'

/*
 * Filtros que se suman (kit HUB §3.3): tamaño de mesa, servicios, segmentos.
 * Reemplaza a los 27 grupos hechos a mano con `aria-pressed`.
 *
 * Activo y segmentado elegido hablan igual: cartulina con contorno verde (el
 * borrador pintaba el activo con `bg-brand-soft` y sin borde, y se veía más
 * apagado que el inactivo). El activo suma un check adelante: forma, no solo
 * color.
 */

export type FilterChipProps = React.ComponentProps<'button'> & {
  /** Controlado. */
  pressed?: boolean
  /** No controlado: el chip lleva su propio estado. */
  defaultPressed?: boolean
  onPressedChange?: (pressed: boolean) => void
  count?: number
  /**
   * Ícono de 16 px antes de la etiqueta; el check del activo lo reemplaza. Es
   * un componente: desde un Server Component va como hijo, no por acá.
   */
  icon?: LucideIcon
  /** Sin `size`, el alto de la fila (`ControlSizeProvider`) o `sm`. */
  size?: 'sm' | 'md'
  /**
   * Para un `<Link>`: el chip dibuja el link, que lleva `aria-current="page"`
   * cuando está activo en vez de `aria-pressed` (un link no se aprieta). El
   * estado sale de `pressed`.
   */
  asChild?: boolean
}

/** El estado que se dibuja: el controlado si vino, si no el propio. */
export function resolvePressed(pressed: boolean | undefined, own: boolean): boolean {
  return pressed ?? own
}

/**
 * Sin `size` toma el alto de la fila por CSS (`--control-h` lo declara el
 * `ControlSizeProvider`, como en el Button) y si no hay fila, `sm`. Con el
 * dedo, `hit-area` lleva el objetivo a 44 px sin agrandar el dibujo; entre
 * chips va `gap-2` para que las áreas no se pisen.
 */
const SIZE_CLASSES = {
  auto: 'h-[var(--control-h,var(--control-sm))] px-3',
  sm: 'h-(--control-sm) px-3',
  md: 'h-(--control-md) px-3.5',
} as const

const chipClasses = [
  'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border-strong type-label text-muted-foreground',
  'hit-area press',
  'hover:bg-hover hover:text-foreground',
  'outline-offset-2 outline-(--ring) focus-visible:outline-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'data-[state=on]:border-primary data-[state=on]:bg-card data-[state=on]:text-foreground forced-colors:data-[state=on]:border-[Highlight]',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
].join(' ')

function FilterChip({
  pressed,
  defaultPressed = false,
  onPressedChange,
  count,
  icon: Icon,
  size,
  asChild = false,
  className,
  children,
  onClick,
  type = 'button',
  ...props
}: FilterChipProps) {
  const [own, setOwn] = React.useState(defaultPressed)
  const isPressed = resolvePressed(pressed, own)
  const state = isPressed ? 'on' : 'off'
  const classes = cn(chipClasses, SIZE_CLASSES[size ?? 'auto'], className)

  const lead = isPressed ? (
    <Check
      data-slot="filter-chip-check"
      aria-hidden="true"
      className="size-3.5 text-primary"
      strokeWidth={2.5}
    />
  ) : Icon ? (
    <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
  ) : null
  const countNode =
    count !== undefined ? (
      <span data-slot="filter-chip-count" className="type-caption type-amount">
        {formatNumber(count)}
      </span>
    ) : null

  if (asChild) {
    return (
      <Slot
        {...props}
        onClick={onClick}
        data-slot="filter-chip"
        data-state={state}
        aria-current={isPressed ? 'page' : undefined}
        className={classes}
      >
        {lead}
        <Slottable>{children}</Slottable>
        {countNode}
      </Slot>
    )
  }

  return (
    <button
      {...props}
      type={type}
      data-slot="filter-chip"
      data-state={state}
      aria-pressed={isPressed}
      className={classes}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        const next = !isPressed
        if (pressed === undefined) setOwn(next)
        onPressedChange?.(next)
      }}
    >
      {lead}
      {children}
      {countNode}
    </button>
  )
}

export type ChipGroupProps = React.ComponentProps<'fieldset'> & {
  /** Nombra el grupo: «Tamaño de la mesa», «Servicios». */
  'aria-label': string
}

/**
 * El grupo: un `<fieldset>` (su rol implícito es `group`) con nombre, en fila
 * con `gap-2` para que las áreas táctiles no se pisen. El preflight ya le saca
 * borde y relleno; `min-w-0` le saca el `min-inline-size: min-content` del
 * navegador, que no lo dejaba achicarse en una fila flex. Con `disabled`
 * deshabilita todos los chips de adentro.
 */
function ChipGroup({ className, ...props }: ChipGroupProps) {
  return (
    <fieldset
      data-slot="chip-group"
      className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}
      {...props}
    />
  )
}

export { ChipGroup, FilterChip }
