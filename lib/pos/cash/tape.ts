/**
 * La cinta de la caja — PURO y testeado.
 *
 * La cinta es el diario del turno: cada cobro, cada retiro y cada ingreso en el orden en que
 * pasaron, de lo último (arriba, recién salido de la registradora) a lo primero (abajo, donde se
 * abrió el turno). Acá se arma esa lista con lo que devuelve la base, se filtra por medio de pago
 * y se escribe lo que dice cada renglón: «Corregido por Juan 23:41: Transferencia → Efectivo».
 *
 * Con el filtro en efectivo la cinta es el diario del cajón: el cambio con el que se abrió, los
 * cobros en efectivo, lo que entró y lo que se sacó. Sumados dan lo que tiene que haber.
 */
import { formatCentsShort } from '@/lib/money'
import { clockAt } from '@/lib/pos/order/clock'
import { defaultInvoice } from './bill'
import { methodChangeLabel } from './shift'
import type {
  CashMovement,
  DayPayment,
  InvoiceByMethod,
  PayMethod,
  PaymentEdit,
  Shift,
} from './types'

export type TapeEntry =
  | { kind: 'payment'; id: string; at: string; payment: DayPayment }
  | { kind: 'movement'; id: string; at: string; movement: CashMovement }
  | { kind: 'opening'; id: string; at: string; shift: Shift }
  | { kind: 'closing'; id: string; at: string; shift: Shift }

export type Tape = {
  /** Lo de este turno, de lo último a lo primero. */
  current: TapeEntry[]
  /** Cobros del mismo día que entraron a otro turno, los más nuevos primero. */
  other: TapeEntry[]
}

export type TapeFilter = 'all' | PayMethod

/** Con la misma hora: el cierre arriba de todo y la apertura abajo de todo. */
const TIE: Readonly<Record<TapeEntry['kind'], number>> = {
  closing: 0,
  payment: 1,
  movement: 1,
  opening: 2,
}

function newestFirst(a: TapeEntry, b: TapeEntry): number {
  const delta = Date.parse(b.at) - Date.parse(a.at)
  if (delta !== 0 && !Number.isNaN(delta)) return delta
  return TIE[a.kind] - TIE[b.kind] || a.id.localeCompare(b.id)
}

/**
 * La cinta de un turno. Los cobros del día que no son de este turno van aparte (`other`): se ven,
 * pero no se suman con los de arriba.
 */
export function buildTape(input: {
  shift: Shift | null
  payments: ReadonlyArray<DayPayment>
  movements: ReadonlyArray<CashMovement>
}): Tape {
  const { shift, payments, movements } = input
  const current: TapeEntry[] = []
  const other: TapeEntry[] = []
  for (const payment of payments) {
    const entry: TapeEntry = { kind: 'payment', id: payment.id, at: payment.created_at, payment }
    // Sin turno a la vista (la caja nunca se abrió) no hay «otro turno»: va todo junto.
    if (!shift || payment.shift_id === shift.id) current.push(entry)
    else other.push(entry)
  }
  for (const movement of movements) {
    current.push({ kind: 'movement', id: movement.id, at: movement.at, movement })
  }
  if (shift) {
    current.push({ kind: 'opening', id: `${shift.id}:opening`, at: shift.opened_at, shift })
    if (shift.status === 'closed' && shift.closed_at) {
      current.push({ kind: 'closing', id: `${shift.id}:closing`, at: shift.closed_at, shift })
    }
  }
  return { current: current.sort(newestFirst), other: other.sort(newestFirst) }
}

/**
 * «Tocar Efectivo deja solo esos». En efectivo quedan además los movimientos del cajón y la
 * apertura: es todo lo que movió billetes. En los demás medios, solo los cobros.
 */
export function filterTape(entries: ReadonlyArray<TapeEntry>, filter: TapeFilter): TapeEntry[] {
  if (filter === 'all') return [...entries]
  return entries.filter((entry) =>
    entry.kind === 'payment' ? entry.payment.method === filter : filter === 'cash',
  )
}

/** Cuántos cobros vigentes hay en una lista y cuánto suman (lo que se le cobró a la gente). */
export function tapeSum(entries: ReadonlyArray<TapeEntry>): { count: number; cents: number } {
  let count = 0
  let cents = 0
  for (const entry of entries) {
    if (entry.kind !== 'payment' || entry.payment.status !== 'ok') continue
    count += 1
    cents += entry.payment.total_cents
  }
  return { count, cents }
}

