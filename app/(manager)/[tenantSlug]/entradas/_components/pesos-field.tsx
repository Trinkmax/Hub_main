'use client'

import type { ReactNode, Ref } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatPesosInput, sanitizePesosTyping } from '../_lib/experience-form'

/**
 * Un precio en pesos (la base guarda centavos; el dueño nunca los ve).
 *
 * `type="text"` con teclado numérico y no `type="number"`: «35.000» con el
 * punto de miles es como lo escribe cualquiera acá, y un input numérico lo
 * vacía sin avisar. Mientras se tipea solo entran números y separadores; al
 * salir del campo queda prolijo («35000» → «35.000»).
 *
 * `h-11 text-base` en cualquier ancho: con menos de 16px iOS hace zoom.
 */
export function PesosField({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  hint,
  error,
  required,
  inputRef,
  disabled,
  className,
}: {
  id: string
  label: ReactNode
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  inputRef?: Ref<HTMLInputElement>
  disabled?: boolean
  className?: string
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id} className="gap-1">
        {label}
        {required ? (
          <span aria-hidden className="text-destructive">
            *
          </span>
        ) : null}
        <span className="sr-only">, en pesos</span>
      </Label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
        >
          $
        </span>
        <Input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(sanitizePesosTyping(event.target.value))}
          onBlur={() => {
            const pretty = formatPesosInput(value)
            if (pretty !== value) onChange(pretty)
            onBlur?.()
          }}
          className="h-11 pl-7 text-base tabular-nums md:text-base"
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-xs leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs leading-snug text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
