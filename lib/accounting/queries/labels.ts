/**
 * Textos y links de las lecturas de Administración que también usan los
 * componentes de cliente (sin `server-only`, sin I/O): nombres de tipos de
 * comprobante y de asiento, estados, títulos de comprobantes, los libros que
 * se exportan (F.15) y el link de descarga.
 *
 * Glosario de pantalla (H.21): «comprobante», «pago», «cobro», «caja o
 * cuenta», «Mover plata»; nunca «documento», «movimiento» ni «tesorería».
 */

import type { DocumentKind, EntryKind, TaxKind } from '@/lib/accounting/types'
import { isVoucherType, voucherDisplay, voucherLabel } from '@/lib/accounting/voucher-types'

// ─── Comprobantes y asientos ─────────────────────────────────────────────────

/** Igual que `KIND_LABELS` del motor y `acc_doc_label` de la base: el mismo nombre en todos lados. */
export const DOCUMENT_KIND_LABELS: Readonly<Record<DocumentKind, string>> = {
  opening: 'Asiento de apertura',
  purchase: 'Compra',
  purchase_credit_note: 'Nota de crédito de proveedor',
  purchase_debit_note: 'Nota de débito de proveedor',
  expense: 'Gasto',
  payment: 'Pago',
  sales_close: 'Cierre del día',
  sales_invoice: 'Factura de venta',
  sales_credit_note: 'Nota de crédito de venta',
  sales_debit_note: 'Nota de débito de venta',
  collection: 'Cobro',
  transfer: 'Movimiento entre cuentas',
  bank_expense: 'Gasto bancario',
  cash_movement: 'Movimiento de caja',
  treasury_adjustment: 'Ajuste de saldo',
  manual: 'Asiento manual',
  reversal: 'Anulación',
  iva_settlement: 'Liquidación de IVA',
  fy_result: 'Refundición de resultados',
  fy_closing: 'Cierre patrimonial',
  fy_opening: 'Apertura del ejercicio',
}

export function documentKindLabel(kind: string): string {
  return kind in DOCUMENT_KIND_LABELS ? DOCUMENT_KIND_LABELS[kind as DocumentKind] : kind
}

export const ENTRY_KIND_LABELS: Readonly<Record<EntryKind, string>> = {
  opening: 'Apertura',
  standard: 'Común',
  manual: 'Manual',
  adjustment: 'Ajuste',
  payroll: 'Sueldos',
  reversal: 'Anulación',
  iva_settlement: 'Liquidación de IVA',
  fy_adjustment: 'Ajuste de cierre',
  fy_result: 'Refundición',
  fy_closing: 'Cierre del ejercicio',
  fy_opening: 'Apertura del ejercicio',
}

export function entryKindLabel(kind: string): string {
  return kind in ENTRY_KIND_LABELS ? ENTRY_KIND_LABELS[kind as EntryKind] : kind
}

/** Tipos de comprobante que van a «Compras y proveedores › Comprobantes». */
export const PURCHASE_DOCUMENT_KINDS = [
  'purchase',
  'purchase_credit_note',
  'purchase_debit_note',
  'expense',
] as const satisfies readonly DocumentKind[]

/** «Ventas y clientes › Facturas» (ventas sueltas). */
export const SALES_INVOICE_KINDS = [
  'sales_invoice',
  'sales_credit_note',
  'sales_debit_note',
] as const satisfies readonly DocumentKind[]

/** Comprobantes que dejan una deuda o un crédito con un proveedor o cliente (tienen «Pendiente»). */
export const OPEN_ITEM_DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  'purchase',
  'purchase_debit_note',
  'sales_invoice',
  'sales_debit_note',
  'sales_close',
  'opening',
  'iva_settlement',
])

export type DocumentTitleInput = {
  kind: string
  voucherType: string | null
  pointOfSale: number | null
  number: number | null
}

/**
 * El nombre de un comprobante en pantalla: «Factura A 0003-00001290» si tiene
 * comprobante fiscal numerado; si no, el tipo («Pago», «Cierre del día»). Un
 * gasto sin comprobante es «Gasto»; con tique, «Tique».
 */
export function documentTitle(doc: DocumentTitleInput): string {
  const type = doc.voucherType
  if (type && type !== 'sin_comprobante' && isVoucherType(type)) {
    return voucherDisplay(type, doc.pointOfSale, doc.number)
  }
  if (type && type !== 'sin_comprobante') return voucherLabel(type)
  return documentKindLabel(doc.kind)
}

