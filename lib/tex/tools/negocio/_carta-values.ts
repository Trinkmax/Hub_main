import { z } from 'zod'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import {
  buildCategoryTree,
  categoryPath,
  categoryPathLabel,
  flattenForPicker,
  type MenuTreeNode,
} from '@/lib/menu/tree'
import type { TexTicketRow, TexTicketWarning } from '../../protocol'
import { cappedBySize, compact, shortText } from '../read/common'
import { capped, money } from '../types'

/**
 * Lo que Tex lee y arma de la Carta, puro. La carta guarda el precio en centavos y lo muestra en pesos
 * enteros (`item-edit-dialog.tsx`, `new-item-form.tsx`): Tex habla en pesos enteros y convierte acá. Lo
 * prueba `tex-negocio.test.ts`.
 */

export type TexMenu = { categories: MenuCategory[]; items: MenuItem[] }

export type Found<T> = { ok: true; value: T } | { ok: false; message: string; many?: boolean }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Lo que entra en una respuesta. */
const LIST_MAX = 40
const SEARCH_MAX = 20
/** Lo que se le ofrece a Tex cuando hay más de uno que coincide. */
const OPTIONS_MAX = 8

/** Sin tildes, sin mayúsculas y sin espacios de más. */
export function textKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** «coca zero» encuentra «Coca Cola Zero». */
function hasAllWords(text: string, wanted: string): boolean {
  const key = textKey(text)
  return textKey(wanted)
    .split(' ')
    .every((word) => key.includes(word))
}

/**
 * Uno solo o nada: por id, por nombre exacto o por las palabras del nombre. Si hay varios, Tex pregunta:
 * nunca elige a ojo entre dos «Agua».
 */
export function pickNamed<T extends { id: string; name: string }>(
  rows: readonly T[],
  wanted: string,
  words: {
    /** Cómo se ofrece cada opción, con lo que hace falta para distinguirla. */
    option: (row: T) => string
    /** «No encontré la categoría «x». Las que hay: …» */
    none: string
  },
): Found<T> {
  const text = wanted.trim()
  const key = textKey(text)
  const found = UUID_RE.test(text)
    ? rows.filter((row) => row.id === text.toLowerCase())
    : rows.some((row) => textKey(row.name) === key)
      ? rows.filter((row) => textKey(row.name) === key)
      : rows.filter((row) => hasAllWords(row.name, text))
  const [only] = found
  if (only && found.length === 1) return { ok: true, value: only }
  if (found.length > 1) {
    const options = found.slice(0, OPTIONS_MAX).map(words.option).join('; ')
    return { ok: false, many: true, message: `«${text}» puede ser: ${options}. Preguntale cuál.` }
  }
  return { ok: false, message: words.none }
}

// ─── Lo que hay ──────────────────────────────────────────────────────────────

function pathOf(menu: TexMenu, categoryId: string): string {
  return categoryPathLabel(menu.categories, categoryId)
}

/** El árbol, indexado. */
function nodesOf(menu: TexMenu): { roots: MenuTreeNode[]; byId: Map<string, MenuTreeNode> } {
  const roots = buildCategoryTree(menu.categories, menu.items)
  const byId = new Map<string, MenuTreeNode>()
  const walk = (nodes: readonly MenuTreeNode[]) => {
    for (const node of nodes) {
      byId.set(node.id, node)
      walk(node.children)
    }
  }
  walk(roots)
  return { roots, byId }
}

/** Los productos de una categoría y de todo lo que tiene adentro. */
function subtreeItems(node: MenuTreeNode): MenuItem[] {
  return [...node.items, ...node.children.flatMap(subtreeItems)]
}

export function categoryItems(menu: TexMenu, categoryId: string, nested = true): MenuItem[] {
  const node = nodesOf(menu).byId.get(categoryId)
  if (!node) return []
  return nested ? subtreeItems(node) : node.items
}

function hasPhoto(item: MenuItem): boolean {
  return Boolean(item.image_url || item.video_url)
}

