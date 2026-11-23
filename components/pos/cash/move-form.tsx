'use client'

import { ChevronLeft, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { formatCentsShort } from '@/lib/money/format'
import type { ShiftSummary } from '@/lib/pos/cash/types'
import { attempt, type CashApi, newKey } from './api'
import { PesosInput, TypedGuard, useTypedAmount } from './typed'

/**
 * Plata que entra o sale del cajón sin ser un cobro, con el motivo escrito: sumar cambio, un retiro
 * de los dueños, las propinas. Se anota con monto y motivo, y queda con el nombre de quien la anotó.
 *
 * Cuando el bar usa Administración, un retiro para un proveedor o para alguien del equipo no pasa por
 * acá: lo arma `MoveOutFlow`, que pregunta para qué sale y a quién. Esta hoja es su «Otro motivo» (y
 * entonces trae cómo volver).
 */

const REASONS: Readonly<Record<'in' | 'out', ReadonlyArray<string>>> = {
  out: ['Hielo', 'Proveedor', 'Compra chica', 'Adelanto de sueldo', 'Retiro de los dueños'],
  in: ['Cambio', 'Seña en efectivo', 'Devolución de un retiro'],
}
/** Con la pregunta «¿Para qué sale?» antes, el proveedor y el adelanto ya tienen su camino. */
const OTHER_REASONS: ReadonlyArray<string> = ['Compra chica', 'Hielo', 'Retiro de los dueños']

const COPY = {
  out: {
    title: 'Sacar plata del cajón',
    sub: 'Para pagar algo en efectivo. Queda anotado con tu nombre.',
    noun: 'retiro',
    why: '¿Para qué?',
  },
  in: {
    title: 'Entró plata al cajón',
    sub: 'Plata que entra sin ser un cobro: cambio que trajeron, una seña en efectivo.',
    noun: 'ingreso',
    why: '¿De dónde viene?',
  },
} as const

export function MoveForm({
  kind,
  shiftId,
  live,
  blind,
  api,
  onBack,
  onClose,
  onDone,
}: {
  kind: 'in' | 'out'
  shiftId: string
  live: ShiftSummary
  blind: boolean
  api: Pick<CashApi, 'move'>
  /** Volver a «¿Para qué sale?». Sin esto, la hoja es el retiro de siempre. */
  onBack?: () => void
  onClose: () => void
  onDone: (message: string) => void
}) {
  const amount = useTypedAmount()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // La misma clave mientras la hoja esté abierta: reintentar sin señal no anota dos veces.
  const [key] = useState(newKey)
  const field = useRef<HTMLInputElement>(null)
  // Como paso de «¿Para qué sale?», el botón que se tocó ya no está y el foco quedaría en la hoja
  // entera: va al monto, que es lo que sigue. Al abrirse sola, la hoja ya pone el foco.
  const isStep = onBack !== undefined
  useEffect(() => {
    if (isStep) field.current?.focus({ preventScroll: true })
  }, [isStep])

  const copy = COPY[kind]
  const out = kind === 'out'
  const expected = live.expected_cash_cents
  // A ciegas no hay con qué comparar: «es más de lo que hay» sería decir cuánto hay.
  const check = amount.check(out && !blind ? { capCents: expected } : {})
  const cents = amount.cents
  const why = reason.trim()
  // Las propinas con tarjeta se le pagan al equipo con plata del cajón: el retiro ya se sabe.
  const cardTips = blind ? 0 : live.tip_cents - live.cash_tips_cents
  const ready = cents !== null && cents > 0 && why !== '' && check.kind === 'ok'
  const reasons = out && onBack ? OTHER_REASONS : REASONS[kind]

  const submit = async () => {
    if (!ready || busy || cents === null) return
    setBusy(true)
    setError(null)
    const result = await attempt(() =>
      api.move({ shiftId, kind, amountCents: cents, reason: why, idempotencyKey: key }),
    )
    if (!result.ok) {
      setBusy(false)
      setError(result.message)
      return
    }
    onDone(
      blind
        ? `${out ? 'Retiro' : 'Ingreso'} de ${formatCentsShort(cents)} anotado.`
        : `${out ? 'Retiro' : 'Ingreso'} de ${formatCentsShort(cents)} anotado. En el cajón tiene que haber ${formatCentsShort(expected + (out ? -cents : cents))}.`,
    )
    onClose()
  }

  const label =
    cents === null || cents <= 0
      ? 'Escribí el monto'
      : check.kind === 'ask'
        ? 'Elegí cuál es el monto'
        : why === ''
          ? out
            ? 'Decí para qué es'
            : 'Decí de dónde viene'
          : `Anotar ${copy.noun} de ${formatCentsShort(cents)}`

  return (
    <>
      <form
        className="pos-sheet-body caja-sheet-body has-foot"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="caja-sheet-head">
          {onBack ? (
            <button type="button" className="caja-step-back" onClick={onBack} disabled={busy}>
              <ChevronLeft aria-hidden strokeWidth={2.6} />
              Para qué sale
            </button>
          ) : null}
          <SheetTitle className="pos-sheet-title caja-sheet-title">
            {onBack ? 'Otro motivo' : copy.title}
          </SheetTitle>
          <SheetDescription className="caja-sheet-sub is-ink">{copy.sub}</SheetDescription>
        </div>

        {error ? (
          <p className="caja-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="caja-field">
          <label htmlFor="caja-move-amount">¿Cuánto?</label>
          <div className="caja-pesos">
            <span aria-hidden>$</span>
            <PesosInput
              ref={field}
              id="caja-move-amount"
              value={amount.text}
              onChange={amount.setText}
              disabled={busy}
              data-testid="movimiento-monto"
            />
          </div>
        </div>

        {check.kind === 'ask' ? (
          <TypedGuard
            ask={check}
            why={
              check.why === 'over'
                ? `En el cajón tiene que haber ${formatCentsShort(expected)}: es más de lo que hay.`
                : null
            }
            onPick={amount.set}
          />
        ) : null}

        <fieldset className="caja-group" disabled={busy}>
          <legend>
            <span className="pos-sheet-q">{copy.why}</span>
          </legend>
          <div className="caja-opts">
            {out && cardTips > 0 ? (
              <button
                type="button"
                className="caja-opt"
                aria-pressed={why === 'Propinas con tarjeta' && cents === cardTips}
                onClick={() => {
                  amount.set(cardTips)
                  setReason('Propinas con tarjeta')
                }}
              >
                <span>
                  Propinas con tarjeta <small>· {formatCentsShort(cardTips)}</small>
                </span>
              </button>
            ) : null}
            {reasons.map((option) => (
              <button
                key={option}
                type="button"
                className="caja-opt"
                aria-pressed={why === option}
                onClick={() => setReason(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <input
            className="caja-input"
            type="text"
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="O escribilo: qué se pagó, a quién"
            aria-label={copy.why}
            autoComplete="off"
            enterKeyHint="done"
            data-testid="movimiento-motivo"
          />
        </fieldset>
      </form>

      <div className="caja-sheet-foot">
        <button
          type="button"
          className="pos-btn pos-btn-primary"
          onClick={() => void submit()}
          disabled={!ready || busy}
          data-testid="movimiento-anotar"
        >
          {busy ? <LoaderCircle className="caja-spin size-5" aria-hidden /> : null}
          {label}
        </button>
      </div>
    </>
  )
}
