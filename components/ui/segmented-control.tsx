'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import * as React from 'react'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import { formatNumber } from '@/lib/format/number-kind'
import { cn } from '@/lib/utils'

/*
 * Filtro de una sola opción (kit HUB §3.3): «Todos · Con puntos · Solo
 * contacto». No es para secciones: para eso están las pestañas.
 *
 * - Modo radio (lo normal): RadioGroup de Radix, `role="radiogroup"` y
 *   `radio`. Las flechas mueven **y eligen** (semántica de radio) y Tab entra
 *   en la opción elegida. Con `name` participa de un formulario GET.
 * - Modo link: si todos los ítems traen `href` (armado en el server), es un
 *   `<nav>` de links con `aria-current="page"` en el elegido (`value`), mismo
 *   aspecto. Sin `scroll` al cambiar: es un filtro de la misma página.
 * - **Cuando no entra** (seis opciones con sus cuentas en un celular de 360
 *   px), `overflow` decide: `scroll` (default) desplaza la pista de costado,
 *   sin barra, con un fundido en el borde que tiene más opciones y la elegida
 *   siempre a la vista; `wrap` baja las opciones a otra fila. Sin envoltorios
 *   con `overflow-x-auto` a mano.
 *
 * Si `onValueChange` cambia la URL, la página usa `router.replace`, no `push`:
 * con las flechas se elige en cada tecla y cada una dejaría una entrada en el
 * historial.
 */

/** Qué borde de la pista se funde: el que tiene más opciones del otro lado. */
export type SegmentedFade = 'start' | 'end' | 'both' | null

/**
 * El fundido según el desplazamiento de la pista (1 px de tolerancia: el
 * redondeo de los anchos fraccionarios no deja un fundido fantasma).
 */
export function segmentedFade(scroll: {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}): SegmentedFade {
  const left = Math.abs(scroll.scrollLeft)
  const hiddenStart = left > 1
  const hiddenEnd = scroll.scrollWidth - scroll.clientWidth - left > 1
  if (hiddenStart && hiddenEnd) return 'both'
  if (hiddenStart) return 'start'
  if (hiddenEnd) return 'end'
  return null
}

/**
 * El `scrollLeft` que deja una opción a la vista, con `margin` de aire para que
 * no quede bajo el fundido; `null` si ya se ve entera. Las posiciones son del
 * contenido de la pista (la opción mide de `start` a `end`).
 */
export function segmentedRevealLeft(
  view: { scrollLeft: number; clientWidth: number },
  item: { start: number; end: number },
  margin = 24,
): number | null {
  const from = view.scrollLeft
  const to = view.scrollLeft + view.clientWidth
  if (item.start - margin < from) return Math.max(0, item.start - margin)
  if (item.end + margin > to) return item.end + margin - view.clientWidth
  return null
}

export type SegmentedItem<T extends string> = {
  value: T
  label: React.ReactNode
  count?: number
  /**
   * Ícono de 16 px antes de la etiqueta. Es un componente: desde un Server
   * Component no cruza al cliente, así que ahí el ícono va adentro de `label`
   * (toma el mismo tamaño).
   */
  icon?: LucideIcon
  disabled?: boolean
  /** Modo link: solo si lo traen todos los ítems. */
  href?: string
}

export type SegmentedControlProps<T extends string> = Omit<
  React.ComponentProps<'div'>,
  'children' | 'defaultValue' | 'dir' | 'onChange' | 'ref'
> & {
  items: ReadonlyArray<SegmentedItem<T>>
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  /** Filtros por GET: el valor elegido viaja con el formulario que lo contiene. */
  name?: string
  /** Sin `size`, el del `ControlSizeProvider` más cercano o `md`. */
  size?: 'sm' | 'md'
  /** Ocupa todo el ancho y reparte las opciones en partes iguales. */
  fullWidth?: boolean
  /**
   * Si las opciones no entran: `scroll` (default) desplaza la pista con un
   * fundido en el borde que tiene más · `wrap` las baja a otra fila.
   */
  overflow?: 'scroll' | 'wrap'
  disabled?: boolean
  required?: boolean
  'aria-label': string
}

