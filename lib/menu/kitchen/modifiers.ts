/**
 * Las aclaraciones, puro: cómo se elige cada grupo, a qué productos llega y la misma carta que
 * recibe el mozo, para que la vista previa sea la de verdad.
 *
 * A qué productos llega un grupo es la regla de la comanda (`lib/pos/order/menu-index.ts`,
 * `buildMenuIndex`): a los productos que lo nombran y a los de una categoría enganchada o de
 * cualquiera que cuelgue de ella. Solo cuentan los productos que se venden (activos y con
 * categoría) y la cadena de categorías activas: una categoría pausada corta la herencia.
 */

import type { PosMenu } from '@/lib/pos/types'
import { cartaTree, NO_CATEGORY_ID, resolveItem } from './routing'
import type {
  CartaCategory,
  CartaItem,
  KitchenSnapshot,
  ModifierGroup,
  ModifierLink,
  ModifierOption,
} from './types'

// ─── Cómo se elige ───────────────────────────────────────────────────────────

/** Las cuatro maneras de elegir que entiende la base (`selection` + `required`). */
export type RuleId = 'one_optional' | 'one_required' | 'many_optional' | 'many_required'

export type Rule = {
  id: RuleId
  selection: ModifierGroup['selection']
  required: boolean
  /** Cómo se llama en la pantalla del dueño. */
  label: string
  /** Qué significa, en una oración. */
  hint: string
}

export const RULES: ReadonlyArray<Rule> = [
  {
    id: 'one_optional',
    selection: 'single',
    required: false,
    label: 'Una, si hace falta',
    hint: 'El mozo toca una o ninguna. Si no toca nada, sale como viene.',
  },
  {
    id: 'one_required',
    selection: 'single',
    required: true,
    label: 'Una sí o sí',
    hint: 'No se puede pedir sin elegir. Para el punto de un lomo o el gusto de un licuado.',
  },
  {
    id: 'many_optional',
    selection: 'multi',
    required: false,
    label: 'Las que hagan falta',
    hint: 'Ninguna, una o varias. Para sacar ingredientes o sumar extras.',
  },
  {
    id: 'many_required',
    selection: 'multi',
    required: true,
    label: 'Al menos una',
    hint: 'Una o varias, pero alguna. Para armar un plato con lo que elija el cliente.',
  },
]

export function ruleOf(group: Pick<ModifierGroup, 'selection' | 'required'>): Rule {
  const found = RULES.find(
    (rule) => rule.selection === group.selection && rule.required === group.required,
  )
  // Las cuatro combinaciones están en la lista.
  return found ?? (RULES[0] as Rule)
}

export function ruleById(id: RuleId): Rule {
  return RULES.find((rule) => rule.id === id) ?? (RULES[0] as Rule)
}

// ─── El orden ────────────────────────────────────────────────────────────────

/** El orden en que la base le manda las cosas al mozo: por posición y, a igual posición, por nombre. */
function byPositionThen<T extends { position: number }>(text: (row: T) => string) {
  return (a: T, b: T) => a.position - b.position || text(a).localeCompare(text(b), 'es')
}

export const byGroupOrder = byPositionThen<ModifierGroup>((group) => group.name)
export const byOptionOrder = byPositionThen<ModifierOption>((option) => option.label)

/** Las opciones de un grupo, en orden. */
export function optionsOf(
  options: ReadonlyArray<ModifierOption>,
  groupId: string,
): ModifierOption[] {
  return options.filter((option) => option.groupId === groupId).sort(byOptionOrder)
}

/** La posición de lo que se agrega al final de una lista. */
export function nextPosition(rows: ReadonlyArray<{ position: number }>): number {
  let max = -1
  for (const row of rows) if (row.position > max) max = row.position
  return max + 1
}

// ─── A qué productos llega ───────────────────────────────────────────────────

/** La misma profundidad a la que corta la comanda (`MAX_DEPTH`). */
const LINEAGE_DEPTH = 12

