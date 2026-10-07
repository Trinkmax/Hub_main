/**
 * La factura de proveedor (H.6), lo puro: del estado del formulario a lo que
 * valida `purchaseSchema`, con el mapa de cada ruta del esquema
 * (`lines.2.amountCents`) al campo de pantalla que la muestra, y las cuentas
 * del total. Lo prueba `administracion-compras.test.ts`.
 */

import { vatFromNet } from '@/lib/accounting/iva'
import type { PurchaseValues } from '@/lib/accounting/server/document-types'
import type { IvaCondition, VatRateBp, VoucherType } from '@/lib/accounting/types'
import { VOUCHER_CATALOG } from '@/lib/accounting/voucher-types'
import { docKindOf } from './vouchers'

/** Las alícuotas del detalle, en el orden en que se muestran (las tres primeras siempre). */
export const DETAIL_RATES = [2100, 1050, 2700, 500, 250, 0] as const satisfies readonly VatRateBp[]
export const MAIN_DETAIL_RATES = [2100, 1050, 2700] as const satisfies readonly VatRateBp[]

export type PurchaseParty =
  | { kind: 'existing'; id: string }
  | {
      kind: 'new'
      name: string
      ivaCondition: IvaCondition
      /** Como lo tipeó la persona (el esquema lo normaliza). */
      taxId: string
      paymentTermDays: number
    }

export type PurchaseFormState = {
  party: PurchaseParty | null
  voucherType: VoucherType | null
  pointOfSale: number | null
  number: number | null
  issueDate: string | null
  dueDate: string | null
  amountMode: 'total' | 'detail'
  /** Modo «Total»: el total de la factura (con IVA, percepciones y otros). */
  totalCents: number | null
  vatRateBp: VatRateBp
  vatAdjustCents: number
  /** La imputación («en qué»): una sola cuenta para toda la factura. */
  accountId: string | null
  /** Modo «Detalle»: el neto de cada alícuota. */
  nets: Readonly<Partial<Record<VatRateBp, number | null>>>
  /** Ajuste de ±1¢ del IVA de cada alícuota. */
  vatAdjust: Readonly<Partial<Record<VatRateBp, number>>>
  /** Modo «Detalle» en B, C y tiques: el importe (no discriminan IVA). */
  grossCents: number | null
  nonTaxedCents: number | null
  exemptCents: number | null
  internalTaxCents: number | null
  percIvaCents: number | null
  percIibbCents: number | null
  iibbJurisdictionCode: number
  percGananciasCents: number | null
  otherTaxesCents: number | null
  /** La cuenta de «Otros tributos» (la de sistema). */
  otherTaxesAccountId: string | null
  /** «Total según la factura» (opcional). */
  controlTotalCents: number | null
  relatedDocumentId: string | null
  recurringExpenseId: string | null
  payNow: {
    treasuryAccountId: string | null
    /** `null` = el total. */
    amountCents: number | null
    date: string | null
    reference: string
  } | null
  notes: string
}

export type PurchaseFormValues = Omit<PurchaseValues, 'clientRef' | 'previewHash' | 'warningsAck'>

function positive(cents: number | null | undefined): cents is number {
  return typeof cents === 'number' && Number.isSafeInteger(cents) && cents > 0
}

/** ¿El tipo discrimina IVA para quien compra? (A, M, tique factura A; «otro» también). */
export function discriminatesVat(type: VoucherType | null): boolean {
  return type !== null && VOUCHER_CATALOG[type].purchaseVat !== 'no'
}

/** El IVA de una alícuota del detalle (calculado del neto + el ajuste de ±1¢). */
export function detailVat(
  netCents: number | null | undefined,
  rate: VatRateBp,
  adjust = 0,
): number {
  if (!positive(netCents) || rate === 0) return 0
  return Math.max(0, vatFromNet(netCents, rate) + adjust)
}

/** Las cuentas del detalle (lo que muestra la columna de importes y su total). */
export function detailTotals(state: PurchaseFormState): {
  netCents: number
  vatCents: number
  otherCents: number
  totalCents: number
} {
  const vat = discriminatesVat(state.voucherType)
  let netCents = 0
  let vatCents = 0
  if (vat) {
    for (const rate of DETAIL_RATES) {
      const net = state.nets[rate]
      if (!positive(net)) continue
      netCents += net
      vatCents += detailVat(net, rate, state.vatAdjust[rate] ?? 0)
    }
  } else if (positive(state.grossCents)) {
    netCents += state.grossCents
  }
  const otherCents = [
    state.nonTaxedCents,
    state.exemptCents,
    state.internalTaxCents,
    state.percIvaCents,
    state.percIibbCents,
    state.percGananciasCents,
    state.otherTaxesCents,
  ].reduce<number>((sum, c) => sum + (positive(c) ? c : 0), 0)
  return { netCents, vatCents, otherCents, totalCents: netCents + vatCents + otherCents }
}

