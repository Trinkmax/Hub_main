'use client'

import * as React from 'react'
import { useFieldControl } from '@/components/ui/field'
import { fieldReadOnly, fieldSurface } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type TextareaProps = React.ComponentProps<'textarea'> & {
  /** Atajo de `aria-invalid`. */
  invalid?: boolean
  /** Con `maxLength`, muestra «120 / 500» abajo a la derecha. */
  showCount?: boolean
}

/** Desde qué fracción del máximo el contador se anuncia al lector. */
const ANNOUNCE_FROM = 0.9

function lengthOf(value: React.ComponentProps<'textarea'>['value']): number {
  // Un arreglo se escribe como lo escribiría React: unido por comas.
  return value == null ? 0 : String(value).length
}

/**
 * Texto largo (§3.2). Mismo aspecto que Input; crece con el contenido
 * (`field-sizing: content` en Chromium; Safari usa `rows`) hasta 320 px y
 * después scrollea.
 *
 * `showCount` + `maxLength` suma el contador en `type-caption`. Se anuncia con
 * `aria-live` recién al llegar al 90 %: antes sería ruido en cada tecla.
 */
function Textarea({ className, invalid, showCount = false, onChange, ...props }: TextareaProps) {
  const control = useFieldControl({
    ...props,
    'aria-invalid': invalid ? true : props['aria-invalid'],
  })
  const isControlled = props.value !== undefined
  const [typed, setTyped] = React.useState(() => lengthOf(props.defaultValue))
  const length = isControlled ? lengthOf(props.value) : typed
  const max = props.maxLength
  const counting = showCount && typeof max === 'number' && max > 0

  const textarea = (
    <textarea
      data-slot="textarea"
      {...control}
      onChange={(event) => {
        if (counting && !isControlled) setTyped(event.target.value.length)
        onChange?.(event)
      }}
      className={cn(
        fieldSurface,
        fieldReadOnly,
        'field-sizing-content min-h-20 max-h-80 resize-y overflow-y-auto px-3 py-2',
        'placeholder:text-subtle-foreground',
        className,
      )}
    />
  )

  if (!counting) return textarea

  const near = length >= max * ANNOUNCE_FROM
  return (
    <div data-slot="textarea-wrapper" className="grid gap-1">
      {textarea}
      <p
        data-slot="textarea-count"
        aria-live={near ? 'polite' : 'off'}
        className="justify-self-end type-caption type-amount text-subtle-foreground"
      >
        {length} / {max}
      </p>
    </div>
  )
}

export { Textarea }