/** ¿El mozo lo puede pedir? Activo y con categoría: es el filtro de `pos_menu`. */
export function isSellable(item: Pick<CartaItem, 'active' | 'categoryId'>): boolean {
  return item.active && item.categoryId !== null
}

/**
 * De cada categoría activa: ella y las que la contienen, de adentro hacia afuera, mientras
 * sigan activas. Una categoría pausada no llega al mozo, así que la cadena se corta ahí.
 */
function activeLineage(categories: ReadonlyArray<CartaCategory>): Map<string, string[]> {
  const active = new Map(
    categories.filter((category) => category.active).map((category) => [category.id, category]),
  )
  const lineage = new Map<string, string[]>()
  for (const category of active.values()) {
    const chain: string[] = []
    let current: CartaCategory | undefined = category
    while (current && chain.length < LINEAGE_DEPTH && !chain.includes(current.id)) {
      chain.push(current.id)
      current = current.parentId ? active.get(current.parentId) : undefined
    }
    lineage.set(category.id, chain)
  }
  return lineage
}

export type GroupReach = {
  /** Grupo → los productos que se venden a los que se les ofrece, en el orden de la lectura. */
  itemsByGroup: ReadonlyMap<string, readonly string[]>
  /** Producto → los grupos enganchados (estén activos o no, tengan opciones o no). */
  groupsByItem: ReadonlyMap<string, readonly string[]>
}

/**
 * A qué productos está enganchado cada grupo. No mira si el grupo está activo ni si tiene
 * opciones: dice a dónde llegaría. Lo que de verdad ve el mozo sale de `waiterGroups`.
 */
export function groupReach(
  snapshot: Pick<KitchenSnapshot, 'categories' | 'items' | 'groups' | 'links'>,
): GroupReach {
  const lineage = activeLineage(snapshot.categories)
  const byCategory = new Map<string, Set<string>>()
  const byItem = new Map<string, Set<string>>()
  for (const link of snapshot.links) {
    const index = link.target === 'category' ? byCategory : byItem
    const set = index.get(link.targetId)
    if (set) set.add(link.groupId)
    else index.set(link.targetId, new Set([link.groupId]))
  }

  // El orden en que el mozo ve las preguntas: el de los grupos, no el de la lectura.
  const order = new Map(
    [...snapshot.groups].sort(byGroupOrder).map((group, index) => [group.id, index]),
  )
  const itemsByGroup = new Map<string, string[]>(snapshot.groups.map((group) => [group.id, []]))
  const groupsByItem = new Map<string, string[]>()
  for (const item of snapshot.items) {
    if (!isSellable(item)) continue
    const found = new Set<string>(byItem.get(item.id) ?? [])
    for (const categoryId of lineage.get(item.categoryId ?? '') ?? []) {
      for (const groupId of byCategory.get(categoryId) ?? []) found.add(groupId)
    }
    const known = [...found]
      .filter((groupId) => order.has(groupId))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    if (known.length === 0) continue
    groupsByItem.set(item.id, known)
    for (const groupId of known) itemsByGroup.get(groupId)?.push(item.id)
  }
  return { itemsByGroup, groupsByItem }
}

/** ¿El mozo ve este grupo? Tiene que estar activo y tener al menos una opción activa. */
export function isUsable(group: ModifierGroup, options: ReadonlyArray<ModifierOption>): boolean {
  return group.active && options.some((option) => option.groupId === group.id && option.active)
}

/**
 * En qué anda un grupo, para decirlo en una palabra:
 * - `off`: apagado, el mozo no lo ve.
 * - `no_options`: prendido pero sin opciones para tocar: tampoco lo ve.
 * - `nowhere`: tiene opciones pero no está enganchado a nada que se venda.
 * - `ready`: lo ven `products` productos.
 */
export type GroupStatus =
  | { kind: 'off' }
  | { kind: 'no_options' }
  | { kind: 'nowhere' }
  | { kind: 'ready'; products: number }

