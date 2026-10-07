'use client'

import type { LucideIcon } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import * as React from 'react'
import { useFieldControl, useFieldLabelId } from '@/components/ui/field'
import { cn } from '@/lib/utils'

export type RadioCardsItem = {
  value: string
  label: React.ReactNode
  description?: React.ReactNode
  icon?: LucideIcon
  /** Un dato al costado de la etiqueta («Recomendado», un monto). */
  meta?: React.ReactNode
  disabled?: boolean
}

export type RadioCardsProps = Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Root>,
  'children' | 'orientation' | 'dir' | 'loop'
> & {
  items: readonly RadioCardsItem[]
  columns?: 1 | 2 | 3
  size?: 'sm' | 'md'
  /** Atajo de `aria-invalid`. */
  invalid?: boolean
  /** Solo lectura: se ve y se enfoca, pero no cambia. */
  readOnly?: boolean
}

/** Un click que no tiene que elegir nada: Radix no marca si el evento viene cancelado. */
function preventCheck(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

const COLUMNS = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' } as const

/**
 * Elegir una opción entre pocas, cuando cada una necesita una línea de
 * explicación (§3.2): tipo de premio de bienvenida, medio de pago, «Nuevo
 * gasto» con o sin factura.
 *
 * - RadioGroup de Radix: las flechas mueven y eligen. La descripción va en
 *   `aria-describedby` de cada tarjeta y no en su nombre.
 * - Elegida: borde verde + `ring-1` + punto de radio relleno arriba a la
 *   derecha (forma además de color; el punto es SVG con `currentColor`, así se
 *   ve en alto contraste).
 * - Foco «afuera», en toda la tarjeta. Sin `press`: es una tarjeta.
 * - Adentro de un `Field`, la etiqueta del Field nombra al grupo
 *   (`aria-labelledby`: un `<label for>` no sirve para un grupo).
 */
function RadioCards({
  items,
  columns = 1,
  size = 'md',
  invalid,
  readOnly,
  className,
  ...props
}: RadioCardsProps) {
  const baseId = React.useId()
  const fieldLabelId = useFieldLabelId()
  const control = useFieldControl({
    ...props,
    readOnly,
    'aria-invalid': invalid ? true : props['aria-invalid'],
  })
  const { readOnly: isReadOnly, ...rootProps } = control
  const labelledBy = props['aria-labelledby'] ?? (props['aria-label'] ? undefined : fieldLabelId)

  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-cards"
      aria-readonly={isReadOnly ? true : undefined}
      {...rootProps}
      aria-labelledby={labelledBy}
      className={cn('group/radio-cards grid gap-2', COLUMNS[columns], className)}
    >
      {items.map((item, index) => {
        const labelId = `${baseId}-${index}-label`
        const descriptionId = item.description ? `${baseId}-${index}-description` : undefined
        const Icon = item.icon
        return (
          <RadioGroupPrimitive.Item
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            onClick={isReadOnly ? preventCheck : undefined}
            data-slot="radio-card"
            className={cn(
              'group/radio-card relative flex w-full items-start gap-3 rounded-lg border border-border-strong bg-card text-start',
              size === 'sm' ? 'p-3' : 'p-4',
              'transition-colors duration-(--duration-quick) hover:bg-muted',
              'outline-offset-2 outline-(--ring) focus-visible:outline-2',
              'data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary',
              'group-aria-invalid/radio-cards:border-destructive',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {Icon ? (
              <Icon
                className="mt-px size-5 shrink-0 text-muted-foreground group-data-[state=checked]/radio-card:text-primary"
                aria-hidden
              />
            ) : null}
            <span className="grid min-w-0 flex-1 gap-0.5 pe-6">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span id={labelId} className="type-label text-foreground">
                  {item.label}
                </span>
                {item.meta ? (
                  <span className="type-caption type-amount text-muted-foreground">
                    {item.meta}
                  </span>
                ) : null}
              </span>
              {item.description ? (
                <span id={descriptionId} className="type-caption text-pretty text-muted-foreground">
                  {item.description}
                </span>
              ) : null}
            </span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
              className={cn(
                'absolute end-3 size-4 text-input group-data-[state=checked]/radio-card:text-primary',
                size === 'sm' ? 'top-3' : 'top-4',
              )}
            >
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle
                cx="8"
                cy="8"
                r="3.5"
                fill="currentColor"
                className="hidden group-data-[state=checked]/radio-card:block"
              />
            </svg>
          </RadioGroupPrimitive.Item>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}

export { RadioCards }