/** Modo link: todos los ítems traen `href`. Con uno solo sin `href` es modo radio. */
export function isSegmentedLinkMode(items: ReadonlyArray<{ href?: string }>): boolean {
  return items.length > 0 && items.every((item) => typeof item.href === 'string')
}

/** La pista es del alto del control (32/36/44 con mouse, 36/44/48 con el dedo). */
const TRACK_HEIGHT: Readonly<Record<ControlSize, string>> = {
  sm: 'h-(--control-sm)',
  md: 'h-(--control-md)',
  lg: 'h-(--control-lg)',
}

const OPTION_PADDING: Readonly<Record<ControlSize, string>> = {
  sm: 'px-2.5',
  md: 'px-3',
  lg: 'px-4',
}

/** En `wrap` la pista crece con las filas: el alto del control pasa a ser el mínimo. */
const TRACK_MIN_HEIGHT: Readonly<Record<ControlSize, string>> = {
  sm: 'min-h-(--control-sm)',
  md: 'min-h-(--control-md)',
  lg: 'min-h-(--control-lg)',
}

/** Y cada opción conserva el alto que tiene adentro de una pista de una fila (menos el p-0.5). */
const OPTION_WRAP_HEIGHT: Readonly<Record<ControlSize, string>> = {
  sm: 'min-h-[calc(var(--control-sm)-0.25rem)]',
  md: 'min-h-[calc(var(--control-md)-0.25rem)]',
  lg: 'min-h-[calc(var(--control-lg)-0.25rem)]',
}

const trackClasses = 'inline-flex max-w-full items-stretch gap-0.5 rounded-md bg-secondary p-0.5'

/**
 * `scroll`: la pista se desplaza de costado, sin barra (en el celular se arrastra;
 * con el teclado, las flechas llevan la opción enfocada a la vista) y sin
 * arrastrar la página. El fundido de 24 px va en el borde que esconde opciones
 * (`data-fade`, que calcula `segmentedFade`).
 */
const SCROLL_CLASSES = [
  'overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
  'data-[fade=start]:[mask-image:linear-gradient(to_right,transparent,#000_1.5rem)]',
  'data-[fade=end]:[mask-image:linear-gradient(to_left,transparent,#000_1.5rem)]',
  'data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%-1.5rem),transparent)]',
].join(' ')

/**
 * El fundido de la pista con `overflow="scroll"`, al día con el desplazamiento
 * y con los cambios de tamaño; y la opción elegida a la vista cuando cambia
 * (sin mover la página: se toca solo el `scrollLeft` de la pista).
 */
