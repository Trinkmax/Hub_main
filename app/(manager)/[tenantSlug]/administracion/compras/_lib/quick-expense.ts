/**
 * «Nuevo gasto» (H.5), lo puro del formulario: qué comprobante proponer, qué
 * alícuota, cómo se reparte el total en neto e IVA, qué precarga un gasto fijo
 * y qué se guarda. Lo prueba `administracion-gasto-rapido.test.ts`.
 */

import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import { splitGross } from '@/lib/accounting/iva'
import type { QuickExpenseValues } from '@/lib/accounting/server/document-types'
import type { IvaCondition, VatRateBp } from '@/lib/accounting/types'
import { isVoucherType, VOUCHER_CATALOG } from '@/lib/accounting/voucher-types'
import { formatDayMonth } from '@/lib/dates'
import type { SheetRecurring } from './sheet-types'

/**
 * Los comprobantes de «Nuevo gasto» (el esquema `quickExpenseSchema.voucher`).
 * Desde el 12/10/2026 se pregunta primero «¿Se factura?»: «No» es `none` (se
 * guarda `sin_comprobante` y en pantalla es «Remito u otro»); «Sí» abre los
 * otros tres. Los valores no cambiaron: cambió cómo se preguntan.
 */
export const QUICK_VOUCHERS = ['none', 'ticket', 'a', 'bc'] as const
export type QuickVoucher = (typeof QUICK_VOUCHERS)[number]

export const QUICK_VOUCHER_LABELS: Readonly<Record<QuickVoucher, string>> = {
  none: 'Remito u otro',
  ticket: 'Tique',
  a: 'Factura A',
  bc: 'Factura B o C',
}

/** Los de «Sí, se factura», en el orden de los chips. */
export const INVOICED_QUICK_VOUCHERS = ['ticket', 'a', 'bc'] as const
export type InvoicedQuickVoucher = (typeof INVOICED_QUICK_VOUCHERS)[number]

/**
 * La respuesta a «¿Se factura?» que corresponde a un comprobante: «No» solo
 * para `none`. No confundir con `isInvoiceVoucher` (una factura A, B o C, que
 * además pide proveedor y número): un tique también «se factura».
 */
export function quickVoucherInvoiced(voucher: QuickVoucher): voucher is InvoicedQuickVoucher {
  return voucher !== 'none'
}

/** Alícuotas de «Nuevo gasto» (las de una factura A de todos los días). */
export const QUICK_VAT_RATES = [2100, 1050, 2700] as const
export type QuickVatRate = (typeof QUICK_VAT_RATES)[number]

export function isQuickVatRate(value: unknown): value is QuickVatRate {
  return value === 2100 || value === 1050 || value === 2700
}

/** Una factura (A, B o C) necesita proveedor, punto de venta y número. */
export function isInvoiceVoucher(voucher: QuickVoucher): boolean {
  return voucher === 'a' || voucher === 'bc'
}

/**
 * Un tipo de comprobante cualquiera → el de «Nuevo gasto» que le corresponde.
 * Lo que no se factura (`sin_comprobante`) es «No»; las
 * letras A y M, «Factura A»; B y C, «Factura B o C». `null`: no dice nada
 * (una DDJJ, una liquidación, un valor viejo).
 */
function quickVoucherOf(type: string | null | undefined): QuickVoucher | null {
  if (!isVoucherType(type)) return null
  if (isNotInvoicedVoucher(type)) return 'none'
  if (type === 'tique') return 'ticket'
  const { letter } = VOUCHER_CATALOG[type]
  if (letter === 'A' || letter === 'M') return 'a'
  if (letter === 'B' || letter === 'C') return 'bc'
  return null
}

/** Por la condición frente al IVA: RI, Factura A; monotributo o exento, Factura B o C; el resto, tique. */
function invoicedVoucherByCondition(
  condition: IvaCondition | null | undefined,
): InvoicedQuickVoucher {
  switch (condition) {
    case 'responsable_inscripto':
      return 'a'
    case 'monotributo':
    case 'exento':
      return 'bc'
    default:
      return 'ticket'
  }
}

/**
 * El comprobante que se propone y, con él, la respuesta a «¿Se factura?»: la
 * ficha propone y la carga decide. Primero el «Comprobante habitual» de la
 * ficha del proveedor; si no tiene, el último que se le cargó; si no hay, por
 * su condición (RI: Factura A; monotributo o exento: Factura B o C). Sin
 * proveedor, «No» (remito u otro).
 */