export function groupStatus(
  group: ModifierGroup,
  options: ReadonlyArray<ModifierOption>,
  reach: GroupReach,
): GroupStatus {
  if (!group.active) return { kind: 'off' }
  if (!isUsable(group, options)) return { kind: 'no_options' }
  const products = reach.itemsByGroup.get(group.id)?.length ?? 0
  return products === 0 ? { kind: 'nowhere' } : { kind: 'ready', products }
}

/** Cuántos productos que se venden tienen al menos una aclaración que el mozo ve. */
export function productsWithChoices(
  snapshot: Pick<KitchenSnapshot, 'groups' | 'options'>,
  reach: GroupReach,
): number {
  const usable = new Set(
    snapshot.groups.filter((group) => isUsable(group, snapshot.options)).map((group) => group.id),
  )
  let count = 0
  for (const groups of reach.groupsByItem.values()) {
    if (groups.some((groupId) => usable.has(groupId))) count += 1
  }
  return count
}

// ─── Dónde está enganchado ───────────────────────────────────────────────────

export type LinkedTarget = {
  target: ModifierLink['target']
  id: string
  name: string
  /** De una categoría: «Comida»; de un producto: «Comida › Hamburguesas». Vacío arriba de todo. */
  context: string
  /** La categoría o el producto está pausado. */
  paused: boolean
}

/** Los enganches de un grupo, con nombre: primero las categorías, en el orden de la carta. */
export function linkedTargets(
  snapshot: Pick<KitchenSnapshot, 'categories' | 'items' | 'links'>,
  groupId: string,
): LinkedTarget[] {
  const tree = cartaTree(snapshot.categories, snapshot.items)
  const categoryOrder = new Map(tree.order.map((id, index) => [id, index]))
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]))
  const itemOrder = new Map(snapshot.items.map((item, index) => [item.id, index]))
  const pathOf = (categoryId: string | null): string => {
    if (categoryId === null || !tree.byId.has(categoryId)) return ''
    const names: string[] = []
    let current: string | null = categoryId
    for (let step = 0; current !== null && step < tree.byId.size; step++) {
      names.unshift(tree.byId.get(current)?.name ?? '')
      current = tree.parent.get(current) ?? null
    }
    return names.join(' › ')
  }

  const out: Array<LinkedTarget & { order: number }> = []
  for (const link of snapshot.links) {
    if (link.groupId !== groupId) continue
    if (link.target === 'category') {
      const category = tree.byId.get(link.targetId)
      if (!category) continue
      out.push({
        target: 'category',
        id: category.id,
        name: category.name,
        context: pathOf(tree.parent.get(category.id) ?? null),
        paused: !category.active,
        order: categoryOrder.get(category.id) ?? 0,
      })
    } else {
      const item = itemsById.get(link.targetId)
      if (!item) continue
      out.push({
        target: 'item',
        id: item.id,
        name: item.name,
        context: pathOf(item.categoryId),
        paused: !item.active,
        order: 1_000_000 + (itemOrder.get(item.id) ?? 0),
      })
    }
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _order, ...target }) => target)
}

// ─── La carta del mozo ───────────────────────────────────────────────────────

/**
 * La carta tal como se la manda la base a la comanda (`pos_menu`), armada con lo que se ve en
 * esta pantalla: solo lo activo, cada producto con su estación ya resuelta y cada grupo con sus
 * opciones y sus enganches. Con esto la vista previa usa el mismo código que el mozo.
 *
 * El precio es el de la carta: el propio de una sucursal no entra acá.
 */
