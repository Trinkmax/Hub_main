'use client'

import {
  type ClipboardEventHandler,
  type ComponentProps,
  type KeyboardEventHandler,
  type Ref,
  useEffect,
  useRef,
  useState,
} from 'react'
import { scrollIntoViewOnTouch } from '@/components/administracion/money-input'
import { CELL_INPUT } from '@/components/administracion/planilla'
import {
  centsToPesosInput,
  type MoneyParse,
  moneyParseMessage,
  parseMoneyToCents,
} from '@/lib/money'
import { cn } from '@/lib/utils'

/** Lo que dejó la celda al salir: un importe, vacío (`null`) o algo que no se entiende. */
export type MoneyCellCommit = { ok: true; cents: number | null } | { ok: false; message: string }

function textOf(cents: number | null): string {
  return cents === null ? '' : centsToPesosInput(cents, { decimals: 'auto' })
}

function messageOf(parse: MoneyParse, raw: string): string | null {
  if (parse.ok || parse.reason === 'vacio') return null
  return moneyParseMessage(parse, raw)
}

/**
 * La celda de plata de una planilla (`CELL_INPUT`): el número a la derecha, sin el «$» de los
 * formularios y con solo la raya de abajo. Pide y muestra PESOS, guarda CENTAVOS, y lee lo mismo que
 * `MoneyInput` (`parseMoneyToCents`, sin flotantes). Se comporta como una celda de Excel: al entrar
 * queda todo seleccionado, para escribir encima.
 *
 * Mientras se escribe no se reformatea ni se marca error; al salir se reescribe prolijo o queda en
 * rojo, con el texto tal como estaba: lo que no se entiende no se guarda y tampoco se tira.
 */
export function MoneyCell({
  value: valueProp,
  onValueChange,
  onCommit,
  onErrorChange,
  maxCents,
  invalid = false,
  inputRef,
  className,
  onKeyDown,
  onPaste,
  ...rest
}: Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'type' | 'ref' | 'onKeyDown' | 'onPaste'
> & {
  /** Centavos, controlado. `null` = vacío (que NO es cero). */
  value: number | null
  /** Cada tecla: centavos leídos en silencio (`null` si está vacío o no se entiende). */
  onValueChange: (cents: number | null) => void
  /** Al salir de la celda. */
  onCommit?: (result: MoneyCellCommit) => void
  /** El error de lectura, cuando hay que mostrarlo (al salir), o `null` cuando se va. */
  onErrorChange?: (error: string | null) => void
  maxCents?: number
  /** Error que viene de afuera (el motor, el servidor). */
  invalid?: boolean
  inputRef?: Ref<HTMLInputElement>
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  onPaste?: ClipboardEventHandler<HTMLInputElement>
}) {
  const value = typeof valueProp === 'number' && Number.isFinite(valueProp) ? valueProp : null
  const [text, setText] = useState(() => textOf(value))
  // Lo último emitido o recibido: si el padre cambia `value` por su cuenta (pegar una columna, un
  // dato nuevo del servidor) el texto se reescribe; si es el eco de lo que se tipea, no se toca.
  const [synced, setSynced] = useState<number | null>(value)
  const [shownError, setShownError] = useState<string | null>(null)
  const errorHandler = useRef(onErrorChange)
  // Lo que había al entrar: Escape vuelve a eso.
  const atFocus = useRef<number | null>(value)

  const parseText = (raw: string) => parseMoneyToCents(raw, { maxCents })

  if (value !== synced) {
    setSynced(value)
    const current = parseText(text)
    if (!(current.ok && current.cents === value) && !(value === null && text.trim() === '')) {
      setText(textOf(value))
      setShownError(null)
    }
  }

  useEffect(() => {
    errorHandler.current = onErrorChange
  })
  useEffect(() => {
    errorHandler.current?.(shownError)
  }, [shownError])

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      value={text}
      aria-invalid={invalid || shownError ? true : undefined}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        const parse = parseText(next)
        const cents = parse.ok ? parse.cents : null
        if (shownError && (parse.ok || parse.reason === 'vacio')) setShownError(null)
        setSynced(cents)
        onValueChange(cents)
      }}
      onFocus={(event) => {
        atFocus.current = value
        scrollIntoViewOnTouch(event)
        event.currentTarget.select()
      }}
      onBlur={() => {
        const parse = parseText(text)
        const message = messageOf(parse, text)
        if (message !== null) {
          setShownError(message)
          onCommit?.({ ok: false, message })
          return
        }
        setShownError(null)
        const cents = parse.ok ? parse.cents : null
        const canonical = textOf(cents)
        if (canonical !== text) setText(canonical)
        onCommit?.({ ok: true, cents })
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // Vuelve a lo que había: sin esto, salir de la celda guardaría lo escrito.
          event.preventDefault()
          setText(textOf(atFocus.current))
          setSynced(atFocus.current)
          setShownError(null)
          onValueChange(atFocus.current)
          return
        }
        onKeyDown?.(event)
      }}
      onPaste={onPaste}
      className={cn(
        CELL_INPUT,
        // 16 px en el celular (si no, iOS hace zoom al entrar) y lugar para el pulgar.
        'text-base md:text-sm pointer-coarse:h-10',
        'aria-invalid:border-destructive aria-invalid:text-destructive aria-invalid:focus:ring-destructive/20',
        className,
      )}
    />
  )
}