/** Una fila de producto: solo lo que se aparta de lo normal, para gastar menos. */
export function itemRow(item: MenuItem, menu: TexMenu) {
  const category = menu.categories.find((c) => c.id === item.category_id)
  return compact({
    id: item.id,
    nombre: item.name,
    categoria: pathOf(menu, item.category_id),
    precio: money(item.price_cents),
    pausado: item.active ? null : true,
    // Disponible, pero no se ve: su categoría está pausada.
    categoria_pausada: item.active && category?.active === false ? true : null,
    sin_foto: hasPhoto(item) ? null : true,
    destacado: item.featured ? true : null,
    etiquetas: item.tags.length > 0 ? item.tags.map((tag) => tag.name) : null,
    puntos_extra: item.points_override,
  })
}

function categoryRow(node: MenuTreeNode) {
  return compact({
    id: node.id,
    nombre: node.name,
    pausada: node.active ? null : true,
    subcategorias: node.children.length > 0 ? node.children.length : null,
    productos: subtreeItems(node).length,
  })
}

/** La carta entera, por arriba. */
export function menuOverview(menu: TexMenu) {
  const { filas, hay_mas } = capped(nodesOf(menu).roots.map(categoryRow), LIST_MAX)
  return {
    categorias: menu.categories.length,
    productos: menu.items.length,
    pausados: menu.items.filter((item) => !item.active).length,
    sin_foto: menu.items.filter((item) => !hasPhoto(item)).length,
    filas,
    hay_mas,
  }
}

/** Una categoría: sus subcategorías y sus productos directos. */
export function categoryData(menu: TexMenu, category: MenuCategory) {
  const node = nodesOf(menu).byId.get(category.id)
  const items = cappedBySize(
    (node?.items ?? []).map((item) => itemRow(item, menu)),
    LIST_MAX,
  )
  return compact({
    id: category.id,
    categoria: pathOf(menu, category.id),
    pausada: category.active ? null : true,
    subcategorias:
      node && node.children.length > 0 ? node.children.map((child) => categoryRow(child)) : null,
    productos: items.filas,
    hay_mas: items.hay_mas ? true : null,
  })
}

/** Por nombre primero; después por lo que dice la descripción o la categoría. */
export function searchItems(menu: TexMenu, wanted: string) {
  const key = textKey(wanted)
  const score = (item: MenuItem): number | null => {
    if (textKey(item.name) === key) return 0
    if (hasAllWords(item.name, wanted)) return 1
    return hasAllWords(
      `${item.name} ${item.description ?? ''} ${pathOf(menu, item.category_id)}`,
      wanted,
    )
      ? 2
      : null
  }
  const hits = menu.items.flatMap((item) => {
    const points = score(item)
    return points === null ? [] : [{ item, points }]
  })
  hits.sort((a, b) => a.points - b.points || a.item.name.localeCompare(b.item.name, 'es'))
  const rows = hits.map(({ item }) =>
    compact({ ...itemRow(item, menu), descripcion: shortText(item.description, 300) }),
  )
  return { cuantos: rows.length, ...cappedBySize(rows, SEARCH_MAX) }
}

export const ITEM_STATES = [
  'sin_foto',
  'sin_descripcion',
  'pausados',
  'destacados',
  'sin_precio',
] as const
export type ItemState = (typeof ITEM_STATES)[number]

const STATE_TEST: Readonly<Record<ItemState, (item: MenuItem) => boolean>> = {
  sin_foto: (item) => !hasPhoto(item),
  sin_descripcion: (item) => !item.description?.trim(),
  pausados: (item) => !item.active,
  destacados: (item) => item.featured,
  sin_precio: (item) => item.price_cents === 0,
}

/** Lo que le falta a la carta, o lo que no se está viendo. */
export function itemsByState(menu: TexMenu, state: ItemState, category: MenuCategory | null) {
  const pool = category ? categoryItems(menu, category.id) : menu.items
  const rows = pool.filter(STATE_TEST[state]).map((item) => itemRow(item, menu))
  return compact({
    estado: state,
    categoria: category ? pathOf(menu, category.id) : null,
    cuantos: rows.length,
    nota:
      state === 'sin_foto'
        ? 'Los que tienen video no cuentan: en la carta muestran el cuadro del video.'
        : state === 'pausados'
          ? 'La carta no lleva stock: «sin stock» es esto. Están ocultos para el cliente hasta que vuelvan.'
          : null,
    ...cappedBySize(rows, LIST_MAX),
  })
}

