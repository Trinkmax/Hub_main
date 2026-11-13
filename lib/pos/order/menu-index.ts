/**
 * La carta, lista para pedir — PURO.
 *
 * `pos_menu` devuelve la carta plana (categorías, productos, aclaraciones). Acá se arma una sola vez
 * lo que la pantalla pregunta cien veces por noche: buscar escribiendo mal y sin acentos, qué
 * aclaraciones lleva un producto, qué es de la barra, qué mostrar cuando todavía no se escribió nada.
 */
import type { MenuCategory, MenuItem, MenuStation, ModifierGroup, PosMenu } from '@/lib/pos/types'
import { nearPrefix, normalize, wordsOf } from './text'

export type MenuOption = ModifierGroup['options'][number]

type SearchEntry = {
  item: MenuItem
  /** El nombre entero, normalizado. */
  name: string
  words: string[]
  /** Las palabras de la categoría y de todas las que la contienen. */
  pathWords: string[]
  /** Puesto en «lo que más sale» (0 = el primero); el resto, infinito. */
  popularity: number
}

export type MenuIndex = {
  menu: PosMenu
  items: ReadonlyMap<string, MenuItem>
  categories: ReadonlyMap<string, MenuCategory>
  stations: ReadonlyMap<string, MenuStation>
  /** Cada aclaración con el grupo al que pertenece. */
  options: ReadonlyMap<string, { option: MenuOption; group: ModifierGroup }>
  /** De cada categoría: ella y todas las que la contienen, de adentro hacia afuera. */
  lineage: ReadonlyMap<string, readonly string[]>
  /** Las categorías que cuelgan de cada una, en orden (`null` = la raíz). */
  children: ReadonlyMap<string | null, readonly MenuCategory[]>
  /** El puesto de cada categoría leyendo la carta de arriba abajo. */
  categoryOrder: ReadonlyMap<string, number>
  /** Los grupos de aclaraciones de cada producto (propios o heredados de su categoría). */
  groupsByItem: ReadonlyMap<string, readonly ModifierGroup[]>
  /** Estaciones que son la barra (por nombre). Vacío = el bar no separa la barra. */
  barStations: ReadonlySet<string>
  entries: readonly SearchEntry[]
}

/** Una categoría no puede colgar de sí misma, pero la base no lo impide: se corta a esta profundidad. */
const MAX_DEPTH = 12

const BAR_STATION_WORDS = new Set([
  'barra',
  'bar',
  'bebida',
  'bebidas',
  'trago',
  'tragos',
  'cocteleria',
  'cafeteria',
  'cafe',
  'vinos',
  'cava',
])

const DRINK_CATEGORY_WORDS = new Set([
  'bebida',
  'bebidas',
  'trago',
  'tragos',
  'coctel',
  'cocteles',
  'cocteleria',
  'cocktails',
  'vino',
  'vinos',
  'espumante',
  'espumantes',
  'cerveza',
  'cervezas',
  'gaseosa',
  'gaseosas',
  'jugo',
  'jugos',
  'licuado',
  'licuados',
  'aperitivo',
  'aperitivos',
  'whisky',
  'cafe',
  'cafeteria',
  'infusion',
  'infusiones',
  'botella',
  'botellas',
  'barra',
])

function byPosition<T extends { position: number; name: string }>(a: T, b: T): number {
  return a.position - b.position || a.name.localeCompare(b.name, 'es', { numeric: true })
}