/** La referencia interna de un comprobante: `#125`. */
export function documentRef(seq: number | null | undefined): string {
  return seq === null || seq === undefined ? '' : `#${seq}`
}

export const TAX_KIND_LABELS: Readonly<Record<TaxKind, string>> = {
  iva: 'IVA',
  iibb: 'IIBB',
  ganancias: 'Ganancias',
  municipal: 'Tasa municipal',
  internos: 'Impuestos internos',
  ley_25413_credito: 'Impuesto a los créditos',
  ley_25413_debito: 'Impuesto a los débitos',
  sircreb: 'SIRCREB',
  sircupa: 'SIRCUPA',
  comision: 'Comisión',
  iva_comision: 'IVA de la comisión',
  percepcion_iva_comision: 'Percepción de IVA de la comisión',
  ret_iva: 'Retención de IVA',
  ret_iibb: 'Retención de IIBB',
  ret_ganancias: 'Retención de Ganancias',
  interes: 'Intereses',
  diferencia: 'Diferencia',
  rendimiento: 'Rendimiento',
  otro: 'Otro',
}

/** `2100` → `'21 %'`, `1050` → `'10,5 %'`, `250` → `'2,5 %'`. */
export function vatRateLabel(bp: number): string {
  const whole = Math.trunc(bp / 100)
  const rest = Math.abs(bp % 100)
  if (rest === 0) return `${whole} %`
  const decimals = String(rest).padStart(2, '0').replace(/0+$/, '')
  return `${whole},${decimals} %`
}

function taxKindLabel(taxKind: string | null | undefined): string | null {
  if (!taxKind) return null
  return taxKind in TAX_KIND_LABELS ? TAX_KIND_LABELS[taxKind as TaxKind] : taxKind
}

/**
 * El renglón de un comprobante en palabras (H.14): «Neto 21 %», «IVA 21 %»,
 * «Percepción IIBB», «Comisión», «Caja o cuenta».
 */
export function lineRoleLabel(
  role: string,
  opts: { vatRateBp?: number | null; taxKind?: string | null } = {},
): string {
  const rate =
    opts.vatRateBp === null || opts.vatRateBp === undefined
      ? ''
      : ` ${vatRateLabel(opts.vatRateBp)}`
  const tax = taxKindLabel(opts.taxKind)
  switch (role) {
    case 'net':
      return `Neto${rate}`
    case 'vat':
      return `IVA${rate}`
    case 'gross':
      return 'Importe con IVA incluido'
    case 'non_taxed':
      return 'No gravado'
    case 'exempt':
      return 'Exento'
    case 'internal_tax':
      return 'Impuestos internos'
    case 'perception':
      if (opts.taxKind === 'municipal') return 'Percepción municipal'
      return tax ? `Percepción ${tax}` : 'Percepción'
    case 'other_tax':
      return tax ?? 'Otros tributos'
    case 'control':
      return 'Cuenta corriente'
    case 'treasury':
      return 'Caja o cuenta'
    case 'compensation':
      return tax ? `Compensación ${tax}` : 'Compensación'
    case 'deduction':
      return tax ?? 'Descuento'
    case 'write_off':
      return 'Diferencia'
    case 'receivable':
      return 'A cobrar'
    case 'advance':
      return 'Seña'
    case 'sales_invoiced':
      return 'Ventas facturadas'
    case 'sales_uninvoiced':
      return 'Ventas sin factura'
    case 'cash_diff':
      return 'Faltante o sobrante de caja'
    case 'vat_pending_release':
      return 'IVA a documentar'
    case 'counterpart':
      return 'Contrapartida'
    case 'adjustment_split':
      return tax ?? 'Ajuste'
    case 'manual':
      return 'Línea'
    case 'opening':
      return 'Saldo inicial'
    case 'settlement':
      return 'Liquidación'
    case 'reversal':
      return 'Anulación'
    case 'fy_result':
      return 'Resultado del ejercicio'
    case 'mirror':
      return 'Cierre'
    default:
      return role
  }
}

export const DOCUMENT_STATUS_LABELS = { posted: 'Vigente', voided: 'Anulado' } as const

/** Estado de pago de un comprobante con partida (H.7: Impaga · Pago parcial · Pagada · Anulada). */
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'voided' | 'none'

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  unpaid: 'Impaga',
  partial: 'Pago parcial',
  paid: 'Pagada',
  voided: 'Anulada',
  none: '—',
}

