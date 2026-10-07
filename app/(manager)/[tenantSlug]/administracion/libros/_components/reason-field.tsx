'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export const REASON_MIN = 5
export const REASON_MAX = 300

/** El texto de zod (`reasonField`), para avisar antes de mandar. */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length
  if (length < REASON_MIN) return 'Contá brevemente el motivo (al menos 5 letras).'
  if (length > REASON_MAX) return 'El motivo puede tener hasta 300 caracteres.'
  return null
}

/**
 * El motivo de una anulación o una reapertura (H.14, H.15): queda guardado y
 * lo ve la contadora. 5 a 300 letras.
 */
export function ReasonField({
  value,
  onChange,
  error,
  disabled,
  label = '¿Por qué?',
  hint = 'Queda guardado y lo ve la contadora.',
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  error: string | null
  disabled: boolean
  label?: string
  hint?: string
  placeholder?: string
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        <span aria-hidden="true" className="ml-0.5 text-destructive">
          *
        </span>
      </Label>
      <Textarea
        id={id}
        value={value}
        rows={3}
        maxLength={REASON_MAX}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        onChange={(e) => onChange(e.target.value)}
        className="text-base md:text-sm"
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
