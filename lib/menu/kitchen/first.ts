/**
 * Qué sale primero en cocina, puro (`tests/lib/menu-kitchen-first.test.ts`).
 *
 * Pedido de los socios (22/11/2026): «que un producto pueda tener "prioridad" (el caso de una
 * entrada)». Lo marcado encabeza la comanda de su mesa, antes que el resto de los rubros.
 *
 * La regla es la de la base (`private.pos_item_first`): vale lo que diga el producto; si no dice
 * nada, alcanza con que esté marcada su categoría o alguna de las que la contienen (la base sube
 * hasta doce más arriba). Una categoría marcada no se desmarca desde una subcategoría: lo que no
 * tiene que salir primero se desmarca en el producto.
 *
 * Todo lo que la pantalla dice («Sale primero por Comida», «10 de 11 salen primero») sale de acá,
 * así muestra lo mismo que después resuelve la base al armar la cola de cocina.
 */

import type { CartaTree } from './routing'
import type { CartaItem, FirstChange } from './types'

/** Cuántas categorías mira la base desde la del producto: la suya y doce más (`ch.depth < 12`). */
export const FIRST_DEPTH = 13

export type FirstResolution = {
  /** Lo que resuelve la base. */
  first: boolean
  /** `own` = dicho acá · `inherited` = viene de una categoría de arriba · `none` = nadie lo marcó. */
  source: 'own' | 'inherited' | 'none'
  /** Con `inherited`: la categoría más cercana que lo marca. */
  fromId: string | null
}

const NONE: FirstResolution = { first: false, source: 'none', fromId: null }

/** Sube desde una categoría, a lo sumo `budget` categorías, hasta la primera marcada. */
function climb(tree: CartaTree, startId: string | null, budget: number): string | null {
  let current = startId
  for (let step = 0; step < budget && current !== null; step++) {
    const category = tree.byId.get(current)
    if (!category) return null
    if (category.kitchenFirst) return category.id
    current = category.parentId
  }
  return null
}

/**
 * ¿Sale primero lo que cuelga directo de esta categoría (y no dice otra cosa)? `own` si la marca
 * está acá; `inherited` si viene de una de arriba.
 */
export function categoryFirst(tree: CartaTree, id: string): FirstResolution {
  const category = tree.byId.get(id)
  if (!category) return NONE
  if (category.kitchenFirst) return { first: true, source: 'own', fromId: null }
  const from = climb(tree, category.parentId, FIRST_DEPTH - 1)
  return from === null ? NONE : { first: true, source: 'inherited', fromId: from }
}

/** Lo que le toca a un producto por su categoría, diga lo que diga él. */
export function inheritedFirst(
  tree: CartaTree,
  item: Pick<CartaItem, 'categoryId'>,
): { first: boolean; fromId: string | null } {
  const from = climb(tree, item.categoryId, FIRST_DEPTH)
  return { first: from !== null, fromId: from }
}

/** ¿Sale primero este producto? Lo que diga él; si no dice nada, lo de su categoría. */
export function itemFirst(
  tree: CartaTree,
  item: Pick<CartaItem, 'kitchenFirst' | 'categoryId'>,
): FirstResolution {
  if (item.kitchenFirst !== null) {
    return { first: item.kitchenFirst, source: 'own', fromId: null }
  }
  const { fromId } = inheritedFirst(tree, item)
  return fromId === null ? NONE : { first: true, source: 'inherited', fromId }
}

/**
 * Lo que hay que guardar para que un producto salga (o no) primero. Si con seguir a su categoría
 * ya queda así, se le saca la marca propia (`to: null`): así el día que la categoría cambie, él
 * la sigue. `null` si ya está como se pide.
 */
export function itemFirstChange(
  tree: CartaTree,
  item: Pick<CartaItem, 'id' | 'kitchenFirst' | 'categoryId'>,
  want: boolean,
): FirstChange | null {
  const to = want === inheritedFirst(tree, item).first ? null : want
  return to === item.kitchenFirst ? null : { node: 'item', id: item.id, to }
}

/** Marcar o desmarcar una categoría. `null` si ya está así (o no existe). */
export function categoryFirstChange(
  tree: CartaTree,
  id: string,
  want: boolean,
): FirstChange | null {
  const category = tree.byId.get(id)
  if (!category || category.kitchenFirst === want) return null
  return { node: 'category', id, to: want }
}

// ─── Los números ─────────────────────────────────────────────────────────────

