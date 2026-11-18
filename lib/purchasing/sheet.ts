/**
 * La planilla de insumos (pedido de Tomás, 09/11/2026: «el listado de insumos, donde tiene el stock objetivo y
 * esas cosas, me gustaría modificarlo desde el Excel»). Ver docs/features/compras.md › Planilla de insumos.
 *
 * Se baja la lista como `.xlsx`, se cambia en Excel o en Google Sheets y se sube: antes de guardar se muestra qué
 * cambia. HUB sigue siendo el dueño de la lista (la usan la cocina, los pedidos, las recetas y Tex); la planilla es
 * la forma de corregir muchos a la vez. Puro: arma el libro y lee el que vuelve. Las acciones están en
 * `sheet-actions.ts`.
 *
 * Reglas al leer:
 * - Cada fila se une con su insumo por la columna oculta «Clave HUB»; si no está (otra planilla, la vieja de
 *   Google), por el código y después por el nombre. Una fila que no se une con ninguno es un insumo nuevo.
 * - Una columna que no viene no se toca. Una celda vacía borra el dato (sin objetivo, sin proveedor…), salvo
 *   Frecuencia y Activo, que quedan como estaban.
 * - Borrar una fila no borra el insumo: queda como está. Para que deje de contarse, «No» en Activo.
 * - El proveedor tiene que existir en HUB (nunca se elige uno parecido solo: se sugiere).
 * - Una zona que HUB no tiene la decide quien sube (pedido de Tomás, 18/11/2026: «yo las modifiqué desde el
 *   Excel nomás»): es nueva y se arma, es una que ya está escrita de otra forma, o es una que ya está con el
 *   nombre cambiado. Por defecto, nueva; mal escrita por una o dos letras, esa; y si sus insumos vienen de una
 *   zona que la planilla ya no nombra, el nombre nuevo de esa (ver `sheetZones`).
 * - Una fila con un problema no se carga entera; las demás sí.
 */

import { sha256HexSync } from '@/lib/imports/hash'
import { findHeaderRow, type HeaderRule } from '@/lib/imports/headers'
import type { Cell } from '@/lib/imports/types'
import { columnName, type XlsxSheetSpec } from '@/lib/xlsx/write'
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  type Frequency,
  type PurItem,
  type PurSupplier,
  type PurZone,
} from './types'
import { formatAmount, sameUnit, UNIT_OPTIONS, unitKey } from './units'

export type SheetField =
  | 'code'
  | 'name'
  | 'brand'
  | 'zone'
  | 'unit'
  | 'target'
  | 'packLabel'
  | 'packSize'
  | 'supplier'
  | 'frequency'
  | 'active'
  | 'notes'
  | 'key'

/** Las columnas de la planilla que se baja, en el orden de la planilla vieja de Google. */
export const ITEM_SHEET_COLUMNS: ReadonlyArray<{
  readonly field: SheetField
  readonly title: string
  readonly width: number
  readonly hidden?: boolean
  readonly text?: boolean
}> = [
  { field: 'code', title: 'Código', width: 11, text: true },
  { field: 'name', title: 'Insumo', width: 34 },
  { field: 'brand', title: 'Marca', width: 16 },
  { field: 'zone', title: 'Zona', width: 24 },
  { field: 'unit', title: 'Unidad', width: 10 },
  { field: 'target', title: 'Objetivo', width: 10 },
  { field: 'packLabel', title: 'Presentación', width: 22 },
  { field: 'packSize', title: 'Cada una trae', width: 13 },
  { field: 'supplier', title: 'Proveedor', width: 26 },
  { field: 'frequency', title: 'Frecuencia', width: 12 },
  { field: 'active', title: 'Activo', width: 8 },
  { field: 'notes', title: 'Notas', width: 44 },
  { field: 'key', title: 'Clave HUB', width: 38, hidden: true },
]

const TITLE_OF = Object.fromEntries(ITEM_SHEET_COLUMNS.map((c) => [c.field, c.title])) as Record<
  SheetField,
  string
>

/** Las columnas que se pueden cambiar (todas menos la clave), para avisar cuáles no vinieron. */
const EDITABLE: readonly SheetField[] = ITEM_SHEET_COLUMNS.map((c) => c.field).filter(
  (f) => f !== 'key',
)

/**
 * Los títulos que se reconocen, ya normalizados (`normalizeHeader`: sin tildes, minúsculas, sin «de/del/la/el»).
 * Incluye los de la planilla vieja de Google (id, nombre, sector, contenido) para poder subir esa también.
 */
const HEADER_RULES: readonly HeaderRule<SheetField>[] = [
  [/^(clave|clave hub|id hub)$/, 'key'],
  [/^(codigo|cod|id|id insumo|codigo insumo|cod insumo)$/, 'code'],
  [/^(insumo|insumos|nombre|producto|articulo|descripcion)$/, 'name'],
  [/^marca$/, 'brand'],
  [/^(zona|zona recorrido|sector|ubicacion|lugar)$/, 'zone'],
  [/^(unidad|unidad conteo|se cuenta en|medida|um|u m)$/, 'unit'],
  [/^(objetivo|stock objetivo|objetivo stock|stock ideal|stock)$/, 'target'],
  [/^(presentacion|como se compra|envase)$/, 'packLabel'],
  [
    /^(cada una trae|contenido|trae|cantidad por presentacion|unidades por presentacion)$/,
    'packSize',
  ],
  [/^(proveedor|proveedores)$/, 'supplier'],
  [/^(frecuencia|tipo)$/, 'frequency'],
  [/^(activo|activa)$/, 'active'],
  [/^(notas|nota|observaciones|observacion|obs|comentarios)$/, 'notes'],
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_QTY = 1_000_000

/** Lo que se edita de un insumo: lo que escribe la planilla y lo que guarda `pur_items`. */
export type ItemValues = {
  code: string | null
  name: string
  brand: string | null
  zoneId: string | null
  unit: string
  frequency: Frequency
  targetQty: number | null
  packLabel: string | null
  packSize: number | null
  supplierId: string | null
  notes: string | null
  active: boolean
}

export function itemValues(item: PurItem): ItemValues {
  return {
    code: item.code,
    name: item.name,
    brand: item.brand,
    zoneId: item.zoneId,
    unit: item.unit,
    frequency: item.frequency,
    targetQty: item.targetQty,
    packLabel: item.packLabel,
    packSize: item.packSize,
    supplierId: item.supplierId,
    notes: item.notes,
    active: item.active,
  }
}

export type SheetCatalog = {
  readonly items: readonly PurItem[]
  readonly zones: readonly PurZone[]
  readonly suppliers: readonly PurSupplier[]
}

// ─── Nombres ─────────────────────────────────────────────────────────────────

/** «Cámara de Frío » → «camara de frio»: para comparar nombres sin tildes, mayúsculas ni signos. */
export function nameKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length] ?? 0
}

