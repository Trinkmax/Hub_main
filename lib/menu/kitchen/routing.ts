/**
 * A qué estación va cada cosa, puro.
 *
 * La estación se pone en una categoría y la heredan sus subcategorías y productos; un producto
 * (o una subcategoría) puede tener la suya. La regla es la de la base
 * (`private.pos_item_station`): la estación propia del producto y, si no tiene, la de la
 * categoría más cercana que tenga una, subiendo a lo sumo doce categorías. No mira si la
 * categoría está pausada ni si la estación está apagada: eso se muestra, no cambia el resultado.
 *
 * Todo lo que la pantalla dice («de Comida», «12 sin estación», «todo a Cocina, menos
 * Ensaladas») sale de acá, así muestra lo mismo que después resuelve la base al pedir.
 */

import type { CartaCategory, CartaItem, KitchenStation, RouteChange } from './types'

/** Cuántas categorías sube la base antes de rendirse (`ch.depth < 12`). */
export const STATION_DEPTH = 12

/** La categoría de mentira de los productos que quedaron sin categoría. */
export const NO_CATEGORY_ID = 'sin-categoria'
export const NO_CATEGORY_NAME = 'Sin categoría'
/** El mismo separador que usa la carta. */
export const PATH_SEPARATOR = ' › '

/** El orden de la carta: por posición; los empates quedan como llegaron (el orden de la lectura). */
function byPosition(a: { position: number }, b: { position: number }): number {
  return a.position - b.position
}

export type CartaTree = {
  byId: ReadonlyMap<string, CartaCategory>
  /**
   * De quién cuelga cada categoría EN PANTALLA: su madre, o `null` si va arriba de todo (no
   * tiene madre, la madre no existe, o había un ciclo y se cortó ahí).
   */
  parent: ReadonlyMap<string, string | null>
  /** Las hijas de cada categoría, en el orden de la carta. `null` = las de arriba de todo. */
  children: ReadonlyMap<string | null, readonly string[]>
  /** Todas, como se recorren: la madre y enseguida todo lo que cuelga de ella. */
  order: readonly string[]
  /** Los productos que cuelgan DIRECTO de cada categoría (`NO_CATEGORY_ID` = los sueltos). */
  items: ReadonlyMap<string, readonly CartaItem[]>
}

/**
 * Arma el árbol. Una categoría cuya madre no existe pasa a ser de arriba de todo, y un ciclo
 * (A dentro de B dentro de A) no cuelga la pantalla: se corta en la primera de la vuelta.
 */
export function cartaTree(
  categories: ReadonlyArray<CartaCategory>,
  items: ReadonlyArray<CartaItem>,
): CartaTree {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const sorted = [...categories].sort(byPosition)
  const parent = new Map<string, string | null>()
  const children = new Map<string | null, string[]>()
  const attach = (id: string, to: string | null) => {
    parent.set(id, to)
    const siblings = children.get(to)
    if (siblings) siblings.push(id)
    else children.set(to, [id])
  }
  for (const category of sorted) {
    const valid =
      category.parentId !== null && category.parentId !== category.id && byId.has(category.parentId)
    attach(category.id, valid ? category.parentId : null)
  }

  const order: string[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    order.push(id)
    for (const child of children.get(id) ?? []) walk(child)
  }
  for (const root of [...(children.get(null) ?? [])]) walk(root)
  // Lo que quedó encerrado en un ciclo no tiene raíz: la primera de la vuelta sube arriba de
  // todo (y deja de colgar de su madre), así se ve y no se recorre dos veces.
  for (const category of sorted) {
    if (seen.has(category.id)) continue
    const was = parent.get(category.id) ?? null
    const siblings = children.get(was)
    if (siblings) {
      children.set(
        was,
        siblings.filter((id) => id !== category.id),
      )
    }
    attach(category.id, null)
    walk(category.id)
  }

  const byCategory = new Map<string, CartaItem[]>()
  for (const item of [...items].sort(byPosition)) {
    const id =
      item.categoryId !== null && byId.has(item.categoryId) ? item.categoryId : NO_CATEGORY_ID
    const list = byCategory.get(id)
    if (list) list.push(item)
    else byCategory.set(id, [item])
  }

  return { byId, parent, children, order, items: byCategory }
}