export function toPosMenu(snapshot: KitchenSnapshot): PosMenu {
  const tree = cartaTree(snapshot.categories, snapshot.items)
  const byName = byPositionThen<{ position: number; name: string }>((row) => row.name)
  const items = snapshot.items.filter(isSellable).sort(byName)
  return {
    service_day: '',
    categories: snapshot.categories
      .filter((category) => category.active)
      .sort(byName)
      .map((category) => ({
        id: category.id,
        name: category.name,
        parent_id: category.parentId,
        position: category.position,
        station_id: category.stationId,
      })),
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      // `isSellable` ya dejó afuera a los que no tienen categoría.
      category_id: item.categoryId ?? NO_CATEGORY_ID,
      position: item.position,
      price_cents: item.priceCents,
      description: null,
      station_id: resolveItem(tree, item).stationId,
      sold_out: false,
    })),
    stations: snapshot.stations
      .filter((station) => station.active)
      .sort(byName)
      .map((station) => ({ id: station.id, name: station.name, color: station.color })),
    modifier_groups: snapshot.groups
      .filter((group) => group.active)
      .sort(byGroupOrder)
      .map((group) => ({
        id: group.id,
        name: group.name,
        selection: group.selection,
        required: group.required,
        options: optionsOf(snapshot.options, group.id)
          .filter((option) => option.active)
          .map((option) => ({
            id: option.id,
            label: option.label,
            delta_cents: option.priceDeltaCents,
          })),
        category_ids: snapshot.links
          .filter((link) => link.groupId === group.id && link.target === 'category')
          .map((link) => link.targetId),
        item_ids: snapshot.links
          .filter((link) => link.groupId === group.id && link.target === 'item')
          .map((link) => link.targetId),
      })),
    popular_now: [],
  }
}

// ─── Las de siempre ──────────────────────────────────────────────────────────

export type GroupTemplate = {
  key: string
  name: string
  rule: RuleId
  options: ReadonlyArray<string>
  /** Para qué sirve, en una línea. */
  hint: string
}

/** Lo que casi todo bar pregunta: para arrancar con un toque y después ajustar. */
export const GROUP_TEMPLATES: ReadonlyArray<GroupTemplate> = [
  {
    key: 'punto',
    name: 'Punto de la carne',
    rule: 'one_optional',
    options: ['Jugoso', 'A punto', 'Bien cocido'],
    hint: 'Hamburguesas, lomos y carnes.',
  },
  {
    key: 'sin',
    name: '¿Qué le sacamos?',
    rule: 'many_optional',
    options: ['Sin lechuga', 'Sin tomate', 'Sin cebolla', 'Sin mayonesa'],
    hint: 'Lo que el cliente no quiere en el plato.',
  },
  {
    key: 'extras',
    name: 'Extras',
    rule: 'many_optional',
    options: ['Extra cheddar', 'Extra bacon', 'Huevo frito'],
    hint: 'Lo que se suma y se cobra aparte: después le ponés el precio a cada uno.',
  },
  {
    key: 'hielo',
    name: 'Hielo y limón',
    rule: 'many_optional',
    options: ['Sin hielo', 'Poco hielo', 'Con limón'],
    hint: 'Bebidas y tragos.',
  },
]

/** Sin tildes, sin mayúsculas y sin signos: para comparar nombres. */
export function plainName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Las plantillas que todavía no están en el bar (por nombre, sin importar tildes ni mayúsculas). */
export function availableTemplates(groups: ReadonlyArray<ModifierGroup>): GroupTemplate[] {
  const taken = new Set(groups.map((group) => plainName(group.name)))
  return GROUP_TEMPLATES.filter((template) => !taken.has(plainName(template.name)))
}

// ─── En palabras ─────────────────────────────────────────────────────────────

/** «Jugoso · A punto · Bien cocido», con «+ 2 más» si no entran. */
export function optionsSummary(labels: ReadonlyArray<string>, max = 4): string {
  if (labels.length === 0) return ''
  const shown = labels.slice(0, max)
  const rest = labels.length - shown.length
  return rest > 0 ? `${shown.join(' · ')} · y ${rest} más` : shown.join(' · ')
}

/** «Hamburguesas», «Hamburguesas y Lomitos», «Hamburguesas, Lomitos y 3 más». */
export function namesSummary(names: ReadonlyArray<string>, max = 2): string {
  if (names.length === 0) return ''
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  const parts = rest > 0 ? [...shown, `${rest} más`] : shown
  const last = parts.pop() ?? ''
  return parts.length > 0 ? `${parts.join(', ')} y ${last}` : last
}
