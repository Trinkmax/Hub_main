/**
 * El árbol de categorías de la carta, puro: quién cuelga de quién, en qué orden y cómo se
 * llama el camino («Comida › Hamburguesas»). Lo usan la lista de «Precios» y el aumento por
 * categorías (elegir una madre incluye a sus hijas).
 */

import type { PriceCategory, PriceItem } from './types'

/** La categoría de mentira de los productos que quedaron sin categoría. */
export const NO_CATEGORY_ID = 'sin-categoria'
export const NO_CATEGORY_NAME = 'Sin categoría'
/** El mismo separador que usa la carta (`categoryPathLabel`). */
export const PATH_SEPARATOR = ' › '

/**
 * El orden de la carta: por posición. Cuando dos empatan, se respeta el orden en que llegaron
 * (el sort es estable), que es el de la lectura: el mismo con el que los muestra la carta. Sin
 * `localeCompare`: el servidor y el navegador tienen que ordenar exactamente igual.
 */
export function byCartaOrder(a: { position: number }, b: { position: number }): number {
  return a.position - b.position
}

export type CategoryTree = {
  byId: ReadonlyMap<string, PriceCategory>
  /** Las hijas de cada categoría, en el orden de la carta. `null` = las de arriba de todo. */
  children: ReadonlyMap<string | null, readonly string[]>
  /** Todas, en el orden en que se recorren: la madre y enseguida todo lo que cuelga de ella. */
  order: readonly string[]
}

/**
 * Arma el árbol. Una categoría cuya madre no existe pasa a ser de arriba de todo, y un ciclo
 * (A dentro de B dentro de A) no cuelga la pantalla: se corta donde se repite.
 */
export function categoryTree(categories: ReadonlyArray<PriceCategory>): CategoryTree {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const children = new Map<string | null, string[]>()
  for (const category of [...categories].sort(byCartaOrder)) {
    const parent =
      category.parentId !== null && category.parentId !== category.id && byId.has(category.parentId)
        ? category.parentId
        : null
    const siblings = children.get(parent)
    if (siblings) siblings.push(category.id)
    else children.set(parent, [category.id])
  }

  const order: string[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    order.push(id)
    for (const child of children.get(id) ?? []) walk(child)
  }
  for (const root of children.get(null) ?? []) walk(root)
  // Lo que quedó encerrado en un ciclo no tiene raíz: se recorre igual, para no perderlo.
  for (const category of [...categories].sort(byCartaOrder)) walk(category.id)

  return { byId, children, order }
}

/** La categoría y todo lo que cuelga de ella. */
export function descendantsOf(tree: CategoryTree, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (current: string) => {
    if (seen.has(current)) return
    seen.add(current)
    out.push(current)
    for (const child of tree.children.get(current) ?? []) walk(child)
  }
  walk(id)
  return out
}

/** De la de más arriba hasta la madre directa (sin incluir a la propia categoría). */
export function ancestorsOf(tree: CategoryTree, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  let parent = tree.byId.get(id)?.parentId ?? null
  while (parent !== null && tree.byId.has(parent) && !seen.has(parent)) {
    seen.add(parent)
    out.unshift(parent)
    parent = tree.byId.get(parent)?.parentId ?? null
  }
  return out
}

export type CategoryPath = {
  /** Los nombres de las madres, de arriba hacia abajo. */
  ancestors: string[]
  name: string
  /** «Comida › Hamburguesas». */
  label: string
  /** `false` si ella o alguna de sus madres está pausada. */
  active: boolean
}

export function categoryPath(tree: CategoryTree, id: string): CategoryPath {
  const category = tree.byId.get(id)
  if (!category) {
    return { ancestors: [], name: NO_CATEGORY_NAME, label: NO_CATEGORY_NAME, active: true }
  }
  const above = ancestorsOf(tree, id)
    .map((ancestor) => tree.byId.get(ancestor))
    .filter((ancestor): ancestor is PriceCategory => ancestor !== undefined)
  const ancestors = above.map((ancestor) => ancestor.name)
  return {
    ancestors,
    name: category.name,
    label: [...ancestors, category.name].join(PATH_SEPARATOR),
    active: category.active && above.every((ancestor) => ancestor.active),
  }
}

/** La categoría de un producto: la suya si existe, o la de «sin categoría». */
export function itemCategoryId(tree: CategoryTree, item: Pick<PriceItem, 'categoryId'>): string {
  return item.categoryId !== null && tree.byId.has(item.categoryId)
    ? item.categoryId
    : NO_CATEGORY_ID
}
