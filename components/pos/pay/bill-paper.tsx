'use client'

import {
  Ban,
  Check,
  ChevronRight,
  Hourglass,
  Minus,
  Receipt,
  Scissors,
  Stamp,
  Star,
} from 'lucide-react'
import { type ApprovalRow, ApprovalSlip } from '@/components/pos/approvals/approvals-sheet'
import { perPerson } from '@/lib/pos/cash/bill'
import {
  type Bill,
  type BillDiscount,
  type InboxApproval,
  METHOD_LABEL,
  type Payment,
} from '@/lib/pos/cash/types'
import { clockAt, minutesSince } from '@/lib/pos/order/clock'
import { isVoidPayload } from '@/lib/pos/pay/approvals'
import { bpLabel } from '@/lib/pos/pay/charge'
import type { Chosen, LineGroup } from '@/lib/pos/pay/lines'
import { type BillMode, billName, billPeople, billTitle } from '@/lib/pos/pay/mode'
import { dayAt } from '@/lib/pos/pay/when'
import { formatMinutes } from '@/lib/pos/table-state'
import { cn } from '@/lib/utils'
import { minus, money } from './pay-types'

/**
 * La cuenta de papel del bar: membrete, renglones con puntos guía, lo que se descuenta, el total
 * abajo y, debajo de la línea de corte, los cobros. Tinta para lo que se pidió; carbónico para lo
 * que escribe el sistema (importes, horas, quién cobró).
 *
 * El papel no cobra: muestra. Lo único que se toca acá es lo que se le puede pedir a la cuenta: dar
 * de baja un renglón, quitar un descuento, ver un cobro. Y, cuando se divide por producto, marcar
 * con el lápiz qué paga cada uno.
 */

function extrasText(extras: LineGroup['extras']): string {
  return extras
    .map((extra) =>
      extra.delta_cents > 0 ? `${extra.label} + ${money(extra.delta_cents)}` : extra.label,
    )
    .join(' · ')
}

