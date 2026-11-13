'use client'

import { Check, ChevronRight, Hourglass, LoaderCircle, Undo2, X } from 'lucide-react'
import Link from 'next/link'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatCentsShort } from '@/lib/money'
import type { ApprovalStatus, ApprovalsInbox, InboxApproval } from '@/lib/pos/cash/types'
import { posFont } from '@/lib/pos/font'
import { clockAt } from '@/lib/pos/order/clock'
import {
  agoLabel,
  approvalCents,
  approvalReason,
  approvalTitle,
  approvalWhere,
  DECISION_WORD,
} from '@/lib/pos/pay/approvals'
import { cn } from '@/lib/utils'
import { type ApprovalAct, isSettled } from './use-approval-acts'
import './approvals.css'

/**
 * La hoja de pedidos. Quien puede dar el OK ve todo lo que espera y contesta con un toque; el resto
 * ve lo suyo y lo que le contestaron.
 *
 *   · Aprobar un descuento: un toque. Se puede deshacer (se quita el descuento).
 *   · Rechazar, o retirar un pedido propio: un toque. Durante unos segundos se puede deshacer.
 *   · Aprobar una baja: no tiene vuelta, así que se pregunta una vez.
 */

export type ApprovalRow = { approval: InboxApproval; act: ApprovalAct | null }

const STAMP_CLASS: Readonly<Record<Exclude<ApprovalStatus, 'pending'>, string>> = {
  approved: '',
  rejected: 'is-no',
  cancelled: 'is-off',
}

/**
 * Un pedido, con lo que se le puede contestar. Es el mismo papelito en la bandeja y en la cuenta de
 * su mesa (ahí va `inBill`: no hace falta decir de qué mesa es ni ofrecer ir a verla).
 */
export function ApprovalSlip({
  row,
  canDecide,
  nowMs,
  inBill = false,
  billHref,
  onApprove,
  onReject,
  onUndo,
  onBack,
  onNavigate,
}: {
  row: ApprovalRow
  canDecide: boolean
  nowMs: number
  inBill?: boolean
  /** A dónde lleva «Ver cuenta». `null` = es la mesa que ya se está mirando. */
  billHref?: (sessionId: string) => string | null
  onApprove: (approval: InboxApproval) => void
  onReject: (approval: InboxApproval) => void
  onUndo: (approval: InboxApproval) => void
  onBack: (approval: InboxApproval) => void
  onNavigate?: () => void
}) {
  const { approval, act } = row
  const isVoid = approval.kind === 'void_item'
  const cents = approvalCents(approval)
  const reason = approvalReason(approval)
  const settled = isSettled(act)
  const busy = act?.kind === 'busy'
  const mayDecide = canDecide
  const mayWithdraw = !canDecide && approval.mine

  const who = approval.mine ? 'lo pediste vos' : `lo pidió ${approval.requested_by_name}`
  const ago = agoLabel(approval.requested_at, nowMs)
  const href = !inBill && !settled ? (billHref?.(approval.session_id) ?? null) : null

  return (
    <li
      className={cn('apv-slip', inBill && 'is-inline', settled && 'is-done')}
      data-testid={`approval-${approval.kind}`}
      data-state={act?.kind ?? 'pending'}
    >
      {inBill ? (
        // En la cuenta de su mesa: qué se pide y cuánto mueve, en un renglón.
        <p className="apv-slip-top">
          <Hourglass aria-hidden strokeWidth={2.4} />
          <b>{approvalTitle(approval)}</b>
          {cents !== null ? <em>{formatCentsShort(-cents)}</em> : null}
        </p>
      ) : (
        <>
          <p className="apv-slip-top">
            <b>
              {approvalWhere(approval)}
              {approval.table_label && approval.alias ? ` · ${approval.alias}` : ''}
            </b>
            {href ? (
              <Link href={href} className="apv-slip-link" onClick={onNavigate} prefetch={false}>
                Ver cuenta
                <ChevronRight aria-hidden strokeWidth={2.6} />
              </Link>
            ) : null}
          </p>
          <div className="apv-slip-what">
            <h3>{approvalTitle(approval)}</h3>
            {cents !== null ? <b>{formatCentsShort(-cents)}</b> : null}
          </div>
        </>
      )}
      <p className="apv-slip-why">
        {inBill && !settled ? `${canDecide ? 'Espera tu OK' : 'Esperando el OK'} · ` : ''}
        {reason ? `«${reason}» · ` : ''}
        {who}
        {ago ? ` · ${ago}` : ''}
      </p>

      {act?.kind === 'error' ? (
        <p className="apv-error" role="alert">
          {act.message}
        </p>
      ) : null}

      {act?.kind === 'grace' || act?.kind === 'done' ? (
        <div className="apv-acts" role="status">
          <span className={cn('apv-stamp', STAMP_CLASS[act.status])}>
            {act.status === 'approved' ? (
              <Check aria-hidden strokeWidth={3} />
            ) : (
              <X aria-hidden strokeWidth={3} />
            )}
            {DECISION_WORD[act.status]}
          </span>
          {act.kind === 'grace' || act.undo ? (
            <button
              type="button"
              className="apv-btn is-link"
              onClick={() => onUndo(approval)}
              data-testid="approval-undo"
            >
              <Undo2 aria-hidden strokeWidth={2.4} />
              Deshacer
            </button>
          ) : null}
        </div>
      ) : act?.kind === 'undone' ? (
        <div className="apv-acts" role="status">
          <span className="apv-stamp is-off">
            <Undo2 aria-hidden strokeWidth={2.6} />
            Deshecho
          </span>
          <span className="apv-slip-why">El descuento se quitó de la mesa.</span>
        </div>
      ) : act?.kind === 'confirm' ? (
        <>
          <p className="apv-confirm">No tiene vuelta. ¿Lo damos de baja?</p>
          <div className="apv-acts">
            <button type="button" className="apv-btn" onClick={() => onBack(approval)}>
              No
            </button>
            <button
              type="button"
              className="apv-btn is-main"
              onClick={() => onApprove(approval)}
              data-testid="approval-confirm"
            >
              Sí, dar de baja
            </button>
          </div>
        </>
      ) : mayDecide ? (
        <div className="apv-acts">
          <button
            type="button"
            className="apv-btn"
            onClick={() => onReject(approval)}
            disabled={busy}
            data-testid="approval-reject"
          >
            Rechazar
          </button>
          <button
            type="button"
            className="apv-btn is-main"
            onClick={() => onApprove(approval)}
            disabled={busy}
            data-testid="approval-approve"
          >
            {busy ? <LoaderCircle className="apv-spin" aria-hidden /> : null}
            {isVoid ? 'Dar de baja…' : 'Aprobar'}
          </button>
        </div>
      ) : mayWithdraw ? (
        <div className="apv-acts">
          <span className="apv-slip-why">Hasta el OK, el total no cambia.</span>
          <button
            type="button"
            className="apv-btn is-link"
            onClick={() => onReject(approval)}
            disabled={busy}
            data-testid="approval-withdraw"
          >
            Retirar el pedido
          </button>
        </div>
      ) : (
        <p className="apv-slip-why">Hasta que el encargado conteste, el total no cambia.</p>
      )}
    </li>
  )
}

