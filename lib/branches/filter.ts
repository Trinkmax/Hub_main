import type { BranchScope } from './types'

/**
 * Cómo cada lectura y cada escritura usa la sucursal que se mira. Puro: lo usan las consultas del servidor, el
 * tiempo real del navegador y las pruebas.
 */

/** Lo que una lectura necesita saber del alcance. Viaja de la pantalla al servidor cuando el navegador pide algo. */
export type BranchFilter = {
  /** `null` = todo el bar sin filtrar (un dueño o la contadora mirando «Todas»: incluye sucursales apagadas). */
  ids: string[] | null
}

export function branchFilterOf(
  scope: Pick<BranchScope, 'isAll' | 'unrestricted' | 'ids'>,
): BranchFilter {
  return { ids: scope.isAll && scope.unrestricted ? null : [...scope.ids] }
}

/** Todo el bar, sin filtrar: para lo que no se mira por sucursal o para tareas programadas. */
export const WHOLE_BAR: BranchFilter = { ids: null }

type Filterable<T> = {
  eq(column: string, value: string): T
  in(column: string, values: readonly string[]): T
}

/**
 * Agrega el filtro de sucursal a una consulta de PostgREST: una sucursal → `eq`; varias → `in`; todo el bar → nada.
 * Una lista vacía no trae nada (alguien sin sucursales no ve filas de nadie).
 */
export function applyBranchFilter<T extends Filterable<T>>(
  query: T,
  filter: BranchFilter,
  column = 'branch_id',
): T {
  if (filter.ids === null) return query
  const [only] = filter.ids
  if (filter.ids.length === 1 && only) return query.eq(column, only)
  return query.in(column, filter.ids)
}

/** Para las funciones de la base: la sucursal pedida, o `null` = las que la persona ve (la base recorta). */
export function rpcBranchId(scope: Pick<BranchScope, 'isAll' | 'current'>): string | null {
  return scope.isAll ? null : (scope.current?.id ?? null)
}

/** ¿Esta fila entra en lo que se mira? Para descartar en el navegador los avisos en vivo de otra sucursal. */
export function inBranchFilter(branchId: string | null | undefined, filter: BranchFilter): boolean {
  if (filter.ids === null) return true
  return typeof branchId === 'string' && filter.ids.includes(branchId)
}

/**
 * Recorta lo que pide el navegador (puede venir viejo o tocado) a lo que la persona ve hoy. Una sucursal que ya no
 * tiene permitida no se cuela; si no queda ninguna, la lectura no trae nada.
 */
export function clampBranchFilter(
  requested: BranchFilter | null | undefined,
  scope: Pick<BranchScope, 'branches' | 'unrestricted'>,
): BranchFilter {
  const visible = new Set(scope.branches.map((branch) => branch.id))
  if (!requested || requested.ids === null) {
    return { ids: scope.unrestricted ? null : [...visible] }
  }
  return { ids: requested.ids.filter((id) => visible.has(id)) }
}

export class BranchRequiredError extends Error {
  constructor() {
    super('branch_required')
    this.name = 'BranchRequiredError'
  }
}

export class BranchForbiddenError extends Error {
  constructor() {
    super('branch_forbidden')
    this.name = 'BranchForbiddenError'
  }
}

/**
 * La sucursal de algo que se crea: la que mandó la pantalla (si la persona la ve) o, si no mandó ninguna, la que se
 * está mirando. En «Todas» con varias sucursales hay que elegir: nunca se crea nada sin sucursal.
 */
export function branchForWrite(
  scope: Pick<BranchScope, 'branches' | 'current'>,
  requested: string | null | undefined,
): string {
  if (requested) {
    if (!scope.branches.some((branch) => branch.id === requested)) throw new BranchForbiddenError()
    return requested
  }
  if (scope.current) return scope.current.id
  const [only] = scope.branches
  if (scope.branches.length === 1 && only) return only.id
  throw new BranchRequiredError()
}

/** Lo que se le dice a la persona cuando falta o no le toca la sucursal. */
export function branchErrorMessage(error: unknown): string | null {
  if (error instanceof BranchRequiredError) return 'Elegí en qué sucursal.'
  if (error instanceof BranchForbiddenError) return 'Esa sucursal no es tuya. Elegí otra.'
  return null
}
