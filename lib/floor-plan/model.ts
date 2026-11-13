/**
 * Del plano que edita el dueño a la maqueta que ve el salón — PURO y testeado
 * (`tests/lib/floor-plan-model.test.ts`).
 *
 * El editor guarda los elementos como filas de `floor_plan_elements`
 * (`ElementRow`); la maqueta (`components/pos/floor/floor-model.tsx`) dibuja
 * `FloorElement`, la forma que devuelve `pos_floor_snapshot`. Acá está la
 * traducción, con el mismo criterio que esa RPC, para que el dueño vea mientras
 * edita exactamente lo que va a ver el mozo.
 */
import { deriveFreeState, type TableState } from '@/lib/pos/table-state'
import type { FloorElement } from '@/lib/pos/types'
import type { ElementRow, FloorKind, FloorPlanData, FloorShape, UnplacedTable } from './queries'

/**
 * Sillas que se dibujan cuando la mesa todavía no tiene lugares cargados: lo
 * mismo que asume la maqueta del salón (`buildScene` usa `capacity ?? 4`).
 */
export const DEFAULT_SEATS = 4

/** Nombre de cada tipo de elemento, como se le dice en el bar. */
export const KIND_LABELS: Record<FloorKind, string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
  door: 'Puerta',
  text: 'Texto',
  stage: 'Escenario',
  booth: 'Box',
}

/** «Mesa 12», «Barra», «Texto Entrada»: cómo se nombra un elemento en pantalla y a los lectores. */
export function elementName(row: Pick<ElementRow, 'kind' | 'label' | 'table'>): string {
  if (row.kind === 'table') return `Mesa ${row.table?.label ?? row.label ?? ''}`.trim()
  return `${KIND_LABELS[row.kind]}${row.label ? ` ${row.label}` : ''}`
}

/**
 * Geometría «en el aire»: lo que el dueño está arrastrando, estirando o girando
 * y todavía no soltó. Pisa a la guardada solo para dibujar la maqueta.
 */
export type LiveGeometry = {
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
}

export function toFloorElement(row: ElementRow, live?: LiveGeometry | null): FloorElement {
  const isTable = row.kind === 'table'
  return {
    id: row.id,
    area_id: row.area_id,
    kind: row.kind,
    shape: row.shape,
    x: live?.x ?? row.x,
    y: live?.y ?? row.y,
    w: live?.width ?? row.width,
    h: live?.height ?? row.height,
    rotation: live?.rotation ?? row.rotation,
    corner_radius: row.corner_radius,
    z: row.z_index,
    label: row.label,
    color: row.color,
    table_id: isTable ? row.physical_table_id : null,
    table_label: isTable ? (row.table?.label ?? row.label) : null,
    capacity: isTable ? (row.table?.capacity ?? null) : null,
  }
}

/**
 * Los elementos de un sector, listos para la maqueta. Igual que la RPC del
 * salón, deja afuera las mesas desactivadas (y las que no tienen mesa detrás).
 */
export function toFloorElements(
  rows: readonly ElementRow[],
  live?: ReadonlyMap<string, LiveGeometry> | null,
): FloorElement[] {
  const out: FloorElement[] = []
  for (const row of rows) {
    if (row.kind === 'table' && (!row.physical_table_id || row.table?.active === false)) continue
    out.push(toFloorElement(row, live?.get(row.id)))
  }
  return out
}

/** Lo que la maqueta necesita saber de cada mesa. */
export type ModelTable = { state: TableState; partySize: number | null; alias: string | null }

const FREE_TABLE: ModelTable = { state: deriveFreeState(null), partySize: null, alias: null }

/** En el editor todas las mesas están libres: se ve el salón armado, sin gente. */
export function freeTables(elements: readonly FloorElement[]): Record<string, ModelTable> {
  const out: Record<string, ModelTable> = {}
  for (const el of elements) {
    if (el.kind === 'table' && el.table_id) out[el.table_id] = FREE_TABLE
  }
  return out
}

/**
 * Qué lugar ocupa una mesa entre las mesas de la maqueta (1 = la primera), en
 * el orden en que la maqueta arma sus zonas de toque: el de los elementos. Con
 * eso el editor marca en la maqueta la mesa elegida. `null` si no está.
 */
