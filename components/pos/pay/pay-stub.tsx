'use client'

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileCheck,
  FileX,
  HandCoins,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  Split as SplitIcon,
  WifiOff,
} from 'lucide-react'
import { useState } from 'react'
import { tenderSuggestions, tipFromPct } from '@/lib/pos/cash/bill'
import {
  type Bill,
  METHOD_LABEL,
  PAY_METHODS,
  type PayMethod,
  type Payment,
} from '@/lib/pos/cash/types'
import { bpLabel, type Charge, chargeReady, type Tender, type Tip } from '@/lib/pos/pay/charge'
import { freeUnits, type LineGroup } from '@/lib/pos/pay/lines'
import { defaultParts, equalProgress, MAX_PARTS, minParts, nextPart } from '@/lib/pos/pay/plan'
import type { Portion, Split } from '@/lib/pos/pay/split'
import { amountWindow, tenderWindow, tipWindow } from '@/lib/pos/pay/typed'
import { cn } from '@/lib/utils'
import { MoneyField, typedSettled } from './money-field'
import { METHOD_ICON, money } from './pay-types'

/**
 * El talón de cobro: una pregunta por vez, y la respuesta es el toque.
 *
 *   ¿Cómo paga?  → seis teclas, siempre en el mismo lugar.
 *   Cada medio pide lo mínimo: en efectivo, con cuánto paga (y el vuelto, enorme); en transferencia,
 *   el alias; en crédito, el recargo a la vista. «Facturar» viene puesto según el medio y la propina
 *   va aparte.
 *   Dividir es otra pregunta, que casi nunca hace falta: se abre desde la primera línea.
 *
 * Lo que ya se contestó queda escrito en carbónico y se toca para cambiarlo. El botón de abajo dice
 * lo que hace y cuánta plata mueve.
 */

export type StubStep = 'method' | 'split' | 'detail' | 'tip'

export type Receipt = { payment: Payment; duplicate: boolean }
export type Unsent = { offline: boolean; message: string; method: PayMethod; amountCents: number }

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const TOTAL_WORD: Readonly<Record<PayMethod, string>> = {
  cash: 'A cobrar',
  transfer: 'Tiene que transferir',
  qr: 'Tiene que pagar',
  debit: 'Pasá la tarjeta por',
  credit: 'Pasá la tarjeta por',
  other: 'A cobrar',
}

function confirmLabel(charge: Charge): string {
  const total = money(charge.totalCents)
  if (charge.method === 'transfer') return `Ya entró · ${total}`
  if (charge.method === 'qr') return `Ya pagó · ${total}`
  return `Cobrar ${total}`
}

export function receiptText(receipt: Receipt): string {
  const { payment } = receipt
  const what = payment.payer_label ?? 'Cobro'
  const how = `${METHOD_LABEL[payment.method]} ${money(payment.amount_cents)}`
  return receipt.duplicate
    ? `${what}: ya estaba anotado (${how}). No se cobró dos veces.`
    : `${what} · ${how}: anotado.`
}

type StubProps = {
  bill: Bill
  groups: ReadonlyArray<LineGroup>
  people: number | null
  step: StubStep
  split: Split
  portion: Portion
  method: PayMethod | null
  charge: Charge | null
  tender: Tender
  tip: Tip
  reference: string
  shiftId: string | null
  sending: boolean
  unsent: Unsent | null
  receipt: Receipt | null
  onStep: (step: StubStep) => void
  onSplit: (split: Split) => void
  onMethod: (method: PayMethod) => void
  onTender: (tender: Tender) => void
  onTip: (tip: Tip) => void
  onInvoice: (invoice: boolean) => void
  onReference: (text: string) => void
  onShift: (shiftId: string) => void
  onConfirm: () => void
  onRetry: () => void
  onGiveUp: () => void
  onReceiptDone: () => void
}

export function PayStub(props: StubProps) {
  const { unsent, receipt, step } = props
  if (unsent) return <UnsentStep {...props} unsent={unsent} />
  // El vuelto no se puede pasar por alto: queda en pantalla hasta que el mozo dice que lo dio.
  if (receipt && receipt.payment.change_cents > 0) {
    return <ChangeStep receipt={receipt} onDone={props.onReceiptDone} />
  }
  if (step === 'split') return <SplitStep {...props} />
  if (step === 'tip' && props.charge) return <TipStep {...props} charge={props.charge} />
  if (step === 'detail' && props.charge) return <DetailStep {...props} charge={props.charge} />
  return <MethodStep {...props} />
}

