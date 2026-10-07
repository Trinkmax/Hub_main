/**
 * Catálogo de comprobantes y matriz de condición frente al IVA (Sprint 1, E.3).
 *
 * - Etiqueta, código AFIP, letra, si discrimina IVA, si va a un libro IVA, en
 *   qué tipos de documento se permite (espejo del CHECK `adoc_voucher_kind`).
 * - Matriz de compras por condición del partícipe: permitido, con aviso
 *   (`voucher_condition`, más `voucher_m` en las M) o rechazado
 *   (`invalid_voucher_for_condition`).
 * - Crédito fiscal computable = el tipo discrimina IVA **y** el partícipe es
 *   responsable inscripto **y** la SAS es responsable inscripta.
 * - Moneda «PES» y cambio 1, y tipos de documento AFIP, para el TXT de la
 *   RG 4597 (fuera del sprint, pero los datos ya quedan guardados).
 *
 * Los códigos AFIP de la liquidación de tarjeta o plataforma y del resumen
 * bancario están «a confirmar» con la contadora (J.1, pregunta 13): quedan en
 * `null` y se completan acá; los exportes los toman de este archivo cuando la
 * fila guardada tiene `null`.
 */

import { formatVoucherNumber } from '@/lib/fiscal'
import type {
  AfipDocType,
  DocumentKind,
  FiscalVoucherType,
  IvaCondition,
  SasIvaCondition,
  TaxIdType,
  VoucherType,
} from './types'
import { VOUCHER_TYPE_KEYS } from './types'

// Los ids de alícuota de AFIP viven con la matemática del IVA (E.4); E.1 los
// lista también en este catálogo, así que se pueden importar de los dos lados.
export { AFIP_ALIQUOT_ID } from './iva'

export type VoucherLetter = 'A' | 'B' | 'C' | 'M'

export type VoucherFamily =
  | 'factura'
  | 'nota_debito'
  | 'nota_credito'
  | 'recibo'
  | 'tique_factura'
  | 'tique'
  | 'liquidacion'
  | 'resumen_bancario'
  | 'otro'
  | 'ddjj'
  | 'sin_comprobante'

export type VoucherInfo = {
  type: VoucherType
  /** Código de comprobante AFIP; `null` si no tiene o está a confirmar. */
  afipCode: number | null
  label: string
  /** Para listas angostas: «FA», «NCB», «Tique». */
  shortLabel: string
  letter: VoucherLetter | null
  family: VoucherFamily
  isCreditNote: boolean
  isDebitNote: boolean
  /** Se puede cargar como compra (o NC/ND de compra) de un proveedor. */
  purchases: boolean
  /** Se puede emitir como venta (factura suelta o fila del cierre del día). */
  sales: boolean
  /**
   * Discrimina IVA para quien lo RECIBE (compras): A, M, tique factura A,
   * liquidación y resumen bancario sí; B, C y tiques no; «otro» es opcional.
   * En ventas la SAS (RI) siempre calcula neto e IVA de lo que factura.
   */
  purchaseVat: 'yes' | 'no' | 'optional'
  /** Entra a un libro IVA (DDJJ y «sin comprobante», no). */
  ivaBook: boolean
  /** Lleva punto de venta y número (adoc_numbered_vouchers). */
  numbered: boolean
}

function v(
  type: VoucherType,
  afipCode: number | null,
  label: string,
  shortLabel: string,
  rest: Omit<VoucherInfo, 'type' | 'afipCode' | 'label' | 'shortLabel'>,
): VoucherInfo {
  return { type, afipCode, label, shortLabel, ...rest }
}

const base = {
  isCreditNote: false,
  isDebitNote: false,
  ivaBook: true,
  numbered: true,
} as const

