'use client'

import { Ban, Check, LoaderCircle } from 'lucide-react'
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
import { creditSurcharge, defaultInvoice } from '@/lib/pos/cash/bill'
import type { PaymentAccess } from '@/lib/pos/cash/screen'
import { methodChangeLabel } from '@/lib/pos/cash/shift'
import { editLines, paymentExtras, paymentTitle, tenderedLine } from '@/lib/pos/cash/tape'
import {
  type DayPayment,
  METHOD_LABEL,
  PAY_METHODS,
  type PayMethod,
  type ShiftSnapshot,
} from '@/lib/pos/cash/types'
import { posFont } from '@/lib/pos/font'
import { clockAt } from '@/lib/pos/order/clock'
import { cn } from '@/lib/utils'
import { attempt, type CashApi } from './api'
import { METHOD_ICON } from './method'

/**
 * Tocar un cobro: corregirlo es elegir el medio correcto. No cambia el monto ni borra nada; queda
 * escrito quién lo corrigió y cuándo. Anular pide el motivo (el motivo es la confirmación) y solo
 * se puede mientras la mesa sigue abierta. Lo que se puede hacer lo decide la base: acá llega
 * resuelto en `access`.
 */

const VOID_REASONS = ['Se cobró dos veces', 'El monto estaba mal', 'No era de esta mesa'] as const

type Form = {
  sourceId: string | null
  method: PayMethod
  invoice: boolean
  /** Solo si queda en crédito: si el recargo se cobró. */
  surcharge: boolean
  voiding: boolean
  why: string
  busy: string | null
  error: string | null
}

function formOf(payment: DayPayment | null): Form {
  return {
    sourceId: payment?.id ?? null,
    method: payment?.method ?? 'cash',
    invoice: payment?.invoice ?? false,
    surcharge: payment ? payment.surcharge_cents > 0 : false,
    voiding: false,
    why: '',
    busy: null,
    error: null,
  }
}

