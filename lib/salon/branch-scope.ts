import type { BranchFilter } from '@/lib/branches/filter'
import type { BranchRef } from '@/lib/branches/types'

/**
 * Las sucursales en la agenda (docs/features/sucursales.md): qué reservas y qué eventos entran en una pantalla, y de
 * qué sucursal es el cupo que se muestra.
 *
 * La regla de fondo: el cupo NUNCA se suma entre sucursales (no comparten sillas). Mirando una sucursal se ve su cupo;
 * mirando varias («Todas») se cuenta la gente y el cupo se muestra por sucursal o no se muestra.
 *
 * Puro (sin supabase ni react): lo usan las consultas, las acciones, el navegador y las pruebas.
 */

/** Lo que el cupo necesita saber de una sucursal. `BranchRef` lo cumple. */
export type CapacityBranch = Pick<BranchRef, 'id' | 'isDefault' | 'seatCapacity'>

/**
 * ¿La sucursal tiene plantas (Planta Alta y Planta Baja)? Hoy solo la principal: las plantas y su cupo viven en la
 * configuración del bar (`tenants.settings.salon_capacities`, el «Cupo general por planta»). Una sucursal sin plantas
 * (el Cerro) reserva sin planta y su cupo general son sus sillas (`branches.seat_capacity`).
 */
export function branchHasFloors(branch: Pick<BranchRef, 'isDefault'> | null | undefined): boolean {
  return branch?.isDefault === true
}

/**
 * Lo que una pantalla del cupo mira:
 * - `filter`: qué reservas y qué eventos entran.
 * - `capacity`: la sucursal cuyo cupo se muestra. `null` = se miran varias: se cuenta la gente, sin cupo.
 * - `floors`: la sucursal con plantas que entra en lo que se mira (su cupo por planta es el del filtro de planta).
 *   `null` = ninguna de las que se miran tiene plantas.
 */
export type SegmentBranchScope = {
  filter: BranchFilter
  capacity: CapacityBranch | null
  floors: CapacityBranch | null
}

function capacityBranchOf(branch: CapacityBranch): CapacityBranch {
  return { id: branch.id, isDefault: branch.isDefault, seatCapacity: branch.seatCapacity }
}

/** Una sucursal sola: sus reservas, sus eventos y su cupo. */
export function singleBranchSegmentScope(branch: CapacityBranch): SegmentBranchScope {
  const only = capacityBranchOf(branch)
  return { filter: { ids: [only.id] }, capacity: only, floors: branchHasFloors(only) ? only : null }
}

/**
 * El cupo de lo que mira una pantalla, a partir del filtro con el que se dibuja (`branchFilterOf(scope)` en el
 * servidor, o el que mandó el navegador ya recortado con `clampBranchFilter`) y las sucursales de la persona.
 *
 * Con exactamente una sucursal hay cupo; con varias no. Todo el bar (`ids: null`) en un bar de una sola sucursal es
 * esa sucursal. Un id que no está entre las sucursales de la persona no aporta cupo (no debería llegar: el filtro ya
 * viene recortado).
 */
export function segmentScopeFromFilter(
  filter: BranchFilter,
  branches: ReadonlyArray<CapacityBranch>,
): SegmentBranchScope {
  const ids = filter.ids
  const inScope = ids === null ? [...branches] : branches.filter((b) => ids.includes(b.id))
  const [only] = inScope
  const single = ids === null ? inScope.length === 1 : ids.length === 1 && inScope.length === 1
  const capacity = single && only ? only : null
  const floors = inScope.find((b) => branchHasFloors(b)) ?? null
  return {
    filter: ids === null ? { ids: null } : { ids: [...ids] },
    capacity: capacity ? capacityBranchOf(capacity) : null,
    floors: floors ? capacityBranchOf(floors) : null,
  }
}

/**
 * Una clave corta del filtro, para los canales de tiempo real y las `key` de React: cambiar de sucursal es empezar
 * de cero (otra suscripción, otro estado).
 */
export function branchFilterKey(filter: BranchFilter): string {
  if (filter.ids === null) return 'todas'
  if (filter.ids.length === 0) return 'ninguna'
  return [...filter.ids].sort().join('+')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** El parámetro de URL con el que viaja el filtro (las descargas: «Exportar» baja lo que se está viendo). */
export const BRANCH_FILTER_PARAM = 'sucursales'

/** `{ ids: null }` → `todas`; `{ ids: [a, b] }` → `a.b`; ninguna → `ninguna`. */
export function branchFilterToParam(filter: BranchFilter): string {
  if (filter.ids === null) return 'todas'
  if (filter.ids.length === 0) return 'ninguna'
  return filter.ids.join('.')
}

/**
 * Lo inverso de `branchFilterToParam`. Falla cerrado: lo que no se entiende es `null` (el llamador recorta con
 * `clampBranchFilter`, que con `null` deja lo que la persona ve). Hasta 50 sucursales.
 */
export function parseBranchFilterParam(raw: string | null | undefined): BranchFilter | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  if (value === '') return null
  if (value === 'todas') return { ids: null }
  if (value === 'ninguna') return { ids: [] }
  const ids = value.split('.')
  if (ids.length > 50 || !ids.every((id) => UUID.test(id))) return null
  return { ids: [...new Set(ids)] }
}

/** «Elegí una sucursal para ver el cupo»: lo que se dice donde el cupo no se puede mostrar sumado. */
export const PICK_BRANCH_FOR_CAPACITY = 'Elegí una sucursal para ver el cupo.'
