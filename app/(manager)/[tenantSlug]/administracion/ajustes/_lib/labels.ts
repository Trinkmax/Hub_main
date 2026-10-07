/**
 * Cómo se dicen en pantalla los datos de Ajustes (H.17, glosario H.21). Puro:
 * lo usan las páginas del servidor y los formularios del navegador.
 */

import { capitalizeFirst, MONTH_NAMES } from '@/lib/dates'

export const SAS_IVA_CONDITION_LABELS = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
} as const

export const IIBB_REGIME_LABELS = {
  local: 'Local (Córdoba)',
  convenio_multilateral: 'Convenio Multilateral',
  exento: 'Exento',
  no_inscripto: 'No inscripto',
} as const

export const IVA_SETTLEMENT_LABELS = {
  on_close: 'Al cerrar cada mes',
  manual: 'A mano (la hace la contadora)',
} as const

export const UNINVOICED_SALES_LABELS = {
  separate_accounts: 'En cuentas propias',
  single_account: 'En la misma cuenta que las facturadas',
} as const

export const CLOSED_PERIOD_VOID_LABELS = {
  adjustment_only: 'Sin fila: solo el ajuste',
  negative_row: 'Con una fila en negativo',
} as const

/** Qué pasa con lo cobrado con cada tipo de medio (H.17). */
export const SALES_METHOD_KIND_LABELS = {
  treasury: 'Entra entero a una caja',
  settled_now: 'Entra a Mercado Pago con descuentos',
  receivable: 'Queda a cobrar',
  customer_account: 'Cuenta corriente de un cliente',
  advance: 'Seña ya cobrada',
} as const

export const COMMISSION_VAT_MODE_LABELS = {
  per_settlement: 'En cada liquidación',
  monthly_invoice: 'Una factura por mes',
  none: 'No factura comisiones',
} as const

export const ACCOUNT_TYPE_LABELS = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio',
  income: 'Ingresos',
  expense: 'Egresos',
} as const

/** 12 → «Diciembre». */
export function monthTitle(month: number): string {
  const name = MONTH_NAMES[month - 1]
  return name ? capitalizeFirst(name) : '—'
}

/** Los meses para elegir el cierre del ejercicio. */
export const FISCAL_END_MONTH_OPTIONS: ReadonlyArray<{ value: number; label: string }> =
  MONTH_NAMES.map((_, index) => ({ value: index + 1, label: monthTitle(index + 1) }))
