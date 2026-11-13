'use client'

import { TriangleAlert } from 'lucide-react'
import { groupThousands } from '@/lib/money'
import { judgeTyped, type TypedWindow, typedQuestion } from '@/lib/pos/pay/typed'
import { money } from './pay-types'

/**
 * Plata escrita a mano. Se escribe en pesos enteros (los puntos de miles aparecen solos) y viaja en
 * centavos. Trae puesto el cuidado de los ceros: si lo escrito no es razonable para ese campo,
 * pregunta «¿$ 129 o $ 129.000?» y no deja seguir hasta que alguien elige.
 */

/** Hasta $ 999.999.999: más que eso no es una cuenta de bar. */
const MAX_DIGITS = 9

/** ¿Lo escrito ya se puede usar? (Está dentro de lo razonable, o alguien dijo «sí, es eso».) */
export function typedSettled(
  cents: number | null,
  range: TypedWindow,
  kept: number | null,
): boolean {
  const verdict = judgeTyped(cents, range)
  if (verdict.kind === 'ok') return true
  return verdict.kind === 'ask' && verdict.canKeep && kept === verdict.cents
}

export function MoneyField({
  id,
  label,
  hideLabel = false,
  value,
  onChange,
  range,
  kept,
  onKeep,
  tooLow,
  tooHigh,
  fix,
  autoFocus = false,
  placeholder = '0',
  testId,
}: {
  id: string
  label: string
  hideLabel?: boolean
  /** En centavos. `null` = vacío. */
  value: number | null
  onChange: (cents: number | null) => void
  /** Qué es razonable y qué es posible en este campo. */
  range: TypedWindow
  /** El monto que alguien ya dio por bueno tal cual está. */
  kept: number | null
  onKeep: (cents: number) => void
  /** Qué decir cuando lo escrito no se puede dejar. */
  tooLow?: string
  tooHigh?: string
  /** Una salida mejor que adivinar ceros (por ejemplo, «Cobrar todo lo que falta»). */
  fix?: { label: string; onClick: () => void }
  autoFocus?: boolean
  placeholder?: string
  testId?: string
}) {
  const verdict = judgeTyped(value, range)
  const asking =
    verdict.kind === 'ask' && !(verdict.canKeep && kept === verdict.cents) ? verdict : null
  const hard = asking && !asking.canKeep ? (asking.why === 'low' ? tooLow : tooHigh) : null
  const suggested = asking && !(fix && !asking.canKeep) ? asking.suggestedCents : null
  const questionId = `${id}-pregunta`

  return (
    <div className="pay-money-field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <div className="pay-money">
        <span aria-hidden>$</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9.]*"
          autoComplete="off"
          enterKeyHint="done"
          placeholder={placeholder}
          // biome-ignore lint/a11y/noAutofocus: se abre porque el mozo acaba de tocar «Otro monto»
          autoFocus={autoFocus}
          value={value === null ? '' : groupThousands(String(Math.round(value / 100)))}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, MAX_DIGITS)
            const pesos = digits === '' ? 0 : Number(digits)
            onChange(pesos > 0 ? pesos * 100 : null)
          }}
          aria-describedby={asking ? questionId : undefined}
          aria-invalid={asking && !asking.canKeep ? true : undefined}
          data-testid={testId}
        />
      </div>

      {asking ? (
        <fieldset id={questionId} className="pay-zeros" aria-live="polite">
          <legend className="sr-only">Revisar el monto</legend>
          <p>
            <TriangleAlert aria-hidden strokeWidth={2.4} />
            <span>
              {hard ??
                (asking.canKeep ? typedQuestion(asking) : `${money(asking.cents)} no puede ser.`)}
              {hard && suggested !== null ? ` ¿Son ${money(suggested)}?` : ''}
            </span>
          </p>
          <div className="pay-zeros-acts">
            {suggested !== null ? (
              <button
                type="button"
                className="pay-mini is-main"
                onClick={() => onChange(suggested)}
                data-testid={testId ? `${testId}-fix` : undefined}
              >
                Son {money(suggested)}
              </button>
            ) : null}
            {fix && !asking.canKeep ? (
              <button type="button" className="pay-mini is-main" onClick={fix.onClick}>
                {fix.label}
              </button>
            ) : null}
            {asking.canKeep ? (
              <button
                type="button"
                className="pay-mini"
                onClick={() => onKeep(asking.cents)}
                data-testid={testId ? `${testId}-keep` : undefined}
              >
                {suggested === null ? `Sí, ${money(asking.cents)}` : `Son ${money(asking.cents)}`}
              </button>
            ) : null}
          </div>
        </fieldset>
      ) : null}
    </div>
  )
}
