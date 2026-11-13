'use client'

import { BellRing, Check, ChevronUp, Pause, Play, Plus, Receipt, Send } from 'lucide-react'
import type { BarPrimary } from '@/lib/pos/order/tickets'
import { cn } from '@/lib/utils'

/**
 * La barra de abajo. Cuenta y Agregar están siempre, en el mismo lugar; lo que cambia es el botón
 * que manda, uno solo por vez:
 *   hay algo sin enviar → «Enviar a cocina» (y «Después» al lado)
 *   hay comida lista    → «Servido» (y arriba, qué es lo que hay que llevar)
 *   hay una tanda esperando y cocina libre → «Marchar tanda N»
 *   nada pendiente      → «Agregar» pasa a ser el botón grande
 */

export function SendRow({
  units,
  blocked,
  onSend,
  onHold,
}: {
  units: number
  /** Hay algo en el borrador que el servidor va a rebotar (un agotado). */
  blocked: boolean
  onSend: () => void
  onHold: () => void
}) {
  return (
    <div className="cmd-bar-row">
      <button
        type="button"
        className="cmd-go is-quiet"
        onClick={onHold}
        disabled={blocked}
        aria-label="Después: dejar la tanda cargada en espera"
        data-testid="order-hold"
      >
        <Pause aria-hidden strokeWidth={2.6} />
        Después
      </button>
      <button
        type="button"
        className="cmd-go"
        onClick={onSend}
        disabled={blocked}
        data-testid="order-send"
      >
        <Send aria-hidden strokeWidth={2.4} />
        Enviar a cocina · {units}
      </button>
    </div>
  )
}

export function BlockedNote() {
  return (
    <p className="cmd-bar-note" role="status">
      Hay un producto <b>agotado</b> en el pedido. Sacalo y lo podés enviar.
    </p>
  )
}

export function ActionBar({
  primary,
  fireNumber,
  readyLabel,
  blocked,
  billOn,
  billBusy,
  addRef,
  onAdd,
  onBill,
  onSend,
  onHold,
  onServe,
  onShowReady,
  onFire,
}: {
  primary: BarPrimary
  /** El número de la tanda que se marcharía. */
  fireNumber: number | null
  /** «2 Mojito · 1 Lomo»: lo que está listo para llevar. */
  readyLabel: string
  blocked: boolean
  billOn: boolean
  billBusy: boolean
  addRef: React.Ref<HTMLButtonElement>
  onAdd: () => void
  onBill: () => void
  onSend: () => void
  onHold: () => void
  onServe: () => void
  /** Ir a la tanda que tiene lo listo (puede haber quedado arriba, fuera de la vista). */
  onShowReady: () => void
  onFire: () => void
}) {
  const addIsMain = primary.kind === 'add'
  return (
    <div className="cmd-bar" data-primary={primary.kind}>
      {primary.kind === 'send' && blocked ? <BlockedNote /> : null}

      {primary.kind === 'serve' && readyLabel ? (
        <button
          type="button"
          className="cmd-bar-ready"
          onClick={onShowReady}
          aria-label={`Listo para llevar: ${readyLabel}. Ver en la comanda`}
          data-testid="order-ready"
        >
          <BellRing aria-hidden strokeWidth={2.5} />
          <span>
            <b>Para llevar:</b> {readyLabel}
          </span>
          <ChevronUp aria-hidden />
        </button>
      ) : null}

      <div className="cmd-bar-row">
        {/* Un toque: pide la cuenta (la mesa cambia de estado en el mapa) y la abre para cobrar. */}
        <button
          type="button"
          className="cmd-util"
          aria-pressed={billOn}
          aria-label={billOn ? 'Ver la cuenta: ya la pidieron' : 'Pedir la cuenta y abrirla'}
          onClick={onBill}
          disabled={billBusy}
          data-testid="order-bill"
        >
          <Receipt aria-hidden strokeWidth={2.2} />
          {billOn ? 'Ver cuenta' : 'Cuenta'}
        </button>
        <button
          ref={addRef}
          type="button"
          className={cn(addIsMain ? 'cmd-go' : 'cmd-util')}
          onClick={onAdd}
          data-testid="order-add"
        >
          <Plus aria-hidden strokeWidth={addIsMain ? 2.8 : 2.4} />
          Agregar
        </button>

        {primary.kind === 'serve' ? (
          <button
            type="button"
            className="cmd-go is-ready"
            onClick={onServe}
            data-testid="order-serve"
          >
            <Check aria-hidden strokeWidth={3} />
            Servido · {primary.units}
          </button>
        ) : null}

        {primary.kind === 'fire' ? (
          <button type="button" className="cmd-go" onClick={onFire} data-testid="order-fire">
            <Play aria-hidden strokeWidth={2.6} />
            Marchar tanda{fireNumber ? ` ${fireNumber}` : ''}
          </button>
        ) : null}
      </div>

      {primary.kind === 'send' ? (
        <SendRow units={primary.units} blocked={blocked} onSend={onSend} onHold={onHold} />
      ) : null}
    </div>
  )
}
