import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceDayInCordoba } from '@/lib/dates'
import type { FloorSnapshot } from '@/lib/pos/types'
import { createClient } from '@/lib/supabase/server'
import { legacyFloorSession } from './live-model'
import { toFloorElements } from './model'

export type AreaRow = {
  id: string
  name: string
  position: number
  width: number
  height: number
  number_start: number
}

export type FloorTableMeta = {
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
}

/** Vocabulario del plano (espejo de los enums `floor_element_*`). */
export type FloorKind =
  | 'table'
  | 'wall'
  | 'pillar'
  | 'island'
  | 'bar'
  | 'door'
  | 'text'
  | 'stage'
  | 'booth'
export type FloorShape = 'rect' | 'circle' | 'banquette'
export type DecorKind = Exclude<FloorKind, 'table'>

export type ElementRow = {
  id: string
  area_id: string
  kind: FloorKind
  shape: FloorShape
  physical_table_id: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  corner_radius: number
  z_index: number
  label: string | null
  color: string | null
  table: FloorTableMeta | null
}

export type UnplacedTable = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
}

export type FloorPlanData = {
  /** Los sectores (pisos, ambientes) de la sucursal, en su orden. */
  areas: AreaRow[]
  elements: ElementRow[]
  /** Mesas activas de la sucursal que todavía no están en ningún sector. */
  unplacedTables: UnplacedTable[]
  /** Mesas desactivadas de la sucursal: no están en el plano, se reactivan desde la lista. */
  inactiveTables: UnplacedTable[]
}

// Forma cruda de la fila de elemento con el join embebido a physical_tables.
type RawElementRow = {
  id: string
  area_id: string
  kind: ElementRow['kind']
  shape: ElementRow['shape']
  physical_table_id: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  corner_radius: number
  z_index: number
  label: string | null
  color: string | null
  // Supabase devuelve el join como objeto o null (relación to-one por la FK).
  physical_tables: {
    label: string
    capacity: number | null
    qr_token: string
    active: boolean
  } | null
}

type RawTableRow = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
}

const EMPTY: FloorPlanData = { areas: [], elements: [], unplacedTables: [], inactiveTables: [] }

const AREA_COLUMNS = 'id, name, position, width, height, number_start'
const ELEMENT_COLUMNS =
  'id, area_id, kind, shape, physical_table_id, x, y, width, height, rotation, corner_radius, z_index, label, color, physical_tables(label, capacity, qr_token, active)'

/**
 * `branch_id` (migración `pos_sucursales`) todavía no está en `types/database.ts`
 * (se regenera aparte): lo que filtra por sucursal va por un cliente sin tipar y
 * se tipa acá, igual que `lib/pos/queries.ts`.
 */