export type FirstBranch = {
  /** Productos en todo lo que cuelga de la categoría. */
  products: number
  /** De esos, los que salen primero. */
  first: number
}

export type FirstStats = {
  /** Productos de la carta (con categoría) que salen primero. */
  first: number
  /** Productos de la carta (con categoría). */
  products: number
  /** Cada categoría con lo que cuelga de ella, a cualquier profundidad. */
  byBranch: ReadonlyMap<string, FirstBranch>
  /** Cómo quedó resuelto cada producto con categoría. */
  items: ReadonlyMap<string, FirstResolution>
}

/**
 * Cuenta qué sale primero. Los productos sin categoría no entran: el mozo no los puede pedir, así
 * que la cocina nunca los ve.
 */
export function firstStats(tree: CartaTree): FirstStats {
  const byBranch = new Map<string, FirstBranch>()
  const items = new Map<string, FirstResolution>()
  let first = 0
  let products = 0

  const walk = (id: string): FirstBranch => {
    const branch: FirstBranch = { products: 0, first: 0 }
    for (const item of tree.items.get(id) ?? []) {
      const resolution = itemFirst(tree, item)
      items.set(item.id, resolution)
      branch.products += 1
      if (resolution.first) branch.first += 1
    }
    for (const child of tree.children.get(id) ?? []) {
      const inside = walk(child)
      branch.products += inside.products
      branch.first += inside.first
    }
    byBranch.set(id, branch)
    return branch
  }
  for (const root of tree.children.get(null) ?? []) {
    const branch = walk(root)
    first += branch.first
    products += branch.products
  }
  return { first, products, byBranch, items }
}

// ─── Las palabras ────────────────────────────────────────────────────────────

/** «7 productos salen primero», con el número aparte para escribirlo grande. */
export function firstHeadline(stats: Pick<FirstStats, 'first'>): { figure: string; lead: string } {
  if (stats.first === 0) return { figure: 'Nada', lead: 'sale primero todavía' }
  return {
    figure: String(stats.first),
    lead: stats.first === 1 ? 'producto sale primero' : 'productos salen primero',
  }
}

/** Lo que se lee debajo del nombre de una categoría. `null` = nada para decir. */
export function categoryFirstNote(tree: CartaTree, stats: FirstStats, id: string): string | null {
  const resolution = categoryFirst(tree, id)
  const branch = stats.byBranch.get(id) ?? { products: 0, first: 0 }
  if (resolution.source === 'inherited') {
    const from = resolution.fromId ? tree.byId.get(resolution.fromId)?.name : null
    return from ? `Sale primero por ${from}` : 'Sale primero por la categoría de arriba'
  }
  if (resolution.source === 'own') {
    if (branch.products === 0) return 'Lo que cargues acá va a salir primero'
    if (branch.first === branch.products) {
      return branch.products === 1
        ? 'Su producto encabeza la comanda'
        : `Sus ${branch.products} productos encabezan la comanda`
    }
    return `${branch.first} de sus ${branch.products} productos encabezan la comanda`
  }
  if (branch.first === 0) return null
  return branch.first === 1
    ? `1 de ${branch.products} sale primero`
    : `${branch.first} de ${branch.products} salen primero`
}

/** Lo que se lee debajo del nombre de un producto. `null` = no sale primero y nadie dijo nada. */
export function itemFirstNote(
  tree: CartaTree,
  item: Pick<CartaItem, 'kitchenFirst' | 'categoryId'>,
): string | null {
  const inherited = inheritedFirst(tree, item)
  if (item.kitchenFirst === null) return inherited.first ? 'Sale primero por su categoría' : null
  if (item.kitchenFirst)
    return inherited.first ? 'Sale primero' : 'Sale primero: solo este producto'
  return inherited.first ? 'Este no, aunque su categoría sí' : null
}

/** El aviso de «guardado» (y lo que nombra «Deshacer»). */
export function firstSay(name: string, first: boolean): string {
  return first ? `${name} sale primero` : `${name} ya no sale primero`
}

/** Las categorías que conviene mostrar abiertas: las que tienen algo marcado adentro, sin serlo ellas. */
export function branchesWithMarks(tree: CartaTree, stats: FirstStats): string[] {
  return tree.order.filter((id) => {
    const branch = stats.byBranch.get(id)
    if (!branch || branch.first === 0) return false
    return categoryFirst(tree, id).source === 'none'
  })
}
