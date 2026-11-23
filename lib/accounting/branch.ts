/**
 * Administración por sucursal, entrega 1 (docs/features/sucursales.md › La regla para cada pantalla).
 *
 * Una empresa y un solo libro: el diario, el mayor y el IVA no se separan. Lo de cada local (los comprobantes de
 * compras y pagos, los gastos fijos, las cajas en efectivo) lleva su sucursal y «Todas» suma. Las cajas sin
 * sucursal (billeteras, bancos, tarjetas) son «de todo el bar»: se ven en todas con un solo saldo.
 *
 * Puro: lo usan las páginas, las acciones, los formularios del navegador y las pruebas.
 */

import { type BranchFilter, branchFilterOf, rpcBranchId } from '@/lib/branches/filter'
import type { BranchScope } from '@/lib/branches/types'

/** La sucursal que mira una pantalla de Administración, lista para sus lecturas. */
export type AccBranchView = {
  scope: BranchScope
  /** Para las tablas (`applyBranchFilter`). `ids: null` = «Todas» sin filtrar. */
  filter: BranchFilter
  /** El `p_branch_id` de los informes: la sucursal que se mira; `null` = todas (lo de siempre). */
  id: string | null
}

export function accBranchView(scope: BranchScope): AccBranchView {
  return { scope, filter: branchFilterOf(scope), id: rpcBranchId(scope) }
}

/**
 * El último parámetro de los informes por sucursal (`p_branch_id`). Sin sucursal no se manda: la base devuelve
 * exactamente lo de siempre (todo el bar), también si la función todavía tiene la firma de antes.
 */
export function branchRpcParam(branchId: string | null | undefined): { p_branch_id?: string } {
  return branchId ? { p_branch_id: branchId } : {}
}

/**
 * El `p_branch_id` de una lectura que pidió el navegador, con el filtro ya recortado (`clampBranchFilter`): una
 * sucursal → esa; varias o todas → `null` (la base recorta a las que la persona ve).
 */
export function rpcBranchIdOfFilter(filter: BranchFilter): string | null {
  if (filter.ids === null || filter.ids.length !== 1) return null
  return filter.ids[0] ?? null
}

/** ¿El filtro recortado se quedó sin ninguna sucursal? Entonces la lectura no trae nada. */
export function isEmptyBranchFilter(filter: BranchFilter): boolean {
  return filter.ids !== null && filter.ids.length === 0
}

type WithBranch = { branchId?: string | null }

/** ¿Esa caja sirve en un formulario de esa sucursal? Las de todo el bar sirven en todas. */
export function treasuryFitsBranch(
  treasury: WithBranch | null | undefined,
  branchId: string | null,
): boolean {
  if (!treasury) return false
  if (!branchId) return true
  return !treasury.branchId || treasury.branchId === branchId
}

/**
 * Las cajas que ofrece un formulario: las de la sucursal elegida y las de todo el bar. Sin sucursal elegida
 * (mirando «Todas», antes de elegir) se ofrecen todas.
 */
export function treasuriesForBranch<T extends WithBranch>(
  treasuries: readonly T[],
  branchId: string | null,
): T[] {
  return treasuries.filter((t) => treasuryFitsBranch(t, branchId))
}

/**
 * La caja elegida, si todavía sirve en la sucursal nueva; si no, `null` (el formulario vuelve a proponer una).
 */
export function keepTreasuryForBranch<T extends WithBranch & { id: string }>(
  treasuries: readonly T[],
  treasuryId: string | null,
  branchId: string | null,
): string | null {
  if (!treasuryId) return null
  const treasury = treasuries.find((t) => t.id === treasuryId)
  return treasuryFitsBranch(treasury, branchId) ? treasuryId : null
}

/**
 * La sucursal de lo que se carga desde un lote importado (Mercado Pago, el banco, ARCA): la de su caja; si la caja
 * es de todo el bar (o el lote no tiene caja), la que se está mirando; mirando «Todas», ninguna (la base pone la
 * principal).
 */
export function importBranchId(input: {
  boxBranchId: string | null | undefined
  viewedBranchId: string | null | undefined
}): string | null {
  return input.boxBranchId || input.viewedBranchId || null
}