export const VOUCHER_CATALOG: Readonly<Record<VoucherType, VoucherInfo>> = {
  factura_a: v('factura_a', 1, 'Factura A', 'FA', {
    ...base,
    letter: 'A',
    family: 'factura',
    purchases: true,
    sales: true,
    purchaseVat: 'yes',
  }),
  nota_debito_a: v('nota_debito_a', 2, 'Nota de débito A', 'NDA', {
    ...base,
    isDebitNote: true,
    letter: 'A',
    family: 'nota_debito',
    purchases: true,
    sales: true,
    purchaseVat: 'yes',
  }),
  nota_credito_a: v('nota_credito_a', 3, 'Nota de crédito A', 'NCA', {
    ...base,
    isCreditNote: true,
    letter: 'A',
    family: 'nota_credito',
    purchases: true,
    sales: true,
    purchaseVat: 'yes',
  }),
  recibo_a: v('recibo_a', 4, 'Recibo A', 'RA', {
    ...base,
    letter: 'A',
    family: 'recibo',
    purchases: true,
    sales: false,
    purchaseVat: 'yes',
  }),
  factura_b: v('factura_b', 6, 'Factura B', 'FB', {
    ...base,
    letter: 'B',
    family: 'factura',
    purchases: true,
    sales: true,
    purchaseVat: 'no',
  }),
  nota_debito_b: v('nota_debito_b', 7, 'Nota de débito B', 'NDB', {
    ...base,
    isDebitNote: true,
    letter: 'B',
    family: 'nota_debito',
    purchases: true,
    sales: true,
    purchaseVat: 'no',
  }),
  nota_credito_b: v('nota_credito_b', 8, 'Nota de crédito B', 'NCB', {
    ...base,
    isCreditNote: true,
    letter: 'B',
    family: 'nota_credito',
    purchases: true,
    sales: true,
    purchaseVat: 'no',
  }),
  recibo_b: v('recibo_b', 9, 'Recibo B', 'RB', {
    ...base,
    letter: 'B',
    family: 'recibo',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
  }),
  factura_c: v('factura_c', 11, 'Factura C', 'FC', {
    ...base,
    letter: 'C',
    family: 'factura',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
  }),
  nota_debito_c: v('nota_debito_c', 12, 'Nota de débito C', 'NDC', {
    ...base,
    isDebitNote: true,
    letter: 'C',
    family: 'nota_debito',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
  }),
  nota_credito_c: v('nota_credito_c', 13, 'Nota de crédito C', 'NCC', {
    ...base,
    isCreditNote: true,
    letter: 'C',
    family: 'nota_credito',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
  }),
  recibo_c: v('recibo_c', 15, 'Recibo C', 'RC', {
    ...base,
    letter: 'C',
    family: 'recibo',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
  }),
  factura_m: v('factura_m', 51, 'Factura M', 'FM', {
    ...base,
    letter: 'M',
    family: 'factura',
    purchases: true,
    sales: false,
    purchaseVat: 'yes',
  }),
  nota_debito_m: v('nota_debito_m', 52, 'Nota de débito M', 'NDM', {
    ...base,
    isDebitNote: true,
    letter: 'M',
    family: 'nota_debito',
    purchases: true,
    sales: false,
    purchaseVat: 'yes',
  }),
  nota_credito_m: v('nota_credito_m', 53, 'Nota de crédito M', 'NCM', {
    ...base,
    isCreditNote: true,
    letter: 'M',
    family: 'nota_credito',
    purchases: true,
    sales: false,
    purchaseVat: 'yes',
  }),
  tique_factura_a: v('tique_factura_a', 81, 'Tique factura A', 'TFA', {
    ...base,
    letter: 'A',
    family: 'tique_factura',
    purchases: true,
    sales: true,
    purchaseVat: 'yes',
  }),
  tique_factura_b: v('tique_factura_b', 82, 'Tique factura B', 'TFB', {
    ...base,
    letter: 'B',
    family: 'tique_factura',
    purchases: true,
    sales: true,
    purchaseVat: 'no',
  }),
  tique_factura_c: v('tique_factura_c', 111, 'Tique factura C', 'TFC', {
    ...base,
    letter: 'C',
    family: 'tique_factura',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
  }),
  tique: v('tique', 83, 'Tique', 'Tique', {
    ...base,
    letter: null,
    family: 'tique',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
  }),
  liquidacion: v('liquidacion', null, 'Liquidación de tarjeta o plataforma', 'Liq.', {
    ...base,
    letter: null,
    family: 'liquidacion',
    purchases: false,
    sales: false,
    purchaseVat: 'yes',
  }),
  resumen_bancario: v('resumen_bancario', null, 'Resumen bancario', 'Res. banc.', {
    ...base,
    letter: null,
    family: 'resumen_bancario',
    purchases: false,
    sales: false,
    purchaseVat: 'yes',
  }),
  otro_comprobante: v('otro_comprobante', 99, 'Otro comprobante', 'Otro', {
    ...base,
    letter: null,
    family: 'otro',
    purchases: true,
    sales: false,
    purchaseVat: 'optional',
  }),
  ddjj_impuesto: v('ddjj_impuesto', null, 'DDJJ o boleta de impuesto', 'DDJJ', {
    ...base,
    letter: null,
    family: 'ddjj',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
    ivaBook: false,
    numbered: false,
  }),
  sin_comprobante: v('sin_comprobante', null, 'Sin comprobante', 'Sin comp.', {
    ...base,
    letter: null,
    family: 'sin_comprobante',
    purchases: true,
    sales: false,
    purchaseVat: 'no',
    ivaBook: false,
    numbered: false,
  }),
}

