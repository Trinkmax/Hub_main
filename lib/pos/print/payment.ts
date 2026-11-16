/**
 * El tique de un cobro, para el cliente — PURO.
 *
 * Pedido de los socios (16/11/2026): que al cobrar salga un tique. Es el comprobante de ESE cobro:
 * qué se pagó (los productos, si se cobró por producto; la parte, si se dividió), con qué medio, la
 * propina y el recargo si los hubo, el vuelto, y cuánto le queda a la mesa.
 *
 * No es una factura y lo dice. El punto de venta marca cada cobro como «con factura» o «sin factura»
 * (según el medio), pero todavía no emite la factura: eso se hace aparte, y este tique no cambia
 * según esa marca.
 */
import type { Bill, Payment } from '@/lib/pos/cash/types'
import { METHOD_LABEL } from '@/lib/pos/cash/types'
import { type PrintDoc, type PrintLine, p, ticketDateTime, ticketMoney } from './doc'

export type PaymentPrintContext = {
  /** El nombre del bar, como va en el membrete. */
  barName: string
  timeZone: string
}

type BillLike = Pick<Bill, 'session' | 'bill' | 'lines'>

function who(session: BillLike['session']): string {
  if (session.table_label) return `Mesa ${session.table_label}`
  if (session.alias) return session.alias
  return session.kind === 'delivery'
    ? 'Delivery'
    : session.kind === 'quick'
      ? 'Para llevar'
      : 'Pedido'
}

/** Los productos que cubrió un cobro por producto: «2 Mojito», con lo que valen. */
export function paidItems(
  payment: Pick<Payment, 'item_ids'>,
  lines: BillLike['lines'],
): { name: string; quantity: number; cents: number }[] {
  const byId = new Map(lines.map((line) => [line.id, line]))
  const out = new Map<string, { name: string; quantity: number; cents: number }>()
  for (const id of payment.item_ids) {
    const line = byId.get(id)
    if (!line) continue
    const unit = line.quantity > 0 ? Math.round(line.line_total_cents / line.quantity) : 0
    const key = `${line.menu_item_id}|${unit}`
    const entry = out.get(key)
    if (entry) {
      entry.quantity += 1
      entry.cents += unit
    } else out.set(key, { name: line.name, quantity: 1, cents: unit })
  }
  return [...out.values()]
}

export function paymentDoc(
  bill: BillLike,
  payment: Payment,
  context: PaymentPrintContext,
): PrintDoc {
  const lines: PrintLine[] = []
  lines.push(p.center(context.barName, { size: 'xl', upper: true }))
  lines.push(p.center(who(bill.session), { size: 'lg', bold: true }))
  lines.push(p.center(ticketDateTime(payment.created_at, context.timeZone), { size: 'sm' }))
  if (payment.is_practice) lines.push(p.banner('Práctica · no es un cobro de verdad'))
  if (payment.status === 'voided') lines.push(p.banner('Cobro anulado'))
  lines.push(p.rule('double'))

  const items = paidItems(payment, bill.lines)
  if (items.length > 0) {
    for (const item of items) {
      lines.push(p.row(`${item.quantity} ${item.name}`, ticketMoney(item.cents), { dots: true }))
    }
    lines.push(p.rule('solid'))
  } else if (payment.payer_label) {
    lines.push(p.center(payment.payer_label, { bold: true }))
    lines.push(p.rule('solid'))
  }

  const extras = payment.surcharge_cents > 0 || payment.tip_cents > 0
  if (extras) lines.push(p.row('Consumo', ticketMoney(payment.amount_cents)))
  if (payment.surcharge_cents > 0) {
    lines.push(p.row('Recargo de crédito', ticketMoney(payment.surcharge_cents)))
  }
  if (payment.tip_cents > 0) lines.push(p.row('Propina', ticketMoney(payment.tip_cents)))
  lines.push(p.row('PAGADO', ticketMoney(payment.total_cents), { bold: true, size: 'lg' }))
  lines.push(p.row('Medio', METHOD_LABEL[payment.method]))
  if (payment.method === 'cash' && payment.tendered_cents !== null && payment.change_cents > 0) {
    lines.push(p.row('Pagó con', ticketMoney(payment.tendered_cents)))
    lines.push(p.row('Vuelto', ticketMoney(payment.change_cents), { bold: true }))
  }
  if (payment.reference) lines.push(p.row('Referencia', payment.reference, { size: 'sm' }))

  lines.push(p.rule('dashed'))
  if (bill.bill.remaining_cents > 0) {
    lines.push(p.row('Falta de la mesa', ticketMoney(bill.bill.remaining_cents)))
  } else {
    lines.push(p.center('Cuenta paga', { bold: true, upper: true }))
  }

  lines.push(p.rule('double'))
  lines.push(p.center('Documento no válido como factura', { size: 'sm' }))
  lines.push(p.center('¡Gracias por venir!', { bold: true }))
  return { title: `Cobro ${who(bill.session)}`, lines }
}
