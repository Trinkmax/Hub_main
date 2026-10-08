/**
 * Lector de la primera hoja de un `.xlsx` (y del XML de Excel 2003) con
 * **valores crudos** (diseño §4.0, `arca-mis-comprobantes.md` §4).
 *
 * - Texto compartido (`sharedStrings`), texto en línea (`inlineStr`), resultado
 *   de fórmula de texto (`str`), números, booleanos y errores (→ `null`).
 * - Se lee el VALOR de la celda, nunca el texto con formato: ARCA manda algunas
 *   celdas de `Tipo Cambio` con un formato que muestra `1438.43498` como
 *   `143.843.498`.
 * - Los números con formato de fecha pasan a `yyyy-MM-dd` (o con hora,
 *   `yyyy-MM-ddTHH:mm:ss`) según el sistema de fechas del libro (1900 o 1904).
 *   Las de solo hora, a `HH:mm:ss`.
 * - En el texto compartido se toman `<t>` y `<r><t>`, NO la lectura fonética
 *   (`<rPh>`), que `textOf` mezclaría. Se decodifican los escapes `_xHHHH_`.
 * - Las celdas combinadas no se rellenan (el valor queda en la primera).
 *
 * Los `.xls` viejos (BIFF) no se leen: `detect.ts` pide guardarlos como CSV.
 */

import {
  attr,
  child,
  childrenNamed,
  findFirst,
  parseXml,
  textAt,
  textOf,
  type XmlNode,
  XmlParseError,
} from '@/lib/xml/mini'
import { excelSerialSeconds, excelSerialTime, excelSerialToIsoDay } from './dates'
import type { Cell, InflateRaw } from './types'
import { defaultInflateRaw, listZip, readZipEntry, type ZipEntry } from './zip'

export type XlsxErrorCode = 'xlsx_corrupt' | 'xlsx_no_sheet' | 'xlsx_too_big'

export class XlsxError extends Error {
  readonly code: XlsxErrorCode
  constructor(code: XlsxErrorCode, message: string) {
    super(message)
    this.name = 'XlsxError'
    this.code = code
  }
}

/** Topes: un Mis Comprobantes de un año entra de sobra. */
export const XLSX_MAX_ROWS = 200_000
export const XLSX_MAX_COLUMNS = 512

export type XlsxSheet = {
  readonly name: string
  /** Fila `i` = fila `i + 1` de la hoja; las filas que no existen quedan `[]`. */
  readonly rows: Cell[][]
  readonly date1904: boolean
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Las partes de un paquete OOXML son UTF-8 (o UTF-16 con BOM). */
function xmlText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  return new TextDecoder('utf-8').decode(bytes)
}

