'use client'

import {
  type ComponentProps,
  type FocusEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  centsToPesosInput,
  type MoneyParse,
  moneyParseMessage,
  type ParseMoneyOptions,
  parseMoneyToCents,
} from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * En pantallas táctiles el teclado tapa la mitad de abajo: el campo con foco va
 * al centro. Con mouse no se mueve nada.
 */
export function scrollIntoViewOnTouch(event: FocusEvent<HTMLElement>): void {
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return
  event.currentTarget.scrollIntoView({ block: 'center' })
}

type NativeInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'size' | 'name' | 'ref' | 'inputMode'
>

export type MoneyInputProps = NativeInputProps & {
  /** Centavos, controlado. `null` = vacío (que NO es cero). */
  value: number | null
  /**
   * Cada tecla: centavos leídos en silencio (`null` si está vacío o no se lee)
   * y el resultado del parseo, con su mensaje listo para mostrar.
   */
  onValueChange: (cents: number | null, info: { parse: MoneyParse; error: string | null }) => void
  /** Si está, un `<input type="hidden" name>` lleva los centavos canónicos (`""` si está vacío). */
  name?: string
  allowNegative?: boolean
  /** Centavos. */
  minCents?: number
  /** Centavos. */
  maxCents?: number
  /** Al salir del campo: `2` → «500.000,00» (default) · `auto` → «500.000» si es redondo. */
  decimals?: 2 | 'auto'
  /** `end` alinea los decimales en pilas y grillas de importes. Default `start`. */
  align?: 'start' | 'end'
  /** `sm` para grillas (asiento manual). Default `md`: 44 px en el celular. */
  size?: 'sm' | 'md'
  /** Error que viene de afuera (zod, servidor). */
  invalid?: boolean
  /** Avisa el error de lectura cuando hay que mostrarlo (al salir del campo o al enviar). */
  onErrorChange?: (error: string | null) => void
  inputRef?: Ref<HTMLInputElement>
}

function textOf(cents: number | null, decimals: 2 | 'auto'): string {
  return cents === null ? '' : centsToPesosInput(cents, { decimals })
}

/**
 * El campo de plata de Administración: pide y muestra PESOS, guarda CENTAVOS.
 *
 * - `type="text"` + `inputMode="decimal"`: acepta «1.234,50», «1234.5»,
 *   «1,234.50», «$ 1.234» pegado (lo lee `parseMoneyToCents`, sin flotantes).
 * - Mientras se tipea no se reformatea ni se marca error; al salir del campo
 *   se reescribe prolijo («1.234,50») o aparece el error.
 * - Vacío no es cero: el placeholder nunca es «0» y vacío llega como `null`.
 * - Si el texto no se lee, el input queda inválido (`setCustomValidity`) y un
 *   formulario nativo no se envía.
 */