/**
 * El más parecido de la lista, con cuánto se parece: `prefix` cuando uno empieza con el otro («Fractal» y
 * «Fractal Agricultura»), si no la cantidad de letras distintas. `null` si ninguno se parece lo suficiente.
 */
function nearest<T extends { name: string }>(
  text: string,
  list: readonly T[],
): { item: T; distance: number; prefix: boolean } | null {
  const key = nameKey(text)
  if (!key) return null
  let best: { item: T; distance: number; prefix: boolean } | null = null
  for (const item of list) {
    const other = nameKey(item.name)
    if (!other) continue
    const prefix = other.startsWith(`${key} `) || key.startsWith(`${other} `)
    const distance = prefix ? 0.5 : levenshtein(key, other)
    if (!best || distance < best.distance) best = { item, distance, prefix }
  }
  if (!best) return null
  return best.distance <= Math.max(1, Math.floor(key.length / 3)) ? best : null
}

/** El nombre más parecido de la lista, para sugerirlo (nunca se elige solo). */
function closest(text: string, names: readonly string[]): string | null {
  return (
    nearest(
      text,
      names.map((name) => ({ name })),
    )?.item.name ?? null
  )
}

/**
 * Un nombre de la lista (zona, proveedor) → su id, o el porqué. Primero el nombre tal cual (sin mayúsculas ni
 * espacios de más), después sin tildes ni signos; si así hay dos («San Jose» y «San José»), no se elige.
 */
function lookup<T extends { id: string; name: string }>(
  text: string,
  list: readonly T[],
): { ok: true; id: string } | { ok: false; suggestion: string | null; twins: string[] } {
  const plain = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const exact = list.filter((x) => plain(x.name) === plain(text))
  if (exact.length === 1 && exact[0]) return { ok: true, id: exact[0].id }
  const key = nameKey(text)
  const found = list.filter((x) => nameKey(x.name) === key)
  if (found.length === 1 && found[0]) return { ok: true, id: found[0].id }
  if (found.length > 1) return { ok: false, suggestion: null, twins: found.map((x) => x.name) }
  return {
    ok: false,
    suggestion: closest(
      text,
      list.map((x) => x.name),
    ),
    twins: [],
  }
}

/** Por qué no se encontró: «La zona «X» no está en HUB. ¿Es «Y»?». */
function notFound(
  what: 'La zona' | 'El proveedor',
  text: string,
  found: { suggestion: string | null; twins: string[] },
  otherwise: string,
): string {
  if (found.twins.length > 1)
    return `${what} «${text}» puede ser ${found.twins.map((t) => `«${t}»`).join(' o ')}: elegilo de la lista.`
  if (found.suggestion) return `${what} «${text}» no está en HUB. ¿Es «${found.suggestion}»?`
  return `${what} «${text}» no está en HUB. ${otherwise}`
}

// ─── Zonas que la planilla trae y HUB no tiene ───────────────────────────────

/** Qué es una zona que la planilla trae y HUB no tiene. La elige quien sube. */
export type ZoneChoice =
  /** Un lugar nuevo: se arma al guardar, al final del recorrido. */
  | { readonly kind: 'create' }
  /** Es esa zona de HUB escrita de otra forma: las filas van ahí y la zona queda como está. */
  | { readonly kind: 'existing'; readonly zoneId: string }
  /** Es esa zona de HUB con el nombre cambiado: toma el nombre de la planilla, con todos sus insumos. */
  | { readonly kind: 'rename'; readonly zoneId: string }

export type SheetNewZone = {
  /** `nameKey` del nombre: así se juntan las filas que la escriben igual (con o sin tildes). */
  readonly key: string
  /** Como vino escrita la primera vez. */
  readonly name: string
  /** Las filas que la usan y se cargan (las que tienen otro problema no cuentan). */
  readonly lines: readonly number[]
  /** Dónde están hoy los insumos de esas filas (`null`: sin zona, o un insumo nuevo). */
  readonly from: ReadonlyArray<{ readonly zoneId: string | null; readonly count: number }>
  /** La zona de HUB que más se le parece, para ofrecerla primero. */
  readonly similarId: string | null
  readonly choice: ZoneChoice
  /** Cómo se llama hoy la zona elegida (va en la huella: si alguien la cambia, se vuelve a mostrar). */
  readonly targetName: string | null
}

export type ZoneChoices = Readonly<Record<string, ZoneChoice>>

const NEW_ZONE = 'nueva:'

/** El lugar de una zona que se va a armar al guardar: hasta entonces, el insumo apunta acá. */
export function newZoneRef(key: string): string {
  return `${NEW_ZONE}${key}`
}

/** La clave de la zona nueva a la que apunta un insumo, o `null` si apunta a una de HUB. */
export function newZoneKeyOf(zoneId: string | null): string | null {
  return zoneId?.startsWith(NEW_ZONE) ? zoneId.slice(NEW_ZONE.length) : null
}

/** Hasta dos letras distintas, sin que una empiece con la otra: es la misma, mal escrita. */
const TYPO_DISTANCE = 2

// ─── Celdas ──────────────────────────────────────────────────────────────────

/** Una celda como texto, sin espacios de más. */
function cellText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'boolean') return cell ? 'Sí' : 'No'
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : ''
  return cell.replace(/\s+/g, ' ').trim()
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }

/**
 * Un número de la planilla: el de la celda, o el que se escribió en un CSV («2,5», «1.000», «10 kg»).
 * Vacío = `null`. Con punto de miles (es-AR) «1.500» es mil quinientos; «1.5», uno y medio.
 */