async function untyped(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

/**
 * El plano que edita el dueño. Con `branchId` devuelve lo de ESA sucursal: sus
 * sectores, lo que hay dibujado en ellos y sus mesas sin ubicar (el mapa y las
 * mesas son de cada sucursal). Sin `branchId` devuelve todo el bar.
 */
export async function getFloorPlan(
  tenantId: string,
  branchId?: string | null,
): Promise<FloorPlanData> {
  const supabase = await untyped()

  // 1) Sectores, en su orden.
  let areasQuery = supabase.from('floor_plan_areas').select(AREA_COLUMNS).eq('tenant_id', tenantId)
  if (branchId) areasQuery = areasQuery.eq('branch_id', branchId)

  // 2) Elementos + join a physical_tables (solo poblado en kind='table'). Un
  // elemento es de la sucursal de su sector: se filtra por el sector (inner join).
  let elementsQuery = supabase
    .from('floor_plan_elements')
    .select(branchId ? `${ELEMENT_COLUMNS}, floor_plan_areas!inner(branch_id)` : ELEMENT_COLUMNS)
    .eq('tenant_id', tenantId)
  if (branchId) elementsQuery = elementsQuery.eq('floor_plan_areas.branch_id', branchId)

  // 3) Mesas (activas y desactivadas). PostgREST no soporta NOT EXISTS declarativo,
  // así que se traen todas y se restan las ya ubicadas.
  let tablesQuery = supabase
    .from('physical_tables')
    .select('id, label, capacity, qr_token, active')
    .eq('tenant_id', tenantId)
  if (branchId) tablesQuery = tablesQuery.eq('branch_id', branchId)

  // Las tres dependen solo de tenant y sucursal: en paralelo (3 hops → 1).
  // Los chequeos de error se mantienen en el mismo orden (areas → elements → tables).
  const [
    { data: areasData, error: areasError },
    { data: elementsData, error: elementsError },
    { data: tablesData, error: tablesError },
  ] = await Promise.all([
    areasQuery
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    elementsQuery
      .order('z_index', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    tablesQuery.order('label', { ascending: true }),
  ])

  if (areasError) {
    console.error('[floor-plan.getFloorPlan] areas', areasError.message)
    return EMPTY
  }

  if (elementsError) {
    console.error('[floor-plan.getFloorPlan] elements', elementsError.message)
    return EMPTY
  }

  if (tablesError) {
    console.error('[floor-plan.getFloorPlan] tables', tablesError.message)
    return EMPTY
  }

  const rawElements = (elementsData ?? []) as unknown as RawElementRow[]

  const elements: ElementRow[] = rawElements.map((row) => ({
    id: row.id,
    area_id: row.area_id,
    kind: row.kind,
    shape: row.shape,
    physical_table_id: row.physical_table_id,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    corner_radius: row.corner_radius,
    z_index: row.z_index,
    label: row.label,
    color: row.color,
    table:
      row.kind === 'table' && row.physical_tables
        ? {
            label: row.physical_tables.label,
            capacity: row.physical_tables.capacity,
            qr_token: row.physical_tables.qr_token,
            active: row.physical_tables.active,
          }
        : null,
  }))

  // Ids de mesas ya ubicadas (tienen elemento). Una mesa ubicada es siempre de la
  // sucursal de su sector (lo mantiene un disparador), así que alcanza con los
  // elementos de esta sucursal.
  const placedTableIds = new Set(
    rawElements.map((row) => row.physical_table_id).filter((id): id is string => id !== null),
  )

  const byLabel = (a: UnplacedTable, b: UnplacedTable) =>
    a.label.localeCompare(b.label, 'es', { numeric: true })
  const toTable = (t: RawTableRow): UnplacedTable => ({
    id: t.id,
    label: t.label,
    capacity: t.capacity,
    qr_token: t.qr_token,
  })
  const tables = (tablesData ?? []) as unknown as RawTableRow[]

  const unplacedTables = tables
    .filter((t) => t.active && !placedTableIds.has(t.id))
    .map(toTable)
    .sort(byLabel)
  const inactiveTables = tables
    .filter((t) => !t.active)
    .map(toTable)
    .sort(byLabel)

  const areas: AreaRow[] = ((areasData ?? []) as unknown as AreaRow[]).map((a) => ({
    id: a.id,
    name: a.name,
    position: a.position,
    width: a.width,
    height: a.height,
    number_start: a.number_start,
  }))

  return { areas, elements, unplacedTables, inactiveTables }
}

// ─── Tipos para la vista en vivo ─────────────────────────────────────────────

export type LiveSession = {
  id: string
  status: 'open' | 'paid' | 'merged' | 'abandoned'
  total_cents: number
  party_size: number | null
  alias: string | null
  opened_at: string
  /**
   * 'ready'     si algún ticket de la sesión tiene status='ready'
   * 'preparing' si tiene 'accepted' o 'preparing' (y ninguno 'ready')
   * 'none'      sin tickets activos en cocina
   */
  kitchen: 'none' | 'preparing' | 'ready'
  /** Existe al menos un table_session_events con type='bill_requested' para esta sesión */
  bill_requested: boolean
}

export type LiveTable = {
  element_id: string
  physical_table_id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  corner_radius: number
  shape: FloorShape
  z_index: number
  label: string
  capacity: number | null
  /** null = mesa libre (sin sesión abierta) */
  session: LiveSession | null
}

export type LiveDecor = {
  element_id: string
  kind: DecorKind
  shape: FloorShape
  x: number
  y: number
  width: number
  height: number
  rotation: number
  corner_radius: number
  z_index: number
  label: string | null
  color: string | null
}

export type LiveFloorData = {
  area: AreaRow
  tables: LiveTable[]
  decor: LiveDecor[]
}

// ─── Raw shapes para los casts de supabase-js ────────────────────────────────

type RawLiveElementRow = {
  id: string
  area_id: string
  kind: ElementRow['kind']
  shape: FloorShape
  physical_table_id: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  corner_radius: number
  z_index: number
  label: string | null
  color: string | null
  physical_tables: {
    label: string
    capacity: number | null
  } | null
}

type RawSessionRow = {
  id: string
  physical_table_id: string | null
  status: string
  total_cents: number
  party_size: number | null
  alias: string | null
  opened_at: string
}

type RawTicketRow = {
  session_id: string
  status: string
}

type RawBillEventRow = {
  session_id: string
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Devuelve todas las áreas del tenant, orden canónico (posición → created_at → id).
 * RLS SELECT abierta a miembros del tenant (owner + staff).
 */
export async function listFloorAreas(tenantId: string): Promise<AreaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('floor_plan_areas')
    .select('id, name, position, width, height, number_start')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('[floor-plan.listFloorAreas]', error.message)
    return []
  }

  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    position: a.position,
    width: a.width,
    height: a.height,
    number_start: a.number_start,
  }))
}

