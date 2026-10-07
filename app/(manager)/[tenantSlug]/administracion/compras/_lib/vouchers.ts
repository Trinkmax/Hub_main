/**
 * Los tipos de comprobante de Compras en el orden en que se eligen, y qué
 * documento genera cada uno (factura → compra, ND → nota de débito, NC → nota
 * de crédito). Puro: lo usan la factura de proveedor, los gastos fijos y la
 * ficha. Lo prueba `administracion-compras.test.ts`.
 */

import type { IvaCondition, VoucherType } from '@/lib/accounting/types'
import { VOUCHER_CATALOG, voucherConditionCheck } from '@/lib/accounting/voucher-types'

/** Comprobantes de compra «comunes», en el orden del selector. */
export const PURCHASE_VOUCHER_ORDER = [
  'factura_a',
  'factura_b',
  'factura_c',
  'factura_m',
  'tique_factura_a',
  'tique_factura_b',
  'tique_factura_c',
  'tique',
  'recibo_a',
  'recibo_b',
  'recibo_c',
  'otro_comprobante',
  'sin_comprobante',
] as const satisfies readonly VoucherType[]

export const DEBIT_NOTE_ORDER = [
  'nota_debito_a',
  'nota_debito_b',
  'nota_debito_c',
  'nota_debito_m',
] as const satisfies readonly VoucherType[]

export const CREDIT_NOTE_ORDER = [
  'nota_credito_a',
  'nota_credito_b',
  'nota_credito_c',
  'nota_credito_m',
] as const satisfies readonly VoucherType[]

/** Para «Comprobante habitual» (ficha y gastos fijos). */
export const PURCHASE_VOUCHER_OPTIONS: ReadonlyArray<{ value: VoucherType; label: string }> =
  PURCHASE_VOUCHER_ORDER.map((type) => ({ value: type, label: VOUCHER_CATALOG[type].label }))

export type PurchaseFamily = 'factura' | 'nd' | 'nc'

export type PurchaseDocKind = 'purchase' | 'purchase_debit_note' | 'purchase_credit_note'

/** El documento que genera un tipo de comprobante. */
export function docKindOf(type: VoucherType): PurchaseDocKind {
  const info = VOUCHER_CATALOG[type]
  if (info.isCreditNote) return 'purchase_credit_note'
  if (info.isDebitNote) return 'purchase_debit_note'
  return 'purchase'
}

export function familyOf(type: VoucherType): PurchaseFamily {
  const kind = docKindOf(type)
  return kind === 'purchase_credit_note' ? 'nc' : kind === 'purchase_debit_note' ? 'nd' : 'factura'
}

/**
 * Los tipos que se ofrecen para una familia y la condición del proveedor:
 * solo los permitidos o «con aviso» por la matriz de E.3 (los rechazados ni
 * aparecen). La DDJJ solo para organismos. Sin proveedor todavía, los de un
 * responsable inscripto (lo más común).
 */
export function voucherOptionsFor(input: {
  family: PurchaseFamily
  condition: IvaCondition | null
  isTaxAgency?: boolean
}): VoucherType[] {
  const condition = input.condition ?? 'responsable_inscripto'
  const base: readonly VoucherType[] =
    input.family === 'nc'
      ? CREDIT_NOTE_ORDER
      : input.family === 'nd'
        ? DEBIT_NOTE_ORDER
        : input.isTaxAgency
          ? [...PURCHASE_VOUCHER_ORDER, 'ddjj_impuesto']
          : PURCHASE_VOUCHER_ORDER
  return base.filter((type) => voucherConditionCheck(type, condition).status !== 'rejected')
}

/**
 * El tipo que se propone (H.6): el último con ese proveedor si se puede usar;
 * si no, por su condición (RI: A; monotributo: C; exento: B); si nada sirve,
 * el primero de la lista.
 */
export function defaultVoucherFor(input: {
  family: PurchaseFamily
  options: readonly VoucherType[]
  remembered: string | null
  condition: IvaCondition | null
}): VoucherType | null {
  const remembered = input.remembered as VoucherType | null
  if (remembered && input.options.includes(remembered)) return remembered
  const letter = input.condition === 'monotributo' ? 'C' : input.condition === 'exento' ? 'B' : 'A'
  const byLetter = input.options.find((t) => {
    const info = VOUCHER_CATALOG[t]
    if (info.letter !== letter) return false
    if (input.family === 'nc') return info.isCreditNote
    if (input.family === 'nd') return info.isDebitNote
    return info.family === 'factura'
  })
  return byLetter ?? input.options[0] ?? null
}
