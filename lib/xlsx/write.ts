/**
 * Un `.xlsx` chico escrito a mano, sin librería: lo usan las planillas que el bar baja, cambia en Excel o en
 * Google Sheets y vuelve a subir (Compras › Insumos › Planilla). Lo que se escribe acá lo lee
 * `lib/imports/xlsx.ts` (las pruebas hacen la ida y la vuelta).
 *
 * Alcanza para lo que hace falta y nada más: texto y números, la fila de títulos en negrita y fija al bajar,
 * el filtro, el ancho de cada columna, columnas y hojas ocultas, y listas para elegir (validación de datos)
 * que apuntan a otra hoja. Los elementos del XML van en el orden que exige el estándar (ECMA-376): Excel
 * «repara» el archivo si no.
 *
 * Puro. El ZIP se arma acá (CRC-32 de `lib/imports/zip.ts`); el que comprime se inyecta (`node:zlib` en el
 * servidor). Sin él, los archivos van guardados sin comprimir, que también es un ZIP válido.
 */

import { crc32 } from '@/lib/imports/zip'

export type XlsxStyle = 'header' | 'title' | 'muted' | 'text'

/** Una celda: texto, número, vacía, o con un estilo. */
export type XlsxCell =
  | string
  | number
  | null
  | { readonly value: string | number | null; readonly style: XlsxStyle }

export type XlsxColumn = {
  /** En caracteres, como el ancho de Excel. */
  readonly width: number
  readonly hidden?: boolean
  /** El formato de lo que se escriba nuevo en la columna (`text`: «0012» no pasa a 12). */
  readonly style?: XlsxStyle
}

/** Una lista para elegir en un rango de celdas, con los valores de otra hoja. */
export type XlsxListValidation = {
  /** «D2:D1000». */
  readonly range: string
  /** De dónde salen las opciones: hoja y rango («A2:A7»). */
  readonly source: { readonly sheet: string; readonly range: string }
  /** `true`: Excel no deja escribir otra cosa. `false`: muestra la lista pero acepta cualquier valor. */
  readonly strict: boolean
  /** El cartel cuando no está en la lista (título hasta 32 letras, texto hasta 255). */
  readonly error?: { readonly title: string; readonly text: string }
}

export type XlsxSheetSpec = {
  /** Hasta 31 letras, sin `[]:*?/\`. */
  readonly name: string
  readonly rows: ReadonlyArray<ReadonlyArray<XlsxCell>>
  readonly columns?: ReadonlyArray<XlsxColumn>
  /** La primera fila son títulos: negrita, con fondo, fija al bajar y con el filtro. */
  readonly header?: boolean
  readonly validations?: ReadonlyArray<XlsxListValidation>
  readonly hidden?: boolean
}

export type DeflateRaw = (data: Uint8Array) => Uint8Array

const STYLE_INDEX: Record<XlsxStyle, number> = { header: 1, title: 2, muted: 3, text: 4 }

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

export class XlsxWriteError extends Error {}

// ─── Texto y referencias ─────────────────────────────────────────────────────

/** Lo que no puede ir en un XML 1.0 (controles salvo tab y salto) se va; `& < > "` se escapan. */
export function xmlText(value: string): string {
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: justamente, sacarlos.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  )
}