export function tableOrdinal(elements: readonly FloorElement[], tableId: string): number | null {
  let ordinal = 0
  for (const el of elements) {
    if (el.kind !== 'table' || !el.table_id) continue
    ordinal += 1
    if (el.table_id === tableId) return ordinal
  }
  return null
}

/**
 * Ancho medio de un carácter del número de mesa, en em. Medido con la fuente del
 * plano (Archivo 800 angosta): los dígitos dan 0,50 y las mayúsculas 0,51. Con
 * 0,56 queda un poco de aire.
 */
const NUMBER_CHAR_EM = 0.56
/** Aire a los costados del número, en px del plano. */
const NUMBER_SIDE_ROOM = 10
const NUMBER_MIN = 13
const NUMBER_MAX = 30
/** Una etiqueta larga no se achica más que esto: abajo ya no se lee. */
const NUMBER_FLOOR = 9

export type TableNumberSize = {
  /** El tamaño con el plano al 100 %. */
  size: number
  /** El más grande que entra en la mesa: el tope aunque el plano esté alejado. */
  cap: number
}

/**
 * Tamaño (en px del plano) del número de una mesa. Va con el lado más chico y,
 * si la etiqueta es larga («50VIP», «Barra 12»), se achica hasta entrar en la
 * mesa en vez de quedar cortada. El número se dibuja siempre derecho: con la
 * mesa girada, el ancho que cuenta es la cuerda horizontal del rectángulo girado
 * (a 90° es el alto).
 */
export function tableNumberSize(
  width: number,
  height: number,
  label: string,
  rotation = 0,
): TableNumberSize {
  const base = Math.max(NUMBER_MIN, Math.min(NUMBER_MAX, Math.min(width, height) * 0.36))
  const chars = Math.max(1, Array.from(label.trim()).length)
  const rad = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const span = Math.min(
    cos > 1e-6 ? width / cos : Number.POSITIVE_INFINITY,
    sin > 1e-6 ? height / sin : Number.POSITIVE_INFINITY,
  )
  const cap = Math.max(NUMBER_FLOOR, (span - NUMBER_SIDE_ROOM) / (chars * NUMBER_CHAR_EM))
  return { size: round2(Math.min(base, cap)), cap: round2(cap) }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export type PlanBox = { x: number; y: number; width: number; height: number }

/**
 * La caja que contiene a todos los elementos (girados incluidos), con aire
 * alrededor para las sillas. `null` si no hay nada. La usa «Encajar».
 */
export function contentBox(
  rows: readonly Pick<ElementRow, 'x' | 'y' | 'width' | 'height' | 'rotation'>[],
  pad = 60,
): PlanBox | null {
  if (rows.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    const rad = ((row.rotation ?? 0) * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))
    const halfW = (row.width * cos + row.height * sin) / 2
    const halfH = (row.width * sin + row.height * cos) / 2
    const cx = row.x + row.width / 2
    const cy = row.y + row.height / 2
    minX = Math.min(minX, cx - halfW)
    minY = Math.min(minY, cy - halfH)
    maxX = Math.max(maxX, cx + halfW)
    maxY = Math.max(maxY, cy + halfH)
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  }
}

/** Cuántas mesas hay dibujadas en cada sector (lo que muestra cada pestaña). */
export function sectorTableCounts(
  rows: readonly Pick<ElementRow, 'area_id' | 'kind' | 'physical_table_id'>[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    if (row.kind !== 'table' || !row.physical_table_id) continue
    out[row.area_id] = (out[row.area_id] ?? 0) + 1
  }
  return out
}

/**
 * Huella de lo que el servidor mandó. El editor trabaja sobre una copia
 * optimista y solo la vuelve a sembrar cuando esta huella cambia: así un
 * refresco que no trae nada nuevo no pisa lo que el dueño está moviendo.
 */
export function planSignature(rows: readonly ElementRow[]): string {
  return rows
    .map((row) =>
      [
        row.id,
        row.area_id,
        row.kind,
        row.shape,
        row.x,
        row.y,
        row.width,
        row.height,
        row.rotation,
        row.corner_radius,
        row.z_index,
        row.label ?? '',
        row.color ?? '',
        row.physical_table_id ?? '',
        row.table
          ? `${row.table.active}/${row.table.label}/${row.table.capacity ?? ''}/${row.table.qr_token}`
          : '',
      ].join(':'),
    )
    .join('|')
}

/**
 * Un cambio que el editor muestra antes de que conteste el servidor (lugares,
 * número, forma, nombre o color). Solo trae lo que cambia.
 */
