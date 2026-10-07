/**
 * Claves estables del plan de cuentas (`acc_accounts.system_key`, §D).
 *
 * El motor nunca busca cuentas por código ni por nombre (los dos se pueden
 * editar): busca por `system_key`. Renombrar o recodificar una cuenta no
 * rompe nada; desactivar una con clave está prohibido (`system_account_locked`).
 *
 * La lista es exactamente la de `private.acc_seed_chart`: el test
 * `accounting-system-keys.test.ts` la compara con `STANDARD_CHART` (y con la
 * migración del seed cuando exista).
 */

import { STANDARD_CHART } from './chart'
import type { Channel } from './types'

export const SYSTEM_ACCOUNT_KEYS = [
  // Activo · créditos por ventas
  'receivable_customers',
  'receivable_debit_cards',
  'receivable_credit_cards',
  'receivable_wallets',
  'receivable_platforms',
  'bad_debt_allowance',
  // Activo · créditos fiscales
  'vat_credit',
  'vat_credit_pending',
  'vat_technical_balance',
  'vat_free_balance',
  'vat_perceptions',
  'vat_withholdings',
  'iibb_perceptions',
  'iibb_withholdings',
  'iibb_sircreb',
  'iibb_sircupa',
  'iibb_balance',
  'income_tax_withholdings',
  'income_tax_perceptions',
  'income_tax_advances',
  'bank_tax_credit',
  // Activo · otros créditos, bienes de cambio, bienes de uso
  'supplier_advances',
  'prepaid_expenses',
  'reconciliation_differences',
  'inventory',
  'accumulated_depreciation',
  // Pasivo
  'payable_suppliers',
  'vat_debit',
  'vat_payable',
  'iibb_payable',
  'municipal_payable',
  'income_tax_payable',
  'other_taxes_payable',
  'payroll_payable',
  'social_security_payable',
  'union_payable',
  'payroll_provisions',
  'customer_deposits',
  'partners_current',
  'other_payables',
  'bank_loans',
  'partner_loans',
  // Patrimonio neto
  'share_capital',
  'capital_receivable',
  'irrevocable_contributions',
  'retained_earnings',
  'current_year_result',
  'legal_reserve',
  'opening_equity',
  // Ingresos
  'sales_salon_invoiced',
  'sales_salon_uninvoiced',
  'sales_delivery_invoiced',
  'sales_delivery_uninvoiced',
  'sales_events_invoiced',
  'sales_events_uninvoiced',
  'cash_over',
  'interest_income',
  'discounts_obtained',
  'other_income',
  // Egresos
  'purchases_food',
  'purchases_soft_drinks',
  'purchases_alcohol',
  'purchases_coffee',
  'purchases_bakery',
  'purchases_packaging',
  'purchases_other',
  'inventory_variation',
  'fees_cards',
  'fees_wallets',
  'fees_platforms',
  'fees_other',
  'advertising_online',
  'advertising_other',
  'iibb_expense',
  'municipal_tax_expense',
  'salaries',
  'employer_contributions',
  'maintenance',
  'cleaning',
  'bank_fees',
  'cash_short',
  'depreciation',
  'misc_expenses',
  'bank_tax_expense',
  'other_taxes_expense',
  'tax_penalties',
  'interest_expense',
  'income_tax_expense',
] as const

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number]

const KEY_SET: ReadonlySet<string> = new Set(SYSTEM_ACCOUNT_KEYS)

/** Guarda de tipo para lo que llega de la base (`system_key text`). */
export function isSystemAccountKey(value: unknown): value is SystemAccountKey {
  return typeof value === 'string' && KEY_SET.has(value)
}

/**
 * Nombre de cada cuenta de sistema en el plan estándar (el que se ve en la UI
 * mientras la contadora no la renombre). Sale de `STANDARD_CHART` para no
 * escribir los nombres dos veces.
 */
