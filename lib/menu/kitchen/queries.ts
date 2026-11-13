import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type {
  CartaCategory,
  CartaItem,
  KitchenSnapshot,
  KitchenStation,
  ModifierGroup,
  ModifierLink,
  ModifierOption,
} from './types'

/**
 * Las lecturas de «Cocina y aclaraciones». Todo va con el cliente del usuario (RLS): la carta,
 * las estaciones y las aclaraciones las lee quien trabaja en el bar y las escriben dueño y
 * contenido.
 *
 * `kitchen_stations`, `menu_modifier_*` y `station_id` todavía no están en `types/database.ts`
 * (se regenera aparte), así que se leen con un cliente sin tipar y se tipan acá, igual que en
 * `lib/menu/prices/queries.ts`.
 */
export async function kitchenClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

export class KitchenReadError extends Error {
  constructor(what: string) {
    super(`menu_kitchen_read_failed:${what}`)
    this.name = 'KitchenReadError'
  }
}

type ReadResult = {
  data: unknown
  error: { code?: string; message: string } | null
}

/** PostgREST corta en 1.000 filas por pedido. */
const PAGE_SIZE = 1_000
const MAX_PAGES = 50

/**
 * Lee todas las filas de una consulta, de a páginas. La consulta tiene que venir con un orden
 * que no deje empates (termina en el id): paginar con empates puede repetir o saltear filas.
 */
async function readAll<Row>(
  what: string,
  page: (from: number, to: number) => PromiseLike<ReadResult>,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let index = 0; index < MAX_PAGES; index++) {
    const from = index * PAGE_SIZE
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error(`[menu.kitchen.${what}]`, error.code, error.message)
      throw new KitchenReadError(what)
    }
    const batch = (Array.isArray(data) ? data : []) as Row[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return rows
}

type StationRow = {
  id: string
  name: string
  color: string | null
  position: number | null
  active: boolean | null
}
type CategoryRow = {
  id: string
  name: string
  parent_id: string | null
  position: number | null
  active: boolean | null
  station_id: string | null
}
type ItemRow = {
  id: string
  name: string
  category_id: string | null
  price_cents: number | string | null
  position: number | null
  active: boolean | null
  station_id: string | null
}
type GroupRow = {
  id: string
  name: string
  selection: string | null
  required: boolean | null
  position: number | null
  active: boolean | null
}
type OptionRow = {
  id: string
  group_id: string
  label: string
  price_delta_cents: number | string | null
  position: number | null
  active: boolean | null
}
type LinkRow = {
  group_id: string
  category_id: string | null
  menu_item_id: string | null
}

const centsOf = (value: number | string | null | undefined): number => {
  const cents = Number(value ?? 0)
  return Number.isFinite(cents) ? cents : 0
}

/** El color por defecto de la base, por si una fila vieja viniera sin uno válido. */
const FALLBACK_COLOR = '#b45309'
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Toda la carta con sus estaciones y sus aclaraciones. Una sola ida (seis lecturas en paralelo).
 * Trae también lo pausado y lo apagado: acá se acomoda todo, no solo lo que hoy se vende.
 *
 * El orden es el de la base al mandarle la carta al mozo: por posición y, a igual posición, por
 * nombre (y el id para que nunca haya empate).
 */
