/**
 * Lo que se ve en «Precios», puro:
 *
 * - **Qué precio se cobra en cada lugar**: el de la carta, o el propio de una sucursal si lo
 *   tiene (`rowPrice`).
 * - **El borrador**: lo que la persona acaba de cambiar se ve al instante, encima de lo último
 *   que se leyó de la base, mientras el servidor guarda. Si el guardado falla, el borrador de
 *   ese precio se va y vuelve a verse lo que hay en la base. Cuando llega una lectura posterior
 *   al guardado, el borrador se descarta: la base manda.
 * - **Los grupos**: los productos por categoría, en el orden de la carta.
 */

import {
  byCartaOrder,
  type CategoryTree,
  categoryPath,
  itemCategoryId,
  NO_CATEGORY_ID,
  NO_CATEGORY_NAME,
} from './tree'
import {
  type BranchOverride,
  type PriceChange,
  type PriceItem,
  type PriceSnapshot,
  type PriceWriteFailure,
  pointKey,
  type ViewId,
} from './types'

// ─── El borrador ─────────────────────────────────────────────────────────────

type DraftMark = {
  /** El pedido que lo escribió: un cambio posterior sobre el mismo precio lo reemplaza. */
  token: number
  saving: boolean
  /** Reloj del servidor cuando terminó de guardarse. */
  savedAt: number | null
}

export type DraftPrice = DraftMark & {
  itemId: string
  branchId: string | null
  /** En una sucursal, `null` = sigue el precio de la carta. */
  cents: number | null
}

export type DraftAvailability = DraftMark & {
  itemId: string
  branchId: string
  available: boolean
}

export type Draft = {
  prices: Readonly<Record<string, DraftPrice>>
  availability: Readonly<Record<string, DraftAvailability>>
}

export const EMPTY_DRAFT: Draft = { prices: {}, availability: {} }

/** Lo que se acaba de cambiar se ve ya, marcado como «guardando». */
export function draftStartPrices(
  draft: Draft,
  token: number,
  changes: ReadonlyArray<PriceChange>,
): Draft {
  const prices = { ...draft.prices }
  for (const change of changes) {
    prices[pointKey(change.branchId, change.itemId)] = {
      itemId: change.itemId,
      branchId: change.branchId,
      cents: change.toCents,
      token,
      saving: true,
      savedAt: null,
    }
  }
  return { ...draft, prices }
}

/**
 * El servidor contestó. Lo que se guardó deja de estar «guardando»; lo que falló se va (y si
 * el servidor dijo cuánto vale ahora, se muestra eso). `loadedAt` es la lectura que la
 * pantalla tiene en este momento: si ya es posterior al guardado, el borrador sobra.
 */
export function draftSettlePrices(
  draft: Draft,
  token: number,
  args: { savedAt: number; loadedAt: number; failed: ReadonlyArray<PriceWriteFailure> },
): Draft {
  const failed = new Map(
    args.failed.map((failure) => [pointKey(failure.branchId, failure.itemId), failure]),
  )
  const covered = args.savedAt <= args.loadedAt
  const prices: Record<string, DraftPrice> = {}
  for (const [key, entry] of Object.entries(draft.prices)) {
    if (entry.token !== token) {
      prices[key] = entry
      continue
    }
    const failure = failed.get(key)
    if (failure) {
      if (failure.currentCents === undefined || covered) continue
      // El precio de la carta nunca queda vacío: si no hay dato, se vuelve a lo leído.
      if (failure.currentCents === null && entry.branchId === null) continue
      prices[key] = { ...entry, cents: failure.currentCents, saving: false, savedAt: args.savedAt }
      continue
    }
    if (!covered) prices[key] = { ...entry, saving: false, savedAt: args.savedAt }
  }
  return { ...draft, prices }
}

/** El pedido entero falló (sin conexión, sin permiso): todo lo suyo vuelve a lo leído. */
export function draftDropToken(draft: Draft, token: number): Draft {
  const prices: Record<string, DraftPrice> = {}
  for (const [key, entry] of Object.entries(draft.prices)) {
    if (entry.token !== token) prices[key] = entry
  }
  const availability: Record<string, DraftAvailability> = {}
  for (const [key, entry] of Object.entries(draft.availability)) {
    if (entry.token !== token) availability[key] = entry
  }
  return { prices, availability }
}

export function draftStartAvailability(
  draft: Draft,
  token: number,
  args: { branchId: string; itemIds: ReadonlyArray<string>; available: boolean },
): Draft {
  const availability = { ...draft.availability }
  for (const itemId of args.itemIds) {
    availability[pointKey(args.branchId, itemId)] = {
      itemId,
      branchId: args.branchId,
      available: args.available,
      token,
      saving: true,
      savedAt: null,
    }
  }
  return { ...draft, availability }
}

export function draftSettleAvailability(
  draft: Draft,
  token: number,
  args: { savedAt: number; loadedAt: number },
): Draft {
  const covered = args.savedAt <= args.loadedAt
  const availability: Record<string, DraftAvailability> = {}
  for (const [key, entry] of Object.entries(draft.availability)) {
    if (entry.token !== token) availability[key] = entry
    else if (!covered) availability[key] = { ...entry, saving: false, savedAt: args.savedAt }
  }
  return { ...draft, availability }
}

/**
 * Llegó una lectura nueva de la base: lo ya guardado ANTES de esa lectura está incluido en
 * ella y se descarta. Lo que todavía se está guardando, o se guardó después, se queda encima.
 */