export function ApprovalsSheet({
  open,
  inbox,
  rows,
  nowMs,
  timeZone,
  billHref,
  onOpenChange,
  onApprove,
  onReject,
  onUndo,
  onBack,
}: {
  open: boolean
  inbox: ApprovalsInbox
  /** Lo pendiente, más lo que se contestó desde esta hoja (que se queda a la vista hasta cerrarla). */
  rows: ReadonlyArray<ApprovalRow>
  nowMs: number
  timeZone: string
  billHref: (sessionId: string) => string | null
  onOpenChange: (open: boolean) => void
  onApprove: (approval: InboxApproval) => void
  onReject: (approval: InboxApproval) => void
  onUndo: (approval: InboxApproval) => void
  /** Volver atrás de la pregunta «¿lo damos de baja?». */
  onBack: (approval: InboxApproval) => void
}) {
  const canDecide = inbox.can_decide
  const shownIds = new Set(rows.map((row) => row.approval.id))
  const recent = inbox.recent.filter((approval) => !shownIds.has(approval.id))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet apv-sheet', posFont.variable)}
        data-testid="approvals-sheet"
      >
        <SheetGrabber />
        <div className="pos-sheet-body apv-body">
          <div className="apv-head">
            <SheetTitle className="pos-sheet-title apv-title">
              {canDecide ? 'Para tu OK' : 'Tus pedidos'}
            </SheetTitle>
            <SheetDescription className="apv-sub">
              {canDecide
                ? 'Descuentos y bajas que pidió el salón. Hasta que contestes, la cuenta no cambia.'
                : 'Los descuentos y las bajas que pediste, y lo que te contestaron.'}
            </SheetDescription>
          </div>

          {rows.length > 0 ? (
            <ul className="apv-list">
              {rows.map((row) => (
                <ApprovalSlip
                  key={row.approval.id}
                  row={row}
                  canDecide={canDecide}
                  nowMs={nowMs}
                  billHref={billHref}
                  onApprove={onApprove}
                  onReject={onReject}
                  onUndo={onUndo}
                  onBack={onBack}
                  onNavigate={() => onOpenChange(false)}
                />
              ))}
            </ul>
          ) : (
            <div className="apv-empty">
              <h3>{canDecide ? 'Nada espera tu OK' : 'No tenés pedidos esperando'}</h3>
              <p>
                {canDecide
                  ? 'Cuando alguien pida un descuento o una baja, aparece acá y la campanita lo avisa.'
                  : 'Cuando pidas un descuento o una baja desde una cuenta, lo seguís desde acá.'}
              </p>
            </div>
          )}

          {recent.length > 0 ? (
            <section className="apv-list" aria-label="Lo que ya se contestó">
              <h3 className="apv-h">Ya contestado</h3>
              <ul className="apv-recent">
                {recent.map((approval) => {
                  const status = approval.status === 'pending' ? 'cancelled' : approval.status
                  return (
                    <li key={approval.id} className={STAMP_CLASS[status]}>
                      {status === 'approved' ? (
                        <Check aria-hidden strokeWidth={3} />
                      ) : (
                        <X aria-hidden strokeWidth={3} />
                      )}
                      <span className="apv-recent-main">
                        {approvalWhere(approval)} · {approvalTitle(approval)}
                        <small>
                          {DECISION_WORD[status]}
                          {approval.decided_by_name ? ` por ${approval.decided_by_name}` : ''}
                          {approval.decided_at
                            ? ` · ${clockAt(approval.decided_at, timeZone)}`
                            : ''}
                          {approval.decision_note ? ` · ${approval.decision_note}` : ''}
                        </small>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          <div className="apv-foot">
            <button
              type="button"
              className="pos-btn pos-btn-quiet"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
