import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listBranches } from '@/lib/pos/queries'
import { createClient } from '@/lib/supabase/server'
import type { PriceChangeRow } from './history'
import type { BranchOverride, PriceBranch, PriceCategory, PriceItem, PriceSnapshot } from './types'

/**
 * Las lecturas de «Precios». Todo va con el cliente del usuario (RLS): la carta la lee quien
 * trabaja en el bar; el historial, solo dueño y contenido.
 *
 * `branches`, `menu_item_branches` y `menu_price_changes` todavía no están en
 * `types/database.ts` (se regenera aparte), así que se leen con un cliente sin tipar y se
 * tipan acá, igual que en `lib/pos/queries.ts`.
 */
export async function untypedClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

export class PriceReadError extends Error {
  constructor(what: string) {
    super(`menu_prices_read_failed:${what}`)
    this.name = 'PriceReadError'
  }
}

type ReadResult = {
  data: unknown
  error: { code?: string; message: string } | null
}

/** PostgREST corta en 1.000 filas por pedido: una carta grande con sucursales las pasa. */
const PAGE_SIZE = 1_000
const MAX_PAGES = 50

/**
 * Lee todas las filas de una consulta. Si entran en un pedido (lo normal), se piden con el
 * orden de siempre de la carta, para que la lista salga igual que ahí. Si no entran, se relee
 * todo de a páginas con `stable = true`: ahí la consulta tiene que sumar un desempate fijo
 * (el id), porque paginar con empates sin resolver puede repetir o saltear filas.
 */
export async function readAllPages<Row>(
  what: string,
  page: (from: number, to: number, stable: boolean) => PromiseLike<ReadResult>,
): Promise<Row[]> {
  const read = async (index: number, stable: boolean): Promise<Row[]> => {
    const from = index * PAGE_SIZE
    const { data, error } = await page(from, from + PAGE_SIZE - 1, stable)
    if (error) {
      console.error(`[menu.prices.${what}]`, error.code, error.message)
      throw new PriceReadError(what)
    }
    return (Array.isArray(data) ? data : []) as Row[]
  }

  const first = await read(0, false)
  if (first.length < PAGE_SIZE) return first

  const rows: Row[] = []
  for (let index = 0; index < MAX_PAGES; index++) {
    const batch = await read(index, true)
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return rows
}

type CategoryRow = {
  id: string
  name: string
  parent_id: string | null
  position: number | null
  active: boolean | null
}
type ItemRow = {
  id: string
  name: string
  category_id: string | null
  price_cents: number | string | null
  position: number | null
  active: boolean | null
}
type OverrideRow = {
  branch_id: string
  menu_item_id: string
  price_cents: number | string | null
  available: boolean | null
}

const centsOf = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const cents = Number(value)
  return Number.isFinite(cents) ? cents : null
}

/**
 * Toda la carta con sus precios, las sucursales y lo que cada producto tiene de distinto en
 * cada una. Una sola ida (cuatro lecturas en paralelo). Incluye los productos pausados y los
 * que quedaron sin categoría: también tienen precio.
 */
export async function getPriceSnapshot(tenantId: string): Promise<PriceSnapshot> {
  // Antes de leer: si después un guardado dice «terminé a las X» y X ≤ loadedAt, esta lectura
  // seguro lo incluye.
  const loadedAt = Date.now()
  const supabase = await untypedClient()
  const [categoryRows, itemRows, overrideRows, branchRows] = await Promise.all([
    readAllPages<CategoryRow>('categories', (from, to, stable) => {
      // El mismo orden que usa la carta (`listMenu`): por posición.
      const query = supabase
        .from('menu_categories')
        .select('id, name, parent_id, position, active')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
      return (stable ? query.order('id', { ascending: true }) : query).range(from, to)
    }),
    readAllPages<ItemRow>('items', (from, to, stable) => {
      const query = supabase
        .from('menu_items')
        .select('id, name, category_id, price_cents, position, active')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
      return (stable ? query.order('id', { ascending: true }) : query).range(from, to)
    }),
    readAllPages<OverrideRow>('overrides', (from, to) =>
      supabase
        .from('menu_item_branches')
        .select('branch_id, menu_item_id, price_cents, available')
        .eq('tenant_id', tenantId)
        .order('menu_item_id', { ascending: true })
        .order('branch_id', { ascending: true })
        .range(from, to),
    ),
    listBranches(tenantId),
  ])

  const categories: PriceCategory[] = categoryRows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    position: row.position ?? 0,
    active: row.active ?? true,
  }))
  const items: PriceItem[] = itemRows.map((row) => ({
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    priceCents: centsOf(row.price_cents) ?? 0,
    position: row.position ?? 0,
    active: row.active ?? true,
  }))
  const branches: PriceBranch[] = branchRows.map((row) => ({
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    slug: row.slug,
    color: row.color,
    isDefault: row.is_default,
  }))

  // Solo lo de las sucursales que están abiertas y de productos que siguen en la carta: lo
  // demás no se ve en ningún lado y no se toca.
  const branchIds = new Set(branches.map((branch) => branch.id))
  const itemIds = new Set(items.map((item) => item.id))
  const overrides: BranchOverride[] = []
  for (const row of overrideRows) {
    if (!branchIds.has(row.branch_id) || !itemIds.has(row.menu_item_id)) continue
    const priceCents = centsOf(row.price_cents)
    const available = row.available ?? true
    // Una fila que no cambia nada (sin precio propio y se vende) es lo mismo que no tenerla.
    if (priceCents === null && available) continue
    overrides.push({ branchId: row.branch_id, itemId: row.menu_item_id, priceCents, available })
  }

  return { loadedAt, categories, items, branches, overrides }
}