/** Lo mismo leído del lado de los cobros (ventas, cuenta corriente). */
export const COLLECTION_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  unpaid: 'Sin cobrar',
  partial: 'Cobro parcial',
  paid: 'Cobrada',
  voided: 'Anulada',
  none: '—',
}

export const PERIOD_STATUS_LABELS = { open: 'Abierto', closed: 'Cerrado' } as const

export const PARTY_KIND_LABELS: Readonly<Record<string, string>> = {
  supplier: 'Proveedor',
  customer: 'Cliente',
  card_processor: 'Tarjetas',
  payment_wallet: 'Billetera',
  delivery_platform: 'Plataforma',
  bank: 'Banco',
  tax_agency: 'Organismo',
  payroll: 'Sueldos',
  partner: 'Socio',
  other: 'Otro',
}

export const TREASURY_KIND_LABELS: Readonly<Record<string, string>> = {
  cash: 'Efectivo',
  bank: 'Banco',
  wallet: 'Billetera',
  credit_card: 'Tarjeta de la empresa',
  other: 'Otra',
}

export const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  salon: 'Salón',
  delivery: 'Delivery',
  events: 'Eventos',
}

// ─── Exportes (F.15) ─────────────────────────────────────────────────────────

export const EXPORT_BOOKS = [
  'diario',
  'mayor',
  'mayor-general',
  'sumas-y-saldos',
  'iva-compras',
  'iva-compras-alicuotas',
  'iva-ventas',
  'iva-ventas-alicuotas',
  'posicion-iva',
  'subdiario-compras',
  'subdiario-pagos',
  'subdiario-ventas',
  'subdiario-ventas-medios',
  'subdiario-cobranzas',
  'subdiario-disponibilidades',
  'estado-de-cuenta',
  'saldos-proveedores',
  'saldos-clientes',
  'cajas-y-bancos',
  'flujo-de-caja',
  'neto-por-medio',
  'ventas-sin-factura',
  'historia',
  'asientos-importacion',
  'plan-de-cuentas',
] as const
export type ExportBook = (typeof EXPORT_BOOKS)[number]

export function isExportBook(value: unknown): value is ExportBook {
  return typeof value === 'string' && (EXPORT_BOOKS as readonly string[]).includes(value)
}

/**
 * Qué período pide cada libro: `mes` (un mes, `?mes=yyyy-MM`), `rango`
 * (`?desde=&hasta=`), `fecha` (al día `?hasta=`, default hoy) o nada.
 */
export type ExportPeriodKind = 'mes' | 'rango' | 'fecha' | 'ninguno'

export type ExportBookInfo = {
  title: string
  description: string
  period: ExportPeriodKind
  /** Parámetros obligatorios además del período. */
  requires?: ReadonlyArray<'cuenta' | 'participe'>
  /** Exige el CUIT de la SAS (libros IVA y posición): 409 `sas_cuit_required`. */
  needsSasCuit?: boolean
}

