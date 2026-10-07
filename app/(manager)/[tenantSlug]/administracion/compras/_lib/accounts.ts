/**
 * Qué cuentas se pueden elegir como «en qué» de una compra, un gasto o un
 * gasto fijo. Puro: lo usan las páginas (filas del plan) y las hojas (cuentas
 * del contexto del motor).
 */

type AccountLike = {
  postable: boolean
  active: boolean
  requiresParty: boolean
  isTreasury: boolean
  type: string
  purchaseSelectable: boolean
  systemKey: string | null
}

/**
 * La regla `imputation` del motor (`isImputationAccount` de
 * `lib/accounting/validate.ts`, C.3.4): imputable, activa, sin partícipe, no
 * de caja, de gasto o de activo, y elegible en compras o sin clave de sistema.
 * La base aplica la misma (`invalid_imputation_account`).
 */
export function isPurchaseImputation(a: AccountLike): boolean {
  return (
    a.postable &&
    a.active &&
    !a.requiresParty &&
    !a.isTreasury &&
    (a.type === 'expense' || a.type === 'asset') &&
    (a.purchaseSelectable || a.systemKey === null)
  )
}

/** Las que aparecen primero al buscar «¿En qué?» (las pensadas para compras). */
export function isQuickExpenseAccount(a: AccountLike): boolean {
  return isPurchaseImputation(a) && a.purchaseSelectable
}