export function parseSheetAmount(cell: Cell | undefined, column: string): Parsed<number | null> {
  const notNumber = {
    ok: false as const,
    reason: `${column}: «${cellText(cell)}» no es un número.`,
  }
  if (cell === null || cell === undefined) return { ok: true, value: null }
  if (typeof cell === 'boolean') return notNumber
  let n: number
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return notNumber
    n = cell
  } else {
    const text = cell.replace(/\s+/g, '')
    if (!text) return { ok: true, value: null }
    if (/^-\d/.test(text)) return { ok: false, reason: `${column}: no puede ser negativo.` }
    // El número, y si atrás viene la unidad («10kg», «2,5 L»), se ignora.
    const m = /^([0-9][0-9.,]*|[.,][0-9]+)[a-záéíóúñ.]*$/i.exec(text)
    if (!m?.[1]) return notNumber
    let s = m[1]
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
    else if (s.includes(',') && s.includes('.')) {
      s =
        s.lastIndexOf(',') > s.lastIndexOf('.')
          ? s.replace(/\./g, '').replace(',', '.')
          : s.replace(/,/g, '')
    } else s = s.replace(',', '.')
    if (!/^(\d+(\.\d+)?|\.\d+)$/.test(s)) return notNumber
    n = Number(s)
  }
  if (n < 0) return { ok: false, reason: `${column}: no puede ser negativo.` }
  if (n > MAX_QTY) return { ok: false, reason: `${column}: es demasiado grande.` }
  return { ok: true, value: round3(n) }
}

const FREQUENCY_WORDS: Record<string, Frequency> = {
  frecuente: 'frequent',
  frecuentes: 'frequent',
  f: 'frequent',
  siempre: 'frequent',
  frequent: 'frequent',
  secundario: 'secondary',
  secundaria: 'secondary',
  secundarios: 'secondary',
  mensual: 'secondary',
  secondary: 'secondary',
  eventual: 'occasional',
  eventuales: 'occasional',
  e: 'occasional',
  ocasional: 'occasional',
  evento: 'occasional',
  eventos: 'occasional',
  occasional: 'occasional',
}

export function parseSheetFrequency(cell: Cell | undefined): Parsed<Frequency | null> {
  const text = cellText(cell)
  if (!text) return { ok: true, value: null }
  const found = FREQUENCY_WORDS[nameKey(text)]
  if (found) return { ok: true, value: found }
  return {
    ok: false,
    reason: `Frecuencia: «${text}» no es una. Poné ${FREQUENCIES.map((f) => FREQUENCY_LABELS[f]).join(', ')}.`,
  }
}

const YES = new Set(['si', 's', 'x', '1', 'true', 'verdadero', 'activo', 'activa', 'ok', 'yes'])
const NO = new Set([
  'no',
  'n',
  '0',
  'false',
  'falso',
  'inactivo',
  'inactiva',
  'desactivado',
  'desactivada',
  'baja',
])

export function parseSheetActive(cell: Cell | undefined): Parsed<boolean | null> {
  if (typeof cell === 'boolean') return { ok: true, value: cell }
  const text = cellText(cell)
  if (!text) return { ok: true, value: null }
  const key = nameKey(text)
  if (YES.has(key)) return { ok: true, value: true }
  if (NO.has(key)) return { ok: true, value: false }
  return { ok: false, reason: `Activo: poné «Sí» o «No» (dice «${text}»).` }
}

/** «Kg», «kilos» → «kg»; «lt» → «L»; «Porcion» → «porción». Lo que no se reconoce queda como vino. */
export function canonicalUnit(text: string): string {
  const key = unitKey(text)
  if (key === 'l') return 'L'
  return UNIT_OPTIONS.find((option) => unitKey(option) === key) ?? text.trim()
}

function boundedText(cell: Cell | undefined, column: string, max: number): Parsed<string | null> {
  const text = cellText(cell)
  if (!text) return { ok: true, value: null }
  if (text.length > max) return { ok: false, reason: `${column}: hasta ${max} letras.` }
  return { ok: true, value: text }
}

// ─── Leer la planilla ────────────────────────────────────────────────────────

export type SheetChange = { readonly field: SheetField; readonly text: string }

export type SheetUpdate = {
  readonly itemId: string
  readonly line: number
  readonly label: string
  readonly changes: readonly SheetChange[]
  /** Cómo está en HUB ahora (va en la huella: si alguien lo cambia antes de guardar, se vuelve a mostrar). */
  readonly before: ItemValues
  readonly next: ItemValues
}

export type SheetCreate = {
  readonly line: number
  readonly label: string
  readonly detail: string
  readonly next: ItemValues
}

export type SheetProblem = {
  readonly line: number
  readonly label: string
  readonly reasons: readonly string[]
}

export type SheetPlan = {
  /** No se encontró una fila de títulos con el insumo (o el código) y algo más. */
  readonly noColumns: boolean
  /** Las columnas editables que no vinieron: quedan como están. */
  readonly missing: readonly string[]
  /** Filas con algo escrito. */
  readonly rows: number
  readonly updates: readonly SheetUpdate[]
  readonly creates: readonly SheetCreate[]
  readonly problems: readonly SheetProblem[]
  /** Filas que dicen lo mismo que HUB. */
  readonly same: number
  /** Insumos de HUB que no están en la planilla: quedan como están. */
  readonly notInSheet: number
  /** Las zonas que la planilla trae y HUB no tiene, con lo que se va a hacer con cada una. */
  readonly newZones: readonly SheetNewZone[]
  /** Las zonas de HUB, en el orden del recorrido, con cuántos insumos tiene hoy cada una. */
  readonly zoneList: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly items: number
  }>
}

const EMPTY_PLAN: SheetPlan = {
  noColumns: true,
  missing: [],
  rows: 0,
  updates: [],
  creates: [],
  problems: [],
  same: 0,
  notInSheet: 0,
  newZones: [],
  zoneList: [],
}

/** «Bondiola de cerdo (INS-006)». */
function labelOf(name: string, code: string | null): string {
  const n = name || 'Sin nombre'
  return code ? `${n} (${code})` : n
}

const sameNumber = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-6

const DASH = '—'

