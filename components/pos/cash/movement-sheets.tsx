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
import { attempt, type CashApi } from './api'
import { MoveForm } from './move-form'
import { MoveOutFlow, useCashTargets } from './move-out-flow'

/**
 * Plata que entra o sale del cajón sin ser un cobro: sacar para pagar el hielo, sumar cambio. Se
 * anota con monto y motivo, y queda con el nombre de quien la anotó. Un movimiento mal anotado no
 * se borra: se anula diciendo por qué.
 *
 * Si el bar usa Administración (`payees`), «Sacar plata» pregunta primero para qué sale: a qué
 * proveedor, o a quién del equipo (adelanto, horas extra, sueldo). Eso lo arma `MoveOutFlow`; el
 * resto (lo que entra, y los bares sin Administración) es el formulario de siempre, `MoveForm`.
 */
export function MoveSheet({
  kind,
  shiftId,
  branchId,
  live,
  blind = false,
  practice = false,
  payees = false,
  today = null,
  purchaseHref = null,
  api,
  onClose,
  onDone,
  onSaved,
}: {
  /** `null` = cerrada. */
  kind: 'in' | 'out' | null
  shiftId: string
  /** La sucursal de esta caja: de ahí salen las listas de a quién se le paga. */
  branchId: string
  live: ShiftSummary
  /** Quien anota no ve cuánto tiene que haber en el cajón. */
  blind?: boolean
  /** El turno es de práctica: lo anotado no llega a Administración. */
  practice?: boolean
  /** El bar usa Administración: al sacar plata se elige el proveedor o a quién del equipo. */
  payees?: boolean
  /** El día del bar (`yyyy-MM-dd`), para los atajos de fechas del pago de un sueldo. */
  today?: string | null
  /** A dónde se carga la compra de un retiro; `null` si quien está no carga compras. */
  purchaseHref?: ((movementId: string) => string) | null
  api: Pick<CashApi, 'move' | 'targets'>
  onClose: () => void
  onDone: (message: string) => void
  /** Se anotó un retiro con destino: hay que volver a leer la caja (la hoja ya avisa). */
  onSaved: () => void
}) {
  const shown = useLast(kind)
  // Cada vez que se abre arranca en blanco y con una clave nueva (al cerrarse no se vacía: baja
  // mostrando lo que tenía).
  const [session, setSession] = useState({ open: false, turn: 0 })
  if ((kind !== null) !== session.open) {
    setSession({ open: kind !== null, turn: session.turn + (kind !== null ? 1 : 0) })
  }
  // Las listas se piden al abrir «Sacar plata», no al cargar la caja: casi nunca hacen falta.
  const targets = useCashTargets(api, branchId, payees && kind === 'out')
  return (
    <Sheet open={kind !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet caja-sheet', posFont.variable)}
        data-testid="movimiento-nuevo"
      >
        <SheetGrabber />
        {shown === 'out' && payees ? (
          <MoveOutFlow
            key={session.turn}
            shiftId={shiftId}
            live={live}
            blind={blind}
            practice={practice}
            today={today}
            targets={targets}
            purchaseHref={purchaseHref}
            api={api}
            onClose={onClose}
            onDone={onDone}
            onSaved={onSaved}
          />
        ) : shown ? (
          <MoveForm
            key={session.turn}
            kind={shown}
            shiftId={shiftId}
            live={live}
            blind={blind}
            api={api}
            onClose={onClose}
            onDone={onDone}
          />
        ) : null}
      </SheetContent>
    </Sheet>
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