export function isVoucherType(value: unknown): value is VoucherType {
  return typeof value === 'string' && (VOUCHER_TYPE_KEYS as readonly string[]).includes(value)
}

/** «Factura A». Para un valor desconocido devuelve el texto tal cual (no rompe un listado viejo). */
export function voucherLabel(type: string): string {
  return isVoucherType(type) ? VOUCHER_CATALOG[type].label : type
}

/** «Factura A 0003-00001290»; sin número, solo la etiqueta. */
export function voucherDisplay(
  type: VoucherType,
  pointOfSale: number | null,
  number: number | null,
): string {
  const label = VOUCHER_CATALOG[type].label
  if (pointOfSale === null || number === null) return label
  return `${label} ${formatVoucherNumber(pointOfSale, number)}`
}

/** El código AFIP del tipo (`null` si no tiene o está a confirmar). */
export function afipVoucherCode(type: VoucherType): number | null {
  return VOUCHER_CATALOG[type].afipCode
}

/** ¿Puede ir a un libro IVA? (`afv_voucher_type`). */
export function isFiscalVoucherType(type: VoucherType): type is FiscalVoucherType {
  return VOUCHER_CATALOG[type].ivaBook
}

// ─── Tipos permitidos por tipo de documento (espejo de adoc_voucher_kind) ────

const PURCHASE_VOUCHERS: readonly VoucherType[] = VOUCHER_TYPE_KEYS.filter(
  (t) => VOUCHER_CATALOG[t].purchases && !VOUCHER_CATALOG[t].isCreditNote,
)
const PURCHASE_CREDIT_NOTES: readonly VoucherType[] = VOUCHER_TYPE_KEYS.filter(
  (t) => VOUCHER_CATALOG[t].isCreditNote,
)
const SALES_INVOICE_VOUCHERS: readonly VoucherType[] = [
  'factura_a',
  'factura_b',
  'nota_debito_a',
  'nota_debito_b',
  'tique_factura_a',
  'tique_factura_b',
]
const SALES_CREDIT_NOTES: readonly VoucherType[] = ['nota_credito_a', 'nota_credito_b']

/** Qué tipos de comprobante admite cada documento; `allowsNull` = puede ir sin tipo. */
export function voucherTypesForKind(kind: DocumentKind): {
  types: readonly VoucherType[]
  allowsNull: boolean
} {
  switch (kind) {
    case 'purchase':
    case 'purchase_debit_note':
      return { types: PURCHASE_VOUCHERS, allowsNull: false }
    case 'purchase_credit_note':
      return { types: PURCHASE_CREDIT_NOTES, allowsNull: false }
    case 'expense':
      return { types: ['sin_comprobante', 'tique'], allowsNull: false }
    case 'sales_invoice':
    case 'sales_debit_note':
      return { types: SALES_INVOICE_VOUCHERS, allowsNull: false }
    case 'sales_credit_note':
      return { types: SALES_CREDIT_NOTES, allowsNull: false }
    case 'collection':
      return {
        types: ['liquidacion', 'factura_a', 'factura_b', 'otro_comprobante'],
        allowsNull: true,
      }
    case 'bank_expense':
      return { types: ['resumen_bancario', 'factura_a', 'otro_comprobante'], allowsNull: true }
    default:
      return { types: [], allowsNull: true }
  }
}

/** ¿El tipo de comprobante corresponde al documento? (si no, `invalid_voucher_for_kind`). */
export function isVoucherAllowedForKind(kind: DocumentKind, type: VoucherType | null): boolean {
  const { types, allowsNull } = voucherTypesForKind(kind)
  return type === null ? allowsNull : types.includes(type)
}

/**
 * Tipos que van en las filas facturadas del cierre del día (E.5.6): A y B, sus
 * NC y ND, y los tiques factura A/B.
 */