export function buildMenuIndex(menu: PosMenu): MenuIndex {
  const categories = new Map(menu.categories.map((c) => [c.id, c]))
  const items = new Map(menu.items.map((i) => [i.id, i]))
  const stations = new Map(menu.stations.map((s) => [s.id, s]))

  const lineage = new Map<string, readonly string[]>()
  for (const category of menu.categories) {
    const chain: string[] = []
    let current: MenuCategory | undefined = category
    while (current && chain.length < MAX_DEPTH && !chain.includes(current.id)) {
      chain.push(current.id)
      current = current.parent_id ? categories.get(current.parent_id) : undefined
    }
    lineage.set(category.id, chain)
  }

  const children = new Map<string | null, MenuCategory[]>()
  for (const category of menu.categories) {
    // Una categoría cuyo padre no existe (o está inactivo) se muestra en la raíz.
    const parent =
      category.parent_id && categories.has(category.parent_id) ? category.parent_id : null
    const list = children.get(parent)
    if (list) list.push(category)
    else children.set(parent, [category])
  }
  for (const list of children.values()) list.sort(byPosition)

  const categoryOrder = new Map<string, number>()
  const visit = (parent: string | null, depth: number) => {
    for (const category of children.get(parent) ?? []) {
      if (categoryOrder.has(category.id)) continue
      categoryOrder.set(category.id, categoryOrder.size)
      if (depth < MAX_DEPTH) visit(category.id, depth + 1)
    }
  }
  visit(null, 0)
  // Las que quedaron en un círculo (A cuelga de B y B de A) no se alcanzan desde la raíz: van al final.
  for (const category of menu.categories) {
    if (!categoryOrder.has(category.id)) categoryOrder.set(category.id, categoryOrder.size)
  }

  const options = new Map<string, { option: MenuOption; group: ModifierGroup }>()
  for (const group of menu.modifier_groups) {
    for (const option of group.options) options.set(option.id, { option, group })
  }

  const usable = menu.modifier_groups.filter((g) => g.options.length > 0)
  const groupsByItem = new Map<string, readonly ModifierGroup[]>()
  for (const item of menu.items) {
    const chain = lineage.get(item.category_id) ?? []
    const groups = usable.filter(
      (g) => g.item_ids.includes(item.id) || g.category_ids.some((id) => chain.includes(id)),
    )
    if (groups.length > 0) groupsByItem.set(item.id, groups)
  }

  const barStations = new Set(
    menu.stations
      .filter((s) => wordsOf(s.name).some((w) => BAR_STATION_WORDS.has(w)))
      .map((s) => s.id),
  )

  const rank = new Map(menu.popular_now.map((id, i) => [id, i]))
  const entries: SearchEntry[] = menu.items.map((item) => ({
    item,
    name: normalize(item.name),
    words: wordsOf(item.name),
    pathWords: (lineage.get(item.category_id) ?? []).flatMap((id) =>
      wordsOf(categories.get(id)?.name ?? ''),
    ),
    popularity: rank.get(item.id) ?? Number.POSITIVE_INFINITY,
  }))

  return {
    menu,
    items,
    categories,
    stations,
    options,
    lineage,
    children,
    categoryOrder,
    groupsByItem,
    barStations,
    entries,
  }
}

/** El orden de la carta: por categoría, de arriba abajo, y adentro por posición. */
function byMenuOrder(index: MenuIndex, a: MenuItem, b: MenuItem): number {
  return (
    (index.categoryOrder.get(a.category_id) ?? 0) - (index.categoryOrder.get(b.category_id) ?? 0) ||
    byPosition(a, b)
  )
}

/** Los nombres de la categoría de afuera hacia adentro: [«Comida», «Pizza»]. */
export function categoryPath(index: MenuIndex, categoryId: string): string[] {
  const names: string[] = []
  const chain = index.lineage.get(categoryId) ?? []
  for (let i = chain.length - 1; i >= 0; i--) {
    const name = index.categories.get(chain[i] ?? '')?.name.trim()
    // «Bebidas › Bebidas» no agrega nada.
    if (name && normalize(name) !== normalize(names[names.length - 1] ?? '')) names.push(name)
  }
  return names
}

export function categoryLabel(index: MenuIndex, categoryId: string): string {
  return categoryPath(index, categoryId).join(' › ')
}

// ─── Buscar ──────────────────────────────────────────────────────────────────

/** Cuánto se parece una palabra escrita a un producto, tal cual se escribió. 0 = no aparece. */
function scoreExact(entry: SearchEntry, token: string): number {
  let best = 0
  for (let i = 0; i < entry.words.length; i++) {
    const word = entry.words[i] ?? ''
    let score = 0
    if (word === token) score = i === 0 ? 100 : 82
    else if (word.startsWith(token)) score = i === 0 ? 92 : 72
    else if (token.length >= 3 && word.includes(token)) score = 40
    if (score > best) best = score
  }
  if (best > 0) return best

  // No está en el nombre: ¿está en la categoría? («pizza» trae todas las pizzas).
  for (const word of entry.pathWords) {
    if (word === token) best = Math.max(best, 34)
    else if (word.startsWith(token)) best = Math.max(best, 28)
  }
  return best
}

/** Lo mismo, perdonando un dedazo. Vale poco: siempre queda debajo de lo que coincide de verdad. */
function scoreTypo(entry: SearchEntry, token: string): number {
  if (entry.words.some((word) => nearPrefix(word, token))) return 16
  if (entry.pathWords.some((word) => nearPrefix(word, token))) return 8
  return 0
}

/**
 * Busca en la carta sin acentos ni mayúsculas, por nombre y por categoría. Ordena por parecido; a
 * igual parecido, primero lo que hay, lo que más sale, lo más corto y el orden de la carta.
 *
 * Todo lo que se escribió tiene que aparecer en algún lado (nombre o categoría). El dedazo se
 * perdona en palabras de cinco letras o más («muzza» también trae la «Muzarella» mal escrita); en
 * las de cuatro, solo si así escrita no existe en ningún producto: «flam» encuentra el flan, pero
 * «lomo» no trae el «limón».
 */