/** De la de más arriba hasta la madre directa (sin incluir a la propia categoría). */
export function ancestorsOf(tree: CartaTree, id: string): string[] {
  const out: string[] = []
  let current = tree.parent.get(id) ?? null
  // El árbol de pantalla no tiene ciclos; el tope es por si acaso.
  for (let step = 0; current !== null && step < tree.byId.size; step++) {
    out.unshift(current)
    current = tree.parent.get(current) ?? null
  }
  return out
}

/** «Comida › Hamburguesas». Una categoría que no existe es «Sin categoría». */
export function pathLabel(tree: CartaTree, id: string | null): string {
  if (id === null || !tree.byId.has(id)) return NO_CATEGORY_NAME
  return [...ancestorsOf(tree, id), id]
    .map((each) => tree.byId.get(each)?.name ?? '')
    .join(PATH_SEPARATOR)
}

// ─── La regla ────────────────────────────────────────────────────────────────

export type Resolution = {
  /** La estación que resuelve la base. `null` = ninguna. */
  stationId: string | null
  /** `own` = puesta acá · `inherited` = viene de una categoría de arriba · `none` = no tiene. */
  source: 'own' | 'inherited' | 'none'
  /** Con `inherited`: la categoría que la define. */
  fromId: string | null
}

const NONE: Resolution = { stationId: null, source: 'none', fromId: null }

/** Sube desde una categoría, a lo sumo `budget` categorías, hasta la primera con estación. */
function climb(tree: CartaTree, startId: string | null, budget: number): Resolution {
  let current = startId
  for (let step = 0; step < budget && current !== null; step++) {
    const category = tree.byId.get(current)
    if (!category) return NONE
    if (category.stationId !== null) {
      return { stationId: category.stationId, source: 'inherited', fromId: category.id }
    }
    current = category.parentId
  }
  return NONE
}

/** La estación de un producto: la suya, o la de la categoría más cercana que tenga una. */
export function resolveItem(
  tree: CartaTree,
  item: Pick<CartaItem, 'stationId' | 'categoryId'>,
): Resolution {
  if (item.stationId !== null) return { stationId: item.stationId, source: 'own', fromId: null }
  return climb(tree, item.categoryId, STATION_DEPTH)
}

/**
 * La estación de una categoría: la que le toca a un producto que cuelga directo de ella y no
 * tiene una propia. Para ese producto la categoría es el primer escalón de los doce.
 */
export function resolveCategory(tree: CartaTree, id: string): Resolution {
  const category = tree.byId.get(id)
  if (!category) return NONE
  if (category.stationId !== null) {
    return { stationId: category.stationId, source: 'own', fromId: null }
  }
  return climb(tree, category.parentId, STATION_DEPTH - 1)
}

/** Lo que heredaría si no tuviera estación propia (para «igual que Comida» y «volver a seguir»). */
export function inheritedByCategory(tree: CartaTree, id: string): Resolution {
  return climb(tree, tree.byId.get(id)?.parentId ?? null, STATION_DEPTH - 1)
}

export function inheritedByItem(tree: CartaTree, item: Pick<CartaItem, 'categoryId'>): Resolution {
  return climb(tree, item.categoryId, STATION_DEPTH)
}

// ─── Los números ─────────────────────────────────────────────────────────────

/**
 * Lo que hay que mirar de un producto:
 * - `unrouted`: no tiene estación. La cocina lo muestra en TODAS las pantallas.
 * - `inactive`: va a una estación apagada. Solo lo muestra una pantalla que vea todas.
 */
export type RouteProblem = 'unrouted' | 'inactive'

export type ItemRoute = {
  item: CartaItem
  resolution: Resolution
  problem: RouteProblem | null
}

