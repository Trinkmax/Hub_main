'use client'

import type { FocusEvent, ReactNode, Ref } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { canonicalInput, type NumberKind, parseLocaleNumber } from '@/lib/salon/event-marketing'
import { cn } from '@/lib/utils'

/**
 * Un campo de número de la pauta: plata, dólar o conteo.
 *
 * `type="text"` y no `number` a propósito: el dueño pega `US$175,26` o
 * `1,234.50` desde Ads Manager, y un `<input type="number">` los vacía sin
 * avisar (o los lee al revés según el idioma del navegador). Lo que se tipea se
 * lee con `parseLocaleNumber` y, al salir del campo, se reescribe prolijo con
 * `canonicalInput` (`1,234.50` → `1.234,50`), así el dueño ve lo que se va a
 * guardar antes de guardarlo.
 *
 * `h-11 text-base` en cualquier ancho: con menos de 16px iOS hace zoom al
 * enfocar y el form queda corrido.
 */

const CURRENCY = {
  usd: { prefix: 'US$', padding: 'pl-12', srSuffix: ', en dólares' },
  ars: { prefix: '$', padding: 'pl-7', srSuffix: ', en pesos' },
} as const

/**
 * En pantallas táctiles el teclado tapa la mitad de abajo: el campo con foco va
 * al centro. Con mouse no se mueve nada (el campo ya está donde se hizo click).
 */
export function scrollIntoViewOnTouch(event: FocusEvent<HTMLElement>): void {
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return
  event.currentTarget.scrollIntoView({ block: 'center' })
}

export type MoneyFieldProps = {
  id: string
  label: string
  optional?: boolean
  kind: NumberKind
  /** `null` = conteo, sin prefijo. */
  currency: 'usd' | 'ars' | null
  value: string
  onValueChange: (value: string) => void
  onBlur?: () => void
  /** «En Meta: «Importe gastado»», o para qué sirve el campo. */
  hint?: ReactNode
  /** Solo lo que YA hay que mostrar (después del blur o del submit). */
  error?: string | null
  placeholder?: string
  inputRef?: Ref<HTMLInputElement>
  disabled?: boolean
  /** Algo debajo del campo, como el chip del último dólar. */
  children?: ReactNode
  className?: string
}

export function MoneyField({
  id,
  label,
  optional,
  kind,
  currency,
  value,
  onValueChange,
  onBlur,
  hint,
  error,
  placeholder,
  inputRef,
  disabled,
  children,
  className,
}: MoneyFieldProps) {
  const money = currency ? CURRENCY[currency] : null
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id} className="gap-1 text-xs">
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(opcional)</span> : null}
        {money ? <span className="sr-only">{money.srSuffix}</span> : null}
      </Label>
      <div className="relative">
        {money ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {money.prefix}
          </span>
        ) : null}
        <Input
          ref={inputRef}
          id={id}
          type="text"
          inputMode={kind === 'count' ? 'numeric' : 'decimal'}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onValueChange(e.target.value)}
          onFocus={scrollIntoViewOnTouch}
          onBlur={() => {
            const parsed = parseLocaleNumber(value, kind)
            if (parsed.ok) {
              const canonical = canonicalInput(parsed.value, kind)
              if (canonical !== value) onValueChange(canonical)
            }
            onBlur?.()
          }}
          className={cn('h-11 text-base tabular-nums md:text-base', money?.padding)}
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs leading-snug text-destructive">
          {error}
        </p>
      ) : null}
      {children}
    </div>
  )
}
