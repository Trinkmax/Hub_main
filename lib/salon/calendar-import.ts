import { excelSerialTime, toIsoDay } from '@/lib/imports/dates'
import { findHeaderRow, type HeaderRule } from '@/lib/imports/headers'
import type { Cell } from '@/lib/imports/types'
import type { MealType } from './types'

/**
 * Cargar las fechas del calendario con un Excel (pedido de Nacho Badra,
 * 30/10/2026: «le mando el Excel, actualiza, se fija: si el lunes 14 era
 * Coraline queda igual, si está cambiado va otro»). Puro: sin DB ni React.
 *
 * 1. `readImportRows` lee la planilla: encuentra las columnas (Fecha, Película,
 *    Hora y Cupo, en cualquier orden y con cualquier mayúscula), entiende las
 *    fechas como las escribe la gente («15/11», «15/11/2026», «domingo 15 de
 *    noviembre», varias en una celda separadas por «;») y reconoce cada
 *    película por el nombre del formato del calendario o por su título en
 *    Entradas («Coraline» es el formato «Caroline»).
 * 2. `planImport` compara con el calendario: la planilla manda en los MESES que
 *    trae y solo para las películas que nombra. Lo que coincide queda igual, lo
 *    nuevo se agrega y lo que ya no está se quita, salvo que tenga reservas
 *    activas (eso se mueve a mano). El resto del calendario no se toca.
 */

// ──────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────

/** Un formato del calendario, con lo que hace falta para reconocerlo y crear fechas. */
export type ImportFormat = {
  id: string
  /** El nombre en el calendario («Caroline»). */
  name: string
  /** Otros nombres con los que se lo reconoce: el título de su película en Entradas. */
  aliases: string[]
  active: boolean
  defaultCapacity: number | null
  defaultMealType: MealType
  defaultPrivateGroup: boolean
  /** La hora (HH:MM) y el cupo de su última fecha: para las filas que no los traen. */
  usualTime: string | null
  usualCapacity: number | null
}

/** Una fecha que pide la planilla, ya entendida. */
export type ImportEntry = {
  /** La fila de la planilla (desde 1, como la ve Excel). */
  line: number
  date: string
  formatId: string
  /** Hora y cupo ESCRITOS en la planilla (null = no los trae: no se cambian). */
  time: string | null
  capacity: number | null
  /** Con qué hora y cupo se crea si es nueva. */
  createTime: string
  createCapacity: number
}

export type ImportProblem = {
  line: number
  /** Lo que estaba escrito («Domingo 30 de noviembre · Mi pobre angelito»). */
  text: string
  reason: string
}

export type ReadResult = {
  entries: ImportEntry[]
  problems: ImportProblem[]
  /** No se encontraron las columnas de fecha y película. */
  noColumns: boolean
}

/** Una fecha que ya está en el calendario. */
export type ExistingEvent = {
  id: string
  templateId: string
  date: string
  /** HH:MM */
  time: string
  capacity: number
  /** Reservas que no están canceladas ni marcadas como «no vino». */
  activeReservations: number
}

export type PlanCreate = {
  kind: 'create'
  date: string
  formatId: string
  time: string
  capacity: number
  lines: number[]
}
export type PlanSame = {
  kind: 'same'
  eventId: string
  date: string
  formatId: string
  time: string
}
export type PlanUpdate = {
  kind: 'update'
  eventId: string
  date: string
  formatId: string
  time: string
  capacity: number
  /** Lo que cambia; null = queda igual. */
  newTime: string | null
  newCapacity: number | null
  /** La hora no se cambia porque tiene reservas (se mueve desde el calendario). */
  timeBlocked: boolean
}
export type PlanRemove = {
  kind: 'remove'
  eventId: string
  date: string
  formatId: string
  time: string
}
/** Habría que quitarla, pero tiene reservas activas: queda. */
export type PlanKeep = {
  kind: 'keep'
  eventId: string
  date: string
  formatId: string
  time: string
  reservations: number
}

export type ImportPlan = {
  creates: PlanCreate[]
  sames: PlanSame[]
  updates: PlanUpdate[]
  removes: PlanRemove[]
  keeps: PlanKeep[]
  /** Los meses (YYYY-MM) que la planilla manda. */
  months: string[]
  /** Filas repetidas (misma película, día y hora) que se tomaron una sola vez. */
  duplicates: number
}