/** Los cambios de un insumo, en castellano: «Objetivo: 10 kg → 12 kg». */
function describeChanges(
  before: ItemValues,
  after: ItemValues,
  names: { zone: Map<string, string>; supplier: Map<string, string> },
): SheetChange[] {
  const changes: SheetChange[] = []
  const text = (v: string | null) => (v ? v : DASH)
  const push = (field: SheetField, from: string, to: string) =>
    changes.push({
      field,
      text: `${field === 'name' ? 'Nombre' : TITLE_OF[field]}: ${from} → ${to}`,
    })
  if ((before.code ?? '') !== (after.code ?? '')) push('code', text(before.code), text(after.code))
  if (before.name !== after.name) push('name', before.name, after.name)
  if ((before.brand ?? '') !== (after.brand ?? ''))
    push('brand', text(before.brand), text(after.brand))
  if (before.zoneId !== after.zoneId)
    push(
      'zone',
      before.zoneId ? (names.zone.get(before.zoneId) ?? DASH) : 'sin zona',
      after.zoneId ? (names.zone.get(after.zoneId) ?? DASH) : 'sin zona',
    )
  if (before.unit !== after.unit) push('unit', before.unit, after.unit)
  if (!sameNumber(before.targetQty, after.targetQty))
    push(
      'target',
      before.targetQty === null ? 'sin objetivo' : formatAmount(before.targetQty, before.unit),
      after.targetQty === null ? 'sin objetivo' : formatAmount(after.targetQty, after.unit),
    )
  if ((before.packLabel ?? '') !== (after.packLabel ?? ''))
    push('packLabel', text(before.packLabel), text(after.packLabel))
  if (!sameNumber(before.packSize, after.packSize))
    push(
      'packSize',
      before.packSize === null ? DASH : formatAmount(before.packSize, before.unit),
      after.packSize === null ? DASH : formatAmount(after.packSize, after.unit),
    )
  if (before.supplierId !== after.supplierId)
    push(
      'supplier',
      before.supplierId ? (names.supplier.get(before.supplierId) ?? DASH) : 'sin proveedor',
      after.supplierId ? (names.supplier.get(after.supplierId) ?? DASH) : 'sin proveedor',
    )
  if (before.frequency !== after.frequency)
    push('frequency', FREQUENCY_LABELS[before.frequency], FREQUENCY_LABELS[after.frequency])
  if (before.active !== after.active)
    changes.push({
      field: 'active',
      text: after.active ? 'Se vuelve a activar' : 'Se desactiva: deja de aparecer en los conteos',
    })
  if ((before.notes ?? '') !== (after.notes ?? '')) {
    const short = (v: string | null) =>
      v ? `«${v.length > 60 ? `${v.slice(0, 57).trimEnd()}…` : v}»` : DASH
    push('notes', short(before.notes), short(after.notes))
  }
  return changes
}

/** Lo que se ve de uno nuevo: «kg · objetivo 5 kg · Caja x 12 · Waggon · Frecuente». */
function describeNew(
  v: ItemValues,
  names: { zone: Map<string, string>; supplier: Map<string, string> },
): string {
  return [
    v.unit,
    v.targetQty === null ? 'sin objetivo' : `objetivo ${formatAmount(v.targetQty, v.unit)}`,
    v.packLabel ??
      (v.packSize === null ? 'sin presentación' : `x ${formatAmount(v.packSize, v.unit)}`),
    v.supplierId ? (names.supplier.get(v.supplierId) ?? null) : 'sin proveedor',
    v.zoneId ? (names.zone.get(v.zoneId) ?? null) : null,
    FREQUENCY_LABELS[v.frequency],
    v.active ? null : 'desactivado',
  ]
    .filter(Boolean)
    .join(' · ')
}

type RowRead = {
  line: number
  key: string | null
  code: string | null
  name: string
  fields: Partial<ItemValues>
  reasons: string[]
  /** La zona nueva que nombra la fila (su `nameKey`), si nombra una que HUB no tiene. */
  newZoneKey: string | null
}

/** Una zona escrita en la planilla que no es de HUB, o el porqué no puede ser una. */
function unknownZone(text: string): { key: string } | { reason: string } {
  const key = nameKey(text)
  if (!key) return { reason: `Zona: «${text}» no es un nombre de zona.` }
  if (text.length > 60) return { reason: 'Zona: el nombre va hasta 60 letras.' }
  return { key }
}

/** Una fila de la planilla → lo que dice de cada columna que vino (sin decidir todavía a qué insumo va). */
function readRow(
  row: readonly Cell[],
  line: number,
  columns: Partial<Record<SheetField, number>>,
  catalog: SheetCatalog,
  zoneChoice: (key: string) => ZoneChoice | undefined,
): RowRead {
  const at = (field: SheetField): Cell | undefined => {
    const index = columns[field]
    return index === undefined ? undefined : row[index]
  }
  const has = (field: SheetField) => columns[field] !== undefined
  const fields: Partial<ItemValues> = {}
  const reasons: string[] = []
  const take = <K extends keyof ItemValues>(key: K, parsed: Parsed<ItemValues[K]>) => {
    if (parsed.ok) fields[key] = parsed.value
    else reasons.push(parsed.reason)
  }

  const keyText = cellText(at('key'))
  // La planilla vieja de Google trae el código en «id»: si ahí hay una clave de HUB, es la clave.
  const codeText = cellText(at('code'))
  const key = UUID_RE.test(keyText) ? keyText : UUID_RE.test(codeText) ? codeText : null
  const code = codeText && !UUID_RE.test(codeText) ? codeText.toUpperCase() : null
  if (has('code') && !UUID_RE.test(codeText)) {
    if (code && code.length > 20) reasons.push('Código: hasta 20 letras.')
    else fields.code = code
  }

  const name = cellText(at('name'))
  if (has('name')) {
    if (!name) reasons.push('Falta el nombre del insumo.')
    else if (name.length > 80) reasons.push('Insumo: el nombre va hasta 80 letras.')
    else fields.name = name
  }
  if (has('brand')) take('brand', boundedText(at('brand'), 'Marca', 60))

  let newZoneKey: string | null = null
  if (has('zone')) {
    const text = cellText(at('zone'))
    if (!text || nameKey(text) === 'sin zona') fields.zoneId = null
    else {
      const found = lookup(text, catalog.zones)
      if (found.ok) fields.zoneId = found.id
      else if (found.twins.length > 1) reasons.push(notFound('La zona', text, found, ''))
      else {
        // Una que HUB no tiene: lo que es lo decide quien sube (ver `ZoneChoice`).
        const unknown = unknownZone(text)
        const choice = 'key' in unknown ? zoneChoice(unknown.key) : undefined
        if ('reason' in unknown) reasons.push(unknown.reason)
        else if (choice) {
          newZoneKey = unknown.key
          fields.zoneId = choice.kind === 'create' ? newZoneRef(unknown.key) : choice.zoneId
        }
      }
    }
  }

  if (has('unit')) {
    const text = cellText(at('unit'))
    if (!text) reasons.push('Falta la unidad (kg, L, unidad…).')
    else if (text.length > 20) reasons.push('Unidad: hasta 20 letras.')
    else fields.unit = canonicalUnit(text)
  }

  if (has('target')) take('targetQty', parseSheetAmount(at('target'), 'Objetivo'))
  if (has('packLabel')) take('packLabel', boundedText(at('packLabel'), 'Presentación', 60))
  if (has('packSize')) {
    const parsed = parseSheetAmount(at('packSize'), 'Cada una trae')
    if (parsed.ok && parsed.value === 0)
      reasons.push('Cada una trae: tiene que ser más que 0 (o dejalo vacío).')
    else take('packSize', parsed)
  }

  if (has('supplier')) {
    const text = cellText(at('supplier'))
    if (!text || nameKey(text) === 'sin proveedor') fields.supplierId = null
    else {
      const found = lookup(text, catalog.suppliers)
      if (found.ok) fields.supplierId = found.id
      else
        reasons.push(
          notFound('El proveedor', text, found, 'Cargalo primero en Compras › Proveedores.'),
        )
    }
  }

  if (has('frequency')) {
    const parsed = parseSheetFrequency(at('frequency'))
    if (!parsed.ok) reasons.push(parsed.reason)
    else if (parsed.value) fields.frequency = parsed.value
  }
  if (has('active')) {
    const parsed = parseSheetActive(at('active'))
    if (!parsed.ok) reasons.push(parsed.reason)
    else if (parsed.value !== null) fields.active = parsed.value
  }
  if (has('notes')) take('notes', boundedText(at('notes'), 'Notas', 500))

  return { line, key, code, name, fields, reasons, newZoneKey }
}