// ─── ¿Cómo paga? ─────────────────────────────────────────────────────────────

function MethodStep({ bill, split, portion, receipt, onStep, onMethod }: StubProps) {
  const surcharge = bill.settings.credit_surcharge_bp
  return (
    <div className="pay-step" data-testid="pay-step-method">
      {receipt ? (
        <p className="pay-receipt" role="status" data-testid="pay-receipt">
          <Check aria-hidden strokeWidth={3} />
          {receiptText(receipt)}
        </p>
      ) : null}

      <button
        type="button"
        className="pay-crumb"
        onClick={() => onStep('split')}
        aria-label={`Cobrás ${portion.title}: ${money(portion.amountCents)}. ${split.kind === 'all' ? 'Dividir la cuenta' : 'Cambiar cómo se divide'}`}
        data-testid="pay-split-open"
      >
        <span className="pay-crumb-main">
          <span>Cobrás {portion.title}</span>
          <b>{money(portion.amountCents)}</b>
        </span>
        <span className="pay-crumb-go">
          {split.kind === 'all' ? (
            <>
              <SplitIcon aria-hidden strokeWidth={2.4} />
              Dividir
            </>
          ) : (
            <>
              Cambiar
              <ChevronRight aria-hidden strokeWidth={2.6} />
            </>
          )}
        </span>
      </button>

      <fieldset className="pay-fieldset">
        <legend className="pay-ask">¿Cómo paga?</legend>
        <div className="pay-keys">
          {PAY_METHODS.map((method) => {
            const Icon = METHOD_ICON[method]
            return (
              <button
                key={method}
                type="button"
                className="pay-key"
                onClick={() => onMethod(method)}
                data-testid={`pay-method-${method}`}
              >
                <Icon aria-hidden strokeWidth={2.1} />
                {METHOD_LABEL[method]}
                {method === 'credit' && surcharge > 0 ? (
                  <small>
                    +{bpLabel(surcharge)}
                    <span className="sr-only"> de recargo</span>
                  </small>
                ) : null}
              </button>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}

// ─── ¿Cómo dividen? ──────────────────────────────────────────────────────────

function SplitStep({ bill, groups, people, split, portion, onSplit, onStep }: StubProps) {
  const remaining = bill.bill.remaining_cents
  const [kept, setKept] = useState<number | null>(null)
  const nothingToPick = freeUnits(groups) === 0
  const progress = equalProgress(bill.payments)
  const part = split.kind === 'equal' ? nextPart(split.parts, bill.payments, remaining) : null
  const amountOk =
    split.kind !== 'amount' || typedSettled(split.cents, amountWindow(remaining), kept)
  const ready = portion.amountCents > 0 && amountOk

  const goAll = () => {
    onSplit({ kind: 'all' })
    onStep('method')
  }
  const setParts = (parts: number) => onSplit({ kind: 'equal', parts })

  const label =
    split.kind === 'all'
      ? `Seguir: todo · ${money(portion.amountCents)}`
      : split.kind === 'equal'
        ? `Seguir: ${portion.title} · ${money(portion.amountCents)}`
        : split.kind === 'items'
          ? portion.amountCents > 0
            ? `Seguir: ${portion.title} · ${money(portion.amountCents)}`
            : 'Marcá en la cuenta lo que paga'
          : portion.amountCents <= 0
            ? 'Escribí cuánto paga'
            : amountOk
              ? `Seguir: ${money(portion.amountCents)}`
              : 'Decime cuál de los dos es'

  return (
    <div className="pay-step" data-testid="pay-step-split">
      <div className="pay-step-head">
        <button
          type="button"
          className="pay-step-back"
          onClick={() => (ready ? onStep('method') : goAll())}
          aria-label="Volver a cómo paga"
        >
          <ChevronLeft aria-hidden strokeWidth={2.4} />
        </button>
        <div className="pay-step-title">
          <h3>¿Cómo dividen?</h3>
          <span>Faltan {money(remaining)}</span>
        </div>
      </div>

      <div className="pay-opts is-grid">
        <button
          type="button"
          className="pay-opt"
          aria-pressed={split.kind === 'all'}
          onClick={goAll}
          data-testid="pay-split-all"
        >
          Todo junto
        </button>
        <button
          type="button"
          className="pay-opt"
          aria-pressed={split.kind === 'equal'}
          onClick={() =>
            setParts(defaultParts(people, bill.reservation?.guests ?? null, bill.payments))
          }
          data-testid="pay-split-equal"
        >
          Partes iguales
        </button>
        <button
          type="button"
          className="pay-opt"
          aria-pressed={split.kind === 'items'}
          onClick={() => onSplit({ kind: 'items', chosen: {} })}
          disabled={nothingToPick}
          data-testid="pay-split-items"
        >
          Por producto
        </button>
        <button
          type="button"
          className="pay-opt"
          aria-pressed={split.kind === 'amount'}
          onClick={() => {
            setKept(null)
            onSplit({ kind: 'amount', cents: null })
          }}
          data-testid="pay-split-amount"
        >
          Otro monto
        </button>
      </div>

      {split.kind === 'equal' && part ? (
        <div className="pay-parts">
          <button
            type="button"
            className="pay-parts-step"
            onClick={() => setParts(split.parts - 1)}
            disabled={split.parts <= minParts(bill.payments)}
            aria-label="Una parte menos"
            data-testid="pay-parts-minus"
          >
            <Minus aria-hidden strokeWidth={2.6} />
          </button>
          <output aria-live="polite" aria-label="Partes" data-testid="pay-parts">
            {part.parts}
          </output>
          <button
            type="button"
            className="pay-parts-step"
            onClick={() => setParts(split.parts + 1)}
            disabled={split.parts >= MAX_PARTS}
            aria-label="Una parte más"
            data-testid="pay-parts-plus"
          >
            <Plus aria-hidden strokeWidth={2.6} />
          </button>
          <p className="pay-parts-text">
            <span>{progress.paid > 0 ? `faltan ${part.left}, de` : 'partes de'}</span>
            <b>{money(part.amountCents)}</b>
          </p>
        </div>
      ) : null}

      {split.kind === 'items' && bill.bill.due_cents !== bill.bill.subtotal_cents ? (
        <p className="pay-note">Con seña o descuento, cada producto carga su parte.</p>
      ) : null}

      {split.kind === 'amount' ? (
        <MoneyField
          id="pay-amount"
          label="¿Cuánto paga ahora?"
          value={split.cents}
          onChange={(cents) => onSplit({ kind: 'amount', cents })}
          range={amountWindow(remaining)}
          kept={kept}
          onKeep={setKept}
          tooHigh={`Es más de lo que falta: quedan ${money(remaining)}.`}
          fix={{ label: `Cobrar los ${money(remaining)}`, onClick: goAll }}
          autoFocus
          testId="pay-amount"
        />
      ) : null}

      <button
        type="button"
        className="pay-go"
        onClick={() => onStep('method')}
        disabled={!ready}
        data-testid="pay-split-next"
      >
        {label}
        {ready ? <ChevronRight aria-hidden strokeWidth={2.6} /> : null}
      </button>
    </div>
  )
}

// ─── El medio: lo mínimo de cada uno ─────────────────────────────────────────

function StepHead({
  method,
  sub,
  amountCents,
  onBack,
  backLabel,
}: {
  method: PayMethod
  sub: string
  amountCents: number
  onBack: () => void
  backLabel: string
}) {
  const Icon = METHOD_ICON[method]
  return (
    <div className="pay-step-head">
      <button type="button" className="pay-step-back" onClick={onBack} aria-label={backLabel}>
        <ChevronLeft aria-hidden strokeWidth={2.4} />
      </button>
      <div className="pay-step-title">
        <h3>
          <Icon aria-hidden strokeWidth={2.2} />
          {METHOD_LABEL[method]}
        </h3>
        <span>{capital(sub)}</span>
      </div>
      <b className="pay-step-amount">{money(amountCents)}</b>
    </div>
  )
}

function DetailStep({
  bill,
  portion,
  charge,
  tender,
  reference,
  shiftId,
  sending,
  onStep,
  onTender,
  onInvoice,
  onReference,
  onShift,
  onConfirm,
}: StubProps & { charge: Charge }) {
  const { method } = charge
  const { settings, shifts } = bill
  const suggestions =
    method === 'cash' ? tenderSuggestions(charge.totalCents, settings.bill_denominations, 3) : []
  // Si ya había un monto escrito a mano (se fue a poner la propina y volvió), sigue a la vista.
  const [custom, setCustom] = useState(
    () => tender.kind === 'given' && !suggestions.includes(tender.cents ?? -1),
  )
  const [kept, setKept] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const range = tenderWindow(charge.totalCents, settings.bill_denominations)
  const tenderOk =
    method !== 'cash' ||
    tender.kind === 'exact' ||
    !custom ||
    typedSettled(tender.cents, range, kept)
  const needsShift = shifts.length > 1 && shiftId === null
  const ready = chargeReady(charge) && tenderOk && !needsShift
  const showMath = method !== 'cash' || charge.tipCents > 0
  const itemized = charge.surchargeCents > 0 || charge.tipCents > 0

  const copyAlias = async () => {
    if (!settings.transfer_alias) return
    try {
      await navigator.clipboard.writeText(settings.transfer_alias)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Sin permiso para el portapapeles: el alias sigue en pantalla, grande, para leerlo.
    }
  }

  return (
    <div className="pay-step" data-testid={`pay-step-${method}`}>
      <StepHead
        method={method}
        sub={portion.title}
        amountCents={charge.amountCents}
        onBack={() => onStep('method')}
        backLabel="Cambiar el medio de pago"
      />

      {method === 'transfer' ? (
        settings.transfer_alias ? (
          <div className="pay-alias">
            <p className="pay-alias-main">
              <span>Alias{settings.transfer_holder ? ` · ${settings.transfer_holder}` : ''}</span>
              <b data-testid="pay-alias">{settings.transfer_alias}</b>
            </p>
            <button
              type="button"
              className="pay-copy"
              onClick={() => void copyAlias()}
              aria-label="Copiar el alias"
            >
              {copied ? (
                <Check aria-hidden strokeWidth={3} />
              ) : (
                <Copy aria-hidden strokeWidth={2.2} />
              )}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        ) : (
          <p className="pay-note">
            Este bar todavía no cargó su alias. Pasale los datos de la cuenta a mano.
          </p>
        )
      ) : null}

      {method === 'qr' ? (
        <p className="pay-note">
          Que escanee el QR del local. Cuando te muestre que pagó, tocá <b>Ya pagó</b>.
        </p>
      ) : null}

      {method === 'other' ? (
        <div className="pay-money-field">
          <label htmlFor="pay-reference">
            ¿Qué fue? <small className="pay-note">Si querés, para acordarte</small>
          </label>
          <input
            id="pay-reference"
            className="pay-text"
            type="text"
            value={reference}
            maxLength={80}
            onChange={(event) => onReference(event.target.value)}
            placeholder="Cuenta corriente, canje, vale…"
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
      ) : null}

      {method === 'cash' ? (
        <fieldset className="pay-fieldset">
          <legend className="pay-ask">¿Con cuánto paga?</legend>
          <div className="pay-opts is-row">
            {suggestions.map((cents, i) => {
              const exact = i === 0
              const pressed =
                !custom &&
                (exact
                  ? tender.kind === 'exact'
                  : tender.kind === 'given' && tender.cents === cents)
              return (
                <button
                  key={cents}
                  type="button"
                  className="pay-opt"
                  aria-pressed={pressed}
                  onClick={() => {
                    setCustom(false)
                    onTender(exact ? { kind: 'exact' } : { kind: 'given', cents })
                  }}
                  data-testid={exact ? 'pay-tender-exact' : `pay-tender-${i}`}
                >
                  {exact ? 'Justo' : money(cents)}
                </button>
              )
            })}
            <button
              type="button"
              className="pay-opt"
              aria-pressed={custom}
              onClick={() => {
                setCustom(true)
                setKept(null)
                onTender({ kind: 'given', cents: null })
              }}
              data-testid="pay-tender-other"
            >
              Otro
            </button>
          </div>
          {custom ? (
            <MoneyField
              id="pay-tender"
              label="Con cuánto paga"
              hideLabel
              value={tender.kind === 'given' ? tender.cents : null}
              onChange={(cents) => onTender({ kind: 'given', cents })}
              range={range}
              kept={kept}
              onKeep={setKept}
              tooLow={`No alcanza: tiene que pagar ${money(charge.totalCents)}.`}
              autoFocus
              testId="pay-tender-input"
            />
          ) : null}
          {charge.changeCents !== null && charge.changeCents > 0 ? (
            <p className="pay-change" aria-live="polite" data-testid="pay-change">
              <span>Vuelto</span>
              <b>{money(charge.changeCents)}</b>
            </p>
          ) : charge.changeCents === 0 ? (
            <p className="pay-change is-none">
              <span>Paga justo: no hay vuelto.</span>
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {showMath ? (
        <div className="pay-math" data-testid="pay-math">
          {itemized ? (
            <p>
              <span>{capital(portion.title)}</span>
              <i className="pay-dots" aria-hidden />
              <b>{money(charge.amountCents)}</b>
            </p>
          ) : null}
          {charge.surchargeCents > 0 ? (
            <p data-testid="pay-surcharge">
              <span>Recargo de crédito · {bpLabel(settings.credit_surcharge_bp)}</span>
              <i className="pay-dots" aria-hidden />
              <b>+ {money(charge.surchargeCents)}</b>
            </p>
          ) : null}
          {charge.tipCents > 0 ? (
            <p>
              <span>Propina · va aparte, no es venta</span>
              <i className="pay-dots" aria-hidden />
              <b>+ {money(charge.tipCents)}</b>
            </p>
          ) : null}
          <p className="is-total">
            <span>{TOTAL_WORD[method]}</span>
            <b>{money(charge.totalCents)}</b>
          </p>
        </div>
      ) : null}

      {shifts.length > 1 ? (
        <fieldset className="pay-fieldset">
          <legend className="pay-ask">¿En qué caja entra?</legend>
          <div className="pay-opts">
            {shifts.map((shift) => (
              <button
                key={shift.id}
                type="button"
                className="pay-opt"
                aria-pressed={shiftId === shift.id}
                onClick={() => onShift(shift.id)}
              >
                {shift.register}
                {shift.label ? <small>{shift.label}</small> : null}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="pay-extras">
        <button
          type="button"
          className="pay-toggle"
          aria-pressed={charge.invoice}
          aria-label="Facturar este cobro"
          onClick={() => onInvoice(!charge.invoice)}
          data-testid="pay-invoice"
        >
          {charge.invoice ? (
            <FileCheck aria-hidden strokeWidth={2.2} />
          ) : (
            <FileX aria-hidden strokeWidth={2.2} />
          )}
          {charge.invoice ? 'Con factura' : 'Sin factura'}
        </button>
        <button
          type="button"
          className={cn('pay-toggle', charge.tipCents > 0 && 'is-set')}
          onClick={() => onStep('tip')}
          data-testid="pay-tip-open"
        >
          <HandCoins aria-hidden strokeWidth={2.2} />
          {charge.tipCents > 0 ? `Propina ${money(charge.tipCents)}` : 'Propina'}
        </button>
      </div>

      <p className="pay-after" data-testid="pay-after">
        {charge.closes ? (
          'Es el último cobro: la mesa se cierra sola.'
        ) : (
          <>
            Después de este, quedan <b>{money(charge.afterCents)}</b> por cobrar.
          </>
        )}
      </p>

      <button
        type="button"
        className="pay-go"
        onClick={onConfirm}
        disabled={!ready || sending}
        data-testid="pay-confirm"
      >
        {sending ? (
          <LoaderCircle className="pay-spin" aria-hidden strokeWidth={2.6} />
        ) : ready ? (
          <Check aria-hidden strokeWidth={3} />
        ) : null}
        {sending
          ? 'Cobrando…'
          : needsShift
            ? 'Elegí en qué caja entra'
            : ready
              ? confirmLabel(charge)
              : 'Decime con cuánto paga'}
      </button>
    </div>
  )
}

// ─── La propina: aparte ──────────────────────────────────────────────────────

function TipStep({ bill, charge, tip, onTip, onStep }: StubProps & { charge: Charge }) {
  const [kept, setKept] = useState<number | null>(null)
  const range = tipWindow(charge.amountCents)
  const done = () => onStep('detail')
  const typed = tip.kind === 'amount' ? tip.cents : null
  const typedOk = typed === null || typedSettled(typed, range, kept)

  return (
    <div className="pay-step" data-testid="pay-step-tip">
      <div className="pay-step-head">
        <button type="button" className="pay-step-back" onClick={done} aria-label="Volver al cobro">
          <ChevronLeft aria-hidden strokeWidth={2.4} />
        </button>
        <div className="pay-step-title">
          <h3>
            <HandCoins aria-hidden strokeWidth={2.2} />
            Propina
          </h3>
          <span>Va aparte: no es venta ni se factura.</span>
        </div>
      </div>

      <div className="pay-opts">
        {bill.settings.tip_presets_pct.map((pct) => (
          <button
            key={pct}
            type="button"
            className="pay-opt"
            aria-pressed={tip.kind === 'pct' && tip.pct === pct}
            onClick={() => {
              onTip({ kind: 'pct', pct })
              done()
            }}
            data-testid={`pay-tip-${pct}`}
          >
            {pct} %<small>{money(tipFromPct(charge.amountCents, pct))}</small>
          </button>
        ))}
        <button
          type="button"
          className="pay-opt"
          aria-pressed={tip.kind === 'amount'}
          onClick={() => {
            setKept(null)
            onTip({ kind: 'amount', cents: null })
          }}
          data-testid="pay-tip-other"
        >
          Otro monto
        </button>
        <button
          type="button"
          className="pay-opt"
          aria-pressed={tip.kind === 'none'}
          onClick={() => {
            onTip({ kind: 'none' })
            done()
          }}
          data-testid="pay-tip-none"
        >
          Sin propina
        </button>
      </div>

      {tip.kind === 'amount' ? (
        <>
          <MoneyField
            id="pay-tip"
            label="Cuánto deja de propina"
            hideLabel
            value={tip.cents}
            onChange={(cents) => onTip({ kind: 'amount', cents })}
            range={range}
            kept={kept}
            onKeep={setKept}
            autoFocus
            testId="pay-tip-input"
          />
          <button
            type="button"
            className="pay-go"
            onClick={done}
            disabled={!typedOk}
            data-testid="pay-tip-done"
          >
            {typed ? `Listo: ${money(typed)} de propina` : 'Listo, sin propina'}
          </button>
        </>
      ) : null}
    </div>
  )
}

// ─── Lo que no salió, y lo que acaba de salir ────────────────────────────────

function UnsentStep({ unsent, sending, onRetry, onGiveUp }: StubProps & { unsent: Unsent }) {
  return (
    <div className="pay-step" data-testid="pay-unsent">
      <p className="pay-alert" role="alert">
        <WifiOff aria-hidden strokeWidth={2.4} />
        <span>
          {unsent.offline ? 'No hay señal: el cobro no se registró.' : unsent.message}
          <small>
            {METHOD_LABEL[unsent.method]} · {money(unsent.amountCents)}. Reintentá cuando vuelva:
            aunque lo toques varias veces, se cobra una sola vez.
          </small>
        </span>
      </p>
      <div className="pay-go-row">
        <button
          type="button"
          className="pay-go is-quiet"
          onClick={onGiveUp}
          disabled={sending}
          data-testid="pay-give-up"
        >
          No cobrar
        </button>
        <button
          type="button"
          className="pay-go"
          onClick={onRetry}
          disabled={sending}
          data-testid="pay-retry"
        >
          {sending ? (
            <LoaderCircle className="pay-spin" aria-hidden strokeWidth={2.6} />
          ) : (
            <RotateCcw aria-hidden strokeWidth={2.6} />
          )}
          {sending ? 'Reintentando…' : 'Reintentar'}
        </button>
      </div>
    </div>
  )
}

function ChangeStep({ receipt, onDone }: { receipt: Receipt; onDone: () => void }) {
  return (
    <div className="pay-step" data-testid="pay-change-step">
      <p className="pay-receipt" role="status">
        <Check aria-hidden strokeWidth={3} />
        {receiptText(receipt)}
      </p>
      <p className="pay-change" data-testid="pay-change">
        <span>Vuelto</span>
        <b>{money(receipt.payment.change_cents)}</b>
      </p>
      <button type="button" className="pay-go" onClick={onDone} data-testid="pay-change-done">
        Listo, ya di el vuelto
      </button>
    </div>
  )
}
