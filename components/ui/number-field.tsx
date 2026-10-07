'use client'

import { Minus, Plus } from 'lucide-react'
import * as React from 'react'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import {
  formResetTarget,
  useField,
  useFieldErrorReporter,
  useFormReset,
  WithoutFieldName,
} from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { focusIfFirstInvalid, mergeRefs, scrollIntoViewOnTouch } from '@/lib/dom/form-control'
import { decimalEsAr, roundTo } from '@/lib/money/decimal'
import { parseLocaleNumber } from '@/lib/money/parse'
import { cn } from '@/lib/utils'

export type NumberDecimals = 0 | 1 | 2

export type NumberParse =
  | { ok: true; value: number }
  | {
      ok: false
      reason: 'vacio' | 'ilegible' | 'negativo' | 'con-decimales' | 'demasiados-decimales'
    }

export type NumberRules = {
  min?: number
  max?: number
  /** Default 0. */
  decimals?: NumberDecimals
}

/** Decimales que trae un número tal como se escribiría (`2.5` → 1). */
function decimalCount(value: number): number {
  const text = String(Math.abs(value))
  if (text.includes('e')) return 0
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

/**
 * Lee lo que se tipea en un campo de números (personas, cupos, días, %), con
 * las reglas de separadores de la casa (`parseLocaleNumber`): `12.500` son
 * doce mil quinientos y `2,5` es dos y medio. Lo que va antes y después de los
 * dígitos se ignora («4 personas»); entre los dígitos, no. Un negativo vale
 * solo si el mínimo es negativo.
 */
export function parseNumberText(text: string, rules: NumberRules = {}): NumberParse {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'vacio' }
  const firstDigit = trimmed.search(/\d/)
  if (firstDigit === -1) return { ok: false, reason: 'ilegible' }
  const lastDigit = trimmed.search(/\d\D*$/)
  if (/[^\d.,\s]/.test(trimmed.slice(firstDigit, lastDigit + 1))) {
    return { ok: false, reason: 'ilegible' }
  }
  const negative = /[-−]/.test(trimmed.slice(0, firstDigit))
  if (negative && !(rules.min !== undefined && rules.min < 0)) {
    return { ok: false, reason: 'negativo' }
  }
  const parsed = parseLocaleNumber(trimmed.slice(firstDigit), 'rate')
  if (!parsed.ok) return { ok: false, reason: 'ilegible' }
  const decimals = rules.decimals ?? 0
  const count = decimalCount(parsed.value)
  if (count > decimals) {
    return { ok: false, reason: decimals === 0 ? 'con-decimales' : 'demasiados-decimales' }
  }
  const value = negative ? -parsed.value : parsed.value
  return { ok: true, value: value === 0 ? 0 : value }
}

/** `12500` → `'12.500'` · `2.5` → `'2,5'` (con `decimals` 1). Con guion ASCII: es lo que se tipea. */
export function formatNumberText(
  value: number,
  opts: { decimals?: NumberDecimals; grouping?: boolean } = {},
): string {
  const decimals = opts.decimals ?? 0
  const rounded = roundTo(value, decimals)
  // Los decimales que hacen falta y no más: 2,5 y no 2,50 (no es plata).
  return decimalEsAr(rounded, Math.min(decimals, decimalCount(rounded)), opts.grouping ?? true)
}

/** Lo que lleva el hidden: el número con punto decimal (`"2.5"`, `"12500"`), o `""`. */
export function numberSubmitValue(value: number | null, decimals: NumberDecimals = 0): string {
  if (value === null || !Number.isFinite(value)) return ''
  return String(roundTo(value, decimals))
}

const PARSE_MESSAGES: Record<Exclude<NumberParse, { ok: true }>['reason'], string> = {
  vacio: 'Falta el número.',
  ilegible: 'Escribí solo el número, por ejemplo 12.',
  negativo: 'Tiene que ser un número positivo.',
  'con-decimales': 'Tiene que ser un número entero.',
  'demasiados-decimales': 'Usá menos decimales.',
}

