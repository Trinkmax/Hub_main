import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SETTINGS_COLUMNS, type SettingsRow, settingsFromRow } from '@/lib/pos/settings/row'
import { createClient } from '@/lib/supabase/server'
import { sellableItems, unassignedCategories } from './checklist'
import { sortBranches } from './order'
import type {
  Borrowed,
  Branch,
  BranchBoardSnapshot,
  BranchFacts,
  MenuFacts,
  TeamFacts,
} from './types'

/**
 * Las lecturas de «Sucursales». Todo va con el cliente del usuario (RLS): acá entra solo el
 * dueño, y cada consulta lleva además el filtro de su bar.
 *
 * `branches`, `pos_settings`, `kitchen_stations` y las columnas nuevas todavía no están en
 * `types/database.ts` (se regenera aparte), así que se leen con un cliente sin tipar y se
 * tipan acá, igual que en `lib/pos/queries.ts`.
 */
export async function untypedClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

export class BranchReadError extends Error {
  constructor(what: string) {
    super(`pos_branches_read_failed:${what}`)
    this.name = 'BranchReadError'
  }
}

type DbError = { code?: string; message: string } | null
type ReadResult = { data: unknown; error: DbError }

/** PostgREST corta en 1.000 filas por pedido. */
const PAGE_SIZE = 1_000
const MAX_PAGES = 30

/** Lee todas las filas de una consulta, de a páginas. La consulta trae su propio orden fijo. */
async function readAll<Row>(
  what: string,
  page: (from: number, to: number) => PromiseLike<ReadResult>,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let index = 0; index < MAX_PAGES; index++) {
    const from = index * PAGE_SIZE
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error(`[pos.branches.${what}]`, error.code, error.message)
      throw new BranchReadError(what)
    }
    const batch = (Array.isArray(data) ? data : []) as Row[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return rows
}

export const BRANCH_COLUMNS =
  'id, name, short_name, slug, color, address, position, is_default, active, updated_at'

export type BranchRow = {
  id: string
  name: string
  short_name: string | null
  slug: string
  color: string
  address: string | null
  position: number | null
  is_default: boolean | null
  active: boolean | null
  updated_at: string
}

export function branchFromRow(row: BranchRow): Branch {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name?.trim() || null,
    slug: row.slug,
    color: row.color.toLowerCase(),
    address: row.address?.trim() || null,
    position: row.position ?? 0,
    isDefault: row.is_default === true,
    active: row.active !== false,
    updatedAt: row.updated_at,
  }
}

/** Todas las sucursales del bar, también las desactivadas, en el orden de siempre. */
export async function readBranches(supabase: SupabaseClient, tenantId: string): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select(BRANCH_COLUMNS)
    .eq('tenant_id', tenantId)
    .limit(PAGE_SIZE)
  if (error) {
    console.error('[pos.branches.list]', error.code, error.message)
    throw new BranchReadError('list')
  }
  return sortBranches(((data ?? []) as unknown as BranchRow[]).map(branchFromRow))
}

/** Una sucursal de ESTE bar, o `null` si no existe (o es de otro). */
export async function readBranch(
  supabase: SupabaseClient,
  tenantId: string,
  branchId: string,
): Promise<Branch | null> {
  const { data, error } = await supabase
    .from('branches')
    .select(BRANCH_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', branchId)
    .maybeSingle()
  if (error) {
    console.error('[pos.branches.one]', error.code, error.message)
    throw new BranchReadError('one')
  }
  return data ? branchFromRow(data as unknown as BranchRow) : null
}

/** La tabla todavía no existe en la base (la caja llega con la migración del cobro). */
const isMissingTable = (error: DbError) =>
  error !== null && (error.code === '42P01' || error.code === 'PGRST205')

/**
 * Cuántas cosas cuelgan de una sucursal y no dejan borrarla: sectores, mesas y mesas abiertas
 * alguna vez. Se cuenta contra la base en el momento (lo usa la acción de borrar).
 */
export async function readBranchWeight(
  supabase: SupabaseClient,
  tenantId: string,
  branchId: string,
): Promise<Pick<BranchFacts, 'sectors' | 'tables' | 'looseTables' | 'hasHistory' | 'openTables'>> {
  const head = { count: 'exact' as const, head: true }
  const [areas, tables, sessions, open] = await Promise.all([
    supabase
      .from('floor_plan_areas')
      .select('id', head)
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId),
    supabase
      .from('physical_tables')
      .select('id', head)
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId),
    supabase
      .from('table_sessions')
      .select('id', head)
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId),
    supabase
      .from('table_sessions')
      .select('id', head)
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .eq('status', 'open'),
  ])
  for (const [what, result] of [
    ['weight.areas', areas],
    ['weight.tables', tables],
    ['weight.sessions', sessions],
    ['weight.open', open],
  ] as const) {
    if (result.error) {
      console.error(`[pos.branches.${what}]`, result.error.code, result.error.message)
      throw new BranchReadError(what)
    }
  }
  return {
    sectors: areas.count ?? 0,
    // Acá no importa si están en el plano: cualquier mesa cuelga de la sucursal.
    tables: tables.count ?? 0,
    looseTables: 0,
    hasHistory: (sessions.count ?? 0) > 0,
    openTables: open.count ?? 0,
  }
}