/** «Mesa 8» y, si hay, de quién es («Sofi · Parte 2 de 4»). */
export function paymentTitle(payment: Pick<DayPayment, 'table_label' | 'alias' | 'payer_label'>): {
  title: string
  detail: string | null
} {
  const alias = payment.alias?.trim() || null
  const payer = payment.payer_label?.trim() || null
  if (payment.table_label) {
    const detail = [alias, payer].filter(Boolean).join(' · ')
    return { title: `Mesa ${payment.table_label}`, detail: detail || null }
  }
  return { title: alias ?? 'Sin mesa', detail: payer }
}

const FIELD_ORDER: Readonly<Record<PaymentEdit['field'], number>> = {
  method: 0,
  surcharge_cents: 1,
  invoice: 2,
}

function invoiceWord(value: string): string {
  return value === 'true' ? 'con factura' : 'sin factura'
}

function editChange(edit: PaymentEdit): string {
  if (edit.field === 'method') return methodChangeLabel(edit.old_value, edit.new_value)
  if (edit.field === 'invoice') {
    return `${invoiceWord(edit.old_value)} → ${invoiceWord(edit.new_value)}`
  }
  return `recargo ${formatCentsShort(Number(edit.old_value))} → ${formatCentsShort(Number(edit.new_value))}`
}

/**
 * Las correcciones de un cobro como quedan escritas para siempre:
 * «Corregido por Juan 23:41: Transferencia → Efectivo».
 * Lo que se cambió en el mismo toque (el medio y el recargo que se fue con él) va en un renglón.
 */
export function editLines(edits: ReadonlyArray<PaymentEdit>, timeZone: string): string[] {
  const groups: PaymentEdit[][] = []
  for (const edit of edits) {
    const last = groups.at(-1)
    const head = last?.[0]
    if (last && head && head.at === edit.at && head.by_name === edit.by_name) last.push(edit)
    else groups.push([edit])
  }
  return groups.map((group) => {
    const head = group[0] as PaymentEdit
    const changes = [...group]
      .sort((a, b) => FIELD_ORDER[a.field] - FIELD_ORDER[b.field])
      .map(editChange)
      .join(' · ')
    const note = group.find((edit) => edit.note)?.note
    const closed = group.some((edit) => edit.after_close) ? ' (con el turno cerrado)' : ''
    return `Corregido por ${head.by_name} ${clockAt(head.at, timeZone)}: ${changes}${closed}${note ? ` · «${note}»` : ''}`
  })
}

/**
 * Lo que el sistema anota al lado de un cobro: la propina y el recargo que van adentro del monto,
 * y la factura solo cuando se sale de lo que el bar tiene puesto para ese medio.
 */
export function paymentExtras(
  payment: Pick<DayPayment, 'method' | 'tip_cents' | 'surcharge_cents' | 'invoice'>,
  invoiceByMethod: InvoiceByMethod | null,
): string[] {
  const out: string[] = []
  if (payment.surcharge_cents > 0) {
    out.push(`Incluye ${formatCentsShort(payment.surcharge_cents)} de recargo`)
  }
  if (payment.tip_cents > 0) out.push(`Incluye ${formatCentsShort(payment.tip_cents)} de propina`)
  if (payment.invoice !== defaultInvoice(payment.method, invoiceByMethod)) {
    out.push(payment.invoice ? 'Con factura' : 'Sin factura')
  }
  return out
}

/** «Pagó con $ 50.000 · vuelto $ 3.000», o `null` si pagó justo o no fue efectivo. */
export function tenderedLine(
  payment: Pick<DayPayment, 'method' | 'tendered_cents' | 'change_cents'>,
): string | null {
  if (payment.method !== 'cash' || payment.tendered_cents === null) return null
  return `Pagó con ${formatCentsShort(payment.tendered_cents)} · vuelto ${formatCentsShort(payment.change_cents)}`
}

/** Cómo arrancó el turno: si quien abrió confirmó lo que había o contó otra cosa. */
export function openingLine(
  shift: Pick<Shift, 'opening_float_cents' | 'opening_expected_cents' | 'opened_by_name'>,
): { text: string; differs: boolean } {
  const who = shift.opened_by_name
  if (shift.opening_expected_cents === null) {
    return { text: `${who} abrió esta caja por primera vez`, differs: false }
  }
  if (shift.opening_expected_cents === shift.opening_float_cents) {
    return { text: `${who} confirmó el cambio que dejó el turno anterior`, differs: false }
  }
  return {
    text: `${who} contó ${formatCentsShort(shift.opening_float_cents)}: el turno anterior había dejado ${formatCentsShort(shift.opening_expected_cents)}`,
    differs: true,
  }
}
