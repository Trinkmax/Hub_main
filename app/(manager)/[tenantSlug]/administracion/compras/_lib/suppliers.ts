/**
 * La pestaña «Proveedores» (H.7), lo puro: el filtro de la URL, qué filas se
 * muestran, la clasificación (la cuenta habitual de cada uno) y los totales
 * del pie. Lo prueba `administracion-compras.test.ts`.
 */

import type { PartyListFilter } from '@/lib/accounting/queries/parties'
import { isPurchaseImputation } from './accounts'

/**
 * El segmentado de la lista, en el orden en que se ve. «Sin clasificar» no es
 * un filtro de saldos: trae a todos y la pestaña deja los que no tienen cuenta.
 */
export const SUPPLIER_FILTERS = [
  { value: 'todos', label: 'Todos', filter: 'all', unclassifiedOnly: false },
  { value: 'con-deuda', label: 'Con deuda', filter: 'with_debt', unclassifiedOnly: false },
  { value: 'vencidos', label: 'Vencidos', filter: 'overdue', unclassifiedOnly: false },
  { value: 'a-favor', label: 'A favor', filter: 'in_favor', unclassifiedOnly: false },
  {
    value: 'impuestos',
    label: 'Impuestos y sueldos',
    filter: 'taxes_payroll',
    unclassifiedOnly: false,
  },
  { value: 'sin-clasificar', label: 'Sin clasificar', filter: 'all', unclassifiedOnly: true },
] as const satisfies ReadonlyArray<{
  value: string
  label: string
  filter: PartyListFilter
  unclassifiedOnly: boolean
}>

export type SupplierFilterValue = (typeof SUPPLIER_FILTERS)[number]['value']

export function supplierFilterOf(raw: string): {
  value: SupplierFilterValue
  filter: PartyListFilter
  /** «Sin clasificar»: solo los que no tienen cuenta habitual. */
  unclassifiedOnly: boolean
} {
  const found = SUPPLIER_FILTERS.find((f) => f.value === raw) ?? SUPPLIER_FILTERS[0]
  return { value: found.value, filter: found.filter, unclassifiedOnly: found.unclassifiedOnly }
}

type SupplierRowLike = {
  systemKey: string | null
  debtCents: number
  creditCents: number
  overdueCents: number
}

/**
 * Los organismos, sueldos y bancos que siembra la puesta en marcha (ARCA,
 * Rentas, el banco…) no ensucian la lista mientras no tengan saldo: aparecen
 * cuando les debés algo, cuando tienen algo a favor o en «Impuestos y
 * sueldos». Los proveedores que cargaste vos se ven siempre.
 */
export function isVisibleSupplier(row: SupplierRowLike, filter: PartyListFilter): boolean {
  if (filter === 'taxes_payroll') return true
  return row.systemKey === null || row.debtCents !== 0 || row.creditCents !== 0
}

// ─── La clasificación: en qué cuenta van sus compras ─────────────────────────

/**
 * Lo que dice la columna «Cuenta»:
 * - `classified`: tiene cuenta habitual (se muestra su nombre).
 * - `unclassified`: le falta («Sin clasificar») y hay que elegirla.
 * - `not_applicable`: no se le compra (ARCA, Rentas, sueldos, un socio, el
 *   banco) o es del sistema: sin cuenta no es un pendiente.
 */
export type SupplierClassification = 'classified' | 'unclassified' | 'not_applicable'

/** A quiénes se les carga una factura o un gasto: proveedores y «otros». */
const CLASSIFIABLE_KINDS: ReadonlySet<string> = new Set(['supplier', 'other'])

type ClassifiableLike = {
  kind: string
  systemKey: string | null
  defaultAccountId: string | null
}

export function supplierClassification(party: ClassifiableLike): SupplierClassification {
  if (party.defaultAccountId) return 'classified'
  if (party.systemKey !== null || !CLASSIFIABLE_KINDS.has(party.kind)) return 'not_applicable'
  return 'unclassified'
}

/**
 * Cuántos faltan clasificar (el número del filtro «Sin clasificar»): los
 * activos, que son los que lista la pantalla. Uno desactivado con saldo
 * también se ve en la lista, pero no se cuenta acá: es un caso de borde.
 */
export function countUnclassified(
  parties: Iterable<ClassifiableLike & { active: boolean }>,
): number {
  let count = 0
  for (const party of parties) {
    if (party.active && supplierClassification(party) === 'unclassified') count += 1
  }
  return count
}

/**
 * ¿Se le puede elegir la cuenta desde la lista? A los que hay que clasificar y
 * a los que ya la tienen (para cambiarla). El resto, desde su ficha.
 */
export function canPickAccount(state: SupplierClassification): boolean {
  return state !== 'not_applicable'
}

/**
 * El próximo sin clasificar después de `afterId`, en el orden de la lista
 * («Guardar y seguir»). No da la vuelta: al llegar al final, `null`.
 */
export function nextUnclassified<T extends { partyId: string; accountId: string | null }>(
  rows: readonly T[],
  afterId: string,
): T | null {
  const index = rows.findIndex((row) => row.partyId === afterId)
  if (index < 0) return null
  return rows.slice(index + 1).find((row) => row.accountId === null) ?? null
}

type PlanAccountLike = {
  id: string
  code: string
  name: string
  parentId: string | null
  description: string | null
  postable: boolean
  active: boolean
  requiresParty: boolean
  isTreasury: boolean
  type: string
  purchaseSelectable: boolean
  systemKey: string | null
}

/** Una cuenta para el selector de la lista (la misma forma que pide `AccountCombobox`). */
export type SupplierAccountOption = {
  id: string
  code: string
  name: string
  postable: boolean
  active: boolean
  description: string | null
  parentId: string | null
}

/**
 * Las cuentas del selector «Elegir cuenta»: las mismas que ofrece la ficha del
 * proveedor (las que sirven para imputar una compra), más los grupos (arman la
 * ruta) y las que ya usa algún proveedor de la lista (se ven, no se eligen).
 */
export function supplierAccountOptions(
  accounts: readonly PlanAccountLike[],
  inUse: ReadonlySet<string>,
): SupplierAccountOption[] {
  return accounts
    .filter((a) => !a.postable || isPurchaseImputation(a) || inUse.has(a.id))
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      postable: a.postable && isPurchaseImputation(a),
      active: a.active,
      description: a.description,
      parentId: a.parentId,
    }))
}

/** Qué se puede hacer con un proveedor desde su fila. */
export type SupplierRowActions = {
  /** «Cargar compra»: solo a los activos (uno desactivado no aparece al cargar). */
  canBuy: boolean
  /** «Pagar»: a los activos (un pago a cuenta) o a los que se les debe algo. */
  canPay: boolean
}

export function supplierRowActions(row: {
  active: boolean
  debtCents: number
}): SupplierRowActions {
  return { canBuy: row.active, canPay: row.active || row.debtCents > 0 }
}

export type SupplierTotals = {
  debtCents: number
  overdueCents: number
  creditCents: number
}

/** Σ de las filas que se ven (el pie de la tabla). */
export function supplierTotals(rows: readonly SupplierRowLike[]): SupplierTotals {
  return rows.reduce<SupplierTotals>(
    (acc, r) => ({
      debtCents: acc.debtCents + r.debtCents,
      overdueCents: acc.overdueCents + r.overdueCents,
      creditCents: acc.creditCents + r.creditCents,
    }),
    { debtCents: 0, overdueCents: 0, creditCents: 0 },
  )
}