/** `_x000D_` → retorno de carro; `_x005F_` es un guion bajo literal. */
export function unescapeOoxml(s: string): string {
  if (!s.includes('_x')) return s
  return s.replace(/_x([0-9a-fA-F]{4})_/g, (_m, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
}

/** El texto de un `<si>` o un `<is>`: `<t>` y las corridas `<r><t>`, sin la fonética. */
export function richText(n: XmlNode | null): string {
  if (!n) return ''
  const plain = childrenNamed(n, 't').map(textOf).join('')
  const runs = childrenNamed(n, 'r')
    .map((r) => textAt(r, 't') ?? '')
    .join('')
  return unescapeOoxml(plain + runs)
}

/** `'AB12'` → columna 27 (desde 0); `null` si la referencia no se entiende. */
export function columnIndex(ref: string): number | null {
  const m = /^\$?([A-Za-z]{1,3})\$?\d*$/.exec(ref.trim())
  if (!m) return null
  let n = 0
  for (const ch of (m[1] ?? '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Resuelve el `Target` de una relación respecto de la carpeta de la parte que la declara. */
function resolvePart(baseDir: string, target: string): string {
  const raw = target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`
  const out: string[] = []
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

// ─── Formatos de fecha ───────────────────────────────────────────────────────

/** Formatos de fecha u hora que trae Excel de fábrica (numFmtId). */
function builtinKind(id: number): 'date' | 'time' | null {
  if ((id >= 14 && id <= 17) || id === 22 || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) {
    return 'date'
  }
  if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return 'time'
  return null
}

/**
 * ¿Un código de formato es de fecha, de hora o ninguno? Se sacan los textos entre
 * comillas, los caracteres escapados, los corchetes (`[Red]`, `[$-2C0A]`) y los
 * rellenos, y se buscan las letras de fecha y hora.
 */
export function formatKind(code: string): 'date' | 'time' | null {
  const elapsed = /\[(h+|m+|s+)\]/i.test(code)
  const clean = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[_*]./g, '')
  if (/[yd]/i.test(clean)) return 'date'
  if (elapsed || /[hs]/i.test(clean)) return 'time'
  if (/m/i.test(clean)) return 'date'
  return null
}

/** Para cada estilo de celda (índice de `cellXfs`), si es fecha, hora o nada. */
function readStyles(styles: XmlNode | null): ('date' | 'time' | null)[] {
  if (!styles) return []
  const custom = new Map<number, string>()
  for (const f of childrenNamed(child(styles, 'numFmts'), 'numFmt')) {
    const id = Number(attr(f, 'numFmtId'))
    const code = attr(f, 'formatCode')
    if (Number.isInteger(id) && code !== null) custom.set(id, code)
  }
  return childrenNamed(child(styles, 'cellXfs'), 'xf').map((xf) => {
    const id = Number(attr(xf, 'numFmtId') ?? '0')
    const code = custom.get(id)
    return code !== undefined ? formatKind(code) : builtinKind(id)
  })
}

function serialToCell(v: number, kind: 'date' | 'time', date1904: boolean): Cell {
  if (kind === 'time' && v >= 0 && v < 1) return excelSerialTime(v)
  const day = excelSerialToIsoDay(v, date1904)
  if (day === null) return v
  return excelSerialSeconds(v) === 0 ? day : `${day}T${excelSerialTime(v)}`
}

// ─── Hoja ────────────────────────────────────────────────────────────────────

function readSheetRows(
  sheet: XmlNode,
  shared: readonly string[],
  styles: readonly ('date' | 'time' | null)[],
  date1904: boolean,
): Cell[][] {
  const rows: Cell[][] = []
  let lastRow = 0
  for (const rowNode of childrenNamed(findFirst(sheet, 'sheetData'), 'row')) {
    const r = Number(attr(rowNode, 'r'))
    const rowNumber = Number.isInteger(r) && r > lastRow ? r : lastRow + 1
    lastRow = rowNumber
    if (rowNumber > XLSX_MAX_ROWS)
      throw new XlsxError('xlsx_too_big', 'La hoja tiene demasiadas filas')
    const cells: Cell[] = []
    let col = -1
    for (const c of childrenNamed(rowNode, 'c')) {
      const ref = attr(c, 'r')
      const fromRef = ref ? columnIndex(ref) : null
      col = fromRef !== null && fromRef > col ? fromRef : col + 1
      if (col >= XLSX_MAX_COLUMNS) break
      const type = attr(c, 't') ?? 'n'
      const v = textAt(c, 'v')
      let value: Cell = null
      if (type === 's') {
        const idx = Number(v)
        value = Number.isInteger(idx) ? (shared[idx] ?? null) : null
      } else if (type === 'inlineStr') {
        value = richText(child(c, 'is'))
      } else if (type === 'str') {
        value = v === null ? null : unescapeOoxml(v)
      } else if (type === 'b') {
        value = v === null ? null : v.trim() === '1' || v.trim().toLowerCase() === 'true'
      } else if (type === 'e') {
        value = null
      } else if (type === 'd') {
        value = v === null ? null : v.trim().replace(/T00:00:00(\.0+)?Z?$/, '')
      } else if (v !== null && v.trim() !== '') {
        const num = Number(v)
        if (Number.isFinite(num)) {
          const style = styles[Number(attr(c, 's') ?? '0')] ?? null
          value = style ? serialToCell(num, style, date1904) : num
        } else {
          value = v
        }
      }
      while (cells.length < col) cells.push(null)
      cells[col] = value
    }
    while (rows.length < rowNumber - 1) rows.push([])
    rows.push(cells)
  }
  return rows
}

function findEntry(entries: readonly ZipEntry[], path: string): ZipEntry | undefined {
  return (
    entries.find((e) => e.name === path) ??
    entries.find((e) => e.name.toLowerCase() === path.toLowerCase())
  )
}

/** ¿Es un paquete de Excel? (un ZIP con `xl/workbook.xml`, o con `[Content_Types].xml` y una carpeta `xl/`). */
export function isXlsxPackage(entries: readonly ZipEntry[]): boolean {
  const names = entries.map((e) => e.name.toLowerCase())
  if (names.includes('xl/workbook.xml')) return true
  return names.includes('[content_types].xml') && names.some((n) => n.startsWith('xl/'))
}

/**
 * Lee una hoja de un `.xlsx` (la primera visible por defecto, en el orden de las
 * pestañas). Tira `XlsxError` o `ZipError` si el archivo está roto.
 */
export async function readWorkbookSheet(
  bytes: Uint8Array,
  inflateRaw: InflateRaw = defaultInflateRaw,
): Promise<XlsxSheet> {
  const entries = listZip(bytes)
  const read = async (path: string): Promise<XmlNode | null> => {
    const entry = findEntry(entries, path)
    if (!entry) return null
    try {
      return parseXml(xmlText(await readZipEntry(bytes, entry, inflateRaw)))
    } catch (e) {
      if (e instanceof XmlParseError) {
        throw new XlsxError('xlsx_corrupt', `Parte ilegible del Excel: ${path}`)
      }
      throw e
    }
  }

  // 1. El libro: lo dice `_rels/.rels` (casi siempre `xl/workbook.xml`).
  let workbookPath = 'xl/workbook.xml'
  const rootRels = await read('_rels/.rels')
  const officeDoc = childrenNamed(rootRels, 'Relationship').find((r) =>
    (attr(r, 'Type') ?? '').endsWith('/officeDocument'),
  )
  const officeTarget = attr(officeDoc, 'Target')
  if (officeTarget) workbookPath = resolvePart('', officeTarget)
  const workbook = await read(workbookPath)
  if (!workbook) throw new XlsxError('xlsx_corrupt', 'El Excel no tiene libro')
  const baseDir = workbookPath.includes('/')
    ? workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1)
    : ''
  const pr = attr(child(workbook, 'workbookPr'), 'date1904')
  const date1904 = pr === '1' || pr === 'true'

  // 2. La primera hoja visible (si están todas ocultas, la primera).
  const sheets = childrenNamed(child(workbook, 'sheets'), 'sheet')
  const visible = sheets.find((s) => {
    const state = attr(s, 'state')
    return state !== 'hidden' && state !== 'veryHidden'
  })
  const sheetNode = visible ?? sheets[0]
  if (!sheetNode) throw new XlsxError('xlsx_no_sheet', 'El Excel no tiene hojas')

  const relsPath = `${baseDir}_rels/${workbookPath.slice(baseDir.length)}.rels`
  const rels = childrenNamed(await read(relsPath), 'Relationship')
  const rid = attr(sheetNode, 'r:id')
  const sheetRel = rels.find((r) => attr(r, 'Id') === rid)
  const sheetTarget = attr(sheetRel, 'Target')
  const sheetPath = sheetTarget
    ? resolvePart(baseDir, sheetTarget)
    : `${baseDir}worksheets/sheet1.xml`
  const sheet = await read(sheetPath)
  if (!sheet) throw new XlsxError('xlsx_no_sheet', 'No se encontró la hoja del Excel')

  // 3. Texto compartido y estilos (los dos son opcionales).
  const relTarget = (suffix: string, fallback: string) => {
    const rel = rels.find((r) => (attr(r, 'Type') ?? '').endsWith(suffix))
    const t = attr(rel, 'Target')
    return t ? resolvePart(baseDir, t) : `${baseDir}${fallback}`
  }
  const sst = await read(relTarget('/sharedStrings', 'sharedStrings.xml'))
  const shared = childrenNamed(sst, 'si').map(richText)
  const styles = readStyles(await read(relTarget('/styles', 'styles.xml')))

  return {
    name: attr(sheetNode, 'name') ?? '',
    rows: readSheetRows(sheet, shared, styles, date1904),
    date1904,
  }
}

/** Las filas crudas de la primera hoja visible (diseño §4.0: `readFirstSheet(bytes, inflateRaw)`). */
export async function readFirstSheet(
  bytes: Uint8Array,
  inflateRaw: InflateRaw = defaultInflateRaw,
): Promise<Cell[][]> {
  return (await readWorkbookSheet(bytes, inflateRaw)).rows
}

// ─── XML de Excel 2003 (SpreadsheetML) ───────────────────────────────────────

/** Atributo de SpreadsheetML: va con `ss:`, pero algunos generadores lo escriben sin prefijo. */
function ssAttr(n: XmlNode | null, name: string): string | null {
  return attr(n, `ss:${name}`) ?? attr(n, name)
}

/**
 * Algunos bancos exportan un «.xls» que es XML de Excel 2003
 * (`<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">`). Se lee la
 * primera hoja con los mismos valores crudos que un `.xlsx`.
 */
export function readSpreadsheetMl(text: string): Cell[][] {
  let root: XmlNode
  try {
    root = parseXml(text)
  } catch {
    throw new XlsxError('xlsx_corrupt', 'El XML de Excel no se puede leer')
  }
  const worksheet = findFirst(root, 'Worksheet')
  if (!worksheet) throw new XlsxError('xlsx_no_sheet', 'El XML de Excel no tiene hojas')
  const rows: Cell[][] = []
  let rowNumber = 0
  for (const rowNode of childrenNamed(child(worksheet, 'Table'), 'Row')) {
    const idx = Number(ssAttr(rowNode, 'Index'))
    rowNumber = Number.isInteger(idx) && idx > rowNumber ? idx : rowNumber + 1
    if (rowNumber > XLSX_MAX_ROWS)
      throw new XlsxError('xlsx_too_big', 'La hoja tiene demasiadas filas')
    const cells: Cell[] = []
    let col = 0
    for (const c of childrenNamed(rowNode, 'Cell')) {
      const cIdx = Number(ssAttr(c, 'Index'))
      if (Number.isInteger(cIdx) && cIdx - 1 > col) col = cIdx - 1
      if (col >= XLSX_MAX_COLUMNS) break
      const data = child(c, 'Data')
      const type = ssAttr(data, 'Type')
      const raw = data ? textOf(data) : null
      let value: Cell = null
      if (raw !== null && raw !== '') {
        if (type === 'Number') {
          const num = Number(raw)
          value = Number.isFinite(num) ? num : raw
        } else if (type === 'Boolean') {
          value = raw.trim() === '1'
        } else if (type === 'DateTime') {
          value = raw.trim().replace(/T00:00:00(\.0+)?$/, '')
        } else if (type === 'Error') {
          value = null
        } else {
          value = raw
        }
      }
      while (cells.length < col) cells.push(null)
      cells[col] = value
      const merge = Number(ssAttr(c, 'MergeAcross'))
      col += 1 + (Number.isInteger(merge) && merge > 0 ? merge : 0)
    }
    while (rows.length < rowNumber - 1) rows.push([])
    rows.push(cells)
  }
  return rows
}