/**
 * Las zonas que la planilla trae y HUB no tiene, en el orden en que aparecen, con lo que se va a hacer con cada
 * una. Primero lo que eligió quien sube (si sigue valiendo); para las demás, lo de siempre:
 * - mal escrita por una o dos letras → es esa zona;
 * - sus insumos vienen de una zona que la planilla ya no nombra → le cambiaron el nombre a esa (si la vacían
 *   entre dos zonas nuevas, el nombre lo toma la que se lleva más);
 * - si no, es nueva.
 * A una zona se le cambia el nombre una sola vez: si dos lo piden, la segunda va a esa zona tal como está.
 */
function sheetZones(
  rows: readonly (readonly Cell[])[],
  from: number,
  columns: Partial<Record<SheetField, number>>,
  catalog: SheetCatalog,
  asked: ZoneChoices,
): Map<string, { name: string; similarId: string | null; choice: ZoneChoice }> {
  const out = new Map<string, { name: string; similarId: string | null; choice: ZoneChoice }>()
  const column = columns.zone
  if (column === undefined) return out
  const zones = catalog.zones
  const byId = new Map(zones.map((z) => [z.id, z]))

  // El insumo de cada fila, como lo busca la lectura (clave, código, nombre), para saber de dónde viene.
  const itemById = new Map(catalog.items.map((i) => [i.id, i]))
  const itemByCode = new Map<string, PurItem>()
  const itemsByName = new Map<string, PurItem[]>()
  for (const item of catalog.items) {
    if (item.code) itemByCode.set(item.code.trim().toUpperCase(), item)
    const k = nameKey(item.name)
    itemsByName.set(k, [...(itemsByName.get(k) ?? []), item])
  }
  const textAt = (row: readonly Cell[], field: SheetField) => {
    const index = columns[field]
    return index === undefined ? '' : cellText(row[index])
  }
  const itemOf = (row: readonly Cell[]): PurItem | undefined => {
    for (const text of [textAt(row, 'key'), textAt(row, 'code')]) {
      if (UUID_RE.test(text) && itemById.has(text)) return itemById.get(text)
    }
    const code = textAt(row, 'code').toUpperCase()
    if (code && itemByCode.has(code)) return itemByCode.get(code)
    const homonyms = itemsByName.get(nameKey(textAt(row, 'name'))) ?? []
    return homonyms.length === 1 ? homonyms[0] : undefined
  }

  const stillNamed = new Set<string>()
  const seen = new Map<
    string,
    { name: string; similar: ReturnType<typeof nearest<PurZone>>; fromZones: Map<string, number> }
  >()
  for (let i = from; i < rows.length; i++) {
    const row = rows[i] ?? []
    const text = cellText(row[column])
    if (!text || nameKey(text) === 'sin zona') continue
    const found = lookup(text, zones)
    if (found.ok) {
      stillNamed.add(found.id)
      continue
    }
    // Dos de HUB que se escriben igual: es un problema de la fila, no una zona nueva.
    if (found.twins.length > 1) continue
    const unknown = unknownZone(text)
    if (!('key' in unknown)) continue
    let entry = seen.get(unknown.key)
    if (!entry) {
      entry = { name: text, similar: nearest(text, zones), fromZones: new Map() }
      seen.set(unknown.key, entry)
    }
    const zoneId = itemOf(row)?.zoneId
    if (zoneId) entry.fromZones.set(zoneId, (entry.fromZones.get(zoneId) ?? 0) + 1)
  }

  const choices = new Map<string, ZoneChoice>()
  const renamed = new Set<string>()
  for (const key of seen.keys()) {
    const want = asked[key]
    if (!want) continue
    if (want.kind === 'create') choices.set(key, want)
    else if (byId.has(want.zoneId)) {
      const choice: ZoneChoice =
        want.kind === 'rename' && renamed.has(want.zoneId)
          ? { kind: 'existing', zoneId: want.zoneId }
          : want
      if (choice.kind === 'rename') renamed.add(choice.zoneId)
      choices.set(key, choice)
    }
  }
  for (const [key, entry] of seen) {
    if (choices.has(key)) continue
    const { similar } = entry
    if (similar && !similar.prefix && similar.distance <= TYPO_DISTANCE)
      choices.set(key, { kind: 'existing', zoneId: similar.item.id })
  }
  // Los cambios de nombre que se adivinan: de la que más insumos se lleva a la que menos.
  const candidates = [...seen]
    .filter(([key]) => !choices.has(key))
    .flatMap(([key, entry]) => {
      const [top] = [...entry.fromZones].sort((a, b) => b[1] - a[1])
      return top && !stillNamed.has(top[0]) ? [{ key, zoneId: top[0], count: top[1] }] : []
    })
    .sort((a, b) => b.count - a.count)
  for (const c of candidates) {
    if (renamed.has(c.zoneId)) continue
    renamed.add(c.zoneId)
    choices.set(c.key, { kind: 'rename', zoneId: c.zoneId })
  }
  for (const [key, entry] of seen) {
    out.set(key, {
      name: entry.name,
      similarId: entry.similar?.item.id ?? null,
      choice: choices.get(key) ?? { kind: 'create' },
    })
  }
  return out
}

