'use client'

import * as React from 'react'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import {
  formResetTarget,
  useField,
  useFieldErrorReporter,
  useFieldLabelId,
  useFormReset,
  WithoutFieldName,
} from '@/components/ui/field'
import { Input, InputAddon, InputGroup } from '@/components/ui/input'
import { focusIfFirstInvalid, mergeRefs, scrollIntoViewOnTouch } from '@/lib/dom/form-control'
import {
  type CentsValue,
  centsToPesosInput,
  centsToSubmitValue,
  type MoneyCurrency,
  type MoneyParse,
  moneyParseMessage,
  parseMoneyToCents,
} from '@/lib/money'
import { cn } from '@/lib/utils'

export type { MoneyParse }

/** Cómo viaja el importe en el `<input type="hidden">`. */
export type MoneySubmitMode = 'cents' | 'pesos'

export type MoneyTextOptions = {
  /** Default `false`: en lo contable el lado lo da Debe o Haber, no el signo. */
  allowNegative?: boolean
  minCents?: number
  maxCents?: number
  /** Default `cents` → `"123450"` · `pesos` → `"1234.50"` (acciones viejas que multiplican por 100). */
  submit?: MoneySubmitMode
  /** Para escribir los bordes en los mensajes. `null` (sin prefijo) los escribe en pesos. */
  currency?: MoneyCurrency | null
}

export type MoneyTextState = {
  parse: MoneyParse
  /** Centavos si se lee, o `null`. */
  cents: number | null
  /** Lo que lleva el hidden: centavos (o pesos) canónicos, o `""` si no hay importe que mandar. */
  submitValue: string
  /**
   * Por qué no se puede mandar, en la voz de la casa, o `null`. Vacío no es un
   * error: lo obligatorio lo dice `required`.
   */
  error: string | null
}

/**
 * Lo que el campo hace con un texto, sin formatearlo (kit §3.2, MoneyField
 * puntos 2 a 6): lo lee a centavos sin flotantes con `parseMoneyToCents`, arma
 * el valor del hidden y el mensaje si no se puede usar. Se llama en cada tecla
 * (parseo silencioso): el hidden ya está listo si Enter envía el formulario.
 */
export function readMoneyText(text: string, opts: MoneyTextOptions = {}): MoneyTextState {
  const parse = parseMoneyToCents(text, {
    allowNegative: opts.allowNegative,
    minCents: opts.minCents,
    maxCents: opts.maxCents,
  })
  if (parse.ok) {
    return {
      parse,
      cents: parse.cents,
      submitValue: centsToSubmitValue(parse.cents, opts.submit ?? 'cents'),
      error: null,
    }
  }
  return {
    parse,
    cents: null,
    submitValue: '',
    error:
      parse.reason === 'vacio'
        ? null
        : moneyParseMessage(parse, text, { currency: opts.currency ?? 'ARS' }),
  }
}

/**
 * Cómo queda el texto al salir del campo: prolijo si se lee (`1,234.50` →
 * `1.234,50`; con `decimals: 'auto'`, entero si es redondo) y tal cual si no
 * (el error lo explica al lado).
 */
export function moneyBlurText(
  text: string,
  opts: MoneyTextOptions & { decimals?: 2 | 'auto' } = {},
): string {
  const state = readMoneyText(text, opts)
  return state.parse.ok ? centsToPesosInput(state.parse.cents, { decimals: opts.decimals }) : text
}

/** El texto de arranque desde centavos de la base: `123450` → `1.234,50`; sin dato, vacío. */
export function centsToMoneyText(cents: CentsValue, decimals: 2 | 'auto' = 2): string {
  return centsToPesosInput(cents, { decimals })
}

const CURRENCY_PREFIX: Readonly<Record<MoneyCurrency, string>> = { ARS: '$', USD: 'US$' }
const CURRENCY_SPOKEN: Readonly<Record<MoneyCurrency, string>> = {
  ARS: 'en pesos',
  USD: 'en dólares',
}
const REQUIRED_MESSAGE = moneyParseMessage({ ok: false, reason: 'vacio' })

export type MoneyFieldProps = Omit<
  React.ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'size' | 'prefix' | 'inputMode'