export const EXPORT_BOOK_INFO: Readonly<Record<ExportBook, ExportBookInfo>> = {
  diario: {
    title: 'Libro diario',
    description: 'Todos los asientos, en orden.',
    period: 'rango',
  },
  mayor: {
    title: 'Mayor de una cuenta',
    description: 'Los movimientos de una cuenta, con su saldo.',
    period: 'rango',
    requires: ['cuenta'],
  },
  'mayor-general': {
    title: 'Mayor general',
    description: 'Una sección por cuenta con movimientos.',
    period: 'rango',
  },
  'sumas-y-saldos': {
    title: 'Sumas y saldos',
    description: 'El balance de comprobación del período.',
    period: 'rango',
  },
  'iva-compras': {
    title: 'Libro IVA compras',
    description: 'Los comprobantes de compra con IVA del mes.',
    period: 'mes',
    needsSasCuit: true,
  },
  'iva-compras-alicuotas': {
    title: 'IVA compras · alícuotas',
    description: 'Una fila por comprobante y alícuota (Libro IVA Digital).',
    period: 'mes',
    needsSasCuit: true,
  },
  'iva-ventas': {
    title: 'Libro IVA ventas',
    description: 'Lo facturado en el mes.',
    period: 'mes',
    needsSasCuit: true,
  },
  'iva-ventas-alicuotas': {
    title: 'IVA ventas · alícuotas',
    description: 'Una fila por comprobante y alícuota (Libro IVA Digital).',
    period: 'mes',
    needsSasCuit: true,
  },
  'posicion-iva': {
    title: 'Posición de IVA',
    description: 'Cuánto IVA da el mes (estimado).',
    period: 'mes',
    needsSasCuit: true,
  },
  'subdiario-compras': {
    title: 'Subdiario de compras',
    description: 'Facturas, notas y gastos de contado.',
    period: 'rango',
  },
  'subdiario-pagos': {
    title: 'Subdiario de pagos',
    description: 'Lo que se les pagó a proveedores y organismos.',
    period: 'rango',
  },
  'subdiario-ventas': {
    title: 'Subdiario de ventas',
    description: 'Cierres del día y facturas sueltas.',
    period: 'rango',
  },
  'subdiario-ventas-medios': {
    title: 'Ventas por medio de cobro',
    description: 'Lo vendido con cada medio, día por día.',
    period: 'rango',
  },
  'subdiario-cobranzas': {
    title: 'Subdiario de cobranzas',
    description: 'Cobros y acreditaciones con sus descuentos.',
    period: 'rango',
  },
  'subdiario-disponibilidades': {
    title: 'Subdiario de cajas y bancos',
    description: 'Lo que entró y salió de cada caja o cuenta.',
    period: 'rango',
  },
  'estado-de-cuenta': {
    title: 'Estado de cuenta',
    description: 'Comprobantes, pagos y saldo de un proveedor o cliente.',
    period: 'rango',
    requires: ['participe'],
  },
  'saldos-proveedores': {
    title: 'Saldos de proveedores',
    description: 'Lo que se les debe, con antigüedad.',
    period: 'fecha',
  },
  'saldos-clientes': {
    title: 'Saldos de clientes',
    description: 'Lo que te deben, con antigüedad.',
    period: 'fecha',
  },
  'cajas-y-bancos': {
    title: 'Cajas y bancos',
    description: 'El saldo de cada caja o cuenta.',
    period: 'fecha',
  },
  'flujo-de-caja': {
    title: 'Flujo de caja',
    description: 'Lo que entró y salió, por mes y por categoría.',
    period: 'rango',
  },
  'neto-por-medio': {
    title: 'Neto por medio de cobro',
    description: 'Lo vendido con cada medio y lo que llegó después de los descuentos.',
    period: 'rango',
  },
  'ventas-sin-factura': {
    title: 'Ventas sin factura',
    description: 'Vendido, facturado y sin facturar, por mes y canal.',
    period: 'rango',
  },
  historia: {
    title: 'Historia',
    description: 'Quién cargó, anuló o cerró qué.',
    period: 'rango',
  },
  'asientos-importacion': {
    title: 'Asientos para importar',
    description: 'Una fila por línea, para levantar en otro sistema contable.',
    period: 'rango',
  },
  'plan-de-cuentas': {
    title: 'Plan de cuentas',
    description: 'Todas las cuentas, con su código y para qué se usan.',
    period: 'ninguno',
  },
}

/** Los archivos del «Paquete del mes» (F.15), en el orden en que se muestran. */
export const MONTH_PACKAGE_BOOKS = [
  'diario',
  'mayor-general',
  'sumas-y-saldos',
  'iva-compras',
  'iva-compras-alicuotas',
  'iva-ventas',
  'iva-ventas-alicuotas',
  'posicion-iva',
  'subdiario-compras',
  'subdiario-pagos',
  'subdiario-ventas',
  'subdiario-cobranzas',
  'subdiario-disponibilidades',
  'saldos-proveedores',
  'saldos-clientes',
] as const satisfies readonly ExportBook[]

export type ExportParams = {
  /** `yyyy-MM` (o cualquier día del mes). */
  mes?: string | null
  desde?: string | null
  hasta?: string | null
  cuenta?: string | null
  participe?: string | null
  caja?: string | null
  antesRefundicion?: boolean
}

/** El link de descarga de un libro: `/api/administracion/export?slug=…&libro=…`. */
export function exportHref(slug: string, libro: ExportBook, params: ExportParams = {}): string {
  const search = new URLSearchParams({ slug, libro })
  if (params.mes) search.set('mes', params.mes.slice(0, 7))
  if (params.desde) search.set('desde', params.desde)
  if (params.hasta) search.set('hasta', params.hasta)
  if (params.cuenta) search.set('cuenta', params.cuenta)
  if (params.participe) search.set('participe', params.participe)
  if (params.caja) search.set('caja', params.caja)
  if (params.antesRefundicion) search.set('antes_refundicion', '1')
  return `/api/administracion/export?${search.toString()}`
}