/** Percepciones y otros tributos (los dos modos los aceptan). */
function extras(state: PurchaseFormState, fieldOf: Record<string, string>) {
  const perceptions: NonNullable<PurchaseFormValues['perceptions']> = []
  const add = (
    taxKind: 'iva' | 'iibb' | 'ganancias',
    cents: number | null,
    field: string,
    jurisdictionCode: number | null,
  ) => {
    if (!positive(cents)) return
    fieldOf[`perceptions.${perceptions.length}.amountCents`] = field
    fieldOf[`perceptions.${perceptions.length}.jurisdictionCode`] = 'percIibbJurisdiction'
    perceptions.push({ taxKind, amountCents: cents, jurisdictionCode })
  }
  add('iva', state.percIvaCents, 'percIva', null)
  add('iibb', state.percIibbCents, 'percIibb', state.iibbJurisdictionCode)
  add('ganancias', state.percGananciasCents, 'percGanancias', null)
  const otherTaxes: NonNullable<PurchaseFormValues['otherTaxes']> = []
  if (positive(state.otherTaxesCents) && state.otherTaxesAccountId) {
    fieldOf['otherTaxes.0.amountCents'] = 'otherTaxes'
    otherTaxes.push({ accountId: state.otherTaxesAccountId, amountCents: state.otherTaxesCents })
  }
  return { perceptions, otherTaxes }
}

/**
 * El estado → lo que valida el esquema. Si falta algo que el esquema no puede
 * ni empezar a leer (proveedor, tipo, fecha, importes, en qué), vuelve
 * `missing` con el texto de cada campo y `values = null`. `fieldOf` traduce
 * las rutas del esquema y del motor a los campos de la pantalla.
 */