export function draftSync(draft: Draft, loadedAt: number): Draft {
  const keep = (entry: DraftMark) =>
    entry.saving || entry.savedAt === null || entry.savedAt > loadedAt
  const prices: Record<string, DraftPrice> = {}
  for (const [key, entry] of Object.entries(draft.prices)) if (keep(entry)) prices[key] = entry
  const availability: Record<string, DraftAvailability> = {}
  for (const [key, entry] of Object.entries(draft.availability)) {
    if (keep(entry)) availability[key] = entry
  }
  if (
    Object.keys(prices).length === Object.keys(draft.prices).length &&
    Object.keys(availability).length === Object.keys(draft.availability).length
  ) {
    return draft
  }
  return { prices, availability }
}

// ─── Qué se cobra en cada lugar ──────────────────────────────────────────────

/** La carta con el borrador encima: lo que la pantalla muestra y de donde parten las cuentas. */
export type PriceBook = {
  /** Producto → precio de la carta. */
  menu: ReadonlyMap<string, number>
  /** `pointKey(sucursal, producto)` → lo que ese producto tiene de distinto ahí. */
  overrides: ReadonlyMap<string, BranchOverride>
  /** Los precios y los «se vende acá» que se están guardando ahora. */
  saving: ReadonlySet<string>
}

export function buildPriceBook(
  snapshot: Pick<PriceSnapshot, 'items' | 'overrides'>,
  draft: Draft,
): PriceBook {
  const menu = new Map<string, number>()
  for (const item of snapshot.items) menu.set(item.id, item.priceCents)
  const overrides = new Map<string, BranchOverride>()
  for (const override of snapshot.overrides) {
    overrides.set(pointKey(override.branchId, override.itemId), override)
  }
  const saving = new Set<string>()

  for (const [key, entry] of Object.entries(draft.prices)) {
    if (entry.saving) saving.add(key)
    if (entry.branchId === null) {
      // Un producto que ya no está en la lectura no vuelve por un borrador viejo.
      if (entry.cents !== null && menu.has(entry.itemId)) menu.set(entry.itemId, entry.cents)
      continue
    }
    const current = overrides.get(key)
    overrides.set(key, {
      branchId: entry.branchId,
      itemId: entry.itemId,
      priceCents: entry.cents,
      available: current?.available ?? true,
    })
  }
  for (const [key, entry] of Object.entries(draft.availability)) {
    if (entry.saving) saving.add(key)
    const current = overrides.get(key)
    overrides.set(key, {
      branchId: entry.branchId,
      itemId: entry.itemId,
      priceCents: current?.priceCents ?? null,
      available: entry.available,
    })
  }
  return { menu, overrides, saving }
}

export type RowPrice = {
  /** Lo que se cobra en el lugar que se está mirando. */
  effectiveCents: number
  /** El precio de la carta. */
  menuCents: number
  /** El precio propio de la sucursal que se mira, o `null` si sigue la carta. */
  ownCents: number | null
  /** Si se vende en la sucursal que se mira (en «Toda la carta», siempre). */
  available: boolean
}

/** El precio de un producto según dónde se esté parado. */
export function rowPrice(book: PriceBook, item: PriceItem, view: ViewId): RowPrice {
  const menuCents = book.menu.get(item.id) ?? item.priceCents
  if (view === null) {
    return { effectiveCents: menuCents, menuCents, ownCents: null, available: true }
  }
  const override = book.overrides.get(pointKey(view, item.id))
  const ownCents = override?.priceCents ?? null
  return {
    effectiveCents: ownCents ?? menuCents,
    menuCents,
    ownCents,
    available: override?.available ?? true,
  }
}

/** Los productos con el precio de la carta al día (el borrador encima). */
export function liveItems(items: ReadonlyArray<PriceItem>, book: PriceBook): PriceItem[] {
  return items.map((item) => {
    const cents = book.menu.get(item.id)
    return cents === undefined || cents === item.priceCents ? item : { ...item, priceCents: cents }
  })
}

// ─── Los grupos de la lista ──────────────────────────────────────────────────

export type PriceGroup = {
  /** El id de la categoría, o el de «sin categoría». */
  id: string
  name: string
  /** Los nombres de las categorías de arriba: «Comida». */
  ancestors: string[]
  /** «Comida › Hamburguesas». */
  pathLabel: string
  /** `false` si la categoría (o una de arriba) está pausada. */
  active: boolean
  items: PriceItem[]
}

/**
 * Los productos por categoría, en el orden de la carta. Solo salen las categorías que tienen
 * productos propios; lo que quedó sin categoría va al final, en su grupo.
 */
export function buildGroups(tree: CategoryTree, items: ReadonlyArray<PriceItem>): PriceGroup[] {
  const byCategory = new Map<string, PriceItem[]>()
  for (const item of items) {
    const id = itemCategoryId(tree, item)
    const list = byCategory.get(id)
    if (list) list.push(item)
    else byCategory.set(id, [item])
  }
  const groups: PriceGroup[] = []
  for (const id of tree.order) {
    const own = byCategory.get(id)
    if (!own) continue
    const path = categoryPath(tree, id)
    groups.push({
      id,
      name: path.name,
      ancestors: path.ancestors,
      pathLabel: path.label,
      active: path.active,
      items: [...own].sort(byCartaOrder),
    })
  }
  const loose = byCategory.get(NO_CATEGORY_ID)
  if (loose) {
    groups.push({
      id: NO_CATEGORY_ID,
      name: NO_CATEGORY_NAME,
      ancestors: [],
      pathLabel: NO_CATEGORY_NAME,
      active: true,
      items: [...loose].sort(byCartaOrder),
    })
  }
  return groups
}

/** De cuánto a cuánto van los precios de un grupo, para decirlo en su título. */
export function priceRange(cents: ReadonlyArray<number>): { min: number; max: number } | null {
  if (cents.length === 0) return null
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of cents) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}