/** 0 → «A», 25 → «Z», 26 → «AA». */
export function columnName(index: number): string {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    name = String.fromCharCode(65 + rest) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/** El nombre de la hoja en una fórmula: entre comillas si tiene espacios o tildes. */
function sheetRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

/** «A2:A7» → «$A$2:$A$7». */
function absolute(range: string): string {
  return range.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')
}

function checkSheetName(name: string): void {
  if (!name || name.length > 31 || /[[\]:*?/\\]/.test(name)) {
    throw new XlsxWriteError(`Nombre de hoja inválido: ${name}`)
  }
}

// ─── Partes del libro ────────────────────────────────────────────────────────

function cellXml(cell: XlsxCell, ref: string): string {
  const { value, style } =
    cell !== null && typeof cell === 'object' ? cell : { value: cell, style: null }
  const s = style ? ` s="${STYLE_INDEX[style]}"` : ''
  if (value === null || value === '') return style ? `<c r="${ref}"${s}/>` : ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new XlsxWriteError(`Número inválido en ${ref}`)
    return `<c r="${ref}"${s}><v>${value}</v></c>`
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`
}

function sheetXml(sheet: XlsxSheetSpec, selected: boolean): string {
  const width = Math.max(1, sheet.columns?.length ?? 0, ...sheet.rows.map((r) => r.length))
  const lastRow = Math.max(1, sheet.rows.length)
  const lastCol = columnName(width - 1)
  const parts: string[] = [`<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">`]
  parts.push(`<dimension ref="A1:${lastCol}${lastRow}"/>`)
  const tab = selected ? ' tabSelected="1"' : ''
  parts.push(
    sheet.header
      ? `<sheetViews><sheetView${tab} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView${tab} workbookViewId="0"/></sheetViews>`,
  )
  parts.push('<sheetFormatPr defaultRowHeight="15"/>')
  if (sheet.columns?.length) {
    parts.push('<cols>')
    sheet.columns.forEach((col, i) => {
      const hidden = col.hidden ? ' hidden="1"' : ''
      const style = col.style ? ` style="${STYLE_INDEX[col.style]}"` : ''
      parts.push(
        `<col min="${i + 1}" max="${i + 1}" width="${col.width}"${style}${hidden} customWidth="1"/>`,
      )
    })
    parts.push('</cols>')
  }
  parts.push('<sheetData>')
  sheet.rows.forEach((row, r) => {
    const cells = row
      .map((cell, c) => {
        const styled =
          sheet.header && r === 0 && (cell === null || typeof cell !== 'object')
            ? { value: cell, style: 'header' as const }
            : cell
        return cellXml(styled, `${columnName(c)}${r + 1}`)
      })
      .join('')
    parts.push(`<row r="${r + 1}">${cells}</row>`)
  })
  parts.push('</sheetData>')
  if (sheet.header && sheet.rows.length > 0) {
    parts.push(`<autoFilter ref="A1:${lastCol}${lastRow}"/>`)
  }
  const validations = sheet.validations ?? []
  if (validations.length > 0) {
    parts.push(`<dataValidations count="${validations.length}">`)
    for (const v of validations) {
      if (v.error && (v.error.title.length > 32 || v.error.text.length > 255)) {
        throw new XlsxWriteError('El cartel de la lista es demasiado largo para Excel')
      }
      checkSheetName(v.source.sheet)
      const error = v.error
        ? ` errorTitle="${xmlText(v.error.title)}" error="${xmlText(v.error.text)}"`
        : ''
      parts.push(
        `<dataValidation type="list" errorStyle="stop" allowBlank="1" showInputMessage="1" showErrorMessage="${v.strict ? 1 : 0}"${error} sqref="${v.range}"><formula1>${sheetRef(v.source.sheet)}!${absolute(v.source.range)}</formula1></dataValidation>`,
      )
    }
    parts.push('</dataValidations>')
  }
  parts.push(
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>',
  )
  parts.push('</worksheet>')
  return XML_HEAD + parts.join('')
}

function workbookXml(sheets: ReadonlyArray<XlsxSheetSpec>): string {
  const list = sheets
    .map((s, i) => {
      const state = s.hidden ? ' state="hidden"' : ''
      return `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}"${state} r:id="rId${i + 1}"/>`
    })
    .join('')
  // Excel guarda el rango del filtro como nombre oculto; sin él igual abre, pero así queda como lo escribe él.
  const filters = sheets
    .map((s, i) => {
      if (!s.header || s.rows.length === 0) return ''
      const width = Math.max(s.columns?.length ?? 0, ...s.rows.map((r) => r.length))
      const ref = `${sheetRef(s.name)}!$A$1:$${columnName(width - 1)}$${s.rows.length}`
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlText(ref)}</definedName>`
    })
    .join('')
  return `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${list}</sheets>${filters ? `<definedNames>${filters}</definedNames>` : ''}</workbook>`
}

/** Estilos: 0 normal · 1 títulos (negrita, fondo, línea abajo) · 2 título grande · 3 gris · 4 texto («@»). */
const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}"><fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font><font><sz val="11"/><color rgb="FF6B665E"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3EEE4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFCFC6B6"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

function contentTypesXml(count: number): string {
  const sheets = Array.from(
    { length: count },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('')
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
}

function workbookRelsXml(count: number): string {
  const sheets = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('')
  return `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">${sheets}<Relationship Id="rId${count + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`
}

const ROOT_RELS_XML = `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${PKG_REL_NS}/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`

function coreXml(author: string, at: Date): string {
  const when = at.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${xmlText(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`
}

const APP_XML = `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>HUB</Application></Properties>`

// ─── ZIP ─────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

/** Fecha y hora de MS-DOS (las del ZIP), en la hora local del servidor da igual: nadie las mira. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.min(Math.max(at.getUTCFullYear(), 1980), 2107)
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  }
}

/** Un ZIP con esos archivos: comprimidos si hay con qué y si achica, guardados si no. */
export function zipFiles(
  files: ReadonlyArray<{ readonly name: string; readonly data: Uint8Array }>,
  options: { readonly deflateRaw?: DeflateRaw; readonly at?: Date } = {},
): Uint8Array {
  const { time, date } = dosDateTime(options.at ?? new Date())
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const packed = options.deflateRaw ? options.deflateRaw(file.data) : null
    const deflated = packed !== null && packed.length < file.data.length
    const body = deflated ? packed : file.data
    const method = deflated ? 8 : 0

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // nombres en UTF-8
    lv.setUint16(8, method, true)
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, file.data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)
    locals.push(local, body)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, file.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length + body.length
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// ─── El libro ────────────────────────────────────────────────────────────────

/** El `.xlsx` con esas hojas, en ese orden (la primera es la que se abre y la que lee el importador). */
export function buildXlsx(
  sheets: ReadonlyArray<XlsxSheetSpec>,
  options: { readonly deflateRaw?: DeflateRaw; readonly at?: Date; readonly author?: string } = {},
): Uint8Array {
  if (sheets.length === 0) throw new XlsxWriteError('Un libro necesita al menos una hoja')
  const names = new Set<string>()
  for (const s of sheets) {
    checkSheetName(s.name)
    const key = s.name.toLowerCase()
    if (names.has(key)) throw new XlsxWriteError(`Hoja repetida: ${s.name}`)
    names.add(key)
  }
  if (sheets[0]?.hidden) throw new XlsxWriteError('La primera hoja no puede estar oculta')
  const at = options.at ?? new Date()
  const files = [
    { name: '[Content_Types].xml', text: contentTypesXml(sheets.length) },
    { name: '_rels/.rels', text: ROOT_RELS_XML },
    { name: 'docProps/core.xml', text: coreXml(options.author ?? 'HUB', at) },
    { name: 'docProps/app.xml', text: APP_XML },
    { name: 'xl/workbook.xml', text: workbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRelsXml(sheets.length) },
    { name: 'xl/styles.xml', text: STYLES_XML },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      text: sheetXml(s, i === 0),
    })),
  ]
  return zipFiles(
    files.map((f) => ({ name: f.name, data: encoder.encode(f.text) })),
    { deflateRaw: options.deflateRaw, at },
  )
}
