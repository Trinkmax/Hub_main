'use client'

import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { formatCentsShort } from '@/lib/money/format'
import {
  checkTypedAmount,
  formatPesosTyping,
  pesosText,
  readPesos,
  type TypedCheck,
  type TypedContext,
  typedQuestion,
} from '@/lib/pos/cash/typed-amount'

type Ask = Extract<TypedCheck, { kind: 'ask' }>

/**
 * Un monto que se escribe a mano, en pesos enteros. Lleva la cuenta de lo que la persona ya
 * confirmó («son $ 129, sí»): por ese monto no se vuelve a preguntar hasta que lo cambie.
 */
export function useTypedAmount(initialCents: number | null = null) {
  const [text, setRaw] = useState(() => pesosText(initialCents))
  const [confirmed, setConfirmed] = useState<number | null>(initialCents)
  const cents = readPesos(text)
  return {
    text,
    cents,
    setText: (raw: string) => setRaw(formatPesosTyping(raw)),
    /** Poner un monto que no hace falta confirmar (un botón lo eligió, no un teclado). */
    set: (value: number) => {
      setRaw(pesosText(value))
      setConfirmed(value)
    },
    /** ¿Se toma sin preguntar? */
    check: (context: TypedContext = {}): TypedCheck =>
      cents === null || cents === confirmed ? { kind: 'ok' } : checkTypedAmount(cents, context),
  }
}

/** El campo: el teclado de números del celular y los miles que se separan solos. */
export function PesosInput({
  value,
  onChange,
  ...rest
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string
  onChange: (raw: string) => void
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      placeholder="0"
      {...rest}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => {
        event.currentTarget.select()
        rest.onFocus?.(event)
      }}
    />
  )
}

/**
 * «¿$ 129 o $ 129.000?»: la pregunta que frena el error de los ceros. Hasta que alguien elige, el
 * botón de seguir queda apagado (lo decide quien la muestra).
 */
export function TypedGuard({
  ask,
  why,
  onPick,
}: {
  ask: Ask
  /** Por qué se pregunta, cuando no es obvio («En el cajón tiene que haber $ 54.000»). */
  why?: string | null
  onPick: (cents: number) => void
}) {
  return (
    <fieldset className="caja-guard" aria-live="polite">
      <legend className="caja-guard-q">
        <TriangleAlert aria-hidden strokeWidth={2.4} />
        <span>{typedQuestion(ask)}</span>
      </legend>
      {why ? <p>{why}</p> : null}
      <div className="caja-guard-opts">
        {ask.suggestedCents !== null ? (
          <button type="button" onClick={() => onPick(ask.suggestedCents ?? ask.typedCents)}>
            Son {formatCentsShort(ask.suggestedCents)}
          </button>
        ) : null}
        <button type="button" onClick={() => onPick(ask.typedCents)}>
          Son {formatCentsShort(ask.typedCents)}
        </button>
      </div>
    </fieldset>
  )
}