export type BranchStats = {
  /** Productos en todo lo que cuelga de la categoría. */
  products: number
  unrouted: number
  inactive: number
  /** Estación → cuántos productos de esta rama terminan ahí. */
  stations: ReadonlyMap<string, number>
}

export type RoutingStats = {
  total: number
  /** Estación → cuántos productos de la carta terminan ahí. Incluye las apagadas. */
  byStation: ReadonlyMap<string, number>
  unrouted: number
  inactive: number
  /** Producto → cómo le fue. */
  routes: ReadonlyMap<string, ItemRoute>
  /** Categoría (o `NO_CATEGORY_ID`) → los números de su rama. */
  branches: ReadonlyMap<string, BranchStats>
}

function problemOf(
  resolution: Resolution,
  stations: ReadonlyMap<string, KitchenStation>,
): RouteProblem | null {
  if (resolution.stationId === null) return 'unrouted'
  const station = stations.get(resolution.stationId)
  // Una estación que ya no está es lo mismo que no tener: la base la deja vacía al borrarla.
  if (!station) return 'unrouted'
  return station.active ? null : 'inactive'
}

type MutableBranch = {
  products: number
  unrouted: number
  inactive: number
  stations: Map<string, number>
}

/** Toda la carta, resuelta: a dónde va cada producto y cuánto junta cada estación y cada rama. */
export function routingStats(
  tree: CartaTree,
  stations: ReadonlyArray<KitchenStation>,
): RoutingStats {
  const stationsById = new Map(stations.map((station) => [station.id, station]))
  const byStation = new Map<string, number>()
  const routes = new Map<string, ItemRoute>()
  const branches = new Map<string, MutableBranch>()
  let total = 0
  let unrouted = 0
  let inactive = 0

  const branchOf = (id: string): MutableBranch => {
    const found = branches.get(id)
    if (found) return found
    const fresh: MutableBranch = { products: 0, unrouted: 0, inactive: 0, stations: new Map() }
    branches.set(id, fresh)
    return fresh
  }

  for (const [categoryId, list] of tree.items) {
    // La rama de un producto: su categoría y todas las de arriba.
    const lineage =
      categoryId === NO_CATEGORY_ID
        ? [NO_CATEGORY_ID]
        : [...ancestorsOf(tree, categoryId), categoryId]
    for (const item of list) {
      const resolution = resolveItem(tree, item)
      const problem = problemOf(resolution, stationsById)
      const stationId = problem === 'unrouted' ? null : resolution.stationId
      routes.set(item.id, { item, resolution, problem })
      total += 1
      if (problem === 'unrouted') unrouted += 1
      if (problem === 'inactive') inactive += 1
      if (stationId !== null) byStation.set(stationId, (byStation.get(stationId) ?? 0) + 1)
      for (const id of lineage) {
        const branch = branchOf(id)
        branch.products += 1
        if (problem === 'unrouted') branch.unrouted += 1
        if (problem === 'inactive') branch.inactive += 1
        if (stationId !== null) {
          branch.stations.set(stationId, (branch.stations.get(stationId) ?? 0) + 1)
        }
      }
    }
  }

  return { total, byStation, unrouted, inactive, routes, branches }
}

export const EMPTY_BRANCH: BranchStats = {
  products: 0,
  unrouted: 0,
  inactive: 0,
  stations: new Map(),
}

// ─── La regla, en palabras ───────────────────────────────────────────────────

/** Algo de adentro de una categoría que no sigue su estación. */
export type RouteException = {
  node: 'category' | 'item'
  id: string
  name: string
  stationId: string
}

/**
 * Lo que cuelga de una categoría y va a OTRA estación que la de ella: subcategorías con la suya
 * y productos con la suya. Dentro de una subcategoría que ya se aparta no se sigue buscando: lo
 * de adentro es asunto de ella.
 */