export type TagRow = { id: string; name: string; color: string; assignment_count?: number }

export function tagRows(tags: readonly TagRow[]) {
  return capped(
    tags.map((tag) => ({
      id: tag.id,
      nombre: tag.name,
      color: tag.color,
      productos: tag.assignment_count ?? 0,
    })),
    60,
  )
}

// ─── A qué se refiere ────────────────────────────────────────────────────────

export function findCategory(menu: TexMenu, wanted: string): Found<MenuCategory> {
  const first = pickNamed(menu.categories, wanted, {
    option: (c) => `${pathOf(menu, c.id)} (id ${c.id})`,
    none: `No encontré la categoría «${wanted.trim()}». Las que hay: ${
      menu.categories
        .filter((c) => c.parent_id === null)
        .slice(0, OPTIONS_MAX)
        .map((c) => c.name)
        .join(', ') || 'ninguna todavía'
    }.`,
  })
  if (first.ok || first.many) return first
  // «bebidas vinos»: la ruta entera.
  const byPath = menu.categories.filter((c) => hasAllWords(pathOf(menu, c.id), wanted))
  const [only] = byPath
  return only && byPath.length === 1 ? { ok: true, value: only } : first
}

export function findItem(menu: TexMenu, wanted: string): Found<MenuItem> {
  return pickNamed(menu.items, wanted, {
    option: (item) =>
      `${item.name} (${pathOf(menu, item.category_id)}, ${money(item.price_cents)}, id ${item.id})`,
    none: `No encontré «${wanted.trim()}» en la carta. Buscalo con buscar_producto o preguntale cómo se llama.`,
  })
}

export function findTag<T extends { id: string; name: string }>(
  tags: readonly T[],
  wanted: string,
): Found<T> {
  return pickNamed(tags, wanted, {
    option: (tag) => `${tag.name} (id ${tag.id})`,
    none: `No hay una etiqueta «${wanted.trim()}». Las que hay: ${
      tags
        .slice(0, OPTIONS_MAX)
        .map((tag) => tag.name)
        .join(', ') || 'ninguna'
    }. Para crearla: preparar_etiqueta.`,
  })
}

/** Lo que se ve en /menu al entrar: el primer nivel, que es lo que Tex puede señalar. */
export function rootNameOf(menu: TexMenu, categoryId: string): string | null {
  return categoryPath(menu.categories, categoryId)[0]?.name ?? null
}

// ─── Los avisos de un tique ──────────────────────────────────────────────────

export function ticketWarning(key: string, title: string): TexTicketWarning {
  return { key, title, body: null }
}

const SHOWS_NOW = 'Se ve ya en la carta pública apenas confirmes.'

// ─── Un producto nuevo ───────────────────────────────────────────────────────

/** Lo que recibe `createMenuItem`, ya validado con `createMenuItemSchema`. */
export type NewItem = {
  category_id: string
  name: string
  description: string | null
  price_cents: number
  points_override: number | null
  featured: boolean
  tag_ids: string[]
}

/**
 * El mismo FormData que arma `new-item-form.tsx`. Lo que no se manda queda vacío en el esquema de la
 * acción. `featured` viaja solo si es verdadero: `z.coerce.boolean` lee cualquier texto como `true`,
 * también «false».
 */
export function newItemFormData(item: NewItem): FormData {
  const form = new FormData()
  form.set('category_id', item.category_id)
  form.set('name', item.name)
  form.set('price_cents', String(item.price_cents))
  if (item.description) form.set('description', item.description)
  if (item.points_override !== null) form.set('points_override', String(item.points_override))
  if (item.featured) form.set('featured', 'true')
  for (const id of item.tag_ids) form.append('tag_ids', id)
  return form
}