> & {
  /** Va en el `<input type="hidden">`, con el valor en el formato de `submit`. El visible no lleva `name`. */
  name?: string
  /** Default `cents` → `"123450"` · `pesos` → `"1234.50"`. */
  submit?: MoneySubmitMode
  /** No controlado, desde la base (centavos). */
  defaultCents?: number | bigint | null
  /** Controlado numérico (centavos). Un cambio de afuera reescribe el texto. */
  cents?: number | null
  /** En cada tecla, con el parseo silencioso: centavos o `null`. */
  onCentsChange?: (cents: number | null, parse: MoneyParse) => void
  /** Controlado por texto (borradores que guardan lo tipeado, como «Cómo nos fue»). */
  value?: string
  onValueChange?: (text: string) => void
  /** Prefijo `$`, `US$` o ninguno. Default `ARS`. */
  currency?: MoneyCurrency | null
  /** Default 2 → «500.000,00» · `auto`: entero si es redondo. */
  decimals?: 2 | 'auto'
  allowNegative?: boolean
  minCents?: number
  maxCents?: number
  /** Default `end`: los decimales se alinean en una pila de importes. */
  align?: 'start' | 'end'
  size?: ControlSize
  invalid?: boolean
  inputRef?: React.Ref<HTMLInputElement>
}

/**
 * Plata (kit §3.2), siempre igual y sin errores de centavos. Promovido desde
 * «Cómo nos fue», que sigue con su copia local hasta el lote D (decisión 43).
 *
 * - `type="text"` + `inputMode="decimal"`: acepta `1.234,50`, `1234,5`,
 *   `1234.50`, `1,234.50`, `$ 1.234`, `US$175,26`, pegado con espacios duros.
 * - El `$` va adentro (oculto para el lector) y el nombre suma «en pesos».
 * - Mientras se tipea: ni formato ni error, pero el hidden se actualiza en
 *   cada tecla. **Enter no se intercepta**: es el envío del formulario.
 * - Al salir: prolijo si se lee; si no, el texto queda y el error aparece en el
 *   Field. Si se envía ilegible, `setCustomValidity` frena el formulario, sin
 *   la burbuja nativa, y el foco vuelve al campo.
 * - Las props sueltas (`data-tour`, `aria-*`, manejadores) van al `<input>`
 *   visible; `className`, a la caja.
 * - 16 px con el dedo (`--control-font`), y al tomar foco se centra en la
 *   pantalla: el teclado tapa la mitad de abajo.
 *
 * **Formularios y React 19** (ver `useFormReset` en `field.tsx`): después de
 * un `<form action>`, React resetea el formulario. Sin `cents` ni `value`,
 * vuelve a `defaultCents` (y, mientras nadie lo toque, sigue al `defaultCents`
 * que cambie, como un `<input>` nativo). Controlado sin `defaultCents`, el
 * reset no lo toca.
 */