// ──────────────────────────────────────────────
// Nombres
// ──────────────────────────────────────────────

/** «El viaje de Chihiro» → «viaje de chihiro»: sin tildes, signos ni artículo inicial. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(el|la|los|las)\s+/, '')
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

type NameIndex = { byName: Map<string, Set<string>>; labels: Map<string, string> }

function buildIndex(formats: readonly ImportFormat[]): NameIndex {
  const byName = new Map<string, Set<string>>()
  const labels = new Map<string, string>()
  for (const f of formats) {
    for (const raw of [f.name, ...f.aliases]) {
      const key = normalizeName(raw)
      if (!key) continue
      const ids = byName.get(key) ?? new Set<string>()
      ids.add(f.id)
      byName.set(key, ids)
      if (!labels.has(key)) labels.set(key, raw.trim())
    }
  }
  return { byName, labels }
}

type MatchResult = { ok: true; format: ImportFormat } | { ok: false; reason: string }

function matchFormat(
  raw: string,
  index: NameIndex,
  formatsById: ReadonlyMap<string, ImportFormat>,
): MatchResult {
  const key = normalizeName(raw)
  const ids = index.byName.get(key)
  if (ids && ids.size > 1) {
    return { ok: false, reason: `Hay más de un formato que se llama «${raw.trim()}».` }
  }
  const id = ids ? [...ids][0] : undefined
  const format = id ? formatsById.get(id) : undefined
  if (format) {
    if (!format.active) {
      return { ok: false, reason: `«${format.name}» está archivado en el calendario.` }
    }
    return { ok: true, format }
  }
  // El parecido más cercano, para sugerirlo (no se elige solo).
  let best: { key: string; distance: number } | null = null
  for (const candidate of index.byName.keys()) {
    const distance = levenshtein(key, candidate)
    if (!best || distance < best.distance) best = { key: candidate, distance }
  }
  // Un tercio del nombre: «Coralin» → «Caroline» son 3 cambios en 7 letras.
  const tolerance = Math.max(2, Math.ceil(key.length / 3))
  const suggestion = best && best.distance <= tolerance ? index.labels.get(best.key) : undefined
  return {
    ok: false,
    reason: suggestion
      ? `No está en el calendario. ¿Quisiste decir «${suggestion}»?`
      : 'No está en el calendario: creá el formato o corregí el nombre.',
  }
}

// ──────────────────────────────────────────────
// Fechas, horas y cupos
// ──────────────────────────────────────────────

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
}
const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
}

function iso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return t.toISOString().slice(0, 10)
}

/** Sin año: el de hoy, salvo que ya haya pasado hace más de un mes (entonces, el que viene). */
function withYear(m: number, d: number, today: string): string | null {
  const year = Number(today.slice(0, 4))
  const thisYear = iso(year, m, d)
  if (thisYear && thisYear >= addDays(today, -31)) return thisYear
  return iso(year + 1, m, d)
}

/** dd/mm/aaaa para los avisos. */
export function dayLabel(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

type DateResult = { ok: true; date: string } | { ok: false; reason: string }

/**
 * Una fecha como la escribe la gente → `yyyy-MM-dd`. Si dice el día de la
 * semana y no coincide («domingo 30 de noviembre» de 2026 es lunes), no se
 * adivina: se avisa.
 */
export function parseImportDate(raw: Cell, today: string): DateResult {
  if (raw === null || raw === '' || typeof raw === 'boolean') {
    return { ok: false, reason: 'Falta la fecha.' }
  }
  if (typeof raw === 'number') {
    const fromSerial = toIsoDay(raw)
    return fromSerial
      ? { ok: true, date: fromSerial }
      : { ok: false, reason: 'La fecha no se entiende.' }
  }
  const text = raw.trim()
  const full = toIsoDay(text)
  if (full) return { ok: true, date: full }

  let s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  let weekday: number | null = null
  const wd = /^(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s+/.exec(s)
  if (wd) {
    weekday = WEEKDAYS[wd[1] ?? ''] ?? null
    s = s.slice(wd[0].length)
  }

  let date: string | null = null
  let m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s)
  if (m) date = withYear(Number(m[2]), Number(m[1]), today)
  if (!date) {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s)
    if (m) {
      const y = (m[3] ?? '').length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      date = iso(y, Number(m[2]), Number(m[1]))
    }
  }
  if (!date) {
    m = /^(\d{1,2})(?:\s+de)?\s+([a-z]+)\.?(?:\s+(?:de\s+|del\s+)?(\d{4}))?$/.exec(s)
    const month = m ? MONTHS[m[2] ?? ''] : undefined
    if (m && month) {
      date = m[3] ? iso(Number(m[3]), month, Number(m[1])) : withYear(month, Number(m[1]), today)
    }
  }
  if (!date) return { ok: false, reason: `La fecha «${text}» no se entiende.` }
  if (weekday !== null && weekdayOf(date) !== weekday) {
    return {
      ok: false,
      reason: `Dice ${WEEKDAY_NAMES[weekday]}, pero el ${dayLabel(date)} es ${WEEKDAY_NAMES[weekdayOf(date)]}.`,
    }
  }
  return { ok: true, date }
}