export function suggestQuickVoucher(input: {
  hasParty: boolean
  /** El «Comprobante habitual» de la ficha (`acc_parties.default_voucher_type`). */
  habitualVoucherType?: string | null
  lastVoucherType?: string | null
  condition?: IvaCondition | null
}): QuickVoucher {
  if (!input.hasParty) return 'none'
  return (
    quickVoucherOf(input.habitualVoucherType) ??
    quickVoucherOf(input.lastVoucherType) ??
    invoicedVoucherByCondition(input.condition)
  )
}

/**
 * Al contestar «Sí, se factura»: qué comprobante queda marcado. El habitual o
 * el último del proveedor si son con factura; si no, por su condición. Sin
 * proveedor, tique (una factura pide proveedor).
 */
export function suggestInvoicedVoucher(input: {
  hasParty: boolean
  habitualVoucherType?: string | null
  lastVoucherType?: string | null
  condition?: IvaCondition | null
}): InvoicedQuickVoucher {
  if (!input.hasParty) return 'ticket'
  for (const type of [input.habitualVoucherType, input.lastVoucherType]) {
    const voucher = quickVoucherOf(type)
    if (voucher !== null && quickVoucherInvoiced(voucher)) return voucher
  }
  return invoicedVoucherByCondition(input.condition)
}

/** La alícuota que se propone: la recordada si es una de las de «Nuevo gasto»; si no, 21 %. */
export function suggestQuickVatRate(remembered: number | null | undefined): QuickVatRate {
  return isQuickVatRate(remembered) ? remembered : 2100
}

/** Hasta dónde llega el ajuste de ±1¢ del IVA (el esquema acepta ±$ 1). */
export const VAT_ADJUST_LIMIT = 100

/**
 * Neto e IVA de un total con IVA incluido (lo mismo que arma el motor:
 * `netFromGross` + el ajuste de ±1¢). `null` si el total no sirve o el ajuste
 * deja un neto o un IVA negativos.
 */
export function splitTotal(
  totalCents: number | null,
  rateBp: VatRateBp,
  adjustCents = 0,
): { netCents: number; vatCents: number } | null {
  if (totalCents === null || !Number.isSafeInteger(totalCents) || totalCents <= 0) return null
  const { vat } = splitGross(totalCents, rateBp)
  const vatCents = vat + (rateBp === 0 ? 0 : adjustCents)
  if (vatCents < 0 || vatCents > totalCents) return null
  return { netCents: totalCents - vatCents, vatCents }
}

/** Lo que se va a guardar, en palabras (para la ayuda debajo del comprobante). */
export function quickExpenseOutcome(input: {
  voucher: QuickVoucher
  hasParty: boolean
  hasNumber: boolean
}): 'expense' | 'purchase' {
  if (input.voucher === 'none') return 'expense'
  if (input.voucher === 'ticket') return input.hasParty && input.hasNumber ? 'purchase' : 'expense'
  return 'purchase'
}

/** La ayuda debajo de «¿Se factura?»: qué se guarda y si entra al Libro IVA. */
export function quickVoucherHelp(input: {
  voucher: QuickVoucher
  outcome: 'expense' | 'purchase'
  condition: IvaCondition | null
}): string {
  if (input.voucher === 'none') {
    return 'Se guarda como gasto de contado, con remito u otro comprobante. No entra al Libro IVA.'
  }
  if (input.voucher === 'ticket') {
    return input.outcome === 'expense'
      ? 'Sin proveedor o sin número, el tique va como gasto: no entra al Libro IVA.'
      : 'Se guarda el tique y el pago: entra al Libro IVA y la cuenta del proveedor queda en cero.'
  }
  if (input.voucher === 'bc' && input.condition === 'responsable_inscripto') {
    return 'Con factura B no computás el IVA: va todo al costo. Pedí factura A si podés.'
  }
  return 'Se guarda la factura y el pago, así la cuenta del proveedor queda en cero.'
}

// ─── N.º de remito ───────────────────────────────────────────────────────────

/** Hasta dónde llega el número del remito (el detalle entero tiene `QUICK_DETAIL_MAX`). */
export const REMITO_MAX = 40
/** El tope del detalle de «Nuevo gasto» (`quickExpenseSchema.detail`). */
export const QUICK_DETAIL_MAX = 280

/**
 * El número del remito va adelante del detalle: «Remito 0001-00001234 · hielo
 * para el evento». Un gasto de contado no lleva punto de venta ni número (el
 * motor no los guarda en un `expense`), así que queda escrito ahí.
 */