export type NumberCheck =
  | { status: 'empty'; value: null; error: null }
  | { status: 'valid'; value: number; error: null }
  | { status: 'invalid'; value: number | null; error: string }

/**
 * Lee el texto con las reglas del campo. Fuera de rango es un error («El
 * máximo es 40»): no se recorta en silencio.
 */
export function checkNumberText(
  text: string,
  rules: NumberRules & { grouping?: boolean } = {},
): NumberCheck {
  const parsed = parseNumberText(text, rules)
  if (!parsed.ok) {
    if (parsed.reason === 'vacio') return { status: 'empty', value: null, error: null }
    const message =
      parsed.reason === 'demasiados-decimales'
        ? `Usá hasta ${rules.decimals === 1 ? 'un decimal' : `${rules.decimals ?? 0} decimales`}.`
        : PARSE_MESSAGES[parsed.reason]
    return { status: 'invalid', value: null, error: message }
  }
  const format = (n: number) =>
    formatNumberText(n, { decimals: rules.decimals, grouping: rules.grouping })
  if (rules.min !== undefined && parsed.value < rules.min) {
    return { status: 'invalid', value: parsed.value, error: `El mínimo es ${format(rules.min)}` }
  }
  if (rules.max !== undefined && parsed.value > rules.max) {
    return { status: 'invalid', value: parsed.value, error: `El máximo es ${format(rules.max)}` }
  }
  return { status: 'valid', value: parsed.value, error: null }
}

/**
 * El número que vale de un texto, o `null` (vacío, ilegible o fuera de rango).
 * Es lo que avisa `onValueChange` y lo que lleva el hidden.
 */
export function validNumberValue(text: string, rules: NumberRules = {}): number | null {
  const check = checkNumberText(text, rules)
  return check.status === 'valid' ? check.value : null
}

/**
 * Controlado: el texto que corresponde a un `value` que llega de afuera, o
 * `null` si lo tipeado se queda. Lo tipeado se queda cuando el `value` es su
 * eco: el número que vale, o `null` si lo tipeado no vale todavía («50» con
 * máximo 40, «abc»). Así un número fuera de rango queda escrito con su error al
 * salir, en lugar de borrarse en la tecla.
 */
export function syncNumberText(
  value: number | null,
  text: string,
  rules: NumberRules & { grouping?: boolean } = {},
): string | null {
  if (value === validNumberValue(text, rules)) return null
  return value === null ? '' : formatNumberText(value, rules)
}

/** `n` dentro de `[min, max]`. */
export function clampNumber(n: number, rules: Pick<NumberRules, 'min' | 'max'>): number {
  let out = n
  if (rules.min !== undefined) out = Math.max(rules.min, out)
  if (rules.max !== undefined) out = Math.min(rules.max, out)
  return out
}

/**
 * Las flechas y los botones − y +: `current + delta`, redondeado a los
 * decimales del campo y adentro de `[min, max]`. Vacío arranca en el mínimo
 * (o en 0): el primer toque pone un número, no salta uno.
 */
export function stepNumberValue(current: number | null, delta: number, rules: NumberRules = {}) {
  if (current === null) return clampNumber(rules.min ?? 0, rules)
  return clampNumber(roundTo(current + delta, rules.decimals ?? 0), rules)
}

const STEPPER_SIZE: Record<ControlSize, string> = {
  sm: 'size-(--control-sm)',
  md: 'size-(--control-md)',
  lg: 'size-(--control-lg)',
}

/** Mantener apretado repite: a los 400 ms y después cada 80 ms. */
const HOLD_DELAY_MS = 400
const HOLD_REPEAT_MS = 80

export type NumberFieldProps = Omit<
  React.ComponentProps<'input'>,
  | 'value'
  | 'defaultValue'
  | 'onChange'
  | 'type'
  | 'size'
  | 'prefix'
  | 'inputMode'
  | 'min'
  | 'max'
  | 'step'
