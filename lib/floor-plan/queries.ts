import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
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
