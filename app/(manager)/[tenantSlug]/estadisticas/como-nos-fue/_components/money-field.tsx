'use client'

import type { FocusEvent, ReactNode, Ref } from 'react'
import { Field } from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
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
 * El aspecto es el del kit (`Field` + `InputGroup`: etiqueta, prefijo `$` o
 * `US$` adentro, ayuda y error con su ícono, 16 px con el dedo para que iOS no
 * haga zoom), pero el comportamiento sigue siendo el de la pauta y NO el del
 * `MoneyField` del kit, a propósito:
 *
 * - el kit lee con `parseMoneyToCents`, que rechaza más de dos decimales
 *   (`0,125`, `1.234,567`) y letras entre los dígitos, cosas que
 *   `parseLocaleNumber` acepta y que la pauta guarda;
 * - el kit frena el envío con `setCustomValidity` y muestra SUS mensajes, y acá
 *   el error lo decide el formulario (`checkMarketingDraft`, el mismo schema del
 *   server) y se muestra recién al salir del campo o al guardar;
 * - los conteos («Mensajes», «Alcance») irían a `NumberField`, que también
 *   tiene su propio parseo y sus mensajes.
 *
 * Cuando el kit tenga un modo «sin validación propia» (el texto y el error los
 * maneja el que llama), esto pasa a ser un `MoneyField` con `decimals="auto"`.
 */

const CURRENCY = {
  usd: { prefix: 'US$', srSuffix: ', en dólares' },
  ars: { prefix: '$', srSuffix: ', en pesos' },
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

  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Field
        id={id}
        label={
          <>
            {label}
            {money ? <span className="sr-only">{money.srSuffix}</span> : null}
          </>
        }
        optional={optional}
        hint={hint}
        error={error}
        disabled={disabled}
      >
        <InputGroup>
          {money ? (
            <InputAddon aria-hidden className="text-subtle-foreground">
              {money.prefix}
            </InputAddon>
          ) : null}
          <Input
            ref={inputRef}
            type="text"
            inputMode={kind === 'count' ? 'numeric' : 'decimal'}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            placeholder={placeholder}
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
            className="type-amount"
          />
        </InputGroup>
      </Field>
      {children}
    </div>
  )
}