export function newItemWarnings(item: NewItem, menu: TexMenu): TexTicketWarning[] {
  const category = menu.categories.find((c) => c.id === item.category_id)
  const twin = menu.items.some(
    (other) => other.category_id === item.category_id && textKey(other.name) === textKey(item.name),
  )
  return [
    category?.active === false
      ? ticketWarning(
          'categoria_pausada',
          `«${category.name}» está pausada: el producto no se va a ver hasta activarla.`,
        )
      : ticketWarning('carta_publica', SHOWS_NOW),
    ...(twin
      ? [ticketWarning('duplicado', `Ya hay un producto «${item.name}» en esa categoría.`)]
      : []),
    ticketWarning('sin_foto', 'Queda sin foto: se sube desde la Carta.'),
  ]
}

// ─── Cambiar un producto ─────────────────────────────────────────────────────

/** Lo que Tex quiere cambiar. El resto del producto se lee recién al confirmar. */
export const itemChangeSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  price_cents: z.number().int().optional(),
  category_id: z.string().optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  points_override: z.number().int().nullable().optional(),
  tags_add: z.array(z.string()).optional(),
  tags_remove: z.array(z.string()).optional(),
})
export type ItemChange = z.infer<typeof itemChangeSchema>

/** Solo lo que de verdad cambia. */
export function effectiveChange(item: MenuItem, change: ItemChange): ItemChange {
  const out: ItemChange = {}
  const current = new Set(item.tags.map((tag) => tag.id))
  const name = change.name?.trim()
  if (name && name !== item.name) out.name = name
  if (change.description !== undefined) {
    const next = change.description?.trim() || null
    if (next !== (item.description?.trim() || null)) out.description = next
  }
  if (change.price_cents !== undefined && change.price_cents !== item.price_cents) {
    out.price_cents = change.price_cents
  }
  if (change.category_id !== undefined && change.category_id !== item.category_id) {
    out.category_id = change.category_id
  }
  if (change.active !== undefined && change.active !== item.active) out.active = change.active
  if (change.featured !== undefined && change.featured !== item.featured) {
    out.featured = change.featured
  }
  if (change.points_override !== undefined && change.points_override !== item.points_override) {
    out.points_override = change.points_override
  }
  const add = (change.tags_add ?? []).filter((id) => !current.has(id))
  if (add.length > 0) out.tags_add = add
  const remove = (change.tags_remove ?? []).filter((id) => current.has(id))
  if (remove.length > 0) out.tags_remove = remove
  return out
}

/**
 * Lo que recibe `updateMenuItem`. Esa acción escribe siempre categoría, nombre, descripción, precio,
 * puntos, foto y disponibilidad, así que hay que mandarle todo; por eso esto se arma con el producto
 * recién leído al confirmar, y no con el de cuando se preparó: si mientras tanto alguien subió la foto,
 * no se pisa. El video también viaja: `updateMenuItemSchema` rechaza el pedido si falta esa clave, igual
 * que el formulario, que siempre la manda. Lo destacado y las etiquetas no se tocan si no vienen.
 */
export function itemUpdatePayload(item: MenuItem, change: ItemChange) {
  const hasTags = change.tags_add !== undefined || change.tags_remove !== undefined
  const tagIds = new Set(item.tags.map((tag) => tag.id))
  for (const id of change.tags_add ?? []) tagIds.add(id)
  for (const id of change.tags_remove ?? []) tagIds.delete(id)
  return {
    id: item.id,
    category_id: change.category_id ?? item.category_id,
    name: change.name ?? item.name,
    description: change.description !== undefined ? change.description : item.description,
    price_cents: change.price_cents ?? item.price_cents,
    points_override:
      change.points_override !== undefined ? change.points_override : item.points_override,
    image_url: item.image_url,
    video_url: item.video_url,
    active: change.active ?? item.active,
    ...(change.featured !== undefined ? { featured: change.featured } : {}),
    ...(hasTags ? { tag_ids: [...tagIds] } : {}),
  }
}