type AreaRow = { id: string; branch_id: string }
type TableRow = { id: string; branch_id: string; active: boolean | null }
type ElementRow = { area_id: string; physical_table_id: string | null }
type SessionRow = { branch_id: string }
type ItemRow = {
  id: string
  category_id: string | null
  station_id: string | null
  active: boolean | null
}
type CategoryRow = {
  id: string
  name: string
  parent_id: string | null
  station_id: string | null
}
type StationRow = { id: string; name: string; color: string }
type ItemBranchRow = {
  branch_id: string
  menu_item_id: string
  price_cents: number | string | null
  available: boolean | null
}

const SALON_TEAM: ReadonlyArray<keyof TeamFacts> = ['owner', 'cashier', 'waiter', 'kitchen', 'host']

/**
 * Todo lo que muestra «Sucursales», en una sola ida (lecturas en paralelo): las sucursales, lo
 * que cada una tiene cargado, la carta, el equipo y los ajustes.
 */
export async function getBranchBoard(tenantId: string): Promise<BranchBoardSnapshot> {
  // Antes de leer: si después un guardado dice «terminé a las X» y X ≤ loadedAt, esta lectura
  // seguro lo incluye.
  const loadedAt = Date.now()
  const supabase = await untypedClient()

  const [
    branches,
    areas,
    tables,
    elements,
    openSessions,
    items,
    categories,
    stations,
    itemBranches,
    team,
    settingsRow,
    borrowed,
    registers,
  ] = await Promise.all([
    readBranches(supabase, tenantId),
    readAll<AreaRow>('areas', (from, to) =>
      supabase
        .from('floor_plan_areas')
        .select('id, branch_id')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<TableRow>('tables', (from, to) =>
      supabase
        .from('physical_tables')
        .select('id, branch_id, active')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<ElementRow>('elements', (from, to) =>
      supabase
        .from('floor_plan_elements')
        .select('area_id, physical_table_id')
        .eq('tenant_id', tenantId)
        .not('physical_table_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<SessionRow>('open', (from, to) =>
      supabase
        .from('table_sessions')
        .select('branch_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'open')
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<ItemRow>('items', (from, to) =>
      supabase
        .from('menu_items')
        .select('id, category_id, station_id, active')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<CategoryRow>('categories', (from, to) =>
      supabase
        .from('menu_categories')
        .select('id, name, parent_id, station_id')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAll<StationRow>('stations', (from, to) =>
      supabase
        .from('kitchen_stations')
        .select('id, name, color')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('position', { ascending: true })
        .order('name', { ascending: true })
        .range(from, to),
    ),
    readAll<ItemBranchRow>('item-branches', (from, to) =>
      supabase
        .from('menu_item_branches')
        .select('branch_id, menu_item_id, price_cents, available')
        .eq('tenant_id', tenantId)
        .order('menu_item_id', { ascending: true })
        .order('branch_id', { ascending: true })
        .range(from, to),
    ),
    readTeam(supabase, tenantId),
    readSettingsRow(supabase, tenantId),
    readBorrowed(supabase, tenantId),
    readRegisters(supabase, tenantId),
  ])

  // ── El plano de cada sucursal ──────────────────────────────────────────────────────────────
  const branchOfArea = new Map(areas.map((area) => [area.id, area.branch_id]))
  const placed = new Set<string>()
  for (const element of elements) {
    if (element.physical_table_id && branchOfArea.has(element.area_id)) {
      placed.add(element.physical_table_id)
    }
  }

  // ── La carta ───────────────────────────────────────────────────────────────────────────────
  const menuItems = items.map((item) => ({
    id: item.id,
    categoryId: item.category_id,
    stationId: item.station_id,
    active: item.active !== false,
  }))
  const sellable = new Set(sellableItems(menuItems).map((item) => item.id))
  const menu: MenuFacts = {
    products: sellable.size,
    stations: stations.map((station) => ({
      id: station.id,
      name: station.name,
      color: station.color,
    })),
    unassigned: unassignedCategories(
      categories.map((category) => ({
        id: category.id,
        name: category.name,
        parentId: category.parent_id,
        stationId: category.station_id,
      })),
      menuItems,
    ),
  }

  // ── Lo de cada sucursal ────────────────────────────────────────────────────────────────────
  const facts: Record<string, BranchFacts> = {}
  for (const branch of branches) {
    facts[branch.id] = {
      sectors: 0,
      tables: 0,
      looseTables: 0,
      openTables: 0,
      hasHistory: false,
      unavailable: 0,
      ownPrices: 0,
      kitchenSeenAt: null,
      registers: registers === null ? null : 0,
    }
  }
  for (const area of areas) {
    const entry = facts[area.branch_id]
    if (entry) entry.sectors += 1
  }
  for (const table of tables) {
    const entry = facts[table.branch_id]
    if (!entry || table.active === false) continue
    if (placed.has(table.id)) entry.tables += 1
    else entry.looseTables += 1
  }
  for (const session of openSessions) {
    const entry = facts[session.branch_id]
    if (entry) {
      entry.openTables += 1
      entry.hasHistory = true
    }
  }
  for (const row of itemBranches) {
    const entry = facts[row.branch_id]
    if (!entry || !sellable.has(row.menu_item_id)) continue
    if (row.available === false) entry.unavailable += 1
    else if (row.price_cents !== null) entry.ownPrices += 1
  }
  if (registers !== null) {
    for (const register of registers) {
      const entry = facts[register.branch_id]
      if (entry && entry.registers !== null) entry.registers += 1
    }
  }

  // Lo que hay que ir a buscar sucursal por sucursal: la última vez que la cocina vio un pedido
  // y, de las que no tienen nada a la vista, si alguna vez tuvieron una mesa abierta.
  await Promise.all(
    branches.map(async (branch) => {
      const entry = facts[branch.id]
      if (!entry) return
      const [seenAt, history] = await Promise.all([
        readKitchenSeen(supabase, tenantId, branch.id),
        entry.hasHistory ? Promise.resolve(true) : readHasHistory(supabase, tenantId, branch.id),
      ])
      entry.kitchenSeenAt = seenAt
      entry.hasHistory = history
    }),
  )

  return {
    loadedAt,
    branches,
    facts,
    menu,
    team,
    settings: settingsFromRow(settingsRow),
    borrowed,
  }
}

async function readSettingsRow(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<SettingsRow | null> {
  const { data, error } = await supabase
    .from('pos_settings')
    .select(SETTINGS_COLUMNS)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    console.error('[pos.branches.settings]', error.code, error.message)
    throw new BranchReadError('settings')
  }
  return (data as SettingsRow | null) ?? null
}

/** Cuánta gente hay por rol. Solo se lee el rol: ni nombres ni mails. */
async function readTeam(supabase: SupabaseClient, tenantId: string): Promise<TeamFacts> {
  const rows = await readAll<{ role: string }>('team', (from, to) =>
    supabase
      .from('memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .order('id', { ascending: true })
      .range(from, to),
  )
  const team: TeamFacts = { owner: 0, cashier: 0, waiter: 0, kitchen: 0, host: 0 }
  for (const row of rows) {
    const role = SALON_TEAM.find((known) => known === row.role)
    if (role) team[role] += 1
  }
  return team
}

/**
 * El alias que el bar ya cargó para las entradas online, para ofrecerlo acá. Si no se puede
 * leer (o el bar no usa entradas), simplemente no hay nada que ofrecer.
 */
async function readBorrowed(supabase: SupabaseClient, tenantId: string): Promise<Borrowed> {
  const { data, error } = await supabase
    .from('ticketing_settings')
    .select('transfer_alias, transfer_holder')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.error('[pos.branches.borrowed]', error.code, error.message)
    return { transferAlias: null, transferHolder: null }
  }
  const row = data as { transfer_alias: string | null; transfer_holder: string | null } | null
  return {
    transferAlias: row?.transfer_alias?.trim() || null,
    transferHolder: row?.transfer_holder?.trim() || null,
  }
}

/**
 * Las cajas activas. `null` = la tabla todavía no existe: la caja llega con el cobro, y el
 * paso se muestra como «llega con el cobro» en vez de romper la pantalla.
 */
async function readRegisters(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Array<{ branch_id: string }> | null> {
  const { data, error } = await supabase
    .from('pos_registers')
    .select('branch_id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .limit(PAGE_SIZE)
  if (error) {
    if (isMissingTable(error)) return null
    // Existe pero no se pudo leer: tampoco se rompe la pantalla; el paso queda en «llega».
    console.error('[pos.branches.registers]', error.code, error.message)
    return null
  }
  return (data ?? []) as Array<{ branch_id: string }>
}

/** Cuándo una pantalla de cocina mostró por última vez un pedido de esta sucursal. */
async function readKitchenSeen(
  supabase: SupabaseClient,
  tenantId: string,
  branchId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('tickets')
    .select('kitchen_seen_at, table_sessions!inner(branch_id)')
    .eq('tenant_id', tenantId)
    .eq('table_sessions.branch_id', branchId)
    .not('kitchen_seen_at', 'is', null)
    .order('kitchen_seen_at', { ascending: false })
    .limit(1)
  if (error) {
    console.error('[pos.branches.kitchen-seen]', error.code, error.message)
    throw new BranchReadError('kitchen-seen')
  }
  const row = ((data ?? []) as Array<{ kitchen_seen_at: string | null }>)[0]
  return row?.kitchen_seen_at ?? null
}

/** ¿Alguna vez tuvo una mesa abierta? */
async function readHasHistory(
  supabase: SupabaseClient,
  tenantId: string,
  branchId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('table_sessions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .limit(1)
  if (error) {
    console.error('[pos.branches.history]', error.code, error.message)
    throw new BranchReadError('history')
  }
  return (data ?? []).length > 0
}
