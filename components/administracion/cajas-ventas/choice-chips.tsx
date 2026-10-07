'use client'

import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { cn } from '@/lib/utils'

export type ChoiceChip<T extends string> = {
  value: T
  label: ReactNode
  /** Para lectores, si `label` no alcanza (p. ej. un saldo al lado del nombre). */
  ariaLabel?: string
  disabled?: boolean
}

/**
 * Una elección de pocas opciones a la vista (¿Quién te pagó?, Entró o Salió,
 * los atajos de «Mover plata»): chips como los de período de Reservas, con el
 * patrón de radio de WAI-ARIA (flechas para moverse, una sola parada de Tab).
 * 44 px en el celular.
 */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  className,
  size = 'md',
}: {
  options: readonly ChoiceChip<T>[]
  value: T | null
  onChange: (value: T) => void
  /** Para lectores, si no hay una etiqueta visible con `labelledBy`. */
  label?: string
  labelledBy?: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = options.filter((o) => !o.disabled)
  const focusable =
    value !== null && enabled.some((o) => o.value === value) ? value : enabled[0]?.value

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (delta === 0) return
    event.preventDefault()
    for (let step = 1; step <= options.length; step++) {
      const next = (index + delta * step + options.length) % options.length
      const option = options[next]
      if (option && !option.disabled) {
        onChange(option.value)
        refs.current[next]?.focus()
        return
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: radiogroup de WAI-ARIA con botones (chips con flechas y una sola parada de Tab)
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel}
            disabled={option.disabled}
            tabIndex={option.value === focusable ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              size === 'sm' ? 'h-9 px-3.5 text-xs md:h-7 md:px-3' : 'h-11 px-4 text-sm md:h-9',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-secondary',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