/**
 * Lee la planilla y la compara con HUB: qué insumos cambian (y cómo), cuáles son nuevos, qué filas tienen
 * problemas, cuántas quedan igual y qué zonas trae que HUB no tiene (con lo que eligió quien sube, o lo de
 * siempre: nueva, salvo una mal escrita por una o dos letras).
 */
export function readItemsSheet(
  rows: readonly (readonly Cell[])[],
  catalog: SheetCatalog,
  options: { readonly zoneChoices?: ZoneChoices } = {},
): SheetPlan {
  const header = findHeaderRow(
    rows,
    HEADER_RULES,
    (c) =>
      (c.name !== undefined || c.code !== undefined || c.key !== undefined) &&
      Object.keys(c).length >= 2,
    15,
  )
  if (!header) return EMPTY_PLAN
  const columns = header.columns
  const missing = EDITABLE.filter((f) => columns[f] === undefined).map((f) => TITLE_OF[f])

  const byId = new Map(catalog.items.map((i) => [i.id, i]))
  const byCode = new Map<string, PurItem>()
  for (const item of catalog.items) if (item.code) byCode.set(item.code.trim().toUpperCase(), item)
  const byName = new Map<string, PurItem[]>()
  for (const item of catalog.items) {
    const k = nameKey(item.name)
    byName.set(k, [...(byName.get(k) ?? []), item])
  }
  const names = {
    zone: new Map(catalog.zones.map((z) => [z.id, z.name])),
    supplier: new Map(catalog.suppliers.map((s) => [s.id, s.name])),
  }
  const sheet = sheetZones(rows, header.index + 1, columns, catalog, options.zoneChoices ?? {})
  // Cómo se leen en los cambios: «Zona: Freezer congelados → Freezer congelados y papas (nueva)»; la que cambia
  // de nombre, ya con el nombre nuevo.
  for (const [key, z] of sheet) {
    if (z.choice.kind === 'create') names.zone.set(newZoneRef(key), `${z.name} (nueva)`)
    if (z.choice.kind === 'rename') names.zone.set(z.choice.zoneId, z.name)
  }

  const claimed = new Map<string, number>()
  const newNames = new Map<string, number>()
  const updates: SheetUpdate[] = []
  const creates: SheetCreate[] = []
  const problems: SheetProblem[] = []
  // Las filas que se cargan (o quedan igual) con una zona nueva, y dónde está hoy su insumo.
  const zoneUse = new Map<number, { key: string; fromZoneId: string | null }>()
  let same = 0
  let read = 0

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    if (row.every((c) => cellText(c) === '')) continue
    read++
    const r = readRow(row, i + 1, columns, catalog, (key) => sheet.get(key)?.choice)

    // ¿A qué insumo va? Clave, código, nombre.
    let item: PurItem | undefined = r.key ? byId.get(r.key) : undefined
    if (!item && r.code) item = byCode.get(r.code)
    if (!item && r.name) {
      const homonyms = byName.get(nameKey(r.name)) ?? []
      if (homonyms.length > 1 && !r.code) {
        problems.push({
          line: r.line,
          label: labelOf(r.name, r.code),
          reasons: [
            `Hay ${homonyms.length} insumos que se llaman así en HUB: poné el código para saber cuál es.`,
          ],
        })
        continue
      }
      // Con un código que no está en HUB, el nombre igual decide (la planilla vieja no tiene clave).
      if (homonyms.length === 1) item = homonyms[0]
    }

    if (item) {
      const label = labelOf(r.fields.name ?? item.name, r.fields.code ?? item.code)
      const first = claimed.get(item.id)
      if (first !== undefined) {
        problems.push({
          line: r.line,
          label,
          reasons: [`Este insumo ya está en la fila ${first}: dejá una sola.`],
        })
        continue
      }
      claimed.set(item.id, r.line)
      if (r.reasons.length > 0) {
        problems.push({ line: r.line, label, reasons: r.reasons })
        continue
      }
      const before = itemValues(item)
      const next: ItemValues = { ...before, ...r.fields }
      // La misma unidad escrita de otra forma («Kg») no es un cambio; tampoco el código en minúsculas.
      if (sameUnit(before.unit, next.unit)) next.unit = before.unit
      if (before.code && next.code && before.code.toUpperCase() === next.code.toUpperCase())
        next.code = before.code
      const changes = describeChanges(before, next, names)
      if (changes.length === 0) same++
      else updates.push({ itemId: item.id, line: r.line, label, changes, before, next })
      if (r.newZoneKey) zoneUse.set(r.line, { key: r.newZoneKey, fromZoneId: item.zoneId })
      continue
    }

    // Uno nuevo.
    const label = labelOf(r.name, r.code)
    const reasons = [...r.reasons]
    if (!r.name && !reasons.some((x) => x.startsWith('Falta el nombre')))
      reasons.push('Falta el nombre del insumo.')
    if (r.fields.unit === undefined && !reasons.some((x) => x.startsWith('Falta la unidad')))
      reasons.push('Falta la unidad (kg, L, unidad…).')
    const nameK = nameKey(r.name)
    const repeated = nameK ? newNames.get(nameK) : undefined
    if (repeated !== undefined) reasons.push(`Está repetido: también va en la fila ${repeated}.`)
    if (reasons.length > 0) {
      problems.push({ line: r.line, label, reasons })
      continue
    }
    if (nameK) newNames.set(nameK, r.line)
    const next: ItemValues = {
      code: null,
      brand: null,
      zoneId: null,
      frequency: 'frequent',
      targetQty: null,
      packLabel: null,
      packSize: null,
      supplierId: null,
      notes: null,
      active: true,
      ...r.fields,
      name: r.fields.name ?? r.name,
      unit: r.fields.unit ?? 'unidad',
    }
    creates.push({ line: r.line, label, detail: describeNew(next, names), next })
    if (r.newZoneKey) zoneUse.set(r.line, { key: r.newZoneKey, fromZoneId: null })
  }

  // Códigos repetidos: el que lo trae nuevo no se carga. Se repite hasta que no quede ninguno (sacar una fila
  // devuelve su código viejo, que puede chocar con otra).
  let keptUpdates = updates
  let keptCreates = creates
  for (let round = 0; round < 10; round++) {
    const owners = new Map<string, Array<{ kind: 'item' | 'update' | 'create'; ref: string }>>()
    const add = (code: string | null, kind: 'item' | 'update' | 'create', ref: string) => {
      if (!code) return
      const k = code.trim().toUpperCase()
      owners.set(k, [...(owners.get(k) ?? []), { kind, ref }])
    }
    const updated = new Map(keptUpdates.map((u) => [u.itemId, u]))
    for (const item of catalog.items) {
      const u = updated.get(item.id)
      if (!u) add(item.code, 'item', item.id)
      else
        add(
          u.next.code,
          (u.next.code ?? '').toUpperCase() === (item.code ?? '').toUpperCase() ? 'item' : 'update',
          item.id,
        )
    }
    keptCreates.forEach((c, i) => {
      add(c.next.code, 'create', String(i))
    })
    const badUpdates = new Set<string>()
    const badCreates = new Set<string>()
    const holder = new Map<string, string>()
    for (const [code, list] of owners) {
      if (list.length < 2) continue
      const keeper = list.find((o) => o.kind === 'item')
      for (const o of list) {
        if (o === keeper) continue
        if (o.kind === 'update') badUpdates.add(o.ref)
        if (o.kind === 'create') badCreates.add(o.ref)
        if (keeper) holder.set(code, keeper.ref)
      }
    }
    if (badUpdates.size === 0 && badCreates.size === 0) break
    const reason = (code: string | null) => {
      const k = (code ?? '').toUpperCase()
      const other = byId.get(holder.get(k) ?? '')
      return other
        ? `El código ${code} ya lo tiene «${other.name}».`
        : `El código ${code} está en más de una fila.`
    }
    for (const u of keptUpdates)
      if (badUpdates.has(u.itemId))
        problems.push({ line: u.line, label: u.label, reasons: [reason(u.next.code)] })
    keptCreates.forEach((c, i) => {
      if (badCreates.has(String(i)))
        problems.push({ line: c.line, label: c.label, reasons: [reason(c.next.code)] })
    })
    keptUpdates = keptUpdates.filter((u) => !badUpdates.has(u.itemId))
    keptCreates = keptCreates.filter((_, i) => !badCreates.has(String(i)))
  }

  // Las zonas nuevas, con las filas que se cargan: una que solo nombran filas con problemas no se arma.
  const withProblems = new Set(problems.map((p) => p.line))
  const zoneById = new Map(catalog.zones.map((z) => [z.id, z]))
  const newZones: SheetNewZone[] = []
  for (const [key, z] of sheet) {
    const uses = [...zoneUse].filter(([line, use]) => use.key === key && !withProblems.has(line))
    if (uses.length === 0) continue
    const from = new Map<string | null, number>()
    for (const [, use] of uses) from.set(use.fromZoneId, (from.get(use.fromZoneId) ?? 0) + 1)
    newZones.push({
      key,
      name: z.name,
      lines: uses.map(([line]) => line),
      from: [...from]
        .map(([zoneId, count]) => ({ zoneId, count }))
        .sort((a, b) => b.count - a.count),
      similarId: z.similarId,
      choice: z.choice,
      targetName: z.choice.kind === 'create' ? null : (zoneById.get(z.choice.zoneId)?.name ?? null),
    })
  }
  const itemsIn = new Map<string, number>()
  for (const item of catalog.items)
    if (item.zoneId) itemsIn.set(item.zoneId, (itemsIn.get(item.zoneId) ?? 0) + 1)

  return {
    noColumns: false,
    missing,
    rows: read,
    updates: keptUpdates,
    creates: keptCreates,
    problems: problems.sort((a, b) => a.line - b.line),
    same,
    notInSheet: catalog.items.filter((item) => !claimed.has(item.id)).length,
    newZones,
    zoneList: [...catalog.zones]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
      .map((z) => ({ id: z.id, name: z.name, items: itemsIn.get(z.id) ?? 0 })),
  }
}

