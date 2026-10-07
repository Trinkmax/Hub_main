'use client'

import type { ClipboardEvent } from 'react'
import { scrollIntoViewOnTouch } from '@/components/administracion/money-input'
import { Input } from '@/components/ui/input'
import { splitPastedVoucher } from '@/lib/accounting/paste'
import { cn } from '@/lib/utils'

export type VoucherNumberValue = { pos: string; number: string }

/** Solo dígitos, hasta `max`. */
function digits(text: string, max: number): string {
  return text.replace(/\D/g, '').slice(0, max)
}

/** «3» → «0003»; «12345» queda igual (AFIP admite hasta 5 dígitos). */
export function padPos(pos: string): string {
  return pos === '' ? '' : pos.padStart(4, '0')
}

export function padNumber(number: string): string {
  return number === '' ? '' : number.padStart(8, '0')
}

/** El texto del campo → número (o `null` si está vacío o es cero). */
export function voucherPart(text: string): number | null {
  if (text === '') return null
  const n = Number.parseInt(text, 10)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Punto de venta y número de un comprobante (H.6): dos campos del panel, el
 * teclado numérico en el celular, y pegar «0003-00001290» en cualquiera de
 * los dos completa los dos. Al salir se rellenan los ceros.
 */
export function VoucherNumberInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  onBlur,
  disabled,
}: {
  /** Para el `<label htmlFor>`: va al punto de venta. */
  id: string
  value: VoucherNumberValue
  onChange: (next: VoucherNumberValue) => void
  invalid?: boolean
  describedBy?: string
  /** Al salir del número (para buscar duplicados). */
  onBlur?: (value: VoucherNumberValue) => void
  disabled?: boolean
}) {
  const fromPaste = (text: string): VoucherNumberValue | null => {
    const parsed = splitPastedVoucher(text)
    if (!parsed) return null
    return { pos: padPos(String(parsed.pointOfSale)), number: padNumber(String(parsed.number)) }
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const next = fromPaste(event.clipboardData.getData('text'))
    if (!next) return
    event.preventDefault()
    onChange(next)
    onBlur?.(next)
  }

  const typed = (field: 'pos' | 'number', raw: string) => {
    // «0003-00001290» tipeado o autocompletado de una vez en un solo campo.
    if (/[-\s/]/.test(raw)) {
      const next = fromPaste(raw)
      if (next) {
        onChange(next)
        return
      }
    }
    onChange({ ...value, [field]: digits(raw, field === 'pos' ? 5 : 8) })
  }

  const base = 'h-11 text-base tabular-nums md:h-10 md:text-sm aria-invalid:border-destructive'

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        value={value.pos}
        inputMode="numeric"
        autoComplete="off"
        placeholder="0003"
        aria-label="Punto de venta"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => typed('pos', e.target.value)}
        onPaste={onPaste}
        onFocus={scrollIntoViewOnTouch}
        onBlur={() => {
          const padded = padPos(value.pos)
          if (padded !== value.pos) onChange({ ...value, pos: padded })
        }}
        className={cn(base, 'w-24 shrink-0')}
      />
      <span aria-hidden="true" className="text-muted-foreground">
        –
      </span>
      <Input
        value={value.number}
        inputMode="numeric"
        autoComplete="off"
        placeholder="00001290"
        aria-label="Número del comprobante"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => typed('number', e.target.value)}
        onPaste={onPaste}
        onFocus={scrollIntoViewOnTouch}
        onBlur={() => {
          const next = { ...value, number: padNumber(value.number) }
          if (next.number !== value.number) onChange(next)
          onBlur?.(next)
        }}
        className={cn(base, 'min-w-0 flex-1')}
      />
    </div>
  )
}