export function withRemito(remito: string, text: string): string {
  const number = remito.trim().replace(/\s+/g, ' ')
  const rest = text.trim()
  if (number === '') return rest
  const head = /^remito\b/i.test(number) ? number : `Remito ${number}`
  return rest === '' ? head : `${head} · ${rest}`
}

/** Cuánto lugar le queda al detalle con ese número de remito adelante. */
export function detailRoom(remito: string, max: number): number {
  const head = withRemito(remito, '')
  return head === '' ? max : Math.max(0, max - head.length - ' · '.length)
}

// ─── Lo que se carga ─────────────────────────────────────────────────────────

/** «¿En qué?»: un proveedor (con su cuenta), una cuenta suelta o un proveedor nuevo. */
export type ExpenseTarget =
  | { kind: 'party'; partyId: string; accountId: string | null }
  | { kind: 'account'; accountId: string }
  | {
      kind: 'new'
      name: string
      ivaCondition: IvaCondition
      /** Como lo tipeó la persona (el esquema lo normaliza). */
      taxId: string
      accountId: string | null
    }

export type QuickExpenseFormState = {
  amountCents: number | null
  target: ExpenseTarget | null
  treasuryAccountId: string | null
  voucher: QuickVoucher
  vatRateBp: QuickVatRate
  vatAdjustCents: number
  pointOfSale: number | null
  number: number | null
  date: string | null
  detail: string
  /** «N.º de remito» (opcional, solo con «No se factura»): va adelante del detalle. */
  remito?: string
  /** El gasto fijo elegido en «¿En qué?» (`null` si no es uno). */
  recurringExpenseId: string | null
}

/** Lo que manda el formulario sin lo que agrega el envío (`clientRef`, `previewHash`, avisos). */
export type QuickExpenseFormValues = Omit<
  QuickExpenseValues,
  'clientRef' | 'previewHash' | 'warningsAck'
>

/**
 * El estado del formulario → lo que valida el esquema. Si falta algo que el
 * esquema no puede ni empezar a leer (importe, en qué, con qué, fecha), vuelve
 * `missing` con el texto de cada campo y `values = null`.
 */
export function buildQuickExpenseValues(state: QuickExpenseFormState): {
  values: QuickExpenseFormValues | null
  missing: Record<string, string>
} {
  const missing: Record<string, string> = {}
  if (state.amountCents === null || state.amountCents <= 0) {
    missing.amountCents = 'Escribí cuánto gastaste.'
  }
  const target = state.target
  if (target === null) missing.target = 'Elegí en qué gastaste.'
  else if (target.kind !== 'account' && target.accountId === null) {
    missing['target.accountId'] = 'Elegí en qué gastaste.'
  }
  if (target?.kind === 'new' && target.name.trim().length < 2) {
    missing['newParty.name'] = 'Escribí el nombre del proveedor.'
  }
  if (state.treasuryAccountId === null) missing.treasuryAccountId = 'Elegí con qué pagaste.'
  if (state.date === null) missing.date = 'Elegí la fecha.'
  if (
    Object.keys(missing).length > 0 ||
    state.amountCents === null ||
    target === null ||
    state.treasuryAccountId === null ||
    state.date === null
  ) {
    return { values: null, missing }
  }

  const accountId = target.accountId ?? ''
  // Sin factura no hay punto de venta ni número (el del remito va en el detalle); con factura
  // el esquema los exige (lo marca en `number`).
  const numbered = quickVoucherInvoiced(state.voucher)
  const detail = numbered ? state.detail.trim() : withRemito(state.remito ?? '', state.detail)
  const values: QuickExpenseFormValues = {
    amountCents: state.amountCents,
    target:
      target.kind === 'party'
        ? { type: 'party', partyId: target.partyId, accountId }
        : { type: 'account', accountId },
    newParty:
      target.kind === 'new'
        ? {
            name: target.name.trim(),
            kind: 'supplier',
            ivaCondition: target.ivaCondition,
            taxId: target.taxId.trim() === '' ? null : target.taxId.trim(),
            paymentTermDays: 0,
            defaultAccountId: accountId,
          }
        : null,
    treasuryAccountId: state.treasuryAccountId,
    voucher: state.voucher,
    vatRateBp: state.vatRateBp,
    vatAdjustCents: state.voucher === 'a' ? state.vatAdjustCents : 0,
    pointOfSale: numbered ? state.pointOfSale : null,
    number: numbered ? state.number : null,
    date: state.date,
    detail: detail === '' ? null : detail,
    recurringExpenseId: state.recurringExpenseId,
  }
  return { values, missing: {} }
}