> & {
  /** Va en el `<input type="hidden">` con el número (punto decimal). */
  name?: string
  value?: number | null
  defaultValue?: number | null
  onValueChange?: (n: number | null) => void
  min?: number
  max?: number
  /** Default 1. */
  step?: number
  /** RePág y AvPág. Default 10. */
  largeStep?: number
  /** Default 0; con decimales el hidden lleva punto («2.5») y el visible coma («2,5»). */
  decimals?: NumberDecimals
  /** Default `true`: «12.500» al salir del campo. */
  grouping?: boolean
  /** Botones − y +. Default `true` (`false` para conteos grandes: «Alcance»). */
  steppers?: boolean
  /** «$». */
  prefix?: string
  /** «personas», «días», «%». */
  suffix?: string
  /** Default «Sumar uno» (o «Sumar 5» con `step` 5). */
  incrementLabel?: string
  /** Default «Restar uno». */
  decrementLabel?: string
  /** Default `center` con botones, `end` sin. */
  align?: 'center' | 'end'
  size?: ControlSize
  invalid?: boolean
  inputRef?: React.Ref<HTMLInputElement>
}

/**
 * Personas, cupos, días, porcentajes enteros (kit §3.2). Reemplaza los
 * steppers armados a mano y los `type="number"`.
 *
 * - `type="text"` + `role="spinbutton"` con `aria-valuenow/min/max` y
 *   `aria-valuetext` («4 personas»).
 * - ↑ ↓ de a `step`, RePág y AvPág de a `largeStep`, Inicio y Fin a min y max:
 *   esos sí quedan adentro del rango.
 * - Botones − y + del alto del campo, fuera del orden de Tab (el campo es una
 *   sola parada, patrón spinbutton) pero con nombre para el lector y el mouse.
 *   Se apagan en el límite; mantener apretado repite.
 * - **Lo tipeado se queda mientras se escribe**, también controlado: un número
 *   fuera de rango («50» con máximo 40) avisa `null` (no hay número que valga)
 *   y el `value={null}` que vuelve no lo borra (`syncNumberText`). Al salir se
 *   valida: error («El máximo es 40»), sin recortar en silencio, y el
 *   formulario no se envía hasta corregirlo.
 * - Un `value` de afuera que no es el eco de lo tipeado reescribe el texto.
 *   Para vaciar desde afuera un texto que no vale (el `value` ya es `null`),
 *   remontalo con `key`.
 *
 * **Formularios y React 19** (ver `useFormReset` en `field.tsx`): después de
 * un `<form action>`, React resetea el formulario. Sin `value`, el campo vuelve
 * a su `defaultValue` (y, mientras nadie lo toque, sigue al `defaultValue` que
 * cambie, como un `<input>` nativo). Controlado sin `defaultValue`, el reset no
 * lo toca: el `value` manda.
 */
