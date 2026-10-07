'use client'

import type * as React from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'

/*
 * Compatibilidad (kit HUB §3.9): `SlidingTabs` es un envoltorio de
 * `SegmentedControl`. La píldora deslizante se fue (un filtro que se toca
 * muchas veces no necesita medir anchos con ResizeObserver) y con ella el
 * «tablist sin paneles ni flechas»: ahora es un `radiogroup` en el que las
 * flechas mueven y eligen.
 *
 * Lo que es una sección (Club, «Cómo nos fue») pasa a `Tabs` en su lote; lo
 * que es un filtro, a `SegmentedControl`. Ojo con `onChange` que navega: con
 * las flechas se elige en cada tecla, así que va con `router.replace`.
 */

/** @deprecated Usá `SegmentedItem` de `@/components/ui/segmented-control`. */
export type SlidingTab<T extends string> = {
  value: T
  label: React.ReactNode
}

export type SlidingTabsProps<T extends string> = Omit<
  React.ComponentProps<'div'>,
  'children' | 'defaultValue' | 'dir' | 'onChange' | 'ref'
> & {
  tabs: ReadonlyArray<SlidingTab<T>>
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  /** Default «Vista»: el viejo no nombraba el grupo. */
  'aria-label'?: string
}

/**
 * @deprecated Usá `SegmentedControl` (filtros) o `Tabs` (secciones). Mismas
 * props de siempre: `tabs`, `value`, `onChange`, `size` y `className`.
 */
export function SlidingTabs<T extends string>({
  tabs,
  value,
  onChange,
  size,
  'aria-label': ariaLabel = 'Vista',
  ...props
}: SlidingTabsProps<T>): React.JSX.Element {
  return (
    <SegmentedControl
      {...props}
      items={tabs}
      value={value}
      onValueChange={onChange}
      size={size}
      aria-label={ariaLabel}
    />
  )
}