/** «Efectivo · 23:41 · Luz · vuelto $ 3.000»: lo que escribió el sistema de ese cobro. */
function paymentFacts(payment: Payment, timeZone: string): string {
  return [
    payment.payer_label ? METHOD_LABEL[payment.method] : null,
    clockAt(payment.created_at, timeZone),
    payment.created_by_name,
    payment.surcharge_cents > 0 ? `recargo ${money(payment.surcharge_cents)}` : null,
    payment.tip_cents > 0 ? `propina ${money(payment.tip_cents)}` : null,
    payment.change_cents > 0 ? `vuelto ${money(payment.change_cents)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function BillPaper({
  bill,
  groups,
  mode,
  place,
  timeZone,
  nowMs,
  picking,
  chosen,
  approvals,
  freshStamp,
  onPick,
  onLess,
  onLine,
  onDiscount,
  onPayment,
}: {
  bill: Bill
  groups: ReadonlyArray<LineGroup>
  mode: BillMode
  /** El membrete: el bar y, si tiene más de una, la sucursal. */
  place: string
  timeZone: string
  nowMs: number
  /** Se está eligiendo qué paga cada uno: los renglones se marcan en vez de abrirse. */
  picking: boolean
  /** Lo marcado para este cobro (se sigue viendo aunque ya no se esté eligiendo). */
  chosen: Chosen | null
  /** Los pedidos de esta mesa (los que esperan y los que se acaban de contestar) y cómo contestarlos. */
  approvals: {
    rows: ReadonlyArray<ApprovalRow>
    onApprove: (approval: InboxApproval) => void
    onReject: (approval: InboxApproval) => void
    onUndo: (approval: InboxApproval) => void
    onBack: (approval: InboxApproval) => void
  }
  /** La mesa se cobró recién, con la pantalla abierta: el sello cae. */
  freshStamp: boolean
  onPick: (group: LineGroup) => void
  onLess: (group: LineGroup) => void
  onLine: (group: LineGroup) => void
  onDiscount: (discount: BillDiscount) => void
  onPayment: (payment: Payment) => void
}) {
  const { session, bill: numbers, can } = bill
  const closed = mode.kind === 'closed'
  const open = session.status === 'open'
  const title = billTitle(session)
  const name = billName(bill)
  const people = billPeople(bill)
  const each = perPerson(numbers.due_cents, people)
  const stampedAt = bill.closed?.at ?? session.paid_at ?? session.bill_requested_at ?? bill.now
  const waiting = minutesSince(session.bill_requested_at, nowMs)
  const pendingVoidIds = new Set(
    bill.pending_approvals.flatMap((approval) =>
      isVoidPayload(approval.payload) ? [approval.payload.item_id] : [],
    ),
  )
  const voidsTotal = bill.voids.reduce((sum, item) => sum + item.amount_cents, 0)
  const wholeDeposit = bill.reservation?.deposit_cents ?? 0

  return (
    <article className="pay-paper" aria-label={`Cuenta de ${title}`} data-testid="pay-paper">
      {session.is_practice ? (
        <p className="pay-tape" data-testid="pay-practice">
          <b>Prueba</b>
          <span>No entra en la caja ni suma puntos.</span>
        </p>
      ) : null}
      {place ? <p className="pay-letterhead">{place}</p> : null}

      <header className="pay-head">
        <h2>Cuenta</h2>
        <time dateTime={stampedAt}>
          {dayAt(stampedAt, timeZone)} · {clockAt(stampedAt, timeZone)}
        </time>
        {open && session.bill_requested_at ? (
          <span className="pay-chip">
            <Receipt aria-hidden strokeWidth={2.4} />
            Pedida
            {waiting !== null && waiting > 0 ? <b>· {formatMinutes(waiting)}</b> : null}
          </span>
        ) : null}
      </header>
      <p className="pay-sub">
        {[title, people ? `${people} ${people === 1 ? 'persona' : 'personas'}` : null, name]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {picking ? (
        <p className="pay-pick-hint" role="status">
          <Check aria-hidden strokeWidth={3} />
          Marcá lo que paga esta persona.
        </p>
      ) : null}

      <ul className="pay-lines" aria-label="Lo que se pidió">
        {groups.map((group) => {
          const picked = chosen ? Math.min(chosen[group.key] ?? 0, group.freeUnits) : 0
          const allPaid = group.freeUnits === 0
          const waitingVoid = group.lines.some((line) => pendingVoidIds.has(line.id))
          const body = (
            <>
              {picking ? (
                <span className="pay-mark" aria-hidden>
                  {picked === 0 ? null : group.freeUnits > 1 ? (
                    <span className="pay-bump" key={picked}>
                      {picked}
                    </span>
                  ) : (
                    <Check strokeWidth={3.2} />
                  )}
                </span>
              ) : null}
              <span className="pay-qty">{group.quantity}</span>
              <span className="pay-line-main">
                <span className="pay-line-row">
                  <span className="pay-line-name">{group.name}</span>
                  <i className="pay-dots" aria-hidden />
                  <b className="pay-line-amount">{money(group.totalCents)}</b>
                </span>
                {group.extras.length > 0 ? (
                  <span className="pay-line-sub">{extrasText(group.extras)}</span>
                ) : null}
                {picked > 0 && group.freeUnits > 1 ? (
                  <span className="pay-line-sub">
                    {picked} de {group.freeUnits} · {money(group.unitCents * picked)}
                  </span>
                ) : null}
                {group.paidUnits > 0 ? (
                  <span className="pay-line-note is-paid">
                    <Check aria-hidden strokeWidth={3} />
                    {allPaid
                      ? 'Cobrado'
                      : `${group.paidUnits} de ${group.quantity} ya ${group.paidUnits === 1 ? 'cobrado' : 'cobrados'}`}
                  </span>
                ) : null}
                {waitingVoid ? (
                  <span className="pay-line-note is-wait">
                    <Hourglass aria-hidden strokeWidth={2.4} />
                    Baja pedida: espera el OK
                  </span>
                ) : null}
              </span>
            </>
          )
          const lineClass = cn(
            'pay-line',
            picked > 0 && 'is-picked',
            allPaid && group.paidUnits > 0 && 'is-paid',
          )
          return (
            <li key={group.key} className={cn(picked > 0 && 'is-picked', waitingVoid && 'is-wait')}>
              {picking ? (
                <button
                  type="button"
                  className={lineClass}
                  aria-pressed={picked > 0}
                  onClick={() => onPick(group)}
                  disabled={allPaid}
                  data-testid={`pay-line-${group.lines[0]?.id ?? group.key}`}
                >
                  {body}
                </button>
              ) : open ? (
                <button
                  type="button"
                  className={lineClass}
                  onClick={() => onLine(group)}
                  data-testid={`pay-line-${group.lines[0]?.id ?? group.key}`}
                >
                  {body}
                </button>
              ) : (
                <div className={lineClass}>{body}</div>
              )}
              {picking && picked > 0 && group.freeUnits > 1 ? (
                <button
                  type="button"
                  className="pay-less"
                  onClick={() => onLess(group)}
                  aria-label={`Uno menos de ${group.name}`}
                >
                  <Minus aria-hidden strokeWidth={2.6} />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>

      {approvals.rows.length > 0 ? (
        <ul className="pay-waits" aria-label="Pedidos de esta mesa">
          {approvals.rows.map((row) => (
            <ApprovalSlip
              key={row.approval.id}
              row={row}
              canDecide={can.approve}
              nowMs={nowMs}
              inBill
              onApprove={approvals.onApprove}
              onReject={approvals.onReject}
              onUndo={approvals.onUndo}
              onBack={approvals.onBack}
            />
          ))}
        </ul>
      ) : null}

      <div className="pay-sums">
        <p className="pay-sum">
          <span>Consumo</span>
          <i className="pay-dots" aria-hidden />
          <b>{money(numbers.subtotal_cents)}</b>
        </p>

        {bill.discounts.map((discount) => {
          const body = (
            <>
              <span>
                Descuento{discount.kind === 'percent' ? ` ${bpLabel(discount.value)}` : ''}
                <small>
                  {discount.reason} · {discount.by_name}
                  {discount.approved_by_name ? ` · OK de ${discount.approved_by_name}` : ''}
                </small>
              </span>
              <i className="pay-dots" aria-hidden />
              <b>{minus(discount.amount_cents)}</b>
            </>
          )
          // Lo quita quien puede aprobar, o quien lo puso.
          return open && (can.approve || discount.mine) ? (
            <button
              key={discount.id}
              type="button"
              className="pay-sum"
              onClick={() => onDiscount(discount)}
              data-testid="pay-discount"
            >
              {body}
            </button>
          ) : (
            <p key={discount.id} className="pay-sum">
              {body}
            </p>
          )
        })}

        {numbers.deposit_cents > 0 ? (
          <p className="pay-sum" data-testid="pay-deposit">
            <span>
              Seña{bill.reservation ? ` · ${bill.reservation.name}` : ''}
              {wholeDeposit > numbers.deposit_cents ? (
                <small>de {money(wholeDeposit)}: se usa lo que alcanza la cuenta</small>
              ) : null}
            </span>
            <i className="pay-dots" aria-hidden />
            <b>{minus(numbers.deposit_cents)}</b>
          </p>
        ) : null}

        <p className="pay-total" data-testid="pay-total">
          <span>Total</span>
          <b>{money(numbers.due_cents)}</b>
          {closed ? (
            <span
              className={cn('pay-stamp is-big', freshStamp && 'is-fresh')}
              data-testid="pay-stamp"
            >
              <Stamp aria-hidden strokeWidth={2.4} />
              Cobrado
            </span>
          ) : null}
        </p>

        {each !== null && people !== null && people > 1 && numbers.due_cents > 0 ? (
          <p className="pay-sum pay-per" data-testid="pay-per-person">
            <span>Por persona · {people}</span>
            <i className="pay-dots" aria-hidden />
            <b>{money(each)}</b>
          </p>
        ) : null}
      </div>

      {bill.payments.length > 0 ? (
        <section aria-label="Cobros">
          <div className="pay-cut" aria-hidden>
            <Scissors />
          </div>
          <h3 className="pay-h3">Cobros</h3>
          <ul className="pay-payments">
            {bill.payments.map((payment) => {
              const voided = payment.status === 'voided'
              return (
                <li key={payment.id}>
                  <button
                    type="button"
                    className={cn('pay-payment', voided && 'is-voided')}
                    onClick={() => onPayment(payment)}
                    data-testid="pay-payment"
                  >
                    {voided ? (
                      <Ban aria-hidden strokeWidth={2.4} />
                    ) : (
                      <Check aria-hidden strokeWidth={3} />
                    )}
                    <span className="pay-payment-main">
                      <span className="pay-payment-name">
                        {payment.payer_label ?? METHOD_LABEL[payment.method]}
                      </span>
                      <span className="pay-payment-sub">
                        {voided
                          ? `Anulado${payment.void_reason ? `: ${payment.void_reason}` : ''}`
                          : paymentFacts(payment, timeZone)}
                      </span>
                    </span>
                    <b>{money(payment.amount_cents)}</b>
                  </button>
                </li>
              )
            })}
          </ul>
          {open ? (
            <p className="pay-sum pay-left">
              <span>{numbers.overpaid_cents > 0 ? 'Cobrado de más' : 'Falta'}</span>
              <i className="pay-dots" aria-hidden />
              <b>
                {money(
                  numbers.overpaid_cents > 0 ? numbers.overpaid_cents : numbers.remaining_cents,
                )}
              </b>
            </p>
          ) : null}
        </section>
      ) : null}

      {bill.voids.length > 0 ? (
        <details className="pay-voids">
          <summary>
            <ChevronRight aria-hidden />
            {bill.voids.length === 1 ? '1 baja' : `${bill.voids.length} bajas`} ·{' '}
            {money(voidsTotal)} que no se cobran
          </summary>
          <ul>
            {bill.voids.map((item) => (
              <li key={item.id}>
                <b>
                  {item.quantity} × {item.name}
                </b>{' '}
                {money(item.amount_cents)}
                <small>
                  {item.reason ?? 'Sin motivo'} · {item.by_name} · {clockAt(item.at, timeZone)}
                </small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {bill.customer ? (
        <p className="pay-club" data-testid="pay-club">
          <Star aria-hidden strokeWidth={2.4} />
          <span>
            {bill.customer.first_name} {bill.customer.last_name}
            {bill.customer.tier ? (
              <>
                {' '}
                <i
                  aria-hidden
                  style={
                    bill.customer.tier_color
                      ? { ['--tier' as string]: bill.customer.tier_color }
                      : undefined
                  }
                />
                {bill.customer.tier}
              </>
            ) : (
              ', socio del club'
            )}
            {closed
              ? '.'
              : session.is_practice
                ? '. En una mesa de práctica no suma puntos.'
                : '. Sus puntos se suman solos al cerrar la mesa.'}
          </span>
        </p>
      ) : null}

      <p className="pay-legal">Documento no válido como factura</p>
    </article>
  )
}