function NumberField({
  name,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  step = 1,
  largeStep = 10,
  decimals = 0,
  grouping = true,
  steppers = true,
  prefix,
  suffix,
  incrementLabel,
  decrementLabel,
  align,
  size,
  invalid,
  inputRef,
  ref,
  className,
  onKeyDown,
  onBlur,
  onFocus,
  onInvalid,
  form,
  ...props
}: NumberFieldProps) {
  const field = useField()
  const reportError = useFieldErrorReporter()
  const resolvedSize = useControlSize(size)
  const localRef = React.useRef<HTMLInputElement>(null)
  const mergedRef = React.useMemo(() => mergeRefs(localRef, ref, inputRef), [ref, inputRef])
  const hiddenName = name ?? field?.name
  const disabled = props.disabled ?? field?.disabled ?? false
  const readOnly = props.readOnly ?? field?.readOnly ?? false
  const rules = { min, max, decimals, grouping }

  const format = (n: number) => formatNumberText(n, { decimals, grouping })
  const textOf = (n: number | null | undefined) => (n === null || n === undefined ? '' : format(n))
  const [text, setText] = React.useState(() => textOf(value ?? defaultValue))
  const check = checkNumberText(text, rules)
  // Lo tipeado, aunque esté fuera de rango: la base de las flechas y del aria.
  const current = check.status === 'empty' ? null : check.value
  // El número que vale (o null): lo que se avisa y lo que lleva el hidden.
  const valid = check.status === 'valid' ? check.value : null
  const [localError, setLocalError] = React.useState<string | null>(null)
  // Tocado desde que montó (o desde el último reset), como el «dirty» de un <input>.
  const [edited, setEdited] = React.useState(false)

  // Controlado: un `value` de afuera reescribe el texto, salvo que sea el eco de
  // lo tipeado (también el `null` de un número fuera de rango).
  const [lastValue, setLastValue] = React.useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (value !== undefined) {
      const synced = syncNumberText(value, text, rules)
      if (synced !== null) setText(synced)
    }
  }

  // No controlado y sin tocar: sigue al `defaultValue` que cambie (el dato que
  // vuelve del server después de guardar), como un <input> nativo.
  const [lastDefault, setLastDefault] = React.useState(defaultValue)
  if (defaultValue !== lastDefault) {
    setLastDefault(defaultValue)
    if (value === undefined && !edited) setText(textOf(defaultValue))
  }

  function setError(message: string | null) {
    setLocalError(message)
    reportError(message)
  }

  const validity = check.error ?? ''
  React.useEffect(() => {
    localRef.current?.setCustomValidity(validity)
  }, [validity])

  useFormReset(localRef, () => {
    setError(null)
    setEdited(false)
    // Controlado sin `defaultValue`: el reset (también el de React 19 después
    // de un `<form action>`) no borra lo que el `value` dice.
    const target = formResetTarget(value, defaultValue)
    if (target.keep) {
      setText(textOf(value))
      return
    }
    const resetValue = target.to ?? null
    setText(textOf(resetValue))
    if (resetValue !== valid) onValueChange?.(resetValue)
  })

  /** Pone un número (flechas o botones): el texto ya sale prolijo. */
  function commit(next: number) {
    const nextText = format(next)
    setText(nextText)
    setEdited(true)
    if (localError !== null) setError(null)
    if (next !== valid) onValueChange?.(next)
    localRef.current?.setCustomValidity(checkNumberText(nextText, rules).error ?? '')
  }

  // El valor más nuevo, para los botones que repiten (el intervalo no ve los renders).
  const latest = React.useRef(current)
  latest.current = current
  const hold = React.useRef<{ timeout?: number; interval?: number }>({})

  function stopHold() {
    window.clearTimeout(hold.current.timeout)
    window.clearInterval(hold.current.interval)
    hold.current = {}
  }

  // Si el campo se desmonta con el botón apretado, el intervalo no sigue solo.
  React.useEffect(
    () => () => {
      window.clearTimeout(hold.current.timeout)
      window.clearInterval(hold.current.interval)
    },
    [],
  )

  function stepBy(delta: number): boolean {
    const before = latest.current
    const next = stepNumberValue(before, delta, rules)
    if (next === before) return false
    latest.current = next
    commit(next)
    return true
  }

  function startHold(delta: number) {
    stopHold()
    if (!stepBy(delta)) return
    hold.current.timeout = window.setTimeout(() => {
      hold.current.interval = window.setInterval(() => {
        // En el límite el botón se apaga y puede no recibir el pointerup: se corta acá.
        if (!stepBy(delta)) stopHold()
      }, HOLD_REPEAT_MS)
    }, HOLD_DELAY_MS)
    window.addEventListener('pointerup', stopHold, { once: true })
    window.addEventListener('pointercancel', stopHold, { once: true })
  }

  const atMin = current !== null && min !== undefined && current <= min
  const atMax = current !== null && max !== undefined && current >= max
  const stepText = format(step)
  const plusLabel = incrementLabel ?? (step === 1 ? 'Sumar uno' : `Sumar ${stepText}`)
  const minusLabel = decrementLabel ?? (step === 1 ? 'Restar uno' : `Restar ${stepText}`)
  const valueText =
    current === null
      ? undefined
      : [prefix, format(current), suffix].filter((part) => part && part !== '').join(' ')
  const textAlign = align ?? (steppers ? 'center' : 'end')

  function stepperButton(delta: number) {
    const isPlus = delta > 0
    const off = disabled || readOnly || (isPlus ? atMax : atMin)
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-label={isPlus ? plusLabel : minusLabel}
        disabled={off}
        data-slot={isPlus ? 'number-field-increment' : 'number-field-decrement'}
        onPointerDown={(event) => {
          if (event.button !== 0 || off) return
          // Sin robarle el foco al campo (con el teclado del celular abierto, tampoco lo cierra).
          event.preventDefault()
          startHold(delta)
        }}
        onPointerLeave={stopHold}
        onClick={(event) => {
          // El lector de pantalla y el teclado llegan con un click sin puntero.
          if (event.detail === 0) stepBy(delta)
        }}
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center border border-input bg-card text-muted-foreground',
          'hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
          'outline-(--ring) -outline-offset-2 focus-visible:outline-2',
          isPlus ? 'rounded-e-md' : 'rounded-s-md',
          STEPPER_SIZE[resolvedSize],
        )}
      >
        {isPlus ? (
          <Plus aria-hidden className="size-4" />
        ) : (
          <Minus aria-hidden className="size-4" />
        )}
      </button>
    )
  }

  return (
    <div
      data-slot="number-field"
      data-size={resolvedSize}
      className={cn('flex w-full min-w-0 items-stretch', className)}
    >
      {steppers ? stepperButton(-1) : null}
      <InputGroup
        size={resolvedSize}
        className={cn(
          'relative',
          steppers &&
            '-mx-px rounded-none has-[[data-slot=input]:focus-visible]:z-10 has-[[data-slot=input][aria-invalid=true]]:z-10',
        )}
      >
        {prefix ? <InputAddon>{prefix}</InputAddon> : null}
        <WithoutFieldName>
          <Input
            ref={mergedRef}
            type="text"
            role="spinbutton"
            inputMode={decimals === 0 ? 'numeric' : 'decimal'}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            form={form}
            {...props}
            aria-valuenow={current ?? undefined}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={valueText}
            invalid={invalid || localError !== null}
            value={text}
            onChange={(event) => {
              const next = event.target.value
              setText(next)
              setEdited(true)
              const nextCheck = checkNumberText(next, rules)
              event.currentTarget.setCustomValidity(nextCheck.error ?? '')
              if (localError !== null && nextCheck.error === null) setError(null)
              // Solo un número que vale; fuera de rango avisa `null` y el texto queda.
              const nextValue = nextCheck.status === 'valid' ? nextCheck.value : null
              if (nextValue !== valid) onValueChange?.(nextValue)
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event)
              if (event.defaultPrevented || readOnly || disabled) return
              let handled = true
              switch (event.key) {
                case 'ArrowUp':
                  stepBy(step)
                  break
                case 'ArrowDown':
                  stepBy(-step)
                  break
                case 'PageUp':
                  stepBy(largeStep)
                  break
                case 'PageDown':
                  stepBy(-largeStep)
                  break
                case 'Home':
                  if (min === undefined) handled = false
                  else commit(min)
                  break
                case 'End':
                  if (max === undefined) handled = false
                  else commit(max)
                  break
                default:
                  handled = false
              }
              if (handled) event.preventDefault()
            }}
            onFocus={(event) => {
              scrollIntoViewOnTouch(event)
              onFocus?.(event)
            }}
            onBlur={(event) => {
              if (check.status === 'valid') {
                const tidy = format(check.value)
                if (tidy !== text) setText(tidy)
              }
              setError(check.error)
              onBlur?.(event)
            }}
            onInvalid={(event) => {
              onInvalid?.(event)
              event.preventDefault()
              const input = event.currentTarget
              setError(check.error ?? (input.validity.valueMissing ? PARSE_MESSAGES.vacio : null))
              focusIfFirstInvalid(input)
            }}
            className={cn('type-amount', textAlign === 'center' ? 'text-center' : 'text-right')}
          />
        </WithoutFieldName>
        {suffix ? <InputAddon side="end">{suffix}</InputAddon> : null}
      </InputGroup>
      {steppers ? stepperButton(1) : null}
      {hiddenName ? (
        <input
          type="hidden"
          name={hiddenName}
          value={numberSubmitValue(valid, decimals)}
          disabled={disabled}
          form={form}
        />
      ) : null}
    </div>
  )
}

export { NumberField }