export const SALES_CLOSE_VOUCHERS: readonly FiscalVoucherType[] = [
  'factura_a',
  'factura_b',
  'nota_credito_a',
  'nota_credito_b',
  'nota_debito_a',
  'nota_debito_b',
  'tique_factura_a',
  'tique_factura_b',
]

// ─── Matriz de compras por condición del partícipe (E.3) ─────────────────────

export type VoucherConditionResult = {
  status: 'allowed' | 'warn' | 'rejected'
  /** Avisos que hay que aceptar para guardar (`voucher_condition`, `voucher_m`). */
  warnings: Array<'voucher_condition' | 'voucher_m'>
}

const ALLOWED: VoucherConditionResult = { status: 'allowed', warnings: [] }
const REJECTED: VoucherConditionResult = { status: 'rejected', warnings: [] }
const WARN_CONDITION: VoucherConditionResult = {
  status: 'warn',
  warnings: ['voucher_condition'],
}
const WARN_M: VoucherConditionResult = { status: 'warn', warnings: ['voucher_m'] }

/**
 * Matriz de compras de E.3. Las letras (A, B, C, M, con sus tiques factura y
 * recibos) y los tiques y «sin comprobante» siguen la tabla. Los tipos
 * «neutros» (otro comprobante, liquidación, resumen bancario, DDJJ) no dependen
 * de la condición: la DDJJ tiene su propia regla (`ddjj_requires_tax_agency`,
 * en validate.ts) y el IVA de un «otro» solo computa si el partícipe es RI.
 */
export function voucherConditionCheck(
  type: VoucherType,
  condition: IvaCondition,
): VoucherConditionResult {
  const info = VOUCHER_CATALOG[type]
  const letter = info.letter

  switch (condition) {
    case 'responsable_inscripto':
      if (letter === 'C') return REJECTED
      if (letter === 'M') return WARN_M
      if (letter === 'B' || type === 'tique' || type === 'sin_comprobante') return WARN_CONDITION
      return ALLOWED
    case 'monotributo':
      if (letter === 'A' || letter === 'B' || letter === 'M') return REJECTED
      return ALLOWED
    case 'exento':
      if (letter === 'A' || letter === 'M') return REJECTED
      return ALLOWED
    case 'consumidor_final':
    case 'no_alcanzado':
    case 'sin_datos':
      if (letter !== null) return REJECTED
      return ALLOWED
  }
}

/**
 * Crédito fiscal computable: el tipo discrimina IVA (para quien lo recibe), el
 * partícipe es responsable inscripto y la SAS también. En cualquier otro caso
 * el IVA, si hay, va al costo. Un «otro comprobante» con IVA discriminado
 * computa si se cumplen las otras dos condiciones.
 */
export function isVatComputable(
  type: VoucherType,
  partyCondition: IvaCondition,
  sasCondition: SasIvaCondition,
): boolean {
  const vat = VOUCHER_CATALOG[type].purchaseVat
  return (
    vat !== 'no' &&
    partyCondition === 'responsable_inscripto' &&
    sasCondition === 'responsable_inscripto'
  )
}

/** ¿El tipo admite renglones `net` + `vat` en una compra? (si no: `vat_not_allowed_for_voucher`). */
export function purchaseAllowsVatLines(type: VoucherType): boolean {
  return VOUCHER_CATALOG[type].purchaseVat !== 'no'
}

// ─── Datos para el Libro IVA Digital (RG 4597) ───────────────────────────────

/** Moneda de todos los comprobantes del sprint: pesos. */
export const AFIP_CURRENCY = 'PES'
/** Tipo de cambio de los comprobantes en pesos. */
export const AFIP_EXCHANGE_RATE = 1

/** Ventas B a consumidor final sin identificar: documento 99, número «0». */
export const FINAL_CONSUMER = {
  name: 'Consumidor final',
  docType: 99,
  docNumber: '0',
  ivaCondition: 'consumidor_final',
} as const satisfies {
  name: string
  docType: AfipDocType
  docNumber: string
  ivaCondition: IvaCondition
}

/** Tipo de documento AFIP según el tipo de identificación del partícipe. */
export function afipDocType(taxIdType: TaxIdType): AfipDocType {
  switch (taxIdType) {
    case 'cuit':
      return 80
    case 'cuil':
      return 86
    case 'dni':
      return 96
    case 'none':
      return 99
  }
}