export function PaymentSheet({
  payment,
  access,
  settings,
  timeZone,
  api,
  onClose,
  onChanged,
}: {
  payment: DayPayment | null
  access: PaymentAccess | null
  settings: ShiftSnapshot['settings']
  timeZone: string
  api: Pick<CashApi, 'edit' | 'voidPay'>
  onClose: () => void
  /** Algo cambió: la pantalla vuelve a leer la caja. `message` es lo que quedó escrito. */
  onChanged: (message: string) => void
}) {
  const shown = useLast(payment)
  const can = useLast(access)
  const [form, setForm] = useState<Form>(() => formOf(payment))
  if (payment && form.sourceId !== payment.id) setForm(formOf(payment))

  if (!shown || !can) {
    return (
      <Sheet open={false}>
        <SheetContent side="bottom" showClose={false} className="pos pos-sheet caja-sheet" />
      </Sheet>
    )
  }

  const { title, detail } = paymentTitle(shown)
  const bp = settings.credit_surcharge_bp
  const wasCredit = shown.method === 'credit'
  const toCredit = form.method === 'credit'
  const methodChanged = form.method !== shown.method
  const invoiceChanged = form.invoice !== shown.invoice
  const surchargeChanged =
    toCredit && bp > 0 && form.surcharge !== (wasCredit ? shown.surcharge_cents > 0 : true)
  const dirty = methodChanged || invoiceChanged || surchargeChanged
  const newSurcharge = toCredit && form.surcharge ? creditSurcharge(shown.amount_cents, bp) : 0
  const notes = [
    tenderedLine(shown),
    ...paymentExtras(shown, settings.invoice_by_method),
    ...editLines(shown.edits, timeZone),
  ].filter((note): note is string => Boolean(note))

  const pickMethod = (method: PayMethod) =>
    setForm((f) => ({
      ...f,
      method,
      error: null,
      // Lo que el bar tiene puesto para ese medio; volver al medio original deja todo como estaba.
      invoice:
        method === shown.method
          ? shown.invoice
          : defaultInvoice(method, settings.invoice_by_method),
      surcharge: method === 'credit' ? (wasCredit ? shown.surcharge_cents > 0 : true) : false,
    }))

  const save = async () => {
    if (!dirty || form.busy) return
    setForm((f) => ({ ...f, busy: 'save', error: null }))
    const result = await attempt(() =>
      api.edit({
        paymentId: shown.id,
        ...(methodChanged ? { method: form.method } : {}),
        ...(invoiceChanged ? { invoice: form.invoice } : {}),
        ...(toCredit && bp > 0 && (methodChanged || surchargeChanged)
          ? { surcharge: form.surcharge }
          : {}),
      }),
    )
    if (!result.ok) {
      setForm((f) => ({ ...f, busy: null, error: result.message }))
      return
    }
    onChanged(
      methodChanged
        ? `Corregido: ${methodChangeLabel(shown.method, form.method)}. Quedó anotado con tu nombre.`
        : 'Corregido. Quedó anotado con tu nombre.',
    )
    onClose()
  }

  const voidWith = async (why: string) => {
    const reason = why.trim()
    if (!reason || form.busy) return
    setForm((f) => ({ ...f, busy: why, error: null }))
    const result = await attempt(() => api.voidPay(shown.id, reason))
    if (!result.ok) {
      setForm((f) => ({ ...f, busy: null, error: result.message }))
      return
    }
    onChanged(
      `Cobro de ${formatCentsShort(shown.total_cents)} anulado. Sigue en la cinta, con el sello.`,
    )
    onClose()
  }

  const primary = methodChanged
    ? `Corregir: ${methodChangeLabel(shown.method, form.method)}`
    : invoiceChanged
      ? `Guardar: ${form.invoice ? 'con factura' : 'sin factura'}`
      : surchargeChanged
        ? `Guardar: ${form.surcharge ? 'con recargo' : 'sin recargo'}`
        : 'Elegí el medio correcto'

  return (
    <Sheet
      open={payment !== null}
      onOpenChange={(next) => {
        if (!next && !form.busy) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet caja-sheet', posFont.variable)}
        data-testid="cobro-hoja"
      >
        <SheetGrabber />
        <div className="pos-sheet-body caja-sheet-body has-foot">
          <div className="caja-sheet-head">
            <SheetTitle className="pos-sheet-title caja-sheet-title">
              {title}
              {detail ? ` · ${detail}` : ''}
            </SheetTitle>
            <SheetDescription className="caja-sheet-sub">
              {formatCentsShort(shown.total_cents)} · {METHOD_LABEL[shown.method]} ·{' '}
              {clockAt(shown.created_at, timeZone)} · cobró {shown.created_by_name}
            </SheetDescription>
            {shown.status === 'voided' ? (
              <p>
                <span className="caja-stamp is-void">
                  <Ban aria-hidden strokeWidth={3} />
                  Anulado
                </span>
              </p>
            ) : null}
            {notes.length > 0 || shown.status === 'voided' ? (
              <div className="caja-sheet-notes">
                {notes.map((note) => (
                  <p key={note} className="caja-sheet-sub">
                    {note}
                  </p>
                ))}
                {shown.status === 'voided' ? (
                  <p className="caja-sheet-sub is-ink">
                    {shown.void_reason ? `«${shown.void_reason}»` : 'Sin motivo'}
                    {shown.voided_by_name ? ` · anuló ${shown.voided_by_name}` : ''}
                    {shown.voided_at ? ` ${clockAt(shown.voided_at, timeZone)}` : ''}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {can.note ? <p className="caja-sheet-sub is-ink">{can.note}</p> : null}

          {form.error ? (
            <p className="caja-error" role="alert">
              {form.error}
            </p>
          ) : null}

          {form.voiding ? (
            <fieldset className="caja-group" disabled={form.busy !== null}>
              <legend>
                <span className="pos-sheet-q">¿Por qué se anula?</span>
                <small>No se borra: queda en la cinta con el sello y tu nombre.</small>
              </legend>
              <div className="caja-reasons">
                {VOID_REASONS.map((reason, index) => (
                  <button
                    key={reason}
                    type="button"
                    className="caja-opt"
                    onClick={() => void voidWith(reason)}
                    data-testid={`anular-motivo-${index}`}
                  >
                    {form.busy === reason ? (
                      <LoaderCircle className="caja-spin" aria-hidden />
                    ) : null}
                    {reason}
                  </button>
                ))}
              </div>
              <div className="caja-field">
                <label htmlFor="caja-void-why">Otro motivo</label>
                <input
                  id="caja-void-why"
                  className="caja-input"
                  type="text"
                  value={form.why}
                  maxLength={200}
                  onChange={(event) => setForm((f) => ({ ...f, why: event.target.value }))}
                  placeholder="Contalo en pocas palabras"
                  autoComplete="off"
                  enterKeyHint="done"
                />
              </div>
            </fieldset>
          ) : can.correct ? (
            <>
              <fieldset className="caja-group" disabled={form.busy !== null}>
                <legend>
                  <span className="pos-sheet-q">¿Con qué pagó de verdad?</span>
                </legend>
                <div className="caja-methods">
                  {PAY_METHODS.map((method) => {
                    const Icon = METHOD_ICON[method]
                    return (
                      <button
                        key={method}
                        type="button"
                        className={cn('caja-opt', method === shown.method && 'is-was')}
                        aria-pressed={form.method === method}
                        onClick={() => pickMethod(method)}
                        data-testid={`medio-${method}`}
                      >
                        <Icon aria-hidden strokeWidth={2.3} />
                        <span className="caja-opt-two">
                          {METHOD_LABEL[method]}
                          {method === shown.method ? <small>como está</small> : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              {toCredit && bp > 0 ? (
                <fieldset className="caja-group" disabled={form.busy !== null}>
                  <legend>
                    <span className="pos-sheet-q">¿Se le cobró el recargo de crédito?</span>
                    <small>
                      {form.surcharge
                        ? `El cobro queda en ${formatCentsShort(shown.amount_cents + newSurcharge + shown.tip_cents)}.`
                        : 'El cobro queda sin recargo.'}
                    </small>
                  </legend>
                  <div className="caja-switch">
                    <button
                      type="button"
                      className="caja-opt"
                      aria-pressed={form.surcharge}
                      onClick={() => setForm((f) => ({ ...f, surcharge: true }))}
                    >
                      Sí, {formatCentsShort(creditSurcharge(shown.amount_cents, bp))}
                    </button>
                    <button
                      type="button"
                      className="caja-opt"
                      aria-pressed={!form.surcharge}
                      onClick={() => setForm((f) => ({ ...f, surcharge: false }))}
                    >
                      No se cobró
                    </button>
                  </div>
                </fieldset>
              ) : null}

              <fieldset className="caja-group" disabled={form.busy !== null}>
                <legend>
                  <span className="pos-sheet-q">¿Lleva factura?</span>
                  {methodChanged ? (
                    <small>
                      Va como el bar tiene puesto para {METHOD_LABEL[form.method].toLowerCase()}.
                    </small>
                  ) : null}
                </legend>
                <div className="caja-switch">
                  <button
                    type="button"
                    className="caja-opt"
                    aria-pressed={form.invoice}
                    onClick={() => setForm((f) => ({ ...f, invoice: true }))}
                  >
                    Con factura
                  </button>
                  <button
                    type="button"
                    className="caja-opt"
                    aria-pressed={!form.invoice}
                    onClick={() => setForm((f) => ({ ...f, invoice: false }))}
                  >
                    Sin factura
                  </button>
                </div>
              </fieldset>
            </>
          ) : null}
        </div>

        <div className="caja-sheet-foot">
          {form.voiding ? (
            <>
              <button
                type="button"
                className="pos-btn pos-btn-quiet is-side"
                onClick={() => setForm((f) => ({ ...f, voiding: false, error: null }))}
                disabled={form.busy !== null}
              >
                No anular
              </button>
              <button
                type="button"
                className="pos-btn pos-btn-primary"
                onClick={() => void voidWith(form.why)}
                disabled={form.busy !== null || form.why.trim() === ''}
                data-testid="anular-confirmar"
              >
                {form.busy === form.why && form.why ? (
                  <LoaderCircle className="caja-spin size-5" aria-hidden />
                ) : null}
                {form.why.trim() === '' ? 'Elegí o escribí el motivo' : 'Anular el cobro'}
              </button>
            </>
          ) : (
            <>
              {can.void ? (
                <button
                  type="button"
                  className="pos-btn pos-btn-quiet is-danger is-side"
                  onClick={() => setForm((f) => ({ ...f, voiding: true, error: null }))}
                  disabled={form.busy !== null}
                  data-testid="cobro-anular"
                >
                  Anular
                </button>
              ) : null}
              {can.correct ? (
                <button
                  type="button"
                  className="pos-btn pos-btn-primary"
                  onClick={() => void save()}
                  disabled={!dirty || form.busy !== null}
                  data-testid="cobro-corregir"
                >
                  {form.busy === 'save' ? (
                    <LoaderCircle className="caja-spin size-5" aria-hidden />
                  ) : dirty ? (
                    <Check className="size-5" aria-hidden strokeWidth={3} />
                  ) : null}
                  {primary}
                </button>
              ) : (
                <button type="button" className="pos-btn pos-btn-primary" onClick={onClose}>
                  Listo
                </button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
