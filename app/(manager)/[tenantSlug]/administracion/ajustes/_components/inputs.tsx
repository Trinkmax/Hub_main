'use client'

import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CUIT_MESSAGES, formatCuit, parseCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { bpToPercentInput, parsePercentToBp } from '../_lib/percent'

/**
 * Campos chicos de Ajustes y de la puesta en marcha, con el `Input` del
 * panel: 44 px y 16 px de fuente en el celular (iOS no hace zoom).
 */

export const INPUT_CLASS = 'h-11 text-base md:h-10 md:text-sm'

/** «1,5 %»: se escribe el porcentaje; al salir del campo queda prolijo («1.5» → «1,5»). */
export function PercentInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  placeholder,
  disabled,
  className,
}: {
  id: string
  value: string
  onChange: (text: string) => void
  invalid?: boolean
  describedBy?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const parsed = parsePercentToBp(value)
          if (parsed.ok && parsed.bp !== null) {
            const tidy = bpToPercentInput(parsed.bp)
            if (tidy !== value) onChange(tidy)
          }
        }}
        className={cn(INPUT_CLASS, 'pr-8 tabular-nums')}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base text-muted-foreground md:text-sm"
      >
        %
      </span>
    </div>
  )
}

/** El mensaje de un CUIT que no se lee (vacío = sin error: el CUIT es opcional). */
export function cuitIssue(text: string): string | null {
  if (text.trim() === '') return null
  const parsed = parseCuit(text)
  if (parsed.ok) return null
  const message = CUIT_MESSAGES[parsed.reason]
  return message.endsWith('.') ? message : `${message}.`
}

/** CUIT con la máscara XX-XXXXXXXX-X al salir del campo; el error se avisa al salir. */
export function CuitInput({
  id,
  value,
  onChange,
  onBlurCheck,
  invalid,
  describedBy,
  disabled,
}: {
  id: string
  value: string
  onChange: (text: string) => void
  /** Al salir del campo: el error de lectura (o `null`). */
  onBlurCheck?: (issue: string | null) => void
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
}) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={16}
      placeholder="30-12345678-9"
      value={value}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const issue = cuitIssue(value)
        if (!issue && value.trim() !== '') {
          const tidy = formatCuit(value)
          if (tidy !== value) onChange(tidy)
        }
        onBlurCheck?.(issue)
      }}
      className={cn(INPUT_CLASS, 'tabular-nums')}
    />
  )
}

/** Fila con interruptor (como «Derivar solo las de 5 estrellas» de Reseñas). */
export function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
  children,
}: {
  id: string
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('rounded-lg border bg-background/50 p-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          {description ? (
            <p id={`${id}-desc`} className="text-xs text-muted-foreground text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-describedby={description ? `${id}-desc` : undefined}
          className="mt-0.5"
        />
      </div>
      {children}
    </div>
  )
}
