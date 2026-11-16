/**
 * La cuenta de una mesa, en papel — PURO.
 *
 * Es lo que se le lleva a la mesa cuando la piden: los productos juntos como en la cuenta de la
 * pantalla («4 Mojito»), lo que se descuenta, el total y, si ya se cobró una parte, cuánto falta.
 * No es una factura y lo dice.
 */
import type { Bill } from '@/lib/pos/cash/types'
import { METHOD_LABEL } from '@/lib/pos/cash/types'
import { groupLines } from '@/lib/pos/pay/lines'
import { type PrintDoc, type PrintLine, p, ticketDateTime, ticketMoney } from './doc'

export type BillPrintContext = {
  /** El nombre del bar, como va en el membrete. */
  barName: string
  branch: string | null
  timeZone: string
  /** Quién atiende la mesa, si se sabe. */
  waiter?: string | null
}

type BillLike = Pick<
  Bill,
  'now' | 'session' | 'bill' | 'lines' | 'discounts' | 'payments' | 'reservation' | 'settings'
>

function who(session: BillLike['session']): string {
  if (session.table_label) return `Mesa ${session.table_label}`
  if (session.alias) return session.alias
  return session.kind === 'delivery'
    ? 'Delivery'
    : session.kind === 'quick'
      ? 'Para llevar'
      : 'Pedido'
}

export function billDoc(bill: BillLike, context: BillPrintContext): PrintDoc {
  const lines: PrintLine[] = []
  const { session } = bill
  lines.push(p.center(context.barName, { size: 'xl', upper: true }))
  if (context.branch) lines.push(p.center(context.branch, { size: 'sm', upper: true }))
  lines.push(p.space())

  const people = session.party_size ?? bill.reservation?.guests ?? null
  const head = [who(session), people ? `${people} ${people === 1 ? 'persona' : 'personas'}` : null]
    .filter(Boolean)
    .join(' · ')
  lines.push(p.center(head, { size: 'lg', bold: true }))
  if (session.table_label && session.alias) lines.push(p.center(session.alias))
  const meta = [
    ticketDateTime(bill.now, context.timeZone),
    context.waiter ? `Atendió ${context.waiter}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  lines.push(p.center(meta, { size: 'sm' }))
  if (session.is_practice) lines.push(p.banner('Práctica · no es una cuenta de verdad'))
  lines.push(p.rule('double'))

  for (const group of groupLines(bill.lines)) {
    lines.push(
      p.row(`${group.quantity} ${group.name}`, ticketMoney(group.totalCents), { dots: true }),
    )
    for (const extra of group.extras) {
      lines.push(p.text(`+ ${extra.label}`, { size: 'sm', indent: true }))
    }
    if (group.quantity > 1) {
      lines.push(p.text(`${ticketMoney(group.unitCents)} c/u`, { size: 'sm', indent: true }))
    }
  }
  lines.push(p.rule('solid'))

  const { bill: numbers } = bill
  const reductions = numbers.discount_cents > 0 || numbers.deposit_cents > 0
  if (reductions) lines.push(p.row('Consumo', ticketMoney(numbers.subtotal_cents)))
  // Cada descuento con su motivo, si la suma da lo que se descontó; si no, una sola línea que no mienta.
  const applied = bill.discounts.filter((discount) => discount.amount_cents > 0)
  const itemized = applied.reduce((sum, discount) => sum + discount.amount_cents, 0)
  if (numbers.discount_cents > 0 && itemized === numbers.discount_cents) {
    for (const discount of applied) {
      lines.push(p.row(`Descuento · ${discount.reason}`, ticketMoney(-discount.amount_cents)))
    }
  } else if (numbers.discount_cents > 0) {
    lines.push(p.row('Descuentos', ticketMoney(-numbers.discount_cents)))
  }
  if (numbers.deposit_cents > 0) lines.push(p.row('Seña', ticketMoney(-numbers.deposit_cents)))
  lines.push(p.row('TOTAL', ticketMoney(numbers.due_cents), { bold: true, size: 'lg' }))

  const paid = bill.payments.filter((payment) => payment.status === 'ok')
  if (paid.length > 0) {
    lines.push(p.rule('dashed'))
    for (const payment of paid) {
      const label = payment.payer_label
        ? `${METHOD_LABEL[payment.method]} · ${payment.payer_label}`
        : METHOD_LABEL[payment.method]
      lines.push(p.row(`Pagado · ${label}`, ticketMoney(payment.amount_cents), { size: 'sm' }))
    }
    if (numbers.remaining_cents > 0) {
      lines.push(p.row('FALTA', ticketMoney(numbers.remaining_cents), { bold: true, size: 'lg' }))
    } else {
      lines.push(p.center('Cuenta paga', { bold: true, upper: true }))
    }
  }

  const toSplit = numbers.remaining_cents > 0 ? numbers.remaining_cents : numbers.due_cents
  if (people && people > 1 && toSplit > 0 && paid.length === 0) {
    lines.push(
      p.row(`Entre ${people}`, `${ticketMoney(Math.ceil(toSplit / people / 100) * 100)} c/u`, {
        size: 'sm',
      }),
    )
  }

  if (numbers.remaining_cents > 0 && bill.settings.transfer_alias) {
    lines.push(p.rule('dashed'))
    lines.push(p.text('Para transferir', { size: 'sm', upper: true, bold: true }))
    lines.push(p.text(`Alias: ${bill.settings.transfer_alias}`, { bold: true }))
    if (bill.settings.transfer_holder) {
      lines.push(p.text(bill.settings.transfer_holder, { size: 'sm' }))
    }
  }

  lines.push(p.rule('double'))
  lines.push(p.center('Documento no válido como factura', { size: 'sm' }))
  lines.push(p.center('¡Gracias por venir!', { bold: true }))
  return { title: `Cuenta ${who(session)}`, lines }
}