/** Lo que guarda la planilla además de los insumos: las zonas que se arman y las que cambian de nombre. */
export function zoneWrites(plan: SheetPlan): {
  creates: Array<{ key: string; name: string }>
  renames: Array<{ zoneId: string; from: string | null; to: string }>
} {
  return {
    creates: plan.newZones
      .filter((z) => z.choice.kind === 'create')
      .map((z) => ({ key: z.key, name: z.name })),
    renames: plan.newZones.flatMap((z) =>
      z.choice.kind === 'rename'
        ? [{ zoneId: z.choice.zoneId, from: z.targetName, to: z.name }]
        : [],
    ),
  }
}

/**
 * La huella de lo que se va a guardar, con cómo estaba cada insumo: si entre la vista previa y el guardado
 * alguien cambió uno (aunque la planilla lo deje igual, lo estaría pisando), no se guarda y se vuelve a mostrar.
 */
export function sheetFingerprint(plan: SheetPlan): string {
  return sha256HexSync(
    JSON.stringify({
      u: plan.updates.map((u) => [u.itemId, u.before, u.next]),
      c: plan.creates.map((c) => [c.line, c.next]),
      // Lo elegido para cada zona nueva y cómo se llama hoy la de HUB elegida.
      ...(plan.newZones.length
        ? { z: plan.newZones.map((z) => [z.key, z.name, z.choice, z.targetName]) }
        : {}),
    }),
  )
}

// ─── El libro que se baja ────────────────────────────────────────────────────

export const ITEMS_SHEET_NAME = 'Insumos'
const LISTS_SHEET = 'Listas'
const HELP_SHEET = 'Cómo usarla'

/** «insumos-hub-2026-11-09.xlsx». */
export function itemsSheetFileName(slug: string, today: string): string {
  const safe = slug.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
  return `insumos-${safe}-${today}.xlsx`
}

/**
 * El libro: la hoja «Insumos» (la que se edita y se sube), «Cómo usarla» y la oculta «Listas», de donde salen
 * las opciones de Zona, Unidad, Proveedor, Frecuencia y Activo. Ordenado como se recorre la cocina: por zona y,
 * adentro, por nombre; los que no tienen zona al final.
 */
