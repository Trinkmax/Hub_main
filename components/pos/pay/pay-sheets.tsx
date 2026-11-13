'use client'

import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useLast } from '@/components/pos/order/use-last'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { computeBill, percentToBp } from '@/lib/pos/cash/bill'
import {
  type Bill,
  type BillDiscount,
  type BillLine,
  METHOD_LABEL,
  type Payment,
  type PaymentEdit,
} from '@/lib/pos/cash/types'
import { posFont } from '@/lib/pos/font'
import { clockAt } from '@/lib/pos/order/clock'
import { isVoidPayload } from '@/lib/pos/pay/approvals'
import { bpLabel } from '@/lib/pos/pay/charge'
import type { LineGroup } from '@/lib/pos/pay/lines'
import { discountWindow } from '@/lib/pos/pay/typed'
import { cn } from '@/lib/utils'
import { MoneyField, typedSettled } from './money-field'
import { minus, money } from './pay-types'

/**
 * Las hojas de la cuenta: pedir un descuento, dar de baja un renglón, mirar (y anular) un cobro.
 *
 * Todo lo que mueve plata fuera de un cobro lleva motivo. Donde no hay vuelta (dar de baja, anular),
 * elegir el motivo es la confirmación; el descuento se elige, se ve cómo queda la cuenta y recién
 * ahí se aplica o se pide.
 */

/** Lo que devuelve una acción lanzada desde una hoja: `null` salió bien; si no, el mensaje. */
export type SheetResult = Promise<string | null>

const DISCOUNT_REASONS = ['Cortesía de la casa', 'Demora', 'Reclamo', 'Promo', 'Personal del bar']
const VOID_REASONS = ['No lo consumieron', 'Vino mal', 'Se demoró', 'Error de carga']
const PAYMENT_VOID_REASONS = [
  'Medio equivocado',
  'Monto equivocado',
  'No pagó',
  'Se cobró dos veces',
]
const PERCENTS = [10, 15, 20, 50]
const MAX_REASON = 200

function sheetClass(): string {
  return cn('pos pos-sheet pay-sheet', posFont.variable)
}

function SheetError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="pay-alert" role="alert">
      <span>{message}</span>
    </p>
  )
}

/** Motivos para tocar: el toque ES la confirmación. El texto libre es la última opción. */
function ReasonButtons({
  reasons,
  busy,
  submitLabel,
  onPick,
}: {
  reasons: ReadonlyArray<string>
  /** El motivo que está viajando. */
  busy: string | null
  submitLabel: string
  onPick: (reason: string) => void
}) {
  const [other, setOther] = useState<string | null>(null)
  const typed = (other ?? '').trim()
  return (
    <>
      <div className="pay-reasons">
        {reasons.map((reason, i) => (
          <button
            key={reason}
            type="button"
            className="pay-opt"
            onClick={() => onPick(reason)}
            data-testid={`pay-reason-${i}`}
          >
            {busy === reason ? <LoaderCircle className="pay-spin" aria-hidden /> : null}
            {reason}
          </button>
        ))}
        {other === null ? (
          <button type="button" className="pay-opt" onClick={() => setOther('')}>
            Otro motivo
          </button>
        ) : null}
      </div>
      {other !== null ? (
        <form
          className="pay-rows"
          onSubmit={(event) => {
            event.preventDefault()
            if (typed) onPick(typed)
          }}
        >
          <label className="sr-only" htmlFor="pay-other-reason">
            Otro motivo
          </label>
          <input
            id="pay-other-reason"
            className="pay-text"
            type="text"
            value={other}
            maxLength={MAX_REASON}
            onChange={(event) => setOther(event.target.value)}
            placeholder="Contá qué pasó"
            autoComplete="off"
            enterKeyHint="done"
            // biome-ignore lint/a11y/noAutofocus: aparece porque acaban de tocar «Otro motivo»
            autoFocus
          />
          <button type="submit" className="pay-go" disabled={!typed || busy !== null}>
            {busy !== null && busy === typed ? (
              <LoaderCircle className="pay-spin" aria-hidden />
            ) : null}
            {typed ? submitLabel : 'Escribí el motivo'}
          </button>
        </form>
      ) : null}
    </>
  )
}