/**
 * Devuelve la geometría del área + estado en vivo de cada mesa.
 *
 * Estrategia (sin RPC nuevo, sin NOT EXISTS en PostgREST):
 * 1. Cargar floor_plan_elements del área (ambos kinds).
 * 2. Para los kind='table': extraer los physical_table_ids → cargar la única
 *    sesión OPEN por mesa (índice único parcial garantiza como máximo una).
 * 3. Cargar tickets de esas sesiones en status kitchen-activo
 *    ('accepted'|'preparing'|'ready') → derivar flag kitchen en JS.
 * 4. Cargar table_session_events type='bill_requested' de esas sesiones → derivar flag en JS.
 * 5. Mapear todo a LiveTable | LiveDecor.
 *
 * RLS SELECT abierta a miembros del tenant (owner + staff). No usa service_role.
 *
 * `knownArea`: si el caller ya tiene la fila del área (ej. de listFloorAreas /
 * getFloorPlan) la pasa y se ahorra el hop de re-leerla.
 */
export async function getLiveFloor(
  tenantId: string,
  areaId: string,
  knownArea?: AreaRow,
): Promise<LiveFloorData> {
  const supabase = await createClient()

  // 1) Área + 2) elementos + 3) sesiones abiertas del tenant, en paralelo
  // (3 hops secuenciales → 1). Las sesiones se filtran en JS a las mesas del
  // área (equivale al `.in(physicalTableIds)` anterior, mismo resultado).
  const [
    { data: areaData, error: areaError },
    { data: elementsData, error: elementsError },
    { data: rawSessions },
  ] = await Promise.all([
    knownArea
      ? Promise.resolve({ data: knownArea, error: null })
      : supabase
          .from('floor_plan_areas')
          .select('id, name, position, width, height, number_start')
          .eq('tenant_id', tenantId)
          .eq('id', areaId)
          .maybeSingle(),
    supabase
      .from('floor_plan_elements')
      .select(
        'id, area_id, kind, shape, physical_table_id, x, y, width, height, rotation, corner_radius, z_index, label, color, physical_tables(label, capacity)',
      )
      .eq('tenant_id', tenantId)
      .eq('area_id', areaId)
      .order('z_index', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('table_sessions')
      .select('id, physical_table_id, status, total_cents, party_size, alias, opened_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'open'),
  ])

  if (areaError || !areaData) {
    console.error('[floor-plan.getLiveFloor] area', areaError?.message ?? 'not found')
    // Devolver una estructura vacía con un área placeholder para no romper el render.
    const fallback: AreaRow = {
      id: areaId,
      name: '',
      position: 0,
      width: 800,
      height: 600,
      number_start: 1,
    }
    return { area: fallback, tables: [], decor: [] }
  }

  const area: AreaRow = {
    id: areaData.id,
    name: areaData.name,
    position: areaData.position,
    width: areaData.width,
    height: areaData.height,
    number_start: areaData.number_start,
  }

  if (elementsError) {
    console.error('[floor-plan.getLiveFloor] elements', elementsError.message)
    return { area, tables: [], decor: [] }
  }

  const rawElements = (elementsData ?? []) as unknown as RawLiveElementRow[]

  // Separar mesas y decoración.
  const tableElements = rawElements.filter(
    (el) => el.kind === 'table' && el.physical_table_id !== null,
  )
  const decorElements = rawElements.filter((el) => el.kind !== 'table')

  const decor: LiveDecor[] = decorElements.map((el) => ({
    element_id: el.id,
    kind: el.kind as LiveDecor['kind'],
    shape: el.shape,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    corner_radius: el.corner_radius,
    z_index: el.z_index,
    label: el.label,
    color: el.color,
  }))

  // Salida temprana si no hay mesas en el área.
  if (tableElements.length === 0) {
    return { area, tables: [], decor }
  }

  const physicalTableIds = new Set(
    tableElements.map((el) => el.physical_table_id).filter((id): id is string => id !== null),
  )

  // Sesiones OPEN por mesa del área (a lo sumo una por índice único parcial).
  const sessions = ((rawSessions ?? []) as unknown as RawSessionRow[]).filter(
    (s) => s.physical_table_id !== null && physicalTableIds.has(s.physical_table_id),
  )

  const sessionsByTableId = new Map<string, RawSessionRow>()
  for (const s of sessions) {
    if (s.physical_table_id) sessionsByTableId.set(s.physical_table_id, s)
  }

  const sessionIds = sessions.map((s) => s.id)

  // 4) Flags de cocina y cuenta pedida (solo si hay sesiones abiertas).
  // kitchen: tickets con status IN ('accepted','preparing','ready').
  // bill_requested: table_session_events type='bill_requested'.
  const kitchenBySession = new Map<string, 'preparing' | 'ready'>()
  const billSessionIds = new Set<string>()

  if (sessionIds.length > 0) {
    const [{ data: rawTickets }, { data: rawBillEvents }] = await Promise.all([
      supabase
        .from('tickets')
        .select('session_id, status')
        .in('session_id', sessionIds)
        .in('status', ['accepted', 'preparing', 'ready']),
      supabase
        .from('table_session_events')
        .select('session_id')
        .in('session_id', sessionIds)
        .eq('type', 'bill_requested'),
    ])

    // Derivar kitchen por sesión: 'ready' tiene prioridad sobre 'preparing'.
    for (const t of (rawTickets ?? []) as unknown as RawTicketRow[]) {
      const current = kitchenBySession.get(t.session_id)
      if (t.status === 'ready') {
        kitchenBySession.set(t.session_id, 'ready')
      } else if (current !== 'ready') {
        // 'accepted' o 'preparing' → nivel 'preparing' si no hay 'ready' todavía.
        kitchenBySession.set(t.session_id, 'preparing')
      }
    }

    for (const ev of (rawBillEvents ?? []) as unknown as RawBillEventRow[]) {
      billSessionIds.add(ev.session_id)
    }
  }

  // 5) Mapear a LiveTable.
  const tables: LiveTable[] = tableElements.map((el) => {
    const sess = el.physical_table_id ? sessionsByTableId.get(el.physical_table_id) : undefined
    const pt = el.physical_tables

    const session: LiveSession | null = sess
      ? {
          id: sess.id,
          status: sess.status as LiveSession['status'],
          total_cents: sess.total_cents ?? 0,
          party_size: sess.party_size,
          alias: sess.alias,
          opened_at: sess.opened_at,
          kitchen: kitchenBySession.get(sess.id) ?? 'none',
          bill_requested: billSessionIds.has(sess.id),
        }
      : null

    return {
      element_id: el.id,
      physical_table_id: el.physical_table_id as string,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation,
      corner_radius: el.corner_radius,
      shape: el.shape,
      z_index: el.z_index,
      label: pt?.label ?? el.label ?? '',
      capacity: pt?.capacity ?? null,
      session,
    }
  })

  return { area, tables, decor }
}

// ─── Destinos para "cambio de mesa" (mover una sesión) ────────────────────────

export type MoveTarget = {
  table_id: string
  label: string
  capacity: number | null
  area_name: string
  /** posición del área para ordenar (cross-área) */
  area_pos: number
}

/**
 * Devuelve las mesas LIBRES (activas, sin sesión abierta) a las que se puede
 * mover una sesión, en TODAS las áreas (cross-área: Planta Baja → Planta Alta).
 * Incluye mesas sin ubicar bajo el grupo "Sin ubicar". Excluye `excludeTableId`.
 * RLS SELECT abierta a miembros del tenant.
 */
export async function getMoveTargets(
  tenantId: string,
  excludeTableId?: string,
): Promise<MoveTarget[]> {
  const supabase = await createClient()

  const [{ data: els }, { data: tbls }, { data: open }] = await Promise.all([
    supabase
      .from('floor_plan_elements')
      .select('physical_table_id, floor_plan_areas(name, position)')
      .eq('tenant_id', tenantId)
      .eq('kind', 'table'),
    supabase
      .from('physical_tables')
      .select('id, label, capacity')
      .eq('tenant_id', tenantId)
      .eq('active', true),
    supabase
      .from('table_sessions')
      .select('physical_table_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'open'),
  ])

  const occupied = new Set(
    ((open ?? []) as { physical_table_id: string | null }[])
      .map((s) => s.physical_table_id)
      .filter((id): id is string => id !== null),
  )

  const placed = new Map<string, { area_name: string; area_pos: number }>()
  for (const e of (els ?? []) as unknown as {
    physical_table_id: string | null
    floor_plan_areas: { name: string; position: number } | null
  }[]) {
    if (e.physical_table_id) {
      placed.set(e.physical_table_id, {
        area_name: e.floor_plan_areas?.name ?? 'Sin ubicar',
        area_pos: e.floor_plan_areas?.position ?? 999,
      })
    }
  }

  const targets: MoveTarget[] = []
  for (const t of (tbls ?? []) as { id: string; label: string; capacity: number | null }[]) {
    if (t.id === excludeTableId || occupied.has(t.id)) continue
    const p = placed.get(t.id)
    targets.push({
      table_id: t.id,
      label: t.label,
      capacity: t.capacity,
      area_name: p?.area_name ?? 'Sin ubicar',
      area_pos: p?.area_pos ?? 999,
    })
  }

  targets.sort((a, b) => a.area_pos - b.area_pos || a.label.localeCompare(b.label, 'es'))
  return targets
}

// ─── Destinos para "mover ítems" (incluye mesas ocupadas) ─────────────────────

export type ItemMoveTarget = {
  table_id: string
  label: string
  capacity: number | null
  area_name: string
  area_pos: number
  /** sesión abierta en la mesa, o null si está libre */
  session: {
    id: string
    alias: string | null
    total_cents: number
    party_size: number | null
  } | null
}

/**
 * Igual que getMoveTargets pero para mover ÍTEMS: incluye mesas ocupadas
 * (con su sesión abierta) además de las libres, y excluye la mesa de la
 * sesión origen. RLS SELECT abierta a miembros del tenant.
 */
export async function getItemMoveTargets(
  tenantId: string,
  sourceSessionId: string,
): Promise<ItemMoveTarget[]> {
  const supabase = await createClient()

  // La sesión origen no condiciona las otras tres queries: va en el mismo
  // Promise.all (2 hops → 1).
  const [{ data: src }, { data: els }, { data: tbls }, { data: open }] = await Promise.all([
    supabase
      .from('table_sessions')
      .select('physical_table_id')
      .eq('id', sourceSessionId)
      .maybeSingle(),
    supabase
      .from('floor_plan_elements')
      .select('physical_table_id, floor_plan_areas(name, position)')
      .eq('tenant_id', tenantId)
      .eq('kind', 'table'),
    supabase
      .from('physical_tables')
      .select('id, label, capacity')
      .eq('tenant_id', tenantId)
      .eq('active', true),
    supabase
      .from('table_sessions')
      .select('id, physical_table_id, alias, total_cents, party_size')
      .eq('tenant_id', tenantId)
      .eq('status', 'open'),
  ])
  const sourceTableId = src?.physical_table_id ?? null

  const openByTable = new Map<
    string,
    { id: string; alias: string | null; total_cents: number; party_size: number | null }
  >()
  for (const s of (open ?? []) as {
    id: string
    physical_table_id: string | null
    alias: string | null
    total_cents: number
    party_size: number | null
  }[]) {
    if (s.physical_table_id) {
      openByTable.set(s.physical_table_id, {
        id: s.id,
        alias: s.alias,
        total_cents: s.total_cents ?? 0,
        party_size: s.party_size,
      })
    }
  }

  const placed = new Map<string, { area_name: string; area_pos: number }>()
  for (const e of (els ?? []) as unknown as {
    physical_table_id: string | null
    floor_plan_areas: { name: string; position: number } | null
  }[]) {
    if (e.physical_table_id) {
      placed.set(e.physical_table_id, {
        area_name: e.floor_plan_areas?.name ?? 'Sin ubicar',
        area_pos: e.floor_plan_areas?.position ?? 999,
      })
    }
  }

  const targets: ItemMoveTarget[] = []
  for (const t of (tbls ?? []) as { id: string; label: string; capacity: number | null }[]) {
    if (t.id === sourceTableId) continue
    const p = placed.get(t.id)
    targets.push({
      table_id: t.id,
      label: t.label,
      capacity: t.capacity,
      area_name: p?.area_name ?? 'Sin ubicar',
      area_pos: p?.area_pos ?? 999,
      session: openByTable.get(t.id) ?? null,
    })
  }

  targets.sort((a, b) => a.area_pos - b.area_pos || a.label.localeCompare(b.label, 'es'))
  return targets
}

// ─── «En vivo» en un bar sin punto de venta ──────────────────────────────────

/**
 * La foto del salón de una sucursal de un bar SIN punto de venta, con la misma forma que usa la maqueta
 * (`FloorSnapshot`). Sale de lo de siempre: el plano y las mesas abiertas del servicio de mesa anterior.
 * Así «En vivo» dibuja la misma maqueta en cualquier bar (antes caía al plano viejo).
 *
 * Lee con el cliente de la persona: las políticas de cada tabla deciden qué ve, y cada consulta filtra
 * por el bar. No trae reservas (el servicio viejo no las ata a una mesa).
 */
export async function getLegacyFloorSnapshot(
  tenantId: string,
  branch: FloorSnapshot['branch'],
): Promise<FloorSnapshot> {
  const supabase = await createClient()
  const [plan, { data: rawSessions, error: sessionsError }] = await Promise.all([
    getFloorPlan(tenantId, branch.id),
    supabase
      .from('table_sessions')
      .select('id, physical_table_id, status, total_cents, party_size, alias, opened_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'open'),
  ])
  if (sessionsError) console.error('[floor-plan.legacySnapshot] sessions', sessionsError.message)

  const elements = toFloorElements(plan.elements)
  // Las mesas de ESTA sucursal: las dibujadas y las que todavía no tienen lugar.
  const tableIds = new Set<string>()
  for (const el of elements) if (el.table_id) tableIds.add(el.table_id)
  for (const table of plan.unplacedTables) tableIds.add(table.id)

  const sessions = ((rawSessions ?? []) as unknown as RawSessionRow[]).filter(
    (row) => row.physical_table_id !== null && tableIds.has(row.physical_table_id),
  )
  const sessionIds = sessions.map((row) => row.id)

  const kitchen = new Map<string, 'preparing' | 'ready'>()
  const billAt = new Map<string, string>()
  if (sessionIds.length > 0) {
    const [{ data: rawTickets }, { data: rawBill }] = await Promise.all([
      supabase
        .from('tickets')
        .select('session_id, status')
        .in('session_id', sessionIds)
        .in('status', ['accepted', 'preparing', 'ready']),
      supabase
        .from('table_session_events')
        .select('session_id, created_at')
        .in('session_id', sessionIds)
        .eq('type', 'bill_requested'),
    ])
    for (const ticket of (rawTickets ?? []) as unknown as RawTicketRow[]) {
      if (ticket.status === 'ready') kitchen.set(ticket.session_id, 'ready')
      else if (kitchen.get(ticket.session_id) !== 'ready') {
        kitchen.set(ticket.session_id, 'preparing')
      }
    }
    for (const event of (rawBill ?? []) as unknown as Array<{
      session_id: string
      created_at: string
    }>) {
      // Si la pidió más de una vez, cuenta la primera: desde ahí espera.
      const known = billAt.get(event.session_id)
      if (!known || event.created_at < known) billAt.set(event.session_id, event.created_at)
    }
  }

  return {
    now: new Date().toISOString(),
    service_day: serviceDayInCordoba(),
    branch,
    settings: null,
    areas: plan.areas.map((area) => ({
      id: area.id,
      name: area.name,
      position: area.position,
      width: area.width,
      height: area.height,
    })),
    elements,
    loose_tables: plan.unplacedTables.map((table) => ({
      id: table.id,
      label: table.label,
      capacity: table.capacity,
    })),
    sessions: sessions.map((row) =>
      legacyFloorSession({
        id: row.id,
        tableId: row.physical_table_id as string,
        openedAt: row.opened_at,
        partySize: row.party_size,
        alias: row.alias,
        totalCents: row.total_cents ?? 0,
        kitchen: kitchen.get(row.id) ?? 'none',
        billRequestedAt: billAt.get(row.id) ?? null,
      }),
    ),
    reservations: [],
    practice_until: null,
  }
}
