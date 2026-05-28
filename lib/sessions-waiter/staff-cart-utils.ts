import type { StaffMenuCategory, StaffMenuItem } from './staff-menu-queries'

export type StaffCartEntry = {
  menuItemId: string
  quantity: number
  notes: string | null
}

export type StaffCartLine = StaffCartEntry & {
  name: string
  unitPriceCents: number
  lineTotalCents: number
}

/** Aplana las categorías y devuelve un Map id→item para lookup rápido. */
export function indexMenuItems(menu: StaffMenuCategory[]): Map<string, StaffMenuItem> {
  const map = new Map<string, StaffMenuItem>()
  for (const cat of menu) {
    for (const it of cat.items) map.set(it.id, it)
  }
  return map
}

/** Reconstruye las líneas del carrito enriqueciéndolas con nombre y precio del menú. */
export function buildCartLines(
  cart: StaffCartEntry[],
  itemsById: Map<string, StaffMenuItem>,
): StaffCartLine[] {
  return cart
    .map((entry) => {
      const it = itemsById.get(entry.menuItemId)
      if (!it) return null
      return {
        ...entry,
        name: it.name,
        unitPriceCents: it.price_cents,
        lineTotalCents: it.price_cents * entry.quantity,
      } satisfies StaffCartLine
    })
    .filter((l): l is StaffCartLine => l !== null)
}

export function cartTotalCents(lines: StaffCartLine[]): number {
  return lines.reduce((sum, l) => sum + l.lineTotalCents, 0)
}

export function cartItemCount(cart: StaffCartEntry[]): number {
  return cart.reduce((sum, e) => sum + e.quantity, 0)
}