export function buildPurchaseValues(state: PurchaseFormState): {
  values: PurchaseFormValues | null
  missing: Record<string, string>
  fieldOf: Record<string, string>
} {
  const missing: Record<string, string> = {}
  const fieldOf: Record<string, string> = {
    partyId: 'party',
    newParty: 'party',
    'newParty.name': 'newPartyName',
    'newParty.taxId': 'newPartyTaxId',
    voucherType: 'voucherType',
    docKind: 'voucherType',
    pointOfSale: 'number',
    number: 'number',
    issueDate: 'issueDate',
    accountingDate: 'issueDate',
    dueDate: 'dueDate',
    'total.totalCents': 'total',
    'total.vatRateBp': 'vatRate',
    'total.vatAdjustCents': 'total',
    'total.accountId': 'account',
    lines: 'detail',
    vat: 'detail',
    controlTotalCents: 'controlTotal',
    relatedDocumentId: 'related',
    'payNow.treasuryAccountId': 'payTreasury',
    'payNow.amountCents': 'payAmount',
    'payNow.date': 'payDate',
    'payNow.reference': 'payReference',
    payNow: 'payTreasury',
    notes: 'notes',
  }

  const party = state.party
  if (party === null) missing.party = 'Elegí el proveedor.'
  else if (party.kind === 'new' && party.name.trim().length < 2) {
    missing.newPartyName = 'Escribí el nombre del proveedor.'
  }
  if (state.voucherType === null) missing.voucherType = 'Elegí el tipo de comprobante.'
  if (state.issueDate === null) missing.issueDate = 'Elegí la fecha de la factura.'
  if (state.accountId === null) missing.account = 'Elegí en qué es la compra.'

  const type = state.voucherType
  const vat = discriminatesVat(type)
  const lines: NonNullable<PurchaseFormValues['lines']> = []
  const vatOverrides: NonNullable<PurchaseFormValues['vat']> = []
  const { perceptions, otherTaxes } = extras(state, fieldOf)

  if (state.amountMode === 'total') {
    if (!positive(state.totalCents)) missing.total = 'Escribí el total de la factura.'
  } else {
    const accountId = state.accountId ?? ''
    const pushLine = (
      role: 'net' | 'gross' | 'non_taxed' | 'exempt' | 'internal_tax',
      cents: number | null | undefined,
      field: string,
      vatRateBp: VatRateBp | null,
    ) => {
      if (!positive(cents)) return
      fieldOf[`lines.${lines.length}.amountCents`] = field
      fieldOf[`lines.${lines.length}.accountId`] = 'account'
      fieldOf[`lines.${lines.length}.vatRateBp`] = field
      lines.push({ role, accountId, amountCents: cents, vatRateBp })
    }
    if (vat) {
      for (const rate of DETAIL_RATES) {
        pushLine('net', state.nets[rate], `net-${rate}`, rate)
        const adjust = state.vatAdjust[rate] ?? 0
        if (positive(state.nets[rate]) && rate !== 0 && adjust !== 0) {
          fieldOf[`vat.${vatOverrides.length}.adjustCents`] = `net-${rate}`
          vatOverrides.push({ vatRateBp: rate, adjustCents: adjust, givenCents: null })
        }
      }
    } else {
      pushLine('gross', state.grossCents, 'gross', null)
    }
    pushLine('non_taxed', state.nonTaxedCents, 'nonTaxed', null)
    pushLine('exempt', state.exemptCents, 'exempt', null)
    pushLine('internal_tax', state.internalTaxCents, 'internalTax', null)
    if (lines.length === 0 && perceptions.length === 0 && otherTaxes.length === 0) {
      missing.detail = vat ? 'Cargá el neto de al menos una alícuota.' : 'Cargá el importe.'
    }
  }

  if (state.payNow) {
    if (state.payNow.treasuryAccountId === null) missing.payTreasury = 'Elegí con qué pagaste.'
  }

  if (Object.keys(missing).length > 0 || party === null || type === null || !state.issueDate) {
    return { values: null, missing, fieldOf }
  }

  const docKind = docKindOf(type)
  const numbered = VOUCHER_CATALOG[type].numbered
  const values: PurchaseFormValues = {
    docKind,
    partyId: party.kind === 'existing' ? party.id : null,
    newParty:
      party.kind === 'new'
        ? {
            name: party.name.trim(),
            kind: 'supplier',
            ivaCondition: party.ivaCondition,
            taxId: party.taxId.trim() === '' ? null : party.taxId.trim(),
            paymentTermDays: party.paymentTermDays,
            defaultAccountId: state.accountId,
          }
        : null,
    voucherType: type,
    pointOfSale: numbered ? state.pointOfSale : null,
    number: numbered ? state.number : null,
    issueDate: state.issueDate,
    accountingDate: null,
    dueDate: docKind === 'purchase_credit_note' ? null : state.dueDate,
    amountMode: state.amountMode,
    total:
      state.amountMode === 'total' && positive(state.totalCents)
        ? {
            totalCents: state.totalCents,
            vatRateBp: vat ? state.vatRateBp : null,
            accountId: state.accountId ?? '',
            vatAdjustCents: vat && state.vatRateBp !== 0 ? state.vatAdjustCents : 0,
          }
        : null,
    lines: state.amountMode === 'detail' ? lines : [],
    vat: state.amountMode === 'detail' ? vatOverrides : [],
    perceptions,
    otherTaxes,
    controlTotalCents:
      state.amountMode === 'detail' && positive(state.controlTotalCents)
        ? state.controlTotalCents
        : null,
    controlAccountId: null,
    relatedDocumentId: docKind === 'purchase_credit_note' ? state.relatedDocumentId : null,
    settlesCommissions: false,
    recurringExpenseId: docKind === 'purchase' ? state.recurringExpenseId : null,
    payNow:
      state.payNow && docKind !== 'purchase_credit_note' && state.payNow.treasuryAccountId
        ? {
            treasuryAccountId: state.payNow.treasuryAccountId,
            amountCents: positive(state.payNow.amountCents) ? state.payNow.amountCents : null,
            date: state.payNow.date,
            reference: state.payNow.reference.trim() === '' ? null : state.payNow.reference.trim(),
          }
        : null,
    notes: state.notes.trim() === '' ? null : state.notes.trim(),
  }
  return { values, missing: {}, fieldOf }
}

/** El total que se va a guardar (el del modo «Total», o la suma del detalle). */
export function purchaseTotal(state: PurchaseFormState): number | null {
  if (state.amountMode === 'total') return positive(state.totalCents) ? state.totalCents : null
  const { totalCents } = detailTotals(state)
  return totalCents > 0 ? totalCents : null
}