export function itemChangeRows(
  item: MenuItem,
  change: ItemChange,
  menu: TexMenu,
  tagName: (id: string) => string,
): TexTicketRow[] {
  const rows: TexTicketRow[] = []
  if (change.name !== undefined) {
    rows.push({ label: 'Nombre', value: `${item.name} → ${change.name}` })
  }
  if (change.price_cents !== undefined) {
    rows.push({
      label: 'Precio',
      value: `${money(item.price_cents)} → ${money(change.price_cents)}`,
    })
  }
  if (change.description !== undefined) {
    rows.push({ label: 'Descripción', value: change.description ?? 'Sin descripción' })
  }
  if (change.category_id !== undefined) {
    rows.push({
      label: 'Categoría',
      value: `${pathOf(menu, item.category_id)} → ${pathOf(menu, change.category_id)}`,
    })
  }
  if (change.active !== undefined) {
    rows.push({
      label: 'Estado',
      value: change.active ? 'Vuelve a la carta' : 'Sale de la carta (pausado)',
    })
  }
  if (change.featured !== undefined) {
    rows.push({ label: 'Destacado', value: change.featured ? 'Sí' : 'No' })
  }
  if (change.points_override !== undefined) {
    rows.push({
      label: 'Puntos extra',
      value: change.points_override === null ? 'Sin puntos extra' : String(change.points_override),
    })
  }
  if (change.tags_add) {
    rows.push({ label: 'Suma etiquetas', value: change.tags_add.map(tagName).join(', ') })
  }
  if (change.tags_remove) {
    rows.push({ label: 'Saca etiquetas', value: change.tags_remove.map(tagName).join(', ') })
  }
  return rows
}

/** Un precio que se duplica o se parte al medio suele ser un cero de más o de menos. */
function bigJump(before: number, after: number): boolean {
  return before > 0 && (after >= before * 2 || after * 2 <= before)
}

export function itemChangeWarnings(
  item: MenuItem,
  change: ItemChange,
  menu: TexMenu,
): TexTicketWarning[] {
  const target = menu.categories.find((c) => c.id === (change.category_id ?? item.category_id))
  const categoryOn = target?.active !== false
  const on = change.active ?? item.active
  const out: TexTicketWarning[] = []
  if (change.active === false) {
    out.push(
      ticketWarning(
        'sale_de_la_carta',
        'Deja de verse en la carta pública apenas confirmes. No se borra: queda pausado y vuelve cuando quieras.',
      ),
    )
  } else if (on && categoryOn) {
    out.push(ticketWarning('carta_publica', SHOWS_NOW))
  } else if (on && target) {
    out.push(
      ticketWarning(
        'categoria_pausada',
        `«${target.name}» está pausada: no se va a ver hasta activarla.`,
      ),
    )
  } else {
    out.push(
      ticketWarning('pausado', 'Está pausado: el cambio se va a ver cuando vuelva a la carta.'),
    )
  }
  if (change.price_cents !== undefined && bigJump(item.price_cents, change.price_cents)) {
    out.push(
      ticketWarning(
        'precio_salto',
        `Cambia mucho: de ${money(item.price_cents)} a ${money(change.price_cents)}. Fijate que el número esté bien.`,
      ),
    )
  }
  return out
}

/** El botón dice qué va a pasar. */
export function itemChangeLabel(change: ItemChange): string {
  const keys = Object.keys(change) as Array<keyof ItemChange>
  if (keys.length !== 1) return 'Guardar los cambios'
  switch (keys[0]) {
    case 'active':
      return change.active ? 'Volver a la carta' : 'Sacar de la carta'
    case 'price_cents':
      return 'Cambiar el precio'
    case 'name':
      return 'Cambiar el nombre'
    case 'description':
      return 'Cambiar la descripción'
    case 'category_id':
      return 'Mover de categoría'
    case 'featured':
      return change.featured ? 'Destacar' : 'Quitar el destacado'
    case 'points_override':
      return 'Cambiar los puntos'
    default:
      return 'Cambiar las etiquetas'
  }
}

// ─── El aumento de precios ───────────────────────────────────────────────────

/**
 * Más que esto se hace por categoría: son de a uno y el pedido tiene 60 segundos. Con tandas de 5 y unos
 * 200 ms por producto, 300 tardan unos 12 segundos.
 */