function useTrackScroll(
  trackRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  selected: string | undefined,
  itemsKey: string,
): SegmentedFade {
  const [fade, setFade] = React.useState<SegmentedFade>(null)

  React.useEffect(() => {
    const track = trackRef.current
    // Sin opciones no hay nada que medir; con otras (`itemsKey`), se vuelven a observar.
    if (!enabled || !track || itemsKey === '') return
    const update = () => setFade(segmentedFade(track))
    update()
    track.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (observer) {
      observer.observe(track)
      // Una cuenta que cambia (12 → 1.204) agranda una opción sin cambiar la pista.
      for (const option of Array.from(track.children)) observer.observe(option)
    }
    return () => {
      track.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [trackRef, enabled, itemsKey])

  React.useEffect(() => {
    const track = trackRef.current
    if (!enabled || !track || selected === undefined) return
    const option = track.querySelector<HTMLElement>('[data-state="checked"]')
    if (!option) return
    const trackBox = track.getBoundingClientRect()
    const box = option.getBoundingClientRect()
    const start = box.left - trackBox.left + track.scrollLeft
    const left = segmentedRevealLeft(
      { scrollLeft: track.scrollLeft, clientWidth: track.clientWidth },
      { start, end: start + box.width },
    )
    if (left !== null) track.scrollLeft = left
  }, [trackRef, enabled, selected])

  return enabled ? fade : null
}

/**
 * La elegida: cartulina + contorno de 1 px `--primary` + texto en tinta, sin
 * sombra (8,54:1 contra la pista; dorado 6,95 en oscuro). El borde
 * transparente de las otras evita que la elegida salte 1 px; en alto
 * contraste ese transparente se pintaría, por eso va en `Canvas` y la elegida
 * en `Highlight`. Sin transición: el cambio es instantáneo.
 */
const optionClasses = [
  'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-transparent type-label text-muted-foreground',
  'hover:text-foreground',
  'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
  'disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50',
  'forced-colors:border-[Canvas]',
  'data-[state=checked]:border-primary data-[state=checked]:bg-card data-[state=checked]:text-foreground forced-colors:data-[state=checked]:border-[Highlight]',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
].join(' ')

function OptionContent<T extends string>({ item }: { item: SegmentedItem<T> }) {
  const Icon = item.icon
  return (
    <>
      {Icon ? <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} /> : null}
      {item.label}
      {item.count !== undefined ? (
        <span data-slot="segmented-count" className="type-caption type-amount">
          {formatNumber(item.count)}
        </span>
      ) : null}
    </>
  )
}

function SegmentedControl<T extends string>({
  items,
  value,
  defaultValue,
  onValueChange,
  name,
  size,
  fullWidth = false,
  overflow = 'scroll',
  disabled,
  required,
  className,
  ...props
}: SegmentedControlProps<T>) {
  const resolvedSize = useControlSize(size)
  const trackRef = React.useRef<HTMLElement | null>(null)
  const setTrack = React.useCallback((node: HTMLElement | null) => {
    trackRef.current = node
  }, [])
  // Sin `value` (no controlado), lo elegido lo sabe Radix: se anota para mostrarlo.
  const [chosen, setChosen] = React.useState(defaultValue)
  const wrap = overflow === 'wrap'
  const fade = useTrackScroll(
    trackRef,
    overflow === 'scroll',
    value ?? chosen,
    items.map((item) => item.value).join('\u0000'),
  )
  const rootClasses = cn(
    trackClasses,
    wrap ? ['h-auto flex-wrap', TRACK_MIN_HEIGHT[resolvedSize]] : TRACK_HEIGHT[resolvedSize],
    overflow === 'scroll' && SCROLL_CLASSES,
    fullWidth && 'flex w-full',
    className,
  )
  const itemClasses = cn(
    optionClasses,
    OPTION_PADDING[resolvedSize],
    wrap && OPTION_WRAP_HEIGHT[resolvedSize],
    fullWidth && 'flex-1',
  )
  const rootData = {
    'data-slot': 'segmented-control',
    'data-size': resolvedSize,
    'data-overflow': overflow,
    'data-fade': fade ?? undefined,
  }

  if (isSegmentedLinkMode(items)) {
    const current = value ?? defaultValue
    return (
      <nav ref={setTrack} {...rootData} className={rootClasses} {...props}>
        {items.map((item) => {
          const state = item.value === current ? 'checked' : 'unchecked'
          // Un link deshabilitado no es un link: queda como texto, fuera del orden de Tab.
          if (item.disabled || disabled || item.href === undefined) {
            return (
              <span
                key={item.value}
                data-slot="segmented-option"
                data-state={state}
                data-disabled=""
                className={itemClasses}
              >
                <OptionContent item={item} />
              </span>
            )
          }
          return (
            <Link
              key={item.value}
              href={item.href}
              scroll={false}
              data-slot="segmented-option"
              data-state={state}
              aria-current={state === 'checked' ? 'page' : undefined}
              className={itemClasses}
            >
              <OptionContent item={item} />
            </Link>
          )
        })}
      </nav>
    )
  }

  // Radix devuelve un string: se busca el ítem para devolver el valor tipado.
  const handleValueChange = (next: string) => {
    const item = items.find((candidate) => candidate.value === next)
    if (!item) return
    setChosen(item.value)
    onValueChange?.(item.value)
  }

  return (
    <RadioGroupPrimitive.Root
      ref={setTrack}
      {...rootData}
      value={value}
      defaultValue={defaultValue}
      onValueChange={handleValueChange}
      name={name}
      disabled={disabled}
      required={required}
      loop
      className={rootClasses}
      {...props}
    >
      {items.map((item) => (
        <RadioGroupPrimitive.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          data-slot="segmented-option"
          className={itemClasses}
        >
          <OptionContent item={item} />
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}

export { SegmentedControl }
