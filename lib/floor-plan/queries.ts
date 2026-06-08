import 'server-only'
import { createClient } from '@/lib/supabase/server'

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
  areas: AreaRow[]
  elements: ElementRow[]
  unplacedTables: UnplacedTable[]
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

const EMPTY: FloorPlanData = { areas: [], elements: [], unplacedTables: [] }

export async function getFloorPlan(tenantId: string): Promise<FloorPlanData> {
  const supabase = await createClient()

  // 1) Áreas del tenant, orden canónico.
  const { data: areasData, error: areasError } = await supabase
    .from('floor_plan_areas')
    .select('id, name, position, width, height, number_start')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (areasError) {
    console.error('[floor-plan.getFloorPlan] areas', areasError.message)
    return EMPTY
  }

  // 2) Elementos del tenant + join a physical_tables (solo poblado en kind='table').
  const { data: elementsData, error: elementsError } = await supabase
    .from('floor_plan_elements')
    .select(
      'id, area_id, kind, shape, physical_table_id, x, y, width, height, rotation, corner_radius, z_index, label, color, physical_tables(label, capacity, qr_token, active)',
    )
    .eq('tenant_id', tenantId)
    .order('z_index', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (elementsError) {
    console.error('[floor-plan.getFloorPlan] elements', elementsError.message)
    return EMPTY
  }

  // 3) Mesas activas sin elemento (anti-join). PostgREST no soporta NOT EXISTS
  // declarativo, así que traemos las activas y restamos las ya ubicadas.
  const { data: tablesData, error: tablesError } = await supabase
    .from('physical_tables')
    .select('id, label, capacity, qr_token')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('label', { ascending: true })

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

  // Ids de mesas ya ubicadas (tienen elemento).
  const placedTableIds = new Set(
    rawElements.map((row) => row.physical_table_id).filter((id): id is string => id !== null),
  )

  const unplacedTables: UnplacedTable[] = (tablesData ?? [])
    .filter((t) => !placedTableIds.has(t.id))
    .map((t) => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      qr_token: t.qr_token,
    }))

  const areas: AreaRow[] = (areasData ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    position: a.position,
    width: a.width,
    height: a.height,
    number_start: a.number_start,
  }))

  return { areas, elements, unplacedTables }
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
 */
export async function getLiveFloor(tenantId: string, areaId: string): Promise<LiveFloorData> {
  const supabase = await createClient()

  // 1) Área
  const { data: areaData, error: areaError } = await supabase
    .from('floor_plan_areas')
    .select('id, name, position, width, height, number_start')
    .eq('tenant_id', tenantId)
    .eq('id', areaId)
    .maybeSingle()

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

  // 2) Elementos del área + join a physical_tables (solo kind='table' tiene FK).
  const { data: elementsData, error: elementsError } = await supabase
    .from('floor_plan_elements')
    .select(
      'id, area_id, kind, shape, physical_table_id, x, y, width, height, rotation, corner_radius, z_index, label, color, physical_tables(label, capacity)',
    )
    .eq('tenant_id', tenantId)
    .eq('area_id', areaId)
    .order('z_index', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

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

  const physicalTableIds = tableElements
    .map((el) => el.physical_table_id)
    .filter((id): id is string => id !== null)

  // 3) Sesiones OPEN por mesa (a lo sumo una por índice único parcial).
  const { data: rawSessions } = await supabase
    .from('table_sessions')
    .select('id, physical_table_id, status, total_cents, party_size, alias, opened_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .in('physical_table_id', physicalTableIds)

  const sessions = ((rawSessions ?? []) as unknown as RawSessionRow[]).filter(
    (s) => s.physical_table_id !== null,
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
