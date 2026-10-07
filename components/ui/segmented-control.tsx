'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import type * as React from 'react'
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
 *
 * Si `onValueChange` cambia la URL, la página usa `router.replace`, no `push`:
 * con las flechas se elige en cada tecla y cada una dejaría una entrada en el
 * historial.
 */

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

const trackClasses = 'inline-flex max-w-full items-stretch gap-0.5 rounded-md bg-secondary p-0.5'

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
  disabled,
  required,
  className,
  ...props
}: SegmentedControlProps<T>) {
  const resolvedSize = useControlSize(size)
  const rootClasses = cn(
    trackClasses,
    TRACK_HEIGHT[resolvedSize],
    fullWidth && 'flex w-full',
    className,
  )
  const itemClasses = cn(optionClasses, OPTION_PADDING[resolvedSize], fullWidth && 'flex-1')

  if (isSegmentedLinkMode(items)) {
    const current = value ?? defaultValue
    return (
      <nav
        data-slot="segmented-control"
        data-size={resolvedSize}
        className={rootClasses}
        {...props}
      >
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
    if (item) onValueChange?.(item.value)
  }

  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented-control"
      data-size={resolvedSize}
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