export function itemsWorkbook(input: {
  readonly items: readonly PurItem[]
  readonly zones: readonly PurZone[]
  readonly suppliers: readonly PurSupplier[]
  readonly barName: string
  /** «09/11/2026 18:54». */
  readonly downloadedAt: string
}): XlsxSheetSpec[] {
  const zoneOrder = new Map(input.zones.map((z, i) => [z.id, i]))
  const zoneName = new Map(input.zones.map((z) => [z.id, z.name]))
  const supplierName = new Map(input.suppliers.map((s) => [s.id, s.name]))
  const items = [...input.items].sort(
    (a, b) =>
      (a.zoneId ? (zoneOrder.get(a.zoneId) ?? 1e6) : 1e6) -
        (b.zoneId ? (zoneOrder.get(b.zoneId) ?? 1e6) : 1e6) || a.name.localeCompare(b.name, 'es'),
  )

  const cellOf: Record<SheetField, (item: PurItem) => string | number | null> = {
    code: (item) => item.code,
    name: (item) => item.name,
    brand: (item) => item.brand,
    zone: (item) => (item.zoneId ? (zoneName.get(item.zoneId) ?? null) : null),
    unit: (item) => item.unit,
    target: (item) => item.targetQty,
    packLabel: (item) => item.packLabel,
    packSize: (item) => item.packSize,
    supplier: (item) => (item.supplierId ? (supplierName.get(item.supplierId) ?? null) : null),
    frequency: (item) => FREQUENCY_LABELS[item.frequency],
    active: (item) => (item.active ? 'Sí' : 'No'),
    notes: (item) => item.notes,
    key: (item) => item.id,
  }
  const rows = [
    ITEM_SHEET_COLUMNS.map((c) => c.title),
    ...items.map((item) => ITEM_SHEET_COLUMNS.map((c) => cellOf[c.field](item))),
  ]

  // Las opciones: las activas, más las que ya usa algún insumo (para que esa celda siga valiendo).
  const usedZones = new Set(input.items.map((i) => i.zoneId))
  const usedSuppliers = new Set(input.items.map((i) => i.supplierId))
  const zones = input.zones.filter((z) => z.active || usedZones.has(z.id)).map((z) => z.name)
  const suppliers = input.suppliers
    .filter((s) => s.active || usedSuppliers.has(s.id))
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b, 'es'))
  const units = [...UNIT_OPTIONS] as string[]
  for (const item of input.items)
    if (!units.some((u) => unitKey(u) === unitKey(item.unit))) units.push(item.unit)
  const lists: Array<{ title: string; values: string[] }> = [
    { title: 'Zonas', values: zones },
    { title: 'Proveedores', values: suppliers },
    { title: 'Frecuencias', values: FREQUENCIES.map((f) => FREQUENCY_LABELS[f]) },
    { title: 'Activo', values: ['Sí', 'No'] },
    { title: 'Unidades', values: units },
  ]
  const longest = Math.max(...lists.map((l) => l.values.length))
  const listRows = [
    lists.map((l) => ({ value: l.title, style: 'header' as const })),
    ...Array.from({ length: longest }, (_, i) => lists.map((l) => l.values[i] ?? null)),
  ]
  const listRange = (column: number) => {
    const letter = columnName(column)
    const count = lists[column]?.values.length ?? 0
    return { sheet: LISTS_SHEET, range: `${letter}2:${letter}${count + 1}` }
  }

  const colLetter = (field: SheetField) =>
    columnName(ITEM_SHEET_COLUMNS.findIndex((c) => c.field === field))
  // Las listas llegan más abajo que la última fila: para los que se agregan.
  const lastRow = Math.max(items.length + 400, 1000)
  const span = (field: SheetField) => `${colLetter(field)}2:${colLetter(field)}${lastRow}`
  const validations = [
    zones.length
      ? {
          range: span('zone'),
          source: listRange(0),
          strict: true,
          // Un lugar nuevo se puede escribir acá: Excel avisa y deja; al subirla, HUB pregunta qué es.
          warnOnly: true,
          error: {
            title: 'Esa zona no está en la lista',
            text: 'Si es un lugar nuevo, dejala: al subir la planilla, HUB te pregunta si la arma, si es una que ya está o si le cambiaste el nombre.',
          },
        }
      : null,
    { range: span('unit'), source: listRange(4), strict: false },
    suppliers.length
      ? {
          range: span('supplier'),
          source: listRange(1),
          strict: true,
          error: {
            title: 'Ese proveedor no está',
            text: 'Elegí un proveedor de la lista. Uno nuevo se carga primero en HUB › Compras › Proveedores.',
          },
        }
      : null,
    {
      range: span('frequency'),
      source: listRange(2),
      strict: true,
      error: { title: 'Frecuencia', text: 'Elegí Frecuente, Secundario o Eventual.' },
    },
    {
      range: span('active'),
      source: listRange(3),
      strict: true,
      error: { title: 'Activo', text: 'Poné Sí o No.' },
    },
  ].filter((v) => v !== null)

  const help: string[] = [
    'Cambiá lo que necesites: objetivo, presentación, cuánto trae cada una, proveedor, zona, unidad, frecuencia o notas.',
    'Para agregar un insumo, sumá una fila con el nombre y la unidad (kg, L, unidad…).',
    'Para que uno deje de contarse, poné «No» en Activo. Borrar la fila no lo saca de HUB: queda como está.',
    'Zona, Proveedor, Frecuencia y Activo se eligen de la lista. Un proveedor nuevo se carga primero en HUB › Compras › Proveedores.',
    'Una zona nueva (un lugar de guardado que HUB no tiene) se puede escribir en la celda o en la lista de Zonas de la hoja Listas. Al subirla, HUB te pregunta si es nueva, si es una que ya está o si le cambiaste el nombre a una.',
    'Una columna que borres no se toca en HUB. Una celda vacía borra ese dato (sin objetivo, sin proveedor…).',
    'Cuando termines, subila en HUB › Compras › Insumos › Planilla: antes de guardar te mostramos qué cambia.',
    'En Google Sheets: abrila desde Drive y, para subirla, Archivo › Descargar › Microsoft Excel (.xlsx).',
    'No borres la columna oculta «Clave HUB»: es la que une cada fila con su insumo.',
  ]

  return [
    {
      name: ITEMS_SHEET_NAME,
      header: true,
      rows,
      columns: ITEM_SHEET_COLUMNS.map((c) => ({
        width: c.width,
        hidden: c.hidden,
        style: c.text ? ('text' as const) : undefined,
      })),
      validations,
    },
    {
      name: HELP_SHEET,
      columns: [{ width: 110 }],
      rows: [
        [{ value: `Insumos de ${input.barName}: cómo usar esta planilla`, style: 'title' }],
        [null],
        ...help.map((line) => [`• ${line}`]),
        [null],
        [{ value: `Bajada de HUB el ${input.downloadedAt}.`, style: 'muted' }],
      ],
    },
    {
      name: LISTS_SHEET,
      hidden: true,
      rows: listRows,
      columns: lists.map(() => ({ width: 28 })),
    },
  ]
}