// ─── Gastos fijos en «¿En qué?» ──────────────────────────────────────────────

/**
 * El comprobante habitual de un gasto fijo en el selector de «Nuevo gasto».
 * `null`: no es uno de los cuatro (nota de crédito, recibo…) y no se toca.
 * Lo que no se factura (el remito) es «No».
 */
export function quickVoucherFromType(voucherType: string | null | undefined): QuickVoucher | null {
  switch (voucherType) {
    case 'sin_comprobante':
      return 'none'
    case 'tique':
      return 'ticket'
    case 'factura_a':
      return 'a'
    case 'factura_b':
    case 'factura_c':
      return 'bc'
    default:
      return null
  }
}

/**
 * Los gastos fijos de «¿En qué?»: primero los pendientes de este mes; dentro
 * de cada grupo, el próximo a vencer primero y después por nombre.
 */
export function sortRecurringForSheet<
  T extends Pick<SheetRecurring, 'name' | 'nextDueDate' | 'pending'>,
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.pending) - Number(a.pending) ||
      (a.nextDueDate < b.nextDueDate ? -1 : a.nextDueDate > b.nextDueDate ? 1 : 0) ||
      a.name.localeCompare(b.name, 'es'),
  )
}

/** «vence hoy», «vence el 10/10» o «venció el 05/10». */
export function recurringDueText(nextDueDate: string, today: string): string {
  if (nextDueDate === today) return 'vence hoy'
  return nextDueDate < today
    ? `venció el ${formatDayMonth(nextDueDate)}`
    : `vence el ${formatDayMonth(nextDueDate)}`
}

/** La marca chica de un gasto fijo: «Gasto fijo · vence el 10/10» si está pendiente; si no, «Gasto fijo». */
export function recurringNote(
  r: Pick<SheetRecurring, 'pending' | 'nextDueDate'>,
  today: string,
): string {
  return r.pending ? `Gasto fijo · ${recurringDueText(r.nextDueDate, today)}` : 'Gasto fijo'
}

/** Lo que precarga un gasto fijo en «Nuevo gasto» (todo se puede cambiar después). */
export type RecurringPrefill = {
  target: Extract<ExpenseTarget, { kind: 'party' | 'account' }>
  /** `null` = monto variable. */
  amountCents: number | null
  /** `null` = el comprobante no se toca. */
  voucher: QuickVoucher | null
  /** `null` = la alícuota no se toca. */
  vatRateBp: QuickVatRate | null
  /** `null` = la caja no se toca. */
  treasuryAccountId: string | null
}

/**
 * Qué precarga elegir un gasto fijo: su proveedor (si se le puede cargar un
 * gasto) con su cuenta (si es imputable), o la cuenta sola; el comprobante
 * habitual (una factura, solo con proveedor), la alícuota, el monto y la caja
 * si sigue activa. `null` si no queda ni proveedor ni cuenta que sirvan.
 */
export function recurringPrefill(
  r: SheetRecurring,
  usable: {
    payablePartyIds: ReadonlySet<string>
    imputableAccountIds: ReadonlySet<string>
    activeTreasuryIds: ReadonlySet<string>
  },
): RecurringPrefill | null {
  const accountId = usable.imputableAccountIds.has(r.accountId) ? r.accountId : null
  const partyId = r.partyId && usable.payablePartyIds.has(r.partyId) ? r.partyId : null
  let target: RecurringPrefill['target']
  if (partyId) target = { kind: 'party', partyId, accountId }
  else if (accountId) target = { kind: 'account', accountId }
  else return null
  const voucher = quickVoucherFromType(r.voucherType)
  return {
    target,
    amountCents: r.amountCents,
    voucher: voucher !== null && isInvoiceVoucher(voucher) && partyId === null ? null : voucher,
    vatRateBp: isQuickVatRate(r.vatRateBp) ? r.vatRateBp : null,
    treasuryAccountId:
      r.treasuryAccountId && usable.activeTreasuryIds.has(r.treasuryAccountId)
        ? r.treasuryAccountId
        : null,
  }
}

/**
 * El monto al elegir un gasto fijo: el suyo si el campo está vacío o todavía
 * tiene el que puso otro gasto fijo (con monto variable, queda vacío). Lo que
 * tipeó la persona no se pisa.
 */
export function amountAfterRecurring(input: {
  current: number | null
  prefilled: number | null
  recurring: number | null
}): number | null {
  const untouched =
    input.current === null || (input.prefilled !== null && input.current === input.prefilled)
  return untouched ? input.recurring : input.current
}