// ─── Descuento a la mesa ─────────────────────────────────────────────────────

export type DiscountChoice =
  | { kind: 'percent'; percent: number; reason: string }
  | { kind: 'amount'; amountCents: number; reason: string }

type DiscountDraft = {
  mode: 'percent' | 'other' | 'amount' | null
  percent: number | null
  otherText: string
  cents: number | null
  kept: number | null
  reason: string
  otherReason: string | null
  busy: boolean
  error: string | null
}

const EMPTY_DISCOUNT: DiscountDraft = {
  mode: null,
  percent: null,
  otherText: '',
  cents: null,
  kept: null,
  reason: '',
  otherReason: null,
  busy: false,
  error: null,
}

/** «12,5» → 12.5. Hasta dos decimales, entre 0 y 100. */
function parsePercent(text: string): number | null {
  const clean = text.trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null
  const value = Number(clean)
  return value > 0 && value <= 100 ? value : null
}

export function DiscountSheet({
  open,
  bill,
  onClose,
  onSubmit,
}: {
  open: boolean
  bill: Bill
  onClose: () => void
  onSubmit: (choice: DiscountChoice) => SheetResult
}) {
  const [draft, setDraft] = useState({ open: false, ...EMPTY_DISCOUNT })
  if (open !== draft.open) setDraft({ open, ...EMPTY_DISCOUNT })
  const patch = (change: Partial<DiscountDraft>) =>
    setDraft((d) => ({ ...d, error: null, ...change }))

  const direct = bill.can.discount_direct
  const range = discountWindow(bill.bill.subtotal_cents, bill.bill.remaining_cents)
  const percent =
    draft.mode === 'percent'
      ? draft.percent
      : draft.mode === 'other'
        ? parsePercent(draft.otherText)
        : null
  const cents =
    draft.mode === 'amount' && typedSettled(draft.cents, range, draft.kept) ? draft.cents : null
  const chosen =
    percent !== null
      ? ({ kind: 'percent', value: percentToBp(percent) } as const)
      : cents !== null
        ? ({ kind: 'amount', value: cents } as const)
        : null
  const reason = (draft.otherReason !== null ? draft.otherReason : draft.reason).trim()

  const after = chosen
    ? computeBill({
        subtotalCents: bill.bill.subtotal_cents,
        discounts: [...bill.discounts, chosen],
        // La seña que ya se está usando es todo lo que hay disponible para esta mesa: si la cuenta
        // baja, se usa menos; nunca más.
        depositAvailableCents: bill.bill.deposit_cents,
        payments: bill.payments,
      })
    : null
  const tooMuch = after !== null && after.overpaid_cents > 0
  const ready = chosen !== null && reason !== '' && !tooMuch

  const submit = async () => {
    if (!ready || draft.busy || chosen === null) return
    patch({ busy: true })
    const error = await onSubmit(
      chosen.kind === 'percent' && percent !== null
        ? { kind: 'percent', percent, reason }
        : { kind: 'amount', amountCents: chosen.value, reason },
    )
    if (error) patch({ busy: false, error })
    else onClose()
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && !draft.busy && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={sheetClass()}
        data-testid="discount-sheet"
      >
        <SheetGrabber />
        <div className="pos-sheet-body pay-sheet-body">
          <div className="pay-sheet-head">
            <SheetTitle className="pos-sheet-title pay-sheet-title">
              {direct ? 'Descuento a la mesa' : 'Pedir un descuento'}
            </SheetTitle>
            <SheetDescription className="pay-sheet-sub is-ink">
              {direct
                ? 'Se aplica ahora. Queda anotado quién fue.'
                : 'El encargado da el OK desde su celular. Hasta entonces el total no cambia.'}
            </SheetDescription>
          </div>

          <fieldset className="pay-group" disabled={draft.busy}>
            <legend>
              <span className="pos-sheet-q">¿Cuánto?</span>
            </legend>
            <div className="pay-opts">
              {PERCENTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="pay-opt"
                  aria-pressed={draft.mode === 'percent' && draft.percent === value}
                  onClick={() => patch({ mode: 'percent', percent: value })}
                  data-testid={`discount-${value}`}
                >
                  {value} %
                </button>
              ))}
              <button
                type="button"
                className="pay-opt"
                aria-pressed={draft.mode === 'other'}
                onClick={() => patch({ mode: 'other' })}
              >
                Otro %
              </button>
              <button
                type="button"
                className="pay-opt"
                aria-pressed={draft.mode === 'amount'}
                onClick={() => patch({ mode: 'amount', kept: null })}
                data-testid="discount-amount"
              >
                En pesos
              </button>
            </div>
            {draft.mode === 'other' ? (
              <div className="pay-money-field">
                <label className="sr-only" htmlFor="pay-discount-percent">
                  Porcentaje de descuento
                </label>
                <div className="pay-money">
                  <input
                    id="pay-discount-percent"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="done"
                    placeholder="12,5"
                    value={draft.otherText}
                    onChange={(event) =>
                      patch({ otherText: event.target.value.replace(/[^\d.,]/g, '').slice(0, 6) })
                    }
                    // biome-ignore lint/a11y/noAutofocus: aparece porque acaban de tocar «Otro %»
                    autoFocus
                  />
                  <span aria-hidden>%</span>
                </div>
              </div>
            ) : null}
            {draft.mode === 'amount' ? (
              <MoneyField
                id="pay-discount-amount"
                label="Descuento en pesos"
                hideLabel
                value={draft.cents}
                onChange={(value) => patch({ cents: value })}
                range={range}
                kept={draft.kept}
                onKeep={(value) => patch({ kept: value })}
                tooHigh={`No puede ser más de lo que falta: ${money(bill.bill.remaining_cents)}.`}
                autoFocus
                testId="discount-amount-input"
              />
            ) : null}
          </fieldset>

          <fieldset className="pay-group" disabled={draft.busy}>
            <legend>
              <span className="pos-sheet-q">¿Por qué?</span>
              <small>Queda anotado.</small>
            </legend>
            <div className="pay-opts">
              {DISCOUNT_REASONS.map((text, i) => (
                <button
                  key={text}
                  type="button"
                  className="pay-opt"
                  aria-pressed={draft.otherReason === null && draft.reason === text}
                  onClick={() => patch({ reason: text, otherReason: null })}
                  data-testid={`discount-reason-${i}`}
                >
                  {text}
                </button>
              ))}
              <button
                type="button"
                className="pay-opt"
                aria-pressed={draft.otherReason !== null}
                onClick={() => patch({ otherReason: draft.otherReason ?? '' })}
              >
                Otro motivo
              </button>
            </div>
            {draft.otherReason !== null ? (
              <>
                <label className="sr-only" htmlFor="pay-discount-reason">
                  Otro motivo
                </label>
                <input
                  id="pay-discount-reason"
                  className="pay-text"
                  type="text"
                  value={draft.otherReason}
                  maxLength={MAX_REASON}
                  onChange={(event) => patch({ otherReason: event.target.value })}
                  placeholder="Contá por qué"
                  autoComplete="off"
                  enterKeyHint="done"
                />
              </>
            ) : null}
          </fieldset>

          {after ? (
            tooMuch ? (
              <SheetError message="Con ese descuento quedaría cobrado de más." />
            ) : (
              <p className="pay-sheet-sub" data-testid="discount-preview">
                La cuenta queda en {money(after.due_cents)}
                {after.paid_cents > 0 ? `: faltarían ${money(after.remaining_cents)}` : ''}. Hoy
                está en {money(bill.bill.due_cents)}.
              </p>
            )
          ) : null}
          <SheetError message={draft.error} />

          <div className="pay-sheet-foot">
            <button
              type="button"
              className="pos-btn pos-btn-quiet"
              onClick={onClose}
              disabled={draft.busy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="pos-btn pos-btn-primary"
              onClick={() => void submit()}
              disabled={!ready || draft.busy}
              data-testid="discount-submit"
            >
              {draft.busy ? <LoaderCircle className="pay-spin size-5" aria-hidden /> : null}
              {chosen === null
                ? 'Elegí cuánto'
                : reason === ''
                  ? 'Elegí el motivo'
                  : direct
                    ? 'Aplicar el descuento'
                    : 'Pedir el OK'}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Un descuento ya puesto ──────────────────────────────────────────────────

export function DiscountInfoSheet({
  discount,
  onClose,
  onRemove,
}: {
  discount: BillDiscount | null
  onClose: () => void
  onRemove: (discount: BillDiscount) => SheetResult
}) {
  const shown = useLast(discount)
  const [state, setState] = useState<{
    source: BillDiscount | null
    busy: boolean
    error: string | null
  }>({ source: null, busy: false, error: null })
  if (discount !== null && state.source !== discount) {
    setState({ source: discount, busy: false, error: null })
  }

  const remove = async () => {
    if (!discount || state.busy) return
    setState((s) => ({ ...s, busy: true, error: null }))
    const error = await onRemove(discount)
    if (error) setState((s) => ({ ...s, busy: false, error }))
    else onClose()
  }

  return (
    <Sheet open={discount !== null} onOpenChange={(next) => !next && !state.busy && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={sheetClass()}
        data-testid="discount-info-sheet"
      >
        <SheetGrabber />
        {shown ? (
          <div className="pos-sheet-body pay-sheet-body">
            <div className="pay-sheet-head">
              <SheetTitle className="pos-sheet-title pay-sheet-title">
                Descuento{shown.kind === 'percent' ? ` ${bpLabel(shown.value)}` : ''} ·{' '}
                {minus(shown.amount_cents)}
              </SheetTitle>
              <SheetDescription className="pay-sheet-sub">
                {shown.reason} · lo puso {shown.by_name}
                {shown.approved_by_name ? ` · OK de ${shown.approved_by_name}` : ''}
              </SheetDescription>
            </div>
            <SheetError message={state.error} />
            <div className="pay-sheet-foot">
              <button
                type="button"
                className="pos-btn pos-btn-quiet pay-danger"
                onClick={() => void remove()}
                disabled={state.busy}
                data-testid="discount-remove"
              >
                {state.busy ? <LoaderCircle className="pay-spin size-5" aria-hidden /> : null}
                Quitar el descuento
              </button>
              <button
                type="button"
                className="pos-btn pos-btn-primary"
                onClick={onClose}
                disabled={state.busy}
              >
                Dejarlo
              </button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

// ─── Dar de baja un renglón ──────────────────────────────────────────────────

function lineDetail(line: BillLine): string {
  return [...line.modifiers.map((m) => m.label), line.notes ? `«${line.notes}»` : null]
    .filter(Boolean)
    .join(' · ')
}

export function BillLineSheet({
  target,
  bill,
  onClose,
  onRequest,
}: {
  target: LineGroup | null
  bill: Bill
  onClose: () => void
  onRequest: (line: BillLine, reason: string) => SheetResult
}) {
  const shown = useLast(target)
  const [state, setState] = useState<{
    source: LineGroup | null
    lineId: string | null
    busy: string | null
    error: string | null
  }>({ source: null, lineId: null, busy: null, error: null })
  if (target !== null && state.source !== target) {
    setState({
      source: target,
      lineId: target.lines.length === 1 ? (target.lines[0]?.id ?? null) : null,
      busy: null,
      error: null,
    })
  }

  const direct = bill.can.void_direct
  const line = shown?.lines.find((l) => l.id === state.lineId) ?? null
  const pending = line
    ? bill.pending_approvals.some(
        (approval) => isVoidPayload(approval.payload) && approval.payload.item_id === line.id,
      )
    : false
  const paid = line ? line.paid_units > 0 : false

  const request = async (reason: string) => {
    if (!line || state.busy) return
    setState((s) => ({ ...s, busy: reason, error: null }))
    const error = await onRequest(line, reason)
    if (error) setState((s) => ({ ...s, busy: null, error }))
    else onClose()
  }

  return (
    <Sheet open={target !== null} onOpenChange={(next) => !next && !state.busy && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={sheetClass()}
        data-testid="bill-line-sheet"
      >
        <SheetGrabber />
        {shown ? (
          <div className="pos-sheet-body pay-sheet-body">
            <div className="pay-sheet-head">
              <SheetTitle className="pos-sheet-title pay-sheet-title">
                {line ? line.quantity : shown.quantity} × {shown.name}
              </SheetTitle>
              <SheetDescription className="pay-sheet-sub">
                {money(line ? line.line_total_cents : shown.totalCents)} en la cuenta
              </SheetDescription>
            </div>

            {shown.lines.length > 1 ? (
              <fieldset className="pay-group" disabled={state.busy !== null}>
                <legend>
                  <span className="pos-sheet-q">¿Cuál?</span>
                  <small>Se pidió más de una vez.</small>
                </legend>
                <div className="pay-opts">
                  {shown.lines.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="pay-opt"
                      aria-pressed={state.lineId === item.id}
                      onClick={() => setState((s) => ({ ...s, lineId: item.id, error: null }))}
                    >
                      {item.quantity} × {money(item.line_total_cents)}
                      {lineDetail(item) ? <small>{lineDetail(item)}</small> : null}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <SheetError message={state.error} />

            {line === null ? null : paid ? (
              <p className="pay-note">Ya está cobrado: no se puede dar de baja.</p>
            ) : pending ? (
              <p className="pay-note">
                Ya hay una baja pedida para este renglón: está esperando el OK.
              </p>
            ) : (
              <fieldset className="pay-group" disabled={state.busy !== null}>
                <legend>
                  <span className="pos-sheet-q">
                    {direct ? '¿Por qué se da de baja?' : '¿Por qué pedís la baja?'}
                  </span>
                  <small>
                    {direct
                      ? 'No tiene vuelta. Queda anotado quién fue.'
                      : 'El encargado da el OK desde su celular.'}
                  </small>
                </legend>
                <ReasonButtons
                  reasons={VOID_REASONS}
                  busy={state.busy}
                  submitLabel={direct ? 'Dar de baja' : 'Pedir la baja'}
                  onPick={(reason) => void request(reason)}
                />
              </fieldset>
            )}

            <div className="pay-sheet-foot">
              <button
                type="button"
                className="pos-btn pos-btn-quiet"
                onClick={onClose}
                disabled={state.busy !== null}
              >
                {line && !paid && !pending ? 'No dar de baja' : 'Cerrar'}
              </button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

// ─── Un cobro ────────────────────────────────────────────────────────────────

const EDIT_FIELD: Readonly<Record<PaymentEdit['field'], string>> = {
  method: 'Medio',
  invoice: 'Factura',
  surcharge_cents: 'Recargo',
}

function editValue(edit: PaymentEdit, value: string): string {
  if (edit.field === 'method') {
    return value in METHOD_LABEL ? METHOD_LABEL[value as keyof typeof METHOD_LABEL] : value
  }
  if (edit.field === 'invoice') return value === 'true' ? 'sí' : 'no'
  return money(Number(value) || 0)
}

export function PaymentSheet({
  payment,
  bill,
  timeZone,
  onClose,
  onVoid,
}: {
  payment: Payment | null
  bill: Bill
  timeZone: string
  onClose: () => void
  onVoid: (payment: Payment, reason: string) => SheetResult
}) {
  const shown = useLast(payment)
  const [state, setState] = useState<{
    source: Payment | null
    asking: boolean
    busy: string | null
    error: string | null
  }>({ source: null, asking: false, busy: null, error: null })
  if (payment !== null && state.source !== payment) {
    setState({ source: payment, asking: false, busy: null, error: null })
  }

  const voidIt = async (reason: string) => {
    if (!payment || state.busy) return
    setState((s) => ({ ...s, busy: reason, error: null }))
    const error = await onVoid(payment, reason)
    if (error) setState((s) => ({ ...s, busy: null, error }))
    else onClose()
  }

  const open = bill.session.status === 'open'
  const live = shown?.status === 'ok'
  const canVoid = Boolean(live && open && bill.can.void_payment)

  return (
    <Sheet open={payment !== null} onOpenChange={(next) => !next && !state.busy && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={sheetClass()}
        data-testid="payment-sheet"
      >
        <SheetGrabber />
        {shown ? (
          <div className="pos-sheet-body pay-sheet-body">
            <div className="pay-sheet-head">
              <SheetTitle className="pos-sheet-title pay-sheet-title">
                {METHOD_LABEL[shown.method]} · {money(shown.amount_cents)}
              </SheetTitle>
              <SheetDescription className="pay-sheet-sub is-ink">
                {[shown.payer_label, shown.is_practice ? 'de práctica' : null, 'bajó de la cuenta']
                  .filter(Boolean)
                  .join(' · ')}
              </SheetDescription>
              {live ? null : <span className="pay-stamp is-void">Anulado</span>}
            </div>

            <dl className="pay-facts">
              <div>
                <dt>Lo cobró</dt>
                <dd>
                  {shown.created_by_name} · {clockAt(shown.created_at, timeZone)}
                </dd>
              </div>
              <div>
                <dt>Factura</dt>
                <dd>{shown.invoice ? 'Sí' : 'No'}</dd>
              </div>
              {shown.tendered_cents !== null ? (
                <div>
                  <dt>Pagó con</dt>
                  <dd>
                    {money(shown.tendered_cents)} · vuelto {money(shown.change_cents)}
                  </dd>
                </div>
              ) : null}
              {shown.surcharge_cents > 0 ? (
                <div>
                  <dt>Recargo de crédito</dt>
                  <dd>+ {money(shown.surcharge_cents)}</dd>
                </div>
              ) : null}
              {shown.tip_cents > 0 ? (
                <div>
                  <dt>Propina (no es venta)</dt>
                  <dd>+ {money(shown.tip_cents)}</dd>
                </div>
              ) : null}
              {shown.total_cents !== shown.amount_cents ? (
                <div>
                  <dt>Se le cobró en total</dt>
                  <dd>{money(shown.total_cents)}</dd>
                </div>
              ) : null}
              {shown.reference ? (
                <div>
                  <dt>Nota</dt>
                  <dd>{shown.reference}</dd>
                </div>
              ) : null}
              {shown.edits.map((edit) => (
                <div key={`${edit.at}-${edit.field}`}>
                  <dt>
                    {EDIT_FIELD[edit.field]} corregido por {edit.by_name}
                  </dt>
                  <dd>
                    {editValue(edit, edit.old_value)} → {editValue(edit, edit.new_value)}
                  </dd>
                </div>
              ))}
              {live ? null : (
                <div>
                  <dt>Lo anuló {shown.voided_by_name ?? 'alguien'}</dt>
                  <dd>{shown.void_reason ?? 'Sin motivo'}</dd>
                </div>
              )}
            </dl>

            <SheetError message={state.error} />

            {state.asking ? (
              <fieldset className="pay-group" disabled={state.busy !== null}>
                <legend>
                  <span className="pos-sheet-q">¿Por qué se anula?</span>
                  <small>No tiene vuelta: después se cobra de nuevo.</small>
                </legend>
                <ReasonButtons
                  reasons={PAYMENT_VOID_REASONS}
                  busy={state.busy}
                  submitLabel="Anular el cobro"
                  onPick={(reason) => void voidIt(reason)}
                />
              </fieldset>
            ) : live ? (
              <p className="pay-note">
                {canVoid
                  ? 'El medio y la factura se corrigen desde Caja, sin anular.'
                  : open
                    ? 'Para anular o corregir un cobro, avisale a la caja.'
                    : 'La mesa ya se cerró: un cobro se corrige desde Caja, no se anula.'}
              </p>
            ) : null}

            <div className="pay-sheet-foot">
              {state.asking ? (
                <button
                  type="button"
                  className="pos-btn pos-btn-quiet"
                  onClick={() => setState((s) => ({ ...s, asking: false, error: null }))}
                  disabled={state.busy !== null}
                >
                  No anular
                </button>
              ) : (
                <>
                  {canVoid ? (
                    <button
                      type="button"
                      className="pos-btn pos-btn-quiet pay-danger"
                      onClick={() => setState((s) => ({ ...s, asking: true }))}
                      data-testid="payment-void"
                    >
                      Anular el cobro
                    </button>
                  ) : null}
                  <button type="button" className="pos-btn pos-btn-primary" onClick={onClose}>
                    Listo
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
