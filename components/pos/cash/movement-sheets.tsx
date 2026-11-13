'use client'

import { Ban, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useLast } from '@/components/pos/order/use-last'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatCentsShort } from '@/lib/money/format'
import type { CashMovement, ShiftSummary } from '@/lib/pos/cash/types'
import { posFont } from '@/lib/pos/font'
import { clockAt } from '@/lib/pos/order/clock'
import { cn } from '@/lib/utils'
import { attempt, type CashApi, newKey } from './api'
import { PesosInput, TypedGuard, useTypedAmount } from './typed'

/**
 * Plata que entra o sale del cajón sin ser un cobro: sacar para pagar el hielo, sumar cambio. Se
 * anota con monto y motivo, y queda con el nombre de quien la anotó. Un movimiento mal anotado no
 * se borra: se anula diciendo por qué.
 */

const REASONS: Readonly<Record<'in' | 'out', ReadonlyArray<string>>> = {
  out: ['Hielo', 'Proveedor', 'Compra chica', 'Adelanto de sueldo', 'Retiro de los dueños'],
  in: ['Cambio', 'Seña en efectivo', 'Devolución de un retiro'],
}

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

export function MoveSheet({
  kind,
  shiftId,
  live,
  api,
  onClose,
  onDone,
}: {
  /** `null` = cerrada. */
  kind: 'in' | 'out' | null
  shiftId: string
  live: ShiftSummary
  api: Pick<CashApi, 'move'>
  onClose: () => void
  onDone: (message: string) => void
}) {
  const shown = useLast(kind)
  // Cada vez que se abre arranca en blanco y con una clave nueva (al cerrarse no se vacía: baja
  // mostrando lo que tenía).
  const [session, setSession] = useState({ open: false, turn: 0 })
  if ((kind !== null) !== session.open) {
    setSession({ open: kind !== null, turn: session.turn + (kind !== null ? 1 : 0) })
  }
  return (
    <Sheet open={kind !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet caja-sheet', posFont.variable)}
        data-testid="movimiento-nuevo"
      >
        <SheetGrabber />
        {shown ? (
          <MoveForm
            key={session.turn}
            kind={shown}
            shiftId={shiftId}
            live={live}
            api={api}
            onClose={onClose}
            onDone={onDone}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function MoveForm({
  kind,
  shiftId,
  live,
  api,
  onClose,
  onDone,
}: {
  kind: 'in' | 'out'
  shiftId: string
  live: ShiftSummary
  api: Pick<CashApi, 'move'>
  onClose: () => void
  onDone: (message: string) => void
}) {
  const amount = useTypedAmount()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // La misma clave mientras la hoja esté abierta: reintentar sin señal no anota dos veces.
  const [key] = useState(newKey)

  const copy = COPY[kind]
  const out = kind === 'out'
  const expected = live.expected_cash_cents
  const check = amount.check(out ? { capCents: expected } : {})
  const cents = amount.cents
  const why = reason.trim()
  // Las propinas con tarjeta se le pagan al equipo con plata del cajón: el retiro ya se sabe.
  const cardTips = live.tip_cents - live.cash_tips_cents
  const ready = cents !== null && cents > 0 && why !== '' && check.kind === 'ok'

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
      `${out ? 'Retiro' : 'Ingreso'} de ${formatCentsShort(cents)} anotado. En el cajón tiene que haber ${formatCentsShort(expected + (out ? -cents : cents))}.`,
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
          <SheetTitle className="pos-sheet-title caja-sheet-title">{copy.title}</SheetTitle>
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
            {REASONS[kind].map((option) => (
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

const VOID_REASONS = ['Se anotó por error', 'El monto estaba mal', 'Al final no se hizo'] as const

/** Tocar un retiro o un ingreso de la cinta: verlo entero y, si hace falta, anularlo. */
export function MovementSheet({
  movement,
  access,
  timeZone,
  api,
  onClose,
  onChanged,
}: {
  movement: CashMovement | null
  access: { void: boolean; note: string | null } | null
  timeZone: string
  api: Pick<CashApi, 'voidMove'>
  onClose: () => void
  onChanged: (message: string) => void
}) {
  const shown = useLast(movement)
  const can = useLast(access)
  const [state, setState] = useState<{
    sourceId: string | null
    asking: boolean
    why: string
    busy: string | null
    error: string | null
  }>({ sourceId: null, asking: false, why: '', busy: null, error: null })
  if (movement && state.sourceId !== movement.id) {
    setState({ sourceId: movement.id, asking: false, why: '', busy: null, error: null })
  }

  const out = shown?.kind === 'out'
  const noun = out ? 'retiro' : 'ingreso'

  const voidWith = async (why: string) => {
    const reason = why.trim()
    if (!shown || !reason || state.busy) return
    setState((s) => ({ ...s, busy: why, error: null }))
    const result = await attempt(() => api.voidMove(shown.id, reason))
    if (!result.ok) {
      setState((s) => ({ ...s, busy: null, error: result.message }))
      return
    }
    onChanged(`El ${noun} de ${formatCentsShort(shown.amount_cents)} quedó anulado.`)
    onClose()
  }

  return (
    <Sheet
      open={movement !== null}
      onOpenChange={(next) => {
        if (!next && !state.busy) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet caja-sheet', posFont.variable)}
        data-testid="movimiento-hoja"
      >
        <SheetGrabber />
        {shown && can ? (
          <>
            <div className="pos-sheet-body caja-sheet-body has-foot">
              <div className="caja-sheet-head">
                <SheetTitle className="pos-sheet-title caja-sheet-title">
                  {out ? 'Retiro' : 'Ingreso'} · {shown.reason}
                </SheetTitle>
                <SheetDescription className="caja-sheet-sub">
                  {out ? '− ' : '+ '}
                  {formatCentsShort(shown.amount_cents)} · {clockAt(shown.at, timeZone)} · anotó{' '}
                  {shown.by_name}
                </SheetDescription>
                {shown.voided_at ? (
                  <>
                    <p>
                      <span className="caja-stamp is-void">
                        <Ban aria-hidden strokeWidth={3} />
                        Anulado
                      </span>
                    </p>
                    <p className="caja-sheet-sub is-ink">
                      {shown.void_reason ? `«${shown.void_reason}»` : 'Sin motivo'}
                      {shown.voided_by_name ? ` · anuló ${shown.voided_by_name}` : ''}{' '}
                      {clockAt(shown.voided_at, timeZone)}
                    </p>
                  </>
                ) : null}
              </div>

              {can.note ? <p className="caja-sheet-sub is-ink">{can.note}</p> : null}

              {state.error ? (
                <p className="caja-error" role="alert">
                  {state.error}
                </p>
              ) : null}

              {state.asking ? (
                <fieldset className="caja-group" disabled={state.busy !== null}>
                  <legend>
                    <span className="pos-sheet-q">¿Por qué se anula?</span>
                    <small>No se borra: queda en la cinta con el sello.</small>
                  </legend>
                  <div className="caja-reasons">
                    {VOID_REASONS.map((reason, index) => (
                      <button
                        key={reason}
                        type="button"
                        className="caja-opt"
                        onClick={() => void voidWith(reason)}
                        data-testid={`movimiento-motivo-${index}`}
                      >
                        {state.busy === reason ? (
                          <LoaderCircle className="caja-spin" aria-hidden />
                        ) : null}
                        {reason}
                      </button>
                    ))}
                  </div>
                  <div className="caja-field">
                    <label htmlFor="caja-move-void-why">Otro motivo</label>
                    <input
                      id="caja-move-void-why"
                      className="caja-input"
                      type="text"
                      value={state.why}
                      maxLength={200}
                      onChange={(event) => setState((s) => ({ ...s, why: event.target.value }))}
                      placeholder="Contalo en pocas palabras"
                      autoComplete="off"
                      enterKeyHint="done"
                    />
                  </div>
                </fieldset>
              ) : null}
            </div>

            <div className="caja-sheet-foot">
              {state.asking ? (
                <>
                  <button
                    type="button"
                    className="pos-btn pos-btn-quiet is-side"
                    onClick={() => setState((s) => ({ ...s, asking: false, error: null }))}
                    disabled={state.busy !== null}
                  >
                    No anular
                  </button>
                  <button
                    type="button"
                    className="pos-btn pos-btn-primary"
                    onClick={() => void voidWith(state.why)}
                    disabled={state.busy !== null || state.why.trim() === ''}
                  >
                    {state.why.trim() === '' ? 'Elegí o escribí el motivo' : `Anular el ${noun}`}
                  </button>
                </>
              ) : (
                <>
                  {can.void ? (
                    <button
                      type="button"
                      className="pos-btn pos-btn-quiet is-danger is-side"
                      onClick={() => setState((s) => ({ ...s, asking: true }))}
                      data-testid="movimiento-anular"
                    >
                      Anular este {noun}
                    </button>
                  ) : null}
                  <button type="button" className="pos-btn pos-btn-primary" onClick={onClose}>
                    Listo
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