export function searchMenu(index: MenuIndex, query: string, limit = 40): MenuItem[] {
  const clean = normalize(query)
  if (!clean) return []
  const tokens = clean.split(' ')
  const forgiving = tokens.map(
    (token) => token.length >= 5 || !index.entries.some((entry) => scoreExact(entry, token) > 0),
  )

  const scored: { entry: SearchEntry; score: number }[] = []
  for (const entry of index.entries) {
    let total = 0
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] ?? ''
      const score = scoreExact(entry, token) || (forgiving[i] ? scoreTypo(entry, token) : 0)
      if (score === 0) {
        total = 0
        break
      }
      total += score
    }
    if (total === 0) continue
    if (entry.name === clean) total += 60
    else if (entry.name.startsWith(clean)) total += 30
    else if (tokens.length > 1 && entry.name.includes(clean)) total += 12
    scored.push({ entry, score: total })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.entry.item.sold_out) - Number(b.entry.item.sold_out) ||
      compareRank(a.entry.popularity, b.entry.popularity) ||
      a.entry.name.length - b.entry.name.length ||
      byMenuOrder(index, a.entry.item, b.entry.item),
  )
  return scored.slice(0, limit).map((s) => s.entry.item)
}

function compareRank(a: number, b: number): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** El primero que se puede pedir: lo que agrega Enter. */
export function firstAddable(results: readonly MenuItem[]): MenuItem | null {
  return results.find((item) => !item.sold_out) ?? null
}

// ─── Sin escribir nada ───────────────────────────────────────────────────────

export type QuickPicks = {
  /** `popular` = lo que más sale a esta hora · `menu` = todavía no hay historia: lo primero de la carta. */
  source: 'popular' | 'menu'
  items: MenuItem[]
}

/**
 * Lo que se ofrece antes de escribir. Si el bar todavía no tiene ventas a esta hora, lo primero de
 * las categorías más grandes, una de cada una por vuelta.
 */
export function quickPicks(index: MenuIndex, limit = 6): QuickPicks {
  const popular: MenuItem[] = []
  for (const id of index.menu.popular_now) {
    const item = index.items.get(id)
    if (item && !popular.includes(item)) popular.push(item)
    if (popular.length >= limit) break
  }
  if (popular.length > 0) return { source: 'popular', items: popular }

  const byCategory = new Map<string, MenuItem[]>()
  for (const item of index.menu.items) {
    const list = byCategory.get(item.category_id)
    if (list) list.push(item)
    else byCategory.set(item.category_id, [item])
  }
  const biggest = [...byCategory.entries()]
    .map(([id, list]) => ({ id, list: [...list].sort(byPosition) }))
    .sort(
      (a, b) =>
        b.list.length - a.list.length ||
        (index.categoryOrder.get(a.id) ?? 0) - (index.categoryOrder.get(b.id) ?? 0),
    )
    .slice(0, Math.max(1, Math.ceil(limit / 2)))

  const picks: MenuItem[] = []
  for (let round = 0; picks.length < limit; round++) {
    let added = false
    for (const { list } of biggest) {
      const item = list[round]
      if (!item || picks.length >= limit) continue
      picks.push(item)
      added = true
    }
    if (!added) break
  }
  return { source: 'menu', items: picks }
}

// ─── Recorrer la carta ───────────────────────────────────────────────────────

export type BrowseNode = {
  /** Estable entre recargas: el camino de nombres. */
  key: string
  name: string
  /** Hermanas con el mismo nombre se muestran como una sola. */
  categoryIds: string[]
  /** Productos que cuelgan directo de acá. */
  items: MenuItem[]
  children: BrowseNode[]
  /** Productos en todo el árbol de abajo. */
  count: number
}

/**
 * La carta como árbol para las fichas de categoría: raíz → sub. Junta las hermanas que se llaman
 * igual (dos «Bebidas» en la raíz son una) y saca las ramas sin productos.
 */