export const PRICE_MAX_ITEMS = 300
/** Cuántos ejemplos muestra el tique. */
const PRICE_EXAMPLES = 5
/** De a cuántos se cambian: `updateMenuItem` es por producto. */
const PRICE_BATCH = 5

export type PriceRule = { kind: 'percent'; percent: number } | { kind: 'amount'; cents: number }

/** Al múltiplo más cercano de `stepPesos`; la carta no tiene centavos. */
export function newPriceCents(before: number, rule: PriceRule, stepPesos: number): number {
  const raw = rule.kind === 'percent' ? (before * (100 + rule.percent)) / 100 : before + rule.cents
  const step = stepPesos * 100
  return Math.round(raw / step) * step
}

export function priceRuleText(rule: PriceRule): string {
  if (rule.kind === 'percent') {
    const sign = rule.percent > 0 ? '+' : '-'
    return `${sign}${String(Math.abs(rule.percent)).replace('.', ',')} %`
  }
  return `${rule.cents > 0 ? '+' : '-'}${money(Math.abs(rule.cents))}`
}

export type PriceLine = { id: string; name: string; before: number; after: number }

export type PricePlan = {
  lines: PriceLine[]
  /** Con precio en $ 0: un porcentaje no les hace nada y un monto les pondría precio. */
  noPrice: MenuItem[]
  /** Con el redondeo quedan igual. */
  same: MenuItem[]
  /** Quedarían en $ 0 o menos. */
  tooLow: MenuItem[]
  /** Pausados que también cambian. */
  paused: number
}

export function pricePlan(
  items: readonly MenuItem[],
  rule: PriceRule,
  stepPesos: number,
): PricePlan {
  const plan: PricePlan = { lines: [], noPrice: [], same: [], tooLow: [], paused: 0 }
  for (const item of items) {
    if (item.price_cents === 0) {
      plan.noPrice.push(item)
      continue
    }
    const after = newPriceCents(item.price_cents, rule, stepPesos)
    if (after <= 0) plan.tooLow.push(item)
    else if (after === item.price_cents) plan.same.push(item)
    else {
      plan.lines.push({ id: item.id, name: item.name, before: item.price_cents, after })
      if (!item.active) plan.paused += 1
    }
  }
  return plan
}

/** Del más barato al más caro, repartidos: con el redondeo, es donde más se nota la diferencia. */
export function priceExamples(lines: readonly PriceLine[]): PriceLine[] {
  const sorted = [...lines].sort((a, b) => a.before - b.before)
  if (sorted.length <= PRICE_EXAMPLES) return sorted
  const picks = new Set<PriceLine>()
  for (let i = 0; i < PRICE_EXAMPLES; i += 1) {
    const line = sorted[Math.round((i * (sorted.length - 1)) / (PRICE_EXAMPLES - 1))]
    if (line) picks.add(line)
  }
  return [...picks]
}

export function priceRows(plan: PricePlan, stepPesos: number): TexTicketRow[] {
  const examples = priceExamples(plan.lines)
  const rest = plan.lines.length - examples.length
  return [
    ...examples.map((line) => ({
      label: line.name,
      value: `${money(line.before)} → ${money(line.after)}`,
    })),
    ...(rest > 0 ? [{ label: `Y ${rest} más`, value: 'con la misma cuenta' }] : []),
    ...(stepPesos > 1 ? [{ label: 'Redondeo', value: `A ${money(stepPesos * 100)}` }] : []),
  ]
}

