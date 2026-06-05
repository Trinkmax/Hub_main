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

export type ElementRow = {
  id: string
  area_id: string
  kind: 'table' | 'wall' | 'pillar' | 'island' | 'bar'
  shape: 'rect' | 'circle'
  physical_table_id: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
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
      'id, area_id, kind, shape, physical_table_id, x, y, width, height, rotation, z_index, label, color, physical_tables(label, capacity, qr_token, active)',
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