function MoneyField({
  name,
  submit = 'cents',
  defaultCents,
  cents,
  onCentsChange,
  value,
  onValueChange,
  currency = 'ARS',
  decimals = 2,
  allowNegative = false,
  minCents,
  maxCents,
  align = 'end',
  size,
  invalid,
  inputRef,
  ref,
  className,
  onBlur,
  onFocus,
  onInvalid,
  form,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}: MoneyFieldProps) {
  const field = useField()
  const reportError = useFieldErrorReporter()
  const fieldLabelId = useFieldLabelId()
  const resolvedSize = useControlSize(size)
  const localRef = React.useRef<HTMLInputElement>(null)
  const mergedRef = React.useMemo(() => mergeRefs(localRef, ref, inputRef), [ref, inputRef])
  const currencyId = React.useId()
  const hiddenName = name ?? field?.name
  const disabled = props.disabled ?? field?.disabled

  const textOptions: MoneyTextOptions = { allowNegative, minCents, maxCents, submit, currency }
  const textControlled = value !== undefined
  const [innerText, setInnerText] = React.useState(() =>
    centsToMoneyText(cents ?? defaultCents ?? null, decimals),
  )
  const text = textControlled ? value : innerText
  const state = readMoneyText(text, textOptions)
  const [localError, setLocalError] = React.useState<string | null>(null)
  // Tocado desde que montó (o desde el último reset), como el «dirty» de un <input>.
  const [edited, setEdited] = React.useState(false)

  // Controlado numérico: un cambio de afuera (que no es el eco de lo tipeado)
  // reescribe el texto. Mientras lo tipeado no se lee, un `null` de afuera no
  // borra lo que la persona está escribiendo.
  const [lastCents, setLastCents] = React.useState(cents)
  if (cents !== lastCents) {
    setLastCents(cents)
    if (!textControlled && cents !== undefined && cents !== state.cents) {
      setInnerText(centsToMoneyText(cents, decimals))
    }
  }

  // No controlado y sin tocar: sigue al `defaultCents` que cambie, como un <input> nativo.
  const [lastDefault, setLastDefault] = React.useState(defaultCents)
  if (defaultCents !== lastDefault) {
    setLastDefault(defaultCents)
    if (!textControlled && cents === undefined && !edited) {
      setInnerText(centsToMoneyText(defaultCents ?? null, decimals))
    }
  }

  function setText(next: string) {
    if (!textControlled) setInnerText(next)
    onValueChange?.(next)
  }

  function setError(message: string | null) {
    setLocalError(message)
    reportError(message)
  }

  // Lo que no se puede mandar frena el envío (también al montar o si el texto
  // cambia desde afuera). En el onChange se pone además en el momento, por si
  // Enter llega antes que el efecto.
  const validity = state.error ?? ''
  React.useEffect(() => {
    localRef.current?.setCustomValidity(validity)
  }, [validity])

  useFormReset(localRef, () => {
    setError(null)
    setEdited(false)
    if (textControlled) return
    // Controlado numérico sin `defaultCents`: el reset (también el de React 19
    // después de un `<form action>`) no borra lo que `cents` dice.
    const target = formResetTarget<CentsValue>(cents, defaultCents)
    if (target.keep) {
      setInnerText(centsToMoneyText(cents ?? null, decimals))
      return
    }
    const resetText = centsToMoneyText(target.to ?? null, decimals)
    setInnerText(resetText)
    const resetState = readMoneyText(resetText, textOptions)
    onCentsChange?.(resetState.cents, resetState.parse)
  })

  // El nombre accesible suma la moneda: «Importe en pesos».
  const spoken = currency ? CURRENCY_SPOKEN[currency] : null
  let labelledBy = ariaLabelledBy
  let label = ariaLabel
  let describedBy = ariaDescribedBy
  if (spoken) {
    if (ariaLabelledBy) labelledBy = `${ariaLabelledBy} ${currencyId}`
    else if (ariaLabel) label = `${ariaLabel}, ${spoken}`
    else if (fieldLabelId) labelledBy = `${fieldLabelId} ${currencyId}`
    else describedBy = [ariaDescribedBy, currencyId].filter(Boolean).join(' ')
  }

  return (
    <>
      <InputGroup
        size={resolvedSize}
        data-slot="money-field"
        data-currency={currency ?? undefined}
        className={className}
      >
        {currency ? (
          <InputAddon aria-hidden className="text-subtle-foreground">
            {CURRENCY_PREFIX[currency]}
          </InputAddon>
        ) : null}
        <WithoutFieldName>
          <Input
            ref={mergedRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            form={form}
            {...props}
            aria-label={label}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            invalid={invalid || localError !== null}
            value={text}
            onChange={(event) => {
              const next = event.target.value
              setText(next)
              setEdited(true)
              const nextState = readMoneyText(next, textOptions)
              event.currentTarget.setCustomValidity(nextState.error ?? '')
              // Mientras se escribe no aparecen errores nuevos; si había uno y
              // ya se lee, se va.
              if (localError !== null && nextState.error === null) setError(null)
              onCentsChange?.(nextState.cents, nextState.parse)
            }}
            onFocus={(event) => {
              scrollIntoViewOnTouch(event)
              onFocus?.(event)
            }}
            onBlur={(event) => {
              if (state.parse.ok) {
                const tidy = centsToMoneyText(state.parse.cents, decimals)
                if (tidy !== text) setText(tidy)
              }
              setError(state.error)
              onBlur?.(event)
            }}
            onInvalid={(event) => {
              onInvalid?.(event)
              // Sin la burbuja nativa (en el idioma del sistema): el error va en el Field.
              event.preventDefault()
              const input = event.currentTarget
              setError(state.error ?? (input.validity.valueMissing ? REQUIRED_MESSAGE : null))
              focusIfFirstInvalid(input)
            }}
            className={cn('type-amount', align === 'end' ? 'text-right' : 'text-left')}
          />
        </WithoutFieldName>
      </InputGroup>
      {spoken ? (
        <span id={currencyId} hidden>
          {spoken}
        </span>
      ) : null}
      {hiddenName ? (
        <input
          type="hidden"
          name={hiddenName}
          value={state.submitValue}
          disabled={disabled}
          form={form}
        />
      ) : null}
    </>
  )
}

export { MoneyField }