export function priceWarnings(plan: PricePlan, stepPesos: number): TexTicketWarning[] {
  const count = (n: number) => (n === 1 ? '1 producto' : `${n} productos`)
  const verb = (n: number, one: string, many: string) => (n === 1 ? one : many)
  const jumps = plan.lines.filter((line) => bigJump(line.before, line.after)).length
  const { paused } = plan
  const noPrice = plan.noPrice.length
  const tooLow = plan.tooLow.length
  const same = plan.same.length
  return [
    ticketWarning('carta_publica', SHOWS_NOW),
    ticketWarning(
      'sin_deshacer',
      'No tiene «Deshacer»: para volver atrás hay que cargar los precios de nuevo.',
    ),
    ...(jumps > 0
      ? [
          ticketWarning(
            'precio_salto',
            `En ${count(jumps)} el precio se duplica o se parte al medio. Fijate que esté bien.`,
          ),
        ]
      : []),
    ...(paused > 0
      ? [
          ticketWarning(
            'pausados',
            `Incluye ${count(paused)} ${verb(paused, 'pausado: no se ve hasta que vuelva', 'pausados: no se ven hasta que vuelvan')} a la carta.`,
          ),
        ]
      : []),
    ...(noPrice > 0
      ? [
          ticketWarning(
            'sin_precio',
            `${count(noPrice)} en $ 0 ${verb(noPrice, 'queda igual', 'quedan iguales')}.`,
          ),
        ]
      : []),
    ...(tooLow > 0
      ? [
          ticketWarning(
            'muy_bajo',
            `${count(tooLow)} no ${verb(tooLow, 'se toca: quedaría', 'se tocan: quedarían')} en $ 0 o menos.`,
          ),
        ]
      : []),
    ...(stepPesos > 1 && same > 0
      ? [
          ticketWarning(
            'igual',
            `${count(same)} ${verb(same, 'queda igual', 'quedan iguales')} con ese redondeo.`,
          ),
        ]
      : []),
  ]
}

export type PriceUpdate = ReturnType<typeof itemUpdatePayload>
type UpdateResult = { ok: true } | { ok: false; message: string }

export type PriceRun = {
  done: PriceLine[]
  /** Cambiaron o desaparecieron mientras el tique esperaba: no se tocan. */
  stale: PriceLine[]
  /** Los que faltan porque se cortó. */
  pending: PriceLine[]
  failure: string | null
}

/**
 * De a tandas, con el producto recién leído. Cada cambio es la misma `updateMenuItem` del formulario:
 * no hay una acción por categoría, así que esto no es atómico. Al primer error se corta y se sabe
 * exactamente qué quedó de cada lado.
 */
export async function applyPriceLines(
  lines: readonly PriceLine[],
  fresh: readonly MenuItem[],
  update: (payload: PriceUpdate) => Promise<UpdateResult>,
): Promise<PriceRun> {
  const byId = new Map(fresh.map((item) => [item.id, item]))
  const run: PriceRun = { done: [], stale: [], pending: [], failure: null }
  const ready: Array<{ line: PriceLine; item: MenuItem }> = []
  for (const line of lines) {
    const item = byId.get(line.id)
    if (item && item.price_cents === line.before) ready.push({ line, item })
    else run.stale.push(line)
  }
  for (let start = 0; start < ready.length; start += PRICE_BATCH) {
    const batch = ready.slice(start, start + PRICE_BATCH)
    if (run.failure !== null) {
      run.pending.push(...batch.map(({ line }) => line))
      continue
    }
    const results = await Promise.all(
      batch.map(({ line, item }) =>
        update(itemUpdatePayload(item, { price_cents: line.after })).catch(
          (): UpdateResult => ({ ok: false, message: 'Se cortó la conexión.' }),
        ),
      ),
    )
    results.forEach((result, index) => {
      const entry = batch[index]
      if (!entry) return
      if (result.ok) run.done.push(entry.line)
      else {
        run.pending.push(entry.line)
        run.failure ??= result.message
      }
    })
  }
  return run
}

function nameList(lines: readonly PriceLine[]): string {
  return lines.map((line) => line.name).join(', ')
}

/** Qué pasó, en una oración que le sirva a la persona y a Tex para seguir. */
export function priceOutcome(run: PriceRun): { ok: boolean; message: string } {
  const staleNote =
    run.stale.length > 0
      ? ` No toqué ${run.stale.length === 1 ? '1 precio que cambió' : `${run.stale.length} precios que cambiaron`} mientras tanto: ${nameList(run.stale)}.`
      : ''
  if (run.failure !== null) {
    const total = run.done.length + run.pending.length
    return {
      ok: false,
      message:
        run.done.length === 0
          ? `No pude cambiar los precios: ${run.failure}${staleNote}`
          : `Cambié ${run.done.length} de ${total} y se cortó: ${run.failure} Esos ya tienen el precio nuevo: no hay que volver a aumentarlos. Faltan: ${nameList(run.pending)}.${staleNote}`,
    }
  }
  if (run.done.length === 0) {
    return { ok: false, message: `No cambié nada.${staleNote} Hay que armarlo de nuevo.` }
  }
  return {
    ok: true,
    message: `${run.done.length === 1 ? 'Cambié 1 precio' : `Cambié ${run.done.length} precios`}.${staleNote}`,
  }
}

