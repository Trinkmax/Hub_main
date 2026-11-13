/**
 * El buscador de «Cocina y aclaraciones», puro: el mismo de «Precios» (sin tildes ni mayúsculas,
 * por nombre y por el camino de la categoría), pero acá también se encuentran las categorías,
 * porque la estación casi siempre se pone ahí.
 */

import {
  buildSearchIndex,
  type SearchIndex,
  searchPrices,
  searchTokens,
} from '@/lib/menu/prices/search'
import { type CartaTree, NO_CATEGORY_ID, pathLabel } from './routing'

export type CartaIndex = {
  categories: SearchIndex
  items: SearchIndex
}

/** Arma el índice una vez por lectura: las categorías y los productos, en el orden de la carta. */
export function buildCartaIndex(tree: CartaTree): CartaIndex {
  const categories = tree.order.map((id) => {
    const parent = tree.parent.get(id) ?? null
    return {
      id,
      name: tree.byId.get(id)?.name ?? '',
      // El camino de las de arriba (vacío en las de arriba de todo).
      path: parent === null ? '' : pathLabel(tree, parent),
    }
  })
  const items = [...tree.order, NO_CATEGORY_ID].flatMap((categoryId) => {
    const path = pathLabel(tree, categoryId === NO_CATEGORY_ID ? null : categoryId)
    return (tree.items.get(categoryId) ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      path,
    }))
  })
  return { categories: buildSearchIndex(categories), items: buildSearchIndex(items) }
}

export type CartaHits = {
  /** Las categorías que se llaman así (no las que solo la contienen). */
  categories: string[]
  items: string[]
}

/** Lo que coincide, del mejor al peor. `null` = no se está buscando. */
export function searchCarta(index: CartaIndex, query: string): CartaHits | null {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return null
  // Una categoría entra si TODO lo buscado está en su propio nombre: «comida pizza» encuentra
  // productos, no la categoría Pizza.
  const named = new Set(
    index.categories
      .filter((entry) => tokens.every((token) => entry.name.includes(token)))
      .map((entry) => entry.id),
  )
  return {
    categories: (searchPrices(index.categories, query) ?? []).filter((id) => named.has(id)),
    items: searchPrices(index.items, query) ?? [],
  }
}
