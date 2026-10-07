/**
 * La pestaña «Proveedores» (H.7), lo puro: el filtro de la URL, qué filas se
 * muestran y los totales del pie. Lo prueba `administracion-compras.test.ts`.
 */

import type { PartyListFilter } from '@/lib/accounting/queries/parties'

/** El segmentado de la lista, en el orden en que se ve. */
export const SUPPLIER_FILTERS = [
  { value: 'todos', label: 'Todos', filter: 'all' },
  { value: 'con-deuda', label: 'Con deuda', filter: 'with_debt' },
  { value: 'vencidos', label: 'Vencidos', filter: 'overdue' },
  { value: 'a-favor', label: 'A favor', filter: 'in_favor' },
  { value: 'impuestos', label: 'Impuestos y sueldos', filter: 'taxes_payroll' },
] as const satisfies ReadonlyArray<{ value: string; label: string; filter: PartyListFilter }>

export type SupplierFilterValue = (typeof SUPPLIER_FILTERS)[number]['value']

export function supplierFilterOf(raw: string): {
  value: SupplierFilterValue
  filter: PartyListFilter
} {
  const found = SUPPLIER_FILTERS.find((f) => f.value === raw) ?? SUPPLIER_FILTERS[0]
  return { value: found.value, filter: found.filter }
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