type ChangeRow = {
  id: string
  menu_item_id: string
  branch_id: string | null
  old_price_cents: number | string | null
  new_price_cents: number | string | null
  batch_id: string | null
  changed_by: string | null
  created_at: string
}

/**
 * Los últimos cambios de precio, del más nuevo al más viejo: de un producto o de toda la
 * carta. La tabla la escribe la base sola (un trigger en cada cambio de precio).
 */
export async function readPriceChanges(
  tenantId: string,
  opts: { itemId: string | null; limit: number },
): Promise<PriceChangeRow[]> {
  const supabase = await untypedClient()
  let query = supabase
    .from('menu_price_changes')
    .select(
      'id, menu_item_id, branch_id, old_price_cents, new_price_cents, batch_id, changed_by, created_at',
    )
    .eq('tenant_id', tenantId)
  if (opts.itemId !== null) query = query.eq('menu_item_id', opts.itemId)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(Math.min(opts.limit, PAGE_SIZE))
  if (error) {
    console.error('[menu.prices.changes]', error.code, error.message)
    throw new PriceReadError('changes')
  }
  return ((data ?? []) as ChangeRow[]).map((row) => ({
    id: row.id,
    itemId: row.menu_item_id,
    branchId: row.branch_id,
    oldCents: centsOf(row.old_price_cents),
    newCents: centsOf(row.new_price_cents),
    batchId: row.batch_id,
    changedBy: row.changed_by,
    createdAt: row.created_at,
  }))
}

/**
 * Cómo se llama cada persona del equipo en el bar (`reservation_managers`). Quien no tiene
 * fila queda sin nombre: el historial dirá «alguien del equipo». Si no se puede leer, el
 * historial se muestra igual, sin nombres.
 */
export async function readTeamNames(tenantId: string): Promise<Map<string, string>> {
  const supabase = await untypedClient()
  const { data, error } = await supabase
    .from('reservation_managers')
    .select('user_id, display_name')
    .eq('tenant_id', tenantId)
    .not('user_id', 'is', null)
    .limit(PAGE_SIZE)
  const names = new Map<string, string>()
  if (error) {
    console.error('[menu.prices.team]', error.code, error.message)
    return names
  }
  for (const row of (data ?? []) as Array<{
    user_id: string | null
    display_name: string | null
  }>) {
    const name = row.display_name?.trim()
    if (row.user_id && name) names.set(row.user_id, name)
  }
  return names
}

/** Los nombres de los productos (de uno o de toda la carta), para el historial. */
export async function readItemNames(
  tenantId: string,
  itemId: string | null,
): Promise<Map<string, string>> {
  const supabase = await untypedClient()
  const rows = await readAllPages<{ id: string; name: string }>('item-names', (from, to) => {
    const query = supabase.from('menu_items').select('id, name').eq('tenant_id', tenantId)
    return (itemId === null ? query : query.eq('id', itemId))
      .order('id', { ascending: true })
      .range(from, to)
  })
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** Los nombres de TODAS las sucursales (también las cerradas: el historial las nombra). */
export async function readBranchNames(tenantId: string): Promise<Map<string, string>> {
  const supabase = await untypedClient()
  const { data, error } = await supabase
    .from('branches')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .limit(PAGE_SIZE)
  const names = new Map<string, string>()
  if (error) {
    console.error('[menu.prices.branches]', error.code, error.message)
    return names
  }
  for (const row of (data ?? []) as Array<{ id: string; name: string }>) names.set(row.id, row.name)
  return names
}