/** «21», «21:30», «21.30», «21hs», la hora de una celda de Excel → HH:MM. */
export function parseImportTime(raw: Cell): { ok: true; time: string | null } | { ok: false } {
  if (raw === null || raw === '') return { ok: true, time: null }
  if (typeof raw === 'boolean') return { ok: false }
  if (typeof raw === 'number') {
    if (raw >= 0 && raw < 1) return { ok: true, time: excelSerialTime(raw).slice(0, 5) }
    if (Number.isInteger(raw) && raw >= 0 && raw <= 23) {
      return { ok: true, time: `${String(raw).padStart(2, '0')}:00` }
    }
    return { ok: false }
  }
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^.*t(?=\d{2}:)/, '')
  if (s === '') return { ok: true, time: null }
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?(?::\d{2})?\s*(?:hs?|horas?)?\.?$/.exec(s)
  if (!m) return { ok: false }
  const h = Number(m[1])
  const min = Number(m[2] ?? '0')
  if (h > 23 || min > 59) return { ok: false }
  return { ok: true, time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` }
}

/** Un cupo entero entre 1 y 999 (lo que acepta el calendario). */
export function parseImportCapacity(
  raw: Cell,
): { ok: true; capacity: number | null } | { ok: false } {
  if (raw === null || raw === '') return { ok: true, capacity: null }
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN
  if (!Number.isInteger(n) || n < 1 || n > 999) return { ok: false }
  return { ok: true, capacity: n }
}

// ──────────────────────────────────────────────
// Leer la planilla
// ──────────────────────────────────────────────

type Column = 'date' | 'name' | 'time' | 'capacity'

const HEADER_RULES: readonly HeaderRule<Column>[] = [
  [/^(fecha|fechas|dia|dias)\b/, 'date'],
  [
    /\b(pelicula|peliculas|evento|eventos|formato|formatos|show|funcion|funciones|nombre)\b/,
    'name',
  ],
  [/^(hora|horas|horario|inicio)\b/, 'time'],
  [/\b(cupo|cupos|capacidad|lugares)\b/, 'capacity'],
]

/** Partes de una celda con varias fechas («2/12; 6/12; 8/12»). */
function splitDates(raw: Cell): Cell[] {
  if (typeof raw !== 'string') return [raw]
  const parts = raw
    .split(/[;\n]+|,(?=\s*\d)/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
  return parts.length > 0 ? parts : [raw]
}

function cellText(raw: Cell | undefined): string {
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

/** Sin fila de títulos: la columna con más fechas y la que más nombres reconoce. */
function guessColumns(
  rows: readonly (readonly Cell[])[],
  index: NameIndex,
  today: string,
): Partial<Record<Column, number>> | null {
  const width = Math.min(
    12,
    rows.slice(0, 40).reduce((max, r) => Math.max(max, r.length), 0),
  )
  let dateCol = -1
  let dateHits = 0
  let nameCol = -1
  let nameHits = 0
  for (let j = 0; j < width; j++) {
    let dates = 0
    let names = 0
    for (const row of rows.slice(0, 40)) {
      const cell = row[j] ?? null
      if (cell === null || cell === '') continue
      if (splitDates(cell).some((p) => parseImportDate(p, today).ok)) dates++
      if (typeof cell === 'string' && index.byName.has(normalizeName(cell))) names++
    }
    if (dates > dateHits) {
      dateHits = dates
      dateCol = j
    }
    if (names > nameHits) {
      nameHits = names
      nameCol = j
    }
  }
  if (dateCol < 0 || nameCol < 0 || dateCol === nameCol) return null
  return { date: dateCol, name: nameCol }
}

/**
 * Las filas de la planilla → las fechas que pide y los problemas, fila por fila.
 * Las fechas que ya pasaron no se cargan (se avisan).
 */
export function readImportRows(
  rows: readonly (readonly Cell[])[],
  formats: readonly ImportFormat[],
  today: string,
): ReadResult {
  const index = buildIndex(formats)
  const formatsById = new Map(formats.map((f) => [f.id, f]))
  const header = findHeaderRow(
    rows,
    HEADER_RULES,
    (c) => c.date !== undefined && c.name !== undefined,
  )
  let columns: Partial<Record<Column, number>> | null = header ? header.columns : null
  let start = header ? header.index + 1 : 0
  if (!columns) {
    columns = guessColumns(rows, index, today)
    start = 0
  }
  if (!columns || columns.date === undefined || columns.name === undefined) {
    return { entries: [], problems: [], noColumns: true }
  }

  const entries: ImportEntry[] = []
  const problems: ImportProblem[] = []
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? []
    const line = i + 1
    const dateCell = row[columns.date] ?? null
    const nameCell = row[columns.name] ?? null
    const name = cellText(nameCell)
    const dateText = cellText(dateCell)
    if (name === '' && dateText === '') continue
    const text = [dateText, name].filter(Boolean).join(' · ')
    if (name === '') {
      problems.push({ line, text, reason: 'Falta la película.' })
      continue
    }
    const match = matchFormat(name, index, formatsById)
    if (!match.ok) {
      problems.push({ line, text, reason: match.reason })
      continue
    }
    const format = match.format
    const time = parseImportTime(columns.time === undefined ? null : (row[columns.time] ?? null))
    if (!time.ok) {
      problems.push({ line, text, reason: 'La hora no se entiende (escribila como 21:00).' })
      continue
    }
    const capacity = parseImportCapacity(
      columns.capacity === undefined ? null : (row[columns.capacity] ?? null),
    )
    if (!capacity.ok) {
      problems.push({ line, text, reason: 'El cupo tiene que ser un número entre 1 y 999.' })
      continue
    }
    const createTime = time.time ?? format.usualTime
    if (!createTime) {
      problems.push({
        line,
        text,
        reason: `Poné la hora: «${format.name}» no tiene fechas anteriores de donde copiarla.`,
      })
      continue
    }
    const createCapacity = capacity.capacity ?? format.defaultCapacity ?? format.usualCapacity
    if (!createCapacity) {
      problems.push({
        line,
        text,
        reason: `Poné el cupo: «${format.name}» no tiene uno por defecto.`,
      })
      continue
    }
    for (const part of splitDates(dateCell)) {
      const parsed = parseImportDate(part, today)
      const partText = [cellText(part), name].filter(Boolean).join(' · ')
      if (!parsed.ok) {
        problems.push({ line, text: partText, reason: parsed.reason })
        continue
      }
      if (parsed.date < today) {
        problems.push({ line, text: partText, reason: `El ${dayLabel(parsed.date)} ya pasó.` })
        continue
      }
      entries.push({
        line,
        date: parsed.date,
        formatId: format.id,
        time: time.time,
        capacity: capacity.capacity,
        createTime,
        createCapacity,
      })
    }
  }
  return { entries, problems, noColumns: false }
}

// ──────────────────────────────────────────────
// Comparar con el calendario
// ──────────────────────────────────────────────

const byDateThenFormat = <T extends { date: string; formatId: string; time: string }>(a: T, b: T) =>
  a.date.localeCompare(b.date) ||
  a.time.localeCompare(b.time) ||
  a.formatId.localeCompare(b.formatId)

/**
 * Qué hay que hacer para que el calendario diga lo que dice la planilla. Solo
 * mira las películas que la planilla nombra, en los meses que trae, de hoy en
 * adelante. `existing` son las fechas de esas películas en esos meses.
 */
export function planImport(
  entries: readonly ImportEntry[],
  existing: readonly ExistingEvent[],
  today: string,
): ImportPlan {
  const months = [...new Set(entries.map((e) => e.date.slice(0, 7)))].sort()
  const formatIds = new Set(entries.map((e) => e.formatId))
  const inScope = existing.filter(
    (ev) =>
      formatIds.has(ev.templateId) && months.includes(ev.date.slice(0, 7)) && ev.date >= today,
  )

  // Una sola vez cada película en cada día y hora (la fila repetida suma sus líneas).
  const unique = new Map<string, ImportEntry & { lines: number[] }>()
  let duplicates = 0
  for (const e of entries) {
    const key = `${e.formatId}|${e.date}|${e.time ?? e.createTime}`
    const seen = unique.get(key)
    if (seen) {
      duplicates++
      seen.lines.push(e.line)
      continue
    }
    unique.set(key, { ...e, lines: [e.line] })
  }

  const pool = new Map<string, ExistingEvent[]>()
  for (const ev of inScope) {
    const key = `${ev.templateId}|${ev.date}`
    pool.set(key, [...(pool.get(key) ?? []), ev])
  }
  const take = (formatId: string, date: string, time: string | null): ExistingEvent | null => {
    const list = pool.get(`${formatId}|${date}`)
    if (!list || list.length === 0) return null
    const i = time
      ? Math.max(
          0,
          list.findIndex((ev) => ev.time === time),
        )
      : 0
    const [found] = list.splice(i, 1)
    return found ?? null
  }

  const creates: PlanCreate[] = []
  const sames: PlanSame[] = []
  const updates: PlanUpdate[] = []
  // Primero las que traen hora (calzan con la fecha de esa hora), después las otras.
  const ordered = [...unique.values()].sort(
    (a, b) => Number(a.time === null) - Number(b.time === null),
  )
  for (const e of ordered) {
    const ev = take(e.formatId, e.date, e.time)
    if (!ev) {
      creates.push({
        kind: 'create',
        date: e.date,
        formatId: e.formatId,
        time: e.createTime,
        capacity: e.createCapacity,
        lines: e.lines,
      })
      continue
    }
    const wantsTime = e.time !== null && e.time !== ev.time
    const timeBlocked = wantsTime && ev.activeReservations > 0
    const newTime = wantsTime && !timeBlocked ? e.time : null
    const newCapacity = e.capacity !== null && e.capacity !== ev.capacity ? e.capacity : null
    if (newTime === null && newCapacity === null && !timeBlocked) {
      sames.push({
        kind: 'same',
        eventId: ev.id,
        date: ev.date,
        formatId: ev.templateId,
        time: ev.time,
      })
      continue
    }
    updates.push({
      kind: 'update',
      eventId: ev.id,
      date: ev.date,
      formatId: ev.templateId,
      time: ev.time,
      capacity: ev.capacity,
      newTime,
      newCapacity,
      timeBlocked,
    })
  }

  const removes: PlanRemove[] = []
  const keeps: PlanKeep[] = []
  for (const list of pool.values()) {
    for (const ev of list) {
      if (ev.activeReservations > 0) {
        keeps.push({
          kind: 'keep',
          eventId: ev.id,
          date: ev.date,
          formatId: ev.templateId,
          time: ev.time,
          reservations: ev.activeReservations,
        })
      } else {
        removes.push({
          kind: 'remove',
          eventId: ev.id,
          date: ev.date,
          formatId: ev.templateId,
          time: ev.time,
        })
      }
    }
  }

  return {
    creates: creates.sort(byDateThenFormat),
    sames: sames.sort(byDateThenFormat),
    updates: updates.sort(byDateThenFormat),
    removes: removes.sort(byDateThenFormat),
    keeps: keeps.sort(byDateThenFormat),
    months,
    duplicates,
  }
}

/** Primer y último día de los meses que trae la planilla (para pedir sus fechas). */
export function monthsRange(months: readonly string[]): { from: string; to: string } | null {
  const first = months[0]
  const last = months[months.length - 1]
  if (!first || !last) return null
  const [y, m] = last.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate()
  return { from: `${first}-01`, to: `${last}-${String(lastDay).padStart(2, '0')}` }
}
