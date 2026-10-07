'use client'

import { type ReactNode, useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addDays, formatIsoDay, isRealIsoDay, todayInCordoba } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useAccountingOptional } from './accounting-provider'

export type DateShortcut = { label: string; value: string }

export type DateInputProps = {
  id?: string
  /** `name` del input nativo: viaja como `yyyy-MM-dd`, igual que el resto del panel. */
  name?: string
  /** `yyyy-MM-dd` o `null`. */
  value: string | null
  onValueChange: (iso: string | null) => void
  /** ISO inclusivos. */
  min?: string
  max?: string
  /**
   * Atajos debajo del campo. `true` (default) = «Hoy» y «Ayer» (los de cargar
   * un gasto o un cierre). `false` = ninguno. O una lista propia.
   */
  shortcuts?: boolean | readonly DateShortcut[]
  /** Hoy en Córdoba. Default: el de `AccountingProvider` (`acc_today`) o el reloj. */
  today?: string
  required?: boolean
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  'aria-label'?: string
  className?: string
}

/**
 * Una fecha civil con el mismo campo que usa todo el panel (`<Input
 * type="date">`, el calendario del sistema: en un navegador en castellano se ve
 * dd/mm/aaaa) más los atajos «Hoy» y «Ayer» con el estilo de los de Reservas.
 * El valor es siempre un string ISO, nunca un `Date`.
 */
export function DateInput({
  id: idProp,
  name,
  value,
  onValueChange,
  min,
  max,
  shortcuts = true,
  today: todayProp,
  required,
  disabled,
  invalid,
  className,
  ...aria
}: DateInputProps) {
  const autoId = useId()
  const id = idProp ?? `date-${autoId}`
  const accounting = useAccountingOptional()
  const today = todayProp ?? accounting?.today ?? todayInCordoba()

  const chips: readonly DateShortcut[] =
    shortcuts === true
      ? [
          { label: 'Hoy', value: today },
          { label: 'Ayer', value: addDays(today, -1) },
        ]
      : shortcuts === false
        ? []
        : shortcuts
  const usable = chips.filter((c) => (!min || c.value >= min) && (!max || c.value <= max))

  return (
    <div className={cn('space-y-2', className)}>
      <Input
        id={id}
        name={name}
        type="date"
        value={value ?? ''}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={aria['aria-describedby']}
        aria-label={aria['aria-label']}
        onChange={(e) => {
          const next = e.target.value
          onValueChange(isRealIsoDay(next) ? next : null)
        }}
        className="h-11 text-base md:h-10 md:text-sm"
      />
      {usable.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {usable.map((chip) => {
            const active = value === chip.value
            return (
              <button
                key={chip.label}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                aria-label={`${chip.label}, ${formatIsoDay(chip.value)}`}
                onClick={() => onValueChange(chip.value)}
                className={cn(
                  'h-9 rounded-full border px-3.5 text-xs font-medium transition-colors md:h-7 md:px-3',
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:bg-secondary',
                )}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export type DateFieldProps = DateInputProps & {
  label: ReactNode
  optional?: boolean
  hint?: ReactNode
  error?: string | null
}

/** Etiqueta + `DateInput` + ayuda + error, como los demás campos del panel. */
export function DateField({ label, optional, hint, error, id: idProp, ...input }: DateFieldProps) {
  const autoId = useId()
  const id = idProp ?? `date-${autoId}`
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>
        {label}
        {input.required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        ) : null}
      </Label>
      <DateInput
        {...input}
        id={id}
        invalid={Boolean(error) || input.invalid}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
