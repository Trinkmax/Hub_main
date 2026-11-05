import type { AccountType, Side } from './types'

/**
 * El «ojo de auditor» de Sumas y saldos (Silvia, reunión del 29/10, min. 10): «una cuenta de pérdida
 * me da un saldo acreedor, digo acá hay un error, entro al mayor». Mira el saldo final de cada cuenta
 * imputable contra lo que esa cuenta debería dar. Puro: lo usan Sumas y saldos, el Cierre de mes y
 * los tests.
 *
 * - Pérdida con saldo acreedor, ganancia con saldo deudor, activo con saldo acreedor y deuda con
 *   saldo deudor. El patrimonio neto puede dar para los dos lados: no se marca.
 * - Las regularizadoras van al revés de su tipo a propósito (la amortización acumulada es un activo
 *   con saldo acreedor): las salva su `normal_side`.
 * - Sueldos a pagar puede estar deudor mientras no se devengó el mes (los adelantos van al Debe).
 * - Los grupos ya suman a sus hijas (marcarlos repetiría la marca) y la línea virtual de resultados
 *   no es una cuenta del plan.
 */

export type AnomalyKind = 'expense_credit' | 'income_debit' | 'asset_credit' | 'liability_debit'

export const ANOMALY_SENTENCES: Readonly<Record<AnomalyKind, string>> = {
  expense_credit: 'Una pérdida no debería dar saldo acreedor.',
  income_debit: 'Una ganancia no debería dar saldo deudor.',
  asset_credit: 'Un activo con saldo acreedor: revisá el mayor.',
  liability_debit: 'Una deuda con saldo deudor: revisá el mayor.',
}

/** Cuentas que pueden estar «al revés» sin que sea un error. */
const NEVER_FLAGGED: ReadonlySet<string> = new Set(['payroll_payable'])

export type AnomalyRow = {
  accountType: AccountType
  normalSide: Side
  postable: boolean
  isVirtual?: boolean
  closingDebitCents: number
  closingCreditCents: number
}

export type Anomaly = { kind: AnomalyKind; sentence: string }

function kindOf(type: AccountType, normalSide: Side, netCents: number): AnomalyKind | null {
  if (netCents === 0) return null
  const debitBalance = netCents > 0
  if (type === 'expense' && !debitBalance && normalSide === 'debit') return 'expense_credit'
  if (type === 'income' && debitBalance && normalSide === 'credit') return 'income_debit'
  if (type === 'asset' && !debitBalance && normalSide === 'debit') return 'asset_credit'
  if (type === 'liability' && debitBalance && normalSide === 'credit') return 'liability_debit'
  return null
}

/** ¿El saldo de esta cuenta está al revés? `null` si está bien o si no es para mirar. */
export function trialAnomaly(row: AnomalyRow, systemKey?: string | null): Anomaly | null {
  if (!row.postable || row.isVirtual) return null
  if (systemKey && NEVER_FLAGGED.has(systemKey)) return null
  const kind = kindOf(
    row.accountType,
    row.normalSide,
    row.closingDebitCents - row.closingCreditCents,
  )
  return kind ? { kind, sentence: ANOMALY_SENTENCES[kind] } : null
}

/** Las filas con el saldo al revés, por cuenta. */
export function trialAnomalies<T extends AnomalyRow & { accountId: string }>(
  rows: readonly T[],
  systemKeys: ReadonlyMap<string, string | null>,
): Map<string, Anomaly> {
  const out = new Map<string, Anomaly>()
  for (const row of rows) {
    const anomaly = trialAnomaly(row, systemKeys.get(row.accountId) ?? null)
    if (anomaly) out.set(row.accountId, anomaly)
  }
  return out
}
