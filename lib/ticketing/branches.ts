import { clampBranchFilter, inBranchFilter } from '@/lib/branches/filter'
import { type BranchScope, branchShortLabel } from '@/lib/branches/types'
import { isOpen } from './availability'
import type { PublicBranch, PublicFunction } from './types'

/**
 * Las entradas y las sucursales (docs/features/sucursales.md). La película es del bar; cada
 * función, de una sucursal. La compra copia la sucursal de su función y la reserva que se crea al
 * pagar también.
 *
 * Puro: lo usan las consultas, las páginas públicas, el panel y las pruebas.
 */

/** Una fila de `branches` con lo que leen las entradas (nunca cupos, teléfonos ni reseñas). */
export type TicketBranchRow = {
  id: string
  slug: string
  name: string
  short_name: string | null
  address: string | null
  color: string | null
  is_default: boolean
  position: number | null
  active: boolean
}

const HEX = /^#[0-9a-f]{6}$/i
const FALLBACK_COLOR = '#2f5d50'

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function toPublicBranch(row: TicketBranchRow): PublicBranch {
  return {
    slug: row.slug,
    name: row.name,
    shortName: text(row.short_name),
    address: text(row.address),
    color: row.color && HEX.test(row.color) ? row.color.toLowerCase() : FALLBACK_COLOR,
  }
}

/** La principal primero y después el orden de Sucursales, como en todo el sistema. */
function byBranchOrder(a: TicketBranchRow, b: TicketBranchRow): number {
  return (
    Number(b.is_default) - Number(a.is_default) ||
    (a.position ?? 0) - (b.position ?? 0) ||
    a.name.localeCompare(b.name, 'es')
  )
}

/**
 * Las sucursales que tienen funciones en lo que se muestra, sin repetir y en el orden de siempre.
 * Una sucursal apagada con una función ya programada entra igual: la función sigue siendo allá.
 */
export function sellingBranches(
  rows: ReadonlyArray<TicketBranchRow>,
  usedIds: Iterable<string | null | undefined>,
): PublicBranch[] {
  const used = new Set<string>()
  for (const id of usedIds) if (id) used.add(id)
  return rows
    .filter((row) => used.has(row.id))
    .sort(byBranchOrder)
    .map(toPublicBranch)
}

/** De id a `slug`, para que lo público nombre la sucursal sin mostrar su id. */
export function branchSlugLookup(
  rows: ReadonlyArray<Pick<TicketBranchRow, 'id' | 'slug'>>,
): (id: string | null | undefined) => string | null {
  const slugs = new Map(rows.map((row) => [row.id, row.slug]))
  return (id) => (id ? (slugs.get(id) ?? null) : null)
}

/** ¿Hace falta decir en qué sucursal es cada función? Solo si más de una tiene funciones. */
export function showBranchNames(branches: ReadonlyArray<unknown>): boolean {
  return branches.length > 1
}

/** El nombre que entra en un talón: el corto, o el nombre si no tiene. */
export function publicBranchLabel(branch: Pick<PublicBranch, 'name' | 'shortName'>): string {
  return branchShortLabel(branch)
}

/** Dónde es una función: la dirección de su sucursal o, si no cargó una, la del bar. */
export function functionAddress(
  branch: Pick<PublicBranch, 'address'> | null | undefined,
  venueAddress: string | null,
): string | null {
  return branch?.address ?? text(venueAddress)
}

const BRANCH_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

/** El `?sucursal=` de un link público: un slug que tenga forma, o nada. */
export function parseBranchParam(raw: string | string[] | null | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : null
  return value && BRANCH_SLUG_RE.test(value) ? value : null
}

/**
 * La función con la que arranca la página de una película: la del día pedido (`?fecha=`) en la
 * sucursal pedida (`?sucursal=`: la misma película puede ir la misma noche en las dos), si no la
 * de ese día, si no la primera con lugar de esa sucursal y, si no, la primera con lugar. Las
 * agotadas y las que tienen la venta frenada no se eligen nunca.
 */
export function pickFunction<F extends Pick<PublicFunction, 'date' | 'state' | 'branch'>>(
  functions: ReadonlyArray<F>,
  wanted: { date: string | null; branch: string | null },
): F | null {
  const open = functions.filter(isOpen)
  const inBranch = (fn: F) => !wanted.branch || fn.branch === wanted.branch
  if (wanted.date) {
    const match =
      open.find((fn) => fn.date === wanted.date && inBranch(fn)) ??
      open.find((fn) => fn.date === wanted.date)
    if (match) return match
  }
  return open.find(inBranch) ?? open[0] ?? null
}

export type FooterPlace = { label: string | null; address: string }

/**
 * Las direcciones del pie. Con una sucursal (o ninguna), una sola: la suya o la del bar. Con
 * varias, cada una con su nombre; las que no cargaron dirección no se listan (repetir la del bar
 * al lado de cada nombre confundiría), y si ninguna cargó, queda la del bar.
 */
export function footerPlaces(
  branches: ReadonlyArray<PublicBranch>,
  venueAddress: string | null,
): FooterPlace[] {
  const venue = text(venueAddress)
  if (branches.length <= 1) {
    const address = functionAddress(branches[0], venue)
    return address ? [{ label: null, address }] : []
  }
  const own = branches.flatMap((branch) =>
    branch.address ? [{ label: branch.name, address: branch.address }] : [],
  )
  if (own.length > 0) return own
  return venue ? [{ label: null, address: venue }] : []
}

/**
 * ¿Esta persona ve la sucursal de algo que ya existe (una compra, una función)? Un dueño las ve
 * todas; el resto, las suyas. Lo usan las acciones del panel: la pantalla ya muestra solo lo de la
 * sucursal que se mira, y esto frena una acción mandada a mano sobre lo de otra.
 */
export function branchVisible(
  scope: Pick<BranchScope, 'branches' | 'unrestricted'>,
  branchId: string | null | undefined,
): boolean {
  return inBranchFilter(branchId, clampBranchFilter(null, scope))
}