export async function getKitchenSnapshot(tenantId: string): Promise<KitchenSnapshot> {
  // Antes de leer: si después un guardado dice «terminé a las X» y X ≤ loadedAt, esta lectura
  // seguro lo incluye.
  const loadedAt = Date.now()
  const supabase = await kitchenClient()
  const [stationRows, categoryRows, itemRows, groupRows, optionRows, linkRows] = await Promise.all([
    readAll<StationRow>('stations', (from, to) =>
      supabase
        .from('kitchen_stations')
        .select('id, name, color, position, active')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<CategoryRow>('categories', (from, to) =>
      supabase
        .from('menu_categories')
        .select('id, name, parent_id, position, active, station_id')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<ItemRow>('items', (from, to) =>
      supabase
        .from('menu_items')
        .select('id, name, category_id, price_cents, position, active, station_id')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<GroupRow>('groups', (from, to) =>
      supabase
        .from('menu_modifier_groups')
        .select('id, name, selection, required, position, active')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<OptionRow>('options', (from, to) =>
      supabase
        .from('menu_modifier_options')
        .select('id, group_id, label, price_delta_cents, position, active')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
        .order('label', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<LinkRow>('links', (from, to) =>
      supabase
        .from('menu_modifier_links')
        .select('group_id, category_id, menu_item_id')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])

  const stations: KitchenStation[] = stationRows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color && HEX.test(row.color) ? row.color.toLowerCase() : FALLBACK_COLOR,
    position: row.position ?? 0,
    active: row.active ?? true,
  }))
  const categories: CartaCategory[] = categoryRows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    position: row.position ?? 0,
    active: row.active ?? true,
    stationId: row.station_id,
  }))
  const items: CartaItem[] = itemRows.map((row) => ({
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    position: row.position ?? 0,
    active: row.active ?? true,
    priceCents: centsOf(row.price_cents),
    stationId: row.station_id,
  }))
  const groups: ModifierGroup[] = groupRows.map((row) => ({
    id: row.id,
    name: row.name,
    selection: row.selection === 'single' ? 'single' : 'multi',
    required: row.required ?? false,
    position: row.position ?? 0,
    active: row.active ?? true,
  }))
  const groupIds = new Set(groups.map((group) => group.id))
  const options: ModifierOption[] = optionRows
    .filter((row) => groupIds.has(row.group_id))
    .map((row) => ({
      id: row.id,
      groupId: row.group_id,
      label: row.label,
      priceDeltaCents: centsOf(row.price_delta_cents),
      position: row.position ?? 0,
      active: row.active ?? true,
    }))
  const links: ModifierLink[] = []
  for (const row of linkRows) {
    if (!groupIds.has(row.group_id)) continue
    if (row.category_id !== null) {
      links.push({ groupId: row.group_id, target: 'category', targetId: row.category_id })
    } else if (row.menu_item_id !== null) {
      links.push({ groupId: row.group_id, target: 'item', targetId: row.menu_item_id })
    }
  }

  return { loadedAt, stations, categories, items, groups, options, links }
}

/** Cuántas opciones se miran a la vez al buscar en qué pedidos salieron. */
const USAGE_CONCURRENCY = 4

/**
 * En cuántos renglones de pedidos salieron estas opciones. Cada pedido guarda una foto de sus
 * aclaraciones (con el id de la opción), así que se busca ahí. `null` si no se pudo leer: quien
 * llama decide no borrar.
 */
export async function countOptionUses(
  supabase: SupabaseClient,
  tenantId: string,
  optionIds: ReadonlyArray<string>,
): Promise<number | null> {
  let total = 0
  let failed = false
  const queue = [...optionIds]
  const worker = async () => {
    for (let optionId = queue.shift(); optionId !== undefined; optionId = queue.shift()) {
      const { count, error } = await supabase
        .from('ticket_items')
        .select('id, tickets!inner(tenant_id)', { count: 'exact', head: true })
        .eq('tickets.tenant_id', tenantId)
        .contains('modifiers', JSON.stringify([{ id: optionId }]))
      if (error) {
        console.error('[menu.kitchen.option-uses]', error.code, error.message)
        failed = true
        return
      }
      total += count ?? 0
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(USAGE_CONCURRENCY, queue.length) }, () => worker()),
  )
  return failed ? null : total
}

/** ¿Algún pedido ya fue a esta estación? `null` si no se pudo leer. */
export async function stationWasUsed(
  supabase: SupabaseClient,
  tenantId: string,
  stationId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('ticket_items')
    .select('id, tickets!inner(tenant_id)')
    .eq('tickets.tenant_id', tenantId)
    .eq('station_id', stationId)
    .limit(1)
  if (error) {
    console.error('[menu.kitchen.station-uses]', error.code, error.message)
    return null
  }
  return (data ?? []).length > 0
}
