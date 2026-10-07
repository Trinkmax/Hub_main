'use client'

import * as React from 'react'
import {
  useField,
  useFieldErrorReporter,
  useFormReset,
  WithoutFieldName,
} from '@/components/ui/field'
import { Input, type InputProps } from '@/components/ui/input'
import {
  CUIT_MESSAGES,
  formatCuit,
  normalizeCuit,
  POINT_OF_SALE_DIGITS,
  padDocNumber,
  padPv,
  parseCuit,
  VOUCHER_NUMBER_DIGITS,
} from '@/lib/fiscal'
import { cn } from '@/lib/utils'

export type CodeKind = 'cuit' | 'pv' | 'doc-number'

/** Dígitos que entran en cada código. */
const MAX_DIGITS: Record<CodeKind, number> = {
  cuit: 11,
  pv: POINT_OF_SALE_DIGITS,
  'doc-number': VOUCHER_NUMBER_DIGITS,
}

const DEFAULT_PAD: Record<Exclude<CodeKind, 'cuit'>, number> = {
  pv: POINT_OF_SALE_DIGITS,
  'doc-number': VOUCHER_NUMBER_DIGITS,
}

/** Mensajes de los códigos que no son CUIT (el del CUIT viene de `lib/fiscal`). */
export const CODE_FIELD_MESSAGES = {
  docNumberZero: 'El número de comprobante empieza en 1.',
} as const

/**
 * Lo que se tipea, saneado: en el CUIT se aceptan guiones, espacios, puntos y
 * barras (se tipea o se pega «20-12345678-6», «20 12345678 6»…) y se cortan
 * los dígitos que sobran; en punto de venta y número, solo dígitos.
 */
export function sanitizeCodeInput(kind: CodeKind, raw: string): string {
  const max = MAX_DIGITS[kind]
  if (kind !== 'cuit') return raw.replace(/\D/g, '').slice(0, max)
  let digits = 0
  let out = ''
  for (const char of raw) {
    if (/\d/.test(char)) {
      if (digits === max) continue
      digits++
      out += char
    } else if (/[\s\-./]/.test(char)) {
      out += char
    }
  }
  return out
}

/**
 * El valor canónico (el del `<input type="hidden">` y de `onValueChange`):
 * solo dígitos; punto de venta y número, con ceros a la izquierda.
 * `"20-12345678-6"` → `"20123456786"` · `"3"` → `"00003"` · `""` → `""`.
 */
export function canonicalCode(kind: CodeKind, text: string, pad?: number): string {
  const digits = normalizeCuit(text).slice(0, MAX_DIGITS[kind])
  if (digits === '' || kind === 'cuit') return digits
  const width = pad ?? DEFAULT_PAD[kind]
  return kind === 'pv' ? padPv(digits, width) : padDocNumber(digits, width)
}

/** Cómo se muestra al salir del campo (o al montar con un valor). */
export function displayCode(kind: CodeKind, text: string, pad?: number): string {
  if (kind === 'cuit') {
    const digits = normalizeCuit(text)
    // Con 11 dígitos, con guiones; si no, lo tipeado tal cual (junto al error).
    return digits.length === 11 ? formatCuit(digits) : text.trim()
  }
  return canonicalCode(kind, text, pad)
}

/** El error local al salir del campo, o `null`. Vacío no es error: lo obligatorio lo dice `required`. */
export function validateCode(kind: CodeKind, text: string): string | null {
  const digits = normalizeCuit(text)
  if (digits === '') return null
  if (kind === 'cuit') {
    const parsed = parseCuit(text)
    return parsed.ok ? null : CUIT_MESSAGES[parsed.reason]
  }
  if (kind === 'doc-number' && Number(digits) === 0) return CODE_FIELD_MESSAGES.docNumberZero
  return null
}

export type CodeFieldProps = Omit<
  InputProps,
  'type' | 'inputMode' | 'value' | 'defaultValue' | 'onChange'
> & {
  kind: CodeKind
  /** Va en el `<input type="hidden">`, con solo dígitos: `"20123456786"` · `"00003"` · `"00001290"`. */
  name?: string
  /** Dígitos (con o sin ceros, con o sin guiones). */
  value?: string
  defaultValue?: string
  /** Recibe el valor canónico en cada cambio (el mismo del hidden). */
  onValueChange?: (digits: string) => void
  /** Ceros a la izquierda. pv: 5 (formato ARCA vigente; los de 4 se leen igual) · doc-number: 8. */
  pad?: number
}

/**
 * Códigos que son números pero no cantidades (§3.2): CUIT, punto de venta y
 * número de comprobante. Llevan ceros a la izquierda, guiones fijos o dígito
 * verificador: un NumberField les sumaría flechas y les comería los ceros, y
 * un Input suelto no los valida.
 *
 * - `type="text"` + `inputMode="numeric"`, sin autocompletar, dígitos tabulares.
 * - CUIT: se tipea o se pega con o sin guiones; al salir se muestra
 *   `20-12345678-6`. Si el dígito verificador no cierra: «El CUIT no es
 *   válido: revisá el último número» (el mismo algoritmo que la base).
 * - Punto de venta y número: al salir se completan con ceros (`3` → `00003`,
 *   `1290` → `00001290`).
 * - El visible no lleva `name` (tampoco el del Field): el FormData recibe solo
 *   el hidden canónico.
 * - El error, como todos, aparece al salir del campo (y se va apenas el valor
 *   vuelve a ser válido). Adentro de un `Field` lo muestra el Field.
 */
function CodeField({
  kind,
  name,
  value,
  defaultValue,
  onValueChange,
  pad,
  onBlur,
  className,
  invalid,
  ...props
}: CodeFieldProps) {
  const field = useField()
  const reportError = useFieldErrorReporter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const hiddenName = name ?? field?.name
  const disabled = props.disabled ?? field?.disabled
  const [text, setText] = React.useState(() => displayCode(kind, value ?? defaultValue ?? '', pad))
  const [localError, setLocalError] = React.useState<string | null>(null)
  const canonical = canonicalCode(kind, text, pad)

  // Controlado: un cambio de afuera (que no es el eco de lo que se tipeó)
  // reemplaza el texto. Si el valor ya es el canónico de lo tipeado, el texto
  // queda como está (no se le ponen los ceros mientras se escribe).
  const [lastValue, setLastValue] = React.useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (value !== undefined && canonicalCode(kind, value, pad) !== canonical) {
      setText(displayCode(kind, value, pad))
    }
  }

  function setError(message: string | null) {
    setLocalError(message)
    reportError(message)
  }

  useFormReset(inputRef, () => {
    setText(displayCode(kind, defaultValue ?? '', pad))
    setError(null)
  })

  return (
    <>
      <WithoutFieldName>
        <Input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          {...props}
          invalid={invalid || localError !== null}
          value={text}
          onChange={(event) => {
            const next = sanitizeCodeInput(kind, event.target.value)
            setText(next)
            // Mientras se escribe no aparecen errores nuevos; si había uno y el
            // valor ya es válido, se va.
            if (localError !== null && validateCode(kind, next) === null) setError(null)
            onValueChange?.(canonicalCode(kind, next, pad))
          }}
          onBlur={(event) => {
            setText(displayCode(kind, text, pad))
            setError(validateCode(kind, text))
            onBlur?.(event)
          }}
          className={cn('type-amount', className)}
          data-kind={kind}
        />
      </WithoutFieldName>
      {hiddenName ? (
        <input type="hidden" name={hiddenName} value={canonical} disabled={disabled} />
      ) : null}
    </>
  )
}

export { CodeField }