export const SYSTEM_ACCOUNT_LABELS: Readonly<Record<SystemAccountKey, string>> = (() => {
  const byKey = new Map<string, string>()
  for (const account of STANDARD_CHART) {
    if (account.systemKey) byKey.set(account.systemKey, account.name)
  }
  const labels = {} as Record<SystemAccountKey, string>
  for (const key of SYSTEM_ACCOUNT_KEYS) labels[key] = byKey.get(key) ?? key
  return labels
})()

// ─── Grupos que usan las reglas (espejo de la matriz C.3.4) ─────────────────

/**
 * Saldos a favor de impuestos que «Pagar otra cosa» puede usar para pagarle a
 * un organismo (rol `compensation` del pago).
 */
export const COMPENSABLE_KEYS = [
  'iibb_perceptions',
  'iibb_withholdings',
  'iibb_sircreb',
  'iibb_sircupa',
  'iibb_balance',
  'income_tax_withholdings',
  'income_tax_perceptions',
  'income_tax_advances',
  'bank_tax_credit',
  'vat_free_balance',
] as const satisfies readonly SystemAccountKey[]

/**
 * Deudas fiscales con partícipe (grupo «Deudas fiscales», 2.1.01.03.000 en el
 * plan estándar): la cuenta de control de una DDJJ (`ddjj_impuesto`) a nombre
 * de un organismo.
 */
export const TAX_PAYABLE_KEYS = [
  'vat_payable',
  'iibb_payable',
  'municipal_payable',
  'income_tax_payable',
  'other_taxes_payable',
] as const satisfies readonly SystemAccountKey[]

/** Cuentas de IVA: un «Otro ingreso o egreso» no puede usarlas de contrapartida. */
export const VAT_ACCOUNT_KEYS = [
  'vat_credit',
  'vat_credit_pending',
  'vat_technical_balance',
  'vat_free_balance',
  'vat_perceptions',
  'vat_withholdings',
  'vat_debit',
  'vat_payable',
] as const satisfies readonly SystemAccountKey[]

/** Las que mueve la liquidación mensual de IVA (rol `settlement`, E.5.15). */
export const IVA_SETTLEMENT_KEYS = [
  'vat_debit',
  'vat_credit',
  'vat_perceptions',
  'vat_withholdings',
  'vat_technical_balance',
  'vat_free_balance',
  'vat_payable',
] as const satisfies readonly SystemAccountKey[]

/** Comisiones de cobro según el tipo de partícipe (deducción `comision` de una cobranza). */
export const COMMISSION_KEYS = [
  'fees_cards',
  'fees_wallets',
  'fees_platforms',
  'fees_other',
] as const satisfies readonly SystemAccountKey[]

/** «Ventas <canal>: facturadas» o «sin factura». */
export function salesAccountKey(channel: Channel, invoiced: boolean): SystemAccountKey {
  switch (channel) {
    case 'salon':
      return invoiced ? 'sales_salon_invoiced' : 'sales_salon_uninvoiced'
    case 'delivery':
      return invoiced ? 'sales_delivery_invoiced' : 'sales_delivery_uninvoiced'
    case 'events':
      return invoiced ? 'sales_events_invoiced' : 'sales_events_uninvoiced'
  }
}

/** Las seis cuentas de ventas, para reconocerlas sin importar el canal. */
export const SALES_ACCOUNT_KEYS = [
  'sales_salon_invoiced',
  'sales_salon_uninvoiced',
  'sales_delivery_invoiced',
  'sales_delivery_uninvoiced',
  'sales_events_invoiced',
  'sales_events_uninvoiced',
] as const satisfies readonly SystemAccountKey[]

export function isOneOf<K extends SystemAccountKey>(
  key: SystemAccountKey | null | undefined,
  list: readonly K[],
): key is K {
  return key !== null && key !== undefined && (list as readonly SystemAccountKey[]).includes(key)
}