export function buildBrowseTree(index: MenuIndex): BrowseNode[] {
  const itemsOf = new Map<string, MenuItem[]>()
  for (const item of index.menu.items) {
    const list = itemsOf.get(item.category_id)
    if (list) list.push(item)
    else itemsOf.set(item.category_id, [item])
  }

  const build = (
    parents: readonly (string | null)[],
    prefix: string,
    depth: number,
  ): BrowseNode[] => {
    if (depth > MAX_DEPTH) return []
    const siblings = parents.flatMap((p) => index.children.get(p) ?? []).sort(byPosition)
    const merged = new Map<string, MenuCategory[]>()
    for (const category of siblings) {
      const name = normalize(category.name)
      const list = merged.get(name)
      if (list) list.push(category)
      else merged.set(name, [category])
    }
    const nodes: BrowseNode[] = []
    for (const [name, group] of merged) {
      const key = prefix ? `${prefix}/${name}` : name
      const ids = group.map((c) => c.id)
      const items = ids.flatMap((id) => itemsOf.get(id) ?? []).sort(byPosition)
      const children = build(ids, key, depth + 1)
      const count = items.length + children.reduce((sum, child) => sum + child.count, 0)
      if (count === 0) continue
      nodes.push({
        key,
        name: group[0]?.name.trim() ?? name,
        categoryIds: ids,
        items,
        children,
        count,
      })
    }
    return nodes
  }
  return build([null], '', 0)
}

export type BrowseSection = { key: string; heading: string | null; items: MenuItem[] }

/**
 * Lo que se lista al elegir una ficha: primero lo que cuelga directo y después cada sub con su
 * título. Si no hay subs, una sola lista sin título.
 */
export function sectionsOf(node: BrowseNode): BrowseSection[] {
  const sections: BrowseSection[] = []
  if (node.items.length > 0) {
    sections.push({
      key: node.key,
      heading: node.children.length > 0 ? node.name : null,
      items: node.items,
    })
  }
  const walk = (child: BrowseNode, trail: string) => {
    const heading = trail ? `${trail} › ${child.name}` : child.name
    if (child.items.length > 0) sections.push({ key: child.key, heading, items: child.items })
    for (const grandchild of child.children) walk(grandchild, heading)
  }
  for (const child of node.children) walk(child, '')
  return sections
}

// ─── Aclaraciones ────────────────────────────────────────────────────────────

/**
 * Los grupos de aclaraciones de un producto: los que lo nombran a él y los de su categoría o de
 * cualquiera que la contenga (un grupo puesto en «Comida» vale para «Comida › Pizza»).
 */
export function modifierGroupsFor(index: MenuIndex, menuItemId: string): readonly ModifierGroup[] {
  return index.groupsByItem.get(menuItemId) ?? []
}

/** ¿Hay que elegir algo antes de poder pedirlo? */
export function needsChoice(index: MenuIndex, menuItemId: string): boolean {
  return modifierGroupsFor(index, menuItemId).some((g) => g.required)
}

/** Los grupos obligatorios a los que todavía les falta una elección. */
export function missingRequired(
  index: MenuIndex,
  menuItemId: string,
  optionIds: readonly string[],
): ModifierGroup[] {
  return modifierGroupsFor(index, menuItemId).filter(
    (g) => g.required && !g.options.some((o) => optionIds.includes(o.id)),
  )
}

/**
 * Tocar una ficha de aclaración. En un grupo de una sola elección, reemplaza a la que estaba (y si
 * el grupo no es obligatorio, tocar la elegida la saca). En uno de varias, prende y apaga.
 */
export function toggleOption(
  group: ModifierGroup,
  optionIds: readonly string[],
  optionId: string,
): string[] {
  const inGroup = new Set(group.options.map((o) => o.id))
  if (!inGroup.has(optionId)) return [...optionIds]
  const selected = optionIds.includes(optionId)
  if (group.selection === 'multi') {
    return selected ? optionIds.filter((id) => id !== optionId) : [...optionIds, optionId]
  }
  const others = optionIds.filter((id) => !inGroup.has(id))
  if (selected) return group.required ? [...optionIds] : others
  return [...others, optionId]
}

/** De unas aclaraciones guardadas, las que siguen valiendo hoy para ese producto. */
export function validOptionIds(
  index: MenuIndex,
  menuItemId: string,
  optionIds: readonly string[],
): string[] {
  const allowed = new Set(
    modifierGroupsFor(index, menuItemId).flatMap((g) => g.options.map((o) => o.id)),
  )
  return optionIds.filter((id) => allowed.has(id))
}

// ─── Barra ───────────────────────────────────────────────────────────────────

/**
 * ¿Es una bebida? Manda la estación: lo que sale por la barra. Si el bar no tiene una estación de
 * barra, se mira la categoría («Bebidas», «Tragos», «Vinos»…).
 */
export function isDrink(
  index: MenuIndex,
  item: Pick<MenuItem, 'station_id' | 'category_id'>,
): boolean {
  if (index.barStations.size > 0) {
    return item.station_id !== null && index.barStations.has(item.station_id)
  }
  const chain = index.lineage.get(item.category_id) ?? []
  return chain.some((id) =>
    wordsOf(index.categories.get(id)?.name ?? '').some((w) => DRINK_CATEGORY_WORDS.has(w)),
  )
}