export function exceptionsOf(tree: CartaTree, id: string): RouteException[] {
  const effective = resolveCategory(tree, id).stationId
  if (effective === null) return []
  const out: RouteException[] = []
  const seen = new Set<string>([id])
  const walk = (categoryId: string) => {
    for (const item of tree.items.get(categoryId) ?? []) {
      if (item.stationId !== null && item.stationId !== effective) {
        out.push({ node: 'item', id: item.id, name: item.name, stationId: item.stationId })
      }
    }
    for (const childId of tree.children.get(categoryId) ?? []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      const child = tree.byId.get(childId)
      if (!child) continue
      if (child.stationId !== null && child.stationId !== effective) {
        out.push({
          node: 'category',
          id: child.id,
          name: child.name,
          stationId: child.stationId,
        })
        continue
      }
      walk(childId)
    }
  }
  walk(id)
  return out
}

/** Cuántas excepciones se nombran antes de resumir el resto. */
const NAMED_EXCEPTIONS = 2

/**
 * «Todo a Cocina, menos Ensaladas (Fríos) y 2 más.» `null` si nada se aparta: la regla ya se
 * lee en la etiqueta y no hace falta repetirla.
 */
export function ruleSentence(
  stationName: string,
  exceptions: ReadonlyArray<RouteException>,
  nameOf: (stationId: string) => string,
): string | null {
  if (exceptions.length === 0) return null
  // Primero las subcategorías: son las que más pesan.
  const ordered = [...exceptions].sort(
    (a, b) => Number(a.node === 'item') - Number(b.node === 'item'),
  )
  const named = ordered
    .slice(0, NAMED_EXCEPTIONS)
    .map((exception) => `${exception.name} (${nameOf(exception.stationId)})`)
  const rest = ordered.length - named.length
  const parts = rest > 0 ? [...named, `${rest} más`] : named
  const last = parts.pop() ?? ''
  const list = parts.length > 0 ? `${parts.join(', ')} y ${last}` : last
  return `Todo a ${stationName}, menos ${list}.`
}

// ─── Cambios en bloque ───────────────────────────────────────────────────────

/**
 * Las marcas que sobran: categorías y productos con una estación propia IGUAL a la que
 * heredarían. Sacárselas no cambia a dónde va nada hoy, y deja que un cambio en la categoría de
 * arriba las mueva a todas juntas.
 */
export function redundantMarks(tree: CartaTree): RouteChange[] {
  const changes: RouteChange[] = []
  for (const id of tree.order) {
    const category = tree.byId.get(id)
    if (!category || category.stationId === null) continue
    if (inheritedByCategory(tree, id).stationId === category.stationId) {
      changes.push({ node: 'category', id, to: null })
    }
  }
  // Los productos se miran con las categorías ya limpias: lo que hereda cada uno no cambia,
  // porque una marca que sobra es, por definición, igual a lo de arriba.
  for (const list of tree.items.values()) {
    for (const item of list) {
      if (item.stationId === null) continue
      if (inheritedByItem(tree, item).stationId === item.stationId) {
        changes.push({ node: 'item', id: item.id, to: null })
      }
    }
  }
  return changes
}

/** Todo lo que tiene puesta esa estación (categorías y productos), para pasarlo a otra. */
export function marksOfStation(
  tree: CartaTree,
  stationId: string,
  to: string | null,
): RouteChange[] {
  const changes: RouteChange[] = []
  for (const id of tree.order) {
    if (tree.byId.get(id)?.stationId === stationId) changes.push({ node: 'category', id, to })
  }
  for (const list of tree.items.values()) {
    for (const item of list) {
      if (item.stationId === stationId) changes.push({ node: 'item', id: item.id, to })
    }
  }
  return changes
}

/** Cuántas marcas propias (categorías y productos) tiene cada estación. */
export function marksByStation(tree: CartaTree): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (stationId: string | null) => {
    if (stationId !== null) counts.set(stationId, (counts.get(stationId) ?? 0) + 1)
  }
  for (const id of tree.order) add(tree.byId.get(id)?.stationId ?? null)
  for (const list of tree.items.values()) for (const item of list) add(item.stationId)
  return counts
}

/** «1 producto», «12 productos». */
export function productsLabel(count: number): string {
  return `${count} ${count === 1 ? 'producto' : 'productos'}`
}
