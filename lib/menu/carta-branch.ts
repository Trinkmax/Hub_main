import type { BranchRef } from '@/lib/branches/types'

/**
 * La carta de cada sucursal (docs/features/carta-por-sucursal.md).
 *
 * Un bar con dos o más sucursales abre su carta con un selector, y cada sucursal muestra la carta del bar menos lo
 * que ahí «no se vende», con su precio propio donde lo tenga. Las dos cosas salen de `menu_item_branches`: la misma
 * fila que usa el punto de venta y que el dueño cambia en Carta → Precios. Sin fila, vale la carta.
 *
 * Módulo puro (sin I/O): lo comparten el servidor y las pruebas.
 */

/** Lo que un producto tiene de distinto en una sucursal. */
export type ItemBranchOverride = {
  menu_item_id: string
  /** Vacío = el precio de la carta. */
  price_cents: number | null
  /** Si se vende en esa sucursal. */
  available: boolean
}

/** El nombre del parámetro de la carta, el mismo que usa el resto del sistema en sus links. */
export const CARTA_BRANCH_PARAM = 'sucursal'

/**
 * Los productos de la carta de una sucursal: saca los que ahí no se venden y pone el precio propio donde lo hay.
 * Conserva el orden y no toca los productos sin fila.
 */
export function applyBranchOverrides<Item extends { id: string; price_cents: number }>(
  items: ReadonlyArray<Item>,
  overrides: ReadonlyArray<ItemBranchOverride>,
): Item[] {
  if (overrides.length === 0) return [...items]
  const byItem = new Map(overrides.map((override) => [override.menu_item_id, override]))
  const out: Item[] = []
  for (const item of items) {
    const override = byItem.get(item.id)
    if (!override) {
      out.push(item)
      continue
    }
    if (!override.available) continue
    out.push(override.price_cents === null ? item : { ...item, price_cents: override.price_cents })
  }
  return out
}

/** La sucursal que pide el link (`?sucursal=cerro`), sin importar mayúsculas ni espacios. */
export function findBranchBySlug<Branch extends Pick<BranchRef, 'slug'>>(
  branches: ReadonlyArray<Branch>,
  slug: string | null | undefined,
): Branch | null {
  const wanted = slug?.trim().toLowerCase()
  if (!wanted) return null
  return branches.find((branch) => branch.slug.toLowerCase() === wanted) ?? null
}

/**
 * La fiesta de una sucursal nueva, según su fecha de apertura (`branches.opened_on`) y el día de servicio del bar
 * (que corta a las 5, así la noche de la inauguración sigue siendo la inauguración después de las 12):
 * - `opening`: hoy abre. Cinta para cortar, papel picado y bienvenida en su carta.
 * - `new`: abrió hace menos de {@link NEW_BRANCH_DAYS} días. Solo la etiqueta «Nuevo» en el selector.
 */
export type CartaCelebration = 'opening' | 'new' | null

/** Cuántos días después de abrir una sucursal sigue diciendo «Nuevo». */
export const NEW_BRANCH_DAYS = 14

/** La sucursal de la carta que se está mirando, lista para dibujar. */
export type CartaBranchView = {
  name: string
  slug: string
  /** `#rrggbb`: el color con el que se la reconoce en toda la app. */
  color: string
  celebration: CartaCelebration
  /** El selector, para cambiar de sucursal. */
  pickerHref: string
}

/** Una sucursal en el selector de la carta. */
export type CartaPickerBranch = {
  id: string
  name: string
  slug: string
  address: string | null
  color: string
  /** La carta de esta sucursal. */
  href: string
  celebration: CartaCelebration
}

/**
 * La marca de «ya festejó» de esta pestaña: el papel picado de bienvenida sale una vez, no en cada recarga ni
 * cuando quien cortó la cinta en el selector llega a la carta (ese ya tuvo el suyo).
 */
export function celebrationSeenKey(branchSlug: string): string {
  return `carta-fiesta:${branchSlug}`
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function dayNumber(isoDay: string): number | null {
  if (!ISO_DAY.test(isoDay)) return null
  const time = Date.parse(`${isoDay}T00:00:00Z`)
  return Number.isNaN(time) ? null : Math.round(time / 86_400_000)
}

export function celebrationOf(openedOn: string | null, serviceDay: string): CartaCelebration {
  if (!openedOn) return null
  const opened = dayNumber(openedOn)
  const today = dayNumber(serviceDay)
  if (opened === null || today === null) return null
  const since = today - opened
  if (since === 0) return 'opening'
  if (since > 0 && since < NEW_BRANCH_DAYS) return 'new'
  return null
}

/**
 * La dirección de la carta de una sucursal. Lleva lo que pedía el link original (`?club` abre el club, `?wallet`
 * la billetera), así un link viejo que pasa por el selector no pierde a dónde iba.
 */
export function cartaBranchHref(
  tenantSlug: string,
  branchSlug: string,
  extra: { club?: boolean; wallet?: boolean } = {},
): string {
  const parts = [`${CARTA_BRANCH_PARAM}=${encodeURIComponent(branchSlug)}`]
  if (extra.club) parts.push('club')
  if (extra.wallet) parts.push('wallet')
  return `/carta/${encodeURIComponent(tenantSlug)}?${parts.join('&')}`
}

/** La dirección del selector: la del QR. */
export function cartaPickerHref(tenantSlug: string): string {
  return `/carta/${encodeURIComponent(tenantSlug)}`
}