// ─── Las categorías ──────────────────────────────────────────────────────────

export type CategoryChange = {
  name?: string
  active?: boolean
  /** `null`: al primer nivel. Sin esto, no se mueve. */
  parent_id?: string | null
}

/** Las categorías a las que se puede mover: no adentro de sí misma ni de sus hijas. */
export function canMoveInside(menu: TexMenu, id: string, parentId: string): boolean {
  return flattenForPicker(menu.categories, id).some((entry) => entry.id === parentId)
}

export function categoryChangeRows(
  category: MenuCategory,
  change: CategoryChange,
  menu: TexMenu,
): TexTicketRow[] {
  const rows: TexTicketRow[] = []
  if (change.name !== undefined) {
    rows.push({ label: 'Nombre', value: `${category.name} → ${change.name}` })
  }
  if (change.active !== undefined) {
    rows.push({ label: 'Estado', value: change.active ? 'Activa' : 'Pausada' })
  }
  if (change.parent_id !== undefined) {
    rows.push({
      label: 'Queda en',
      value: change.parent_id === null ? 'Primer nivel' : pathOf(menu, change.parent_id),
    })
  }
  return rows
}

export function categoryChangeWarnings(
  category: MenuCategory,
  change: CategoryChange,
  menu: TexMenu,
): TexTicketWarning[] {
  const node = nodesOf(menu).byId.get(category.id)
  const count = node?.items.length ?? 0
  if (change.active === false) {
    const activeChildren = node?.children.filter((child) => child.active).length ?? 0
    return [
      ...(count > 0
        ? [
            ticketWarning(
              'sale_de_la_carta',
              count === 1
                ? 'Su producto deja de verse en la carta pública apenas confirmes.'
                : `Sus ${count} productos dejan de verse en la carta pública apenas confirmes.`,
            ),
          ]
        : []),
      ...(activeChildren > 0
        ? [
            ticketWarning(
              'subcategorias',
              'Sus subcategorías activas siguen a la vista y pasan al primer nivel de la carta. Para ocultarlas, hay que pausarlas también.',
            ),
          ]
        : []),
    ]
  }
  return category.active || change.active === true
    ? [ticketWarning('carta_publica', SHOWS_NOW)]
    : [
        ticketWarning(
          'categoria_pausada',
          `«${category.name}» está pausada: el cambio se va a ver cuando la actives.`,
        ),
      ]
}

export function categoryChangeLabel(change: CategoryChange): string {
  const keys = Object.keys(change) as Array<keyof CategoryChange>
  if (keys.length !== 1) return 'Guardar los cambios'
  if (keys[0] === 'active') return change.active ? 'Activar la categoría' : 'Pausar la categoría'
  return keys[0] === 'name' ? 'Cambiar el nombre' : 'Mover la categoría'
}

/** El mismo FormData que arma `new-category-form.tsx`, sin foto: se sube en la pantalla. */
export function newCategoryFormData(input: { name: string; parent_id: string | null }): FormData {
  const form = new FormData()
  form.set('name', input.name)
  form.set('image_url', '')
  form.set('parent_id', input.parent_id ?? '')
  return form
}

// ─── Las etiquetas ───────────────────────────────────────────────────────────

export const DEFAULT_TAG_COLOR = '#94a3b8'

export function tagFormData(input: { id?: string; name: string; color: string }): FormData {
  const form = new FormData()
  if (input.id) form.set('id', input.id)
  form.set('name', input.name)
  form.set('color', input.color)
  return form
}

/** Una muestra de nombres, para el tique. */
export function nameSample(names: readonly string[], max = 5): string {
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} y ${names.length - max} más` : shown
}