export function MoneyInput({
  value: valueProp,
  onValueChange,
  name,
  allowNegative = false,
  minCents,
  maxCents,
  decimals = 2,
  align = 'start',
  size = 'md',
  invalid = false,
  onErrorChange,
  inputRef,
  required,
  placeholder,
  className,
  onBlur,
  onFocus,
  onInvalid,
  ...rest
}: MoneyInputProps) {
  // Un NaN que se cuele no puede trabar el campo (NaN !== NaN re-renderizaría siempre).
  const value = typeof valueProp === 'number' && Number.isFinite(valueProp) ? valueProp : null
  const [text, setText] = useState(() => textOf(value, decimals))
  // Último valor que emitimos (o recibimos): si el padre cambia `value` por su
  // cuenta (reset, «Usar $ X»), el texto se reescribe; si es el eco de lo que
  // tipeamos, no se toca (si no, «1234,» se volvería «1.234,00» en cada tecla).
  const [synced, setSynced] = useState<number | null>(value)
  const [shownError, setShownError] = useState<string | null>(null)
  const localRef = useRef<HTMLInputElement | null>(null)

  const options: ParseMoneyOptions = { allowNegative, minCents, maxCents }

  const parseText = (raw: string) => parseMoneyToCents(raw, options)

  if (value !== synced) {
    setSynced(value)
    const current = parseText(text)
    if (!(current.ok && current.cents === value) && !(value === null && text.trim() === '')) {
      setText(textOf(value, decimals))
      setShownError(null)
    }
  }

  const errorFor = useCallback(
    (raw: string, parse: MoneyParse): string | null => {
      if (parse.ok) return null
      if (parse.reason === 'vacio') return required ? moneyParseMessage(parse) : null
      return moneyParseMessage(parse, raw)
    },
    [required],
  )

  // El estado de validez nativo sigue al texto: un form no se envía con plata ilegible.
  const validity = errorFor(text, parseText(text))
  useEffect(() => {
    localRef.current?.setCustomValidity(validity ?? '')
  }, [validity])

  const showError = (message: string | null) => setShownError(message)

  // El Field de afuera se entera del error que se muestra (también cuando un
  // reset del padre lo borra durante el render).
  useEffect(() => {
    onErrorChange?.(shownError)
  }, [shownError, onErrorChange])

  const setRefs = (node: HTMLInputElement | null) => {
    localRef.current = node
    if (typeof inputRef === 'function') inputRef(node)
    else if (inputRef && typeof inputRef === 'object') {
      ;(inputRef as { current: HTMLInputElement | null }).current = node
    }
  }

  return (
    <div className={cn('relative', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground',
          size === 'sm' ? 'text-sm' : 'text-base md:text-sm',
        )}
      >
        $
      </span>
      <Input
        {...rest}
        ref={setRefs}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        required={required}
        placeholder={placeholder}
        value={text}
        aria-invalid={invalid || shownError ? true : undefined}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          // Mientras tipea, un error ya mostrado se va apenas el texto se lee.
          const parse = parseText(next)
          const cents = parse.ok ? parse.cents : null
          if (shownError && parse.ok) showError(null)
          setSynced(cents)
          onValueChange(cents, { parse, error: errorFor(next, parse) })
        }}
        onFocus={(e) => {
          scrollIntoViewOnTouch(e)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          const parse = parseText(text)
          if (parse.ok) {
            const canonical = textOf(parse.cents, decimals)
            if (canonical !== text) setText(canonical)
            showError(null)
          } else {
            showError(parse.reason === 'vacio' ? null : errorFor(text, parse))
          }
          onBlur?.(e)
        }}
        onInvalid={(e) => {
          // Sin la burbuja nativa: el error se ve en el campo, en castellano.
          e.preventDefault()
          showError(errorFor(text, parseText(text)))
          const form = e.currentTarget.form
          if (form && form.querySelector(':invalid') === e.currentTarget) e.currentTarget.focus()
          onInvalid?.(e)
        }}
        className={cn(
          'pl-7 tabular-nums',
          size === 'sm' ? 'h-10 text-base md:h-8 md:text-sm' : 'h-11 text-base md:h-10 md:text-sm',
          align === 'end' && 'text-right',
        )}
      />
      {name ? (
        <input type="hidden" name={name} value={value === null ? '' : String(value)} />
      ) : null}
    </div>
  )
}

export type MoneyFieldProps = Omit<MoneyInputProps, 'id' | 'onErrorChange'> & {
  id?: string
  label: ReactNode
  /** Marca «(opcional)» al lado de la etiqueta. */
  optional?: boolean
  /** Ayuda debajo del campo. */
  hint?: ReactNode
  /** Error de afuera (zod o servidor). Gana sobre el de lectura. */
  error?: string | null
  /** Algo debajo del campo (p. ej. «Usar $ 1.240.000»). */
  children?: ReactNode
  fieldClassName?: string
}

/**
 * Etiqueta + `MoneyInput` + ayuda + error, como el resto de los formularios del
 * panel (`clientes/nuevo`). El error de lectura aparece al salir del campo o al
 * enviar, con `role="alert"`; la etiqueta suma «, en pesos» para lectores.
 */
export function MoneyField({
  id: idProp,
  label,
  optional = false,
  hint,
  error,
  children,
  fieldClassName,
  required,
  ...input
}: MoneyFieldProps) {
  const autoId = useId()
  const id = idProp ?? `money-${autoId}`
  const [parseError, setParseError] = useState<string | null>(null)
  const message = error ?? parseError
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = message ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('grid content-start gap-1.5', fieldClassName)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        ) : null}
        <span className="sr-only">, en pesos</span>
      </Label>
      <MoneyInput
        {...input}
        id={id}
        required={required}
        invalid={Boolean(error) || input.invalid}
        aria-describedby={describedBy}
        onErrorChange={setParseError}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ) : null}
      {children}
    </div>
  )
}