export type ElementPatch = {
  shape?: FloorShape
  label?: string | null
  color?: string | null
  table?: { label?: string; capacity?: number | null }
}

/** La fila con el cambio encima. Los datos de mesa solo se tocan si la fila es una mesa. */
export function applyPatch(row: ElementRow, patch: ElementPatch): ElementRow {
  return {
    ...row,
    ...(patch.shape !== undefined ? { shape: patch.shape } : null),
    ...(patch.label !== undefined ? { label: patch.label } : null),
    ...(patch.color !== undefined ? { color: patch.color } : null),
    table: patch.table && row.table ? { ...row.table, ...patch.table } : row.table,
  }
}

/** Una mesa en la lista del editor (la pestaña «Lista» y el respaldo si el plano falla). */
export type ListedTable = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
  /** Dónde está dibujada. `null` = sin ubicar, o desactivada. */
  sector: string | null
}

/**
 * Todas las mesas de la sucursal en una sola lista: las dibujadas (con su
 * sector), las que están sin ubicar y las desactivadas. Ordenadas como se
 * cuentan: 2 antes que 10.
 */
export function listTables(data: FloorPlanData): ListedTable[] {
  const sectorOf = new Map(data.areas.map((area) => [area.id, area.name]))
  const placed: ListedTable[] = []
  for (const el of data.elements) {
    if (el.kind !== 'table' || !el.physical_table_id || !el.table) continue
    placed.push({
      id: el.physical_table_id,
      label: el.table.label,
      capacity: el.table.capacity,
      qr_token: el.table.qr_token,
      active: el.table.active,
      sector: sectorOf.get(el.area_id) ?? null,
    })
  }
  const loose = (active: boolean) => (t: FloorPlanData['unplacedTables'][number]) => ({
    id: t.id,
    label: t.label,
    capacity: t.capacity,
    qr_token: t.qr_token,
    active,
    sector: null,
  })
  return [
    ...placed,
    ...data.unplacedTables.map(loose(true)),
    ...data.inactiveTables.map(loose(false)),
  ].sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }))
}

/** Una mesa que el dueño acaba de quitar del plano y que el servidor todavía no confirmó. */
export type RemovedTable = { elementId: string; table: UnplacedTable }

/** La mesa de un elemento, como va a quedar en «Mesas sin ubicar». `null` si no es una mesa. */
export function removedTableOf(row: ElementRow): RemovedTable | null {
  if (row.kind !== 'table' || !row.physical_table_id || !row.table) return null
  return {
    elementId: row.id,
    table: {
      id: row.physical_table_id,
      label: row.table.label,
      capacity: row.table.capacity,
      qr_token: row.table.qr_token,
    },
  }
}

/**
 * «Mesas sin ubicar» sin esperar al servidor: lo que el servidor ya sabe más las
 * que se acaban de quitar del plano. Una mesa no aparece dos veces, ni aparece
 * si sigue (o volvió a estar) dibujada. Ordenadas como se cuentan.
 */
export function unplacedWithRemoved(
  server: readonly UnplacedTable[],
  removed: readonly RemovedTable[],
  placedTableIds: ReadonlySet<string>,
): UnplacedTable[] {
  if (removed.length === 0) return [...server]
  const seen = new Set(server.map((t) => t.id))
  const out = [...server]
  for (const { table } of removed) {
    if (seen.has(table.id) || placedTableIds.has(table.id)) continue
    seen.add(table.id)
    out.push(table)
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }))
}

/**
 * Tras un refresco, qué mesas «recién quitadas» siguen haciendo falta: las que
 * todavía están viajando (`inFlight`, por id de elemento) y las que el servidor
 * aún no muestra ni como sin ubicar ni como dibujadas. Las demás ya las trae el
 * servidor (o no se pudieron quitar) y sobran.
 */
export function pruneRemoved(
  removed: readonly RemovedTable[],
  data: Pick<FloorPlanData, 'unplacedTables' | 'elements'>,
  inFlight: ReadonlySet<string>,
): RemovedTable[] {
  const unplaced = new Set(data.unplacedTables.map((t) => t.id))
  const placed = new Set(data.elements.map((e) => e.physical_table_id))
  return removed.filter(
    (r) => inFlight.has(r.elementId) || (!unplaced.has(r.table.id) && !placed.has(r.table.id)),
  )
}
