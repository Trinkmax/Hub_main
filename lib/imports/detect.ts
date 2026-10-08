/**
 * Abrir un archivo subido y decir qué es (diseño §4.0, primer paso de los tres
 * importadores).
 *
 * `openTable` convierte cualquier formato que aceptamos en filas de celdas:
 * - ZIP de Mis Comprobantes (un CSV adentro; también un `.xlsx` adentro);
 * - `.xlsx` (y el «.xls» que es XML de Excel 2003 o una página HTML);
 * - CSV o TXT en UTF-8, Windows-1252 o UTF-16, con `;`, `,`, tabulador o `|`.
 * Rechaza con un aviso claro el `.xls` viejo (BIFF: «guardalo como CSV»), el PDF
 * y los ZIP con contraseña, dañados o con varios archivos.
 *
 * `detectTableSource` mira los títulos: Mis Comprobantes (Recibidos o Emitidos)
 * y Portal IVA por las reglas de §9.3; Liquidaciones de Mercado Pago (y el
 * reporte equivocado, «Todas las transacciones»); un extracto bancario por los
 * sinónimos de `banco.md` §3.2. Si nada calza, `unknown` (el importador del
 * banco igual puede pedir el mapeo de columnas).
 */

import { BANK_HEADER_RULES, isBankHeader } from './bank/statement'
import { decodeText, sniffContainer } from './bytes'
import { parseCsv, sniffDelimiter } from './csv'
import { findHeaderRow, isMcHeader, MC_HEADER_RULES } from './headers'
import { looksLikeHtmlTable, readHtmlTable } from './html-table'
import { isMpReleaseHeader, isMpSettlementHeader, MP_HEADER_RULES } from './mercadopago/release'
import {
  type Cell,
  type Delimiter,
  type DetectedSource,
  type ImportIssue,
  type InflateRaw,
  issue,
  type TextEncodingName,
} from './types'
import {
  isXlsxPackage,
  readSpreadsheetMl,
  readWorkbookSheet,
  XLSX_MAX_ROWS,
  XlsxError,
} from './xlsx'
import { defaultInflateRaw, listZip, readZipEntry, type ZipEntry, ZipError } from './zip'

/** Lo que acepta la base (`aibt_file`: hasta 20 MB). */
export const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024

export type TableContainer = 'csv' | 'zip_csv' | 'xlsx' | 'zip_xlsx' | 'html' | 'spreadsheetml'

export type OpenedTable = {
  readonly container: TableContainer
  /** `csv` = celdas de texto de un CSV; `sheet` = planilla (Excel, HTML). Va a `McMeta.container`. */
  readonly cellKind: 'csv' | 'sheet'
  readonly rows: Cell[][]
  /** El archivo de adentro del ZIP (su nombre dice «recibidos» o «emitidos»). */
  readonly entryName: string | null
  readonly encoding: TextEncodingName | null
  readonly delimiter: Delimiter | null
  /** Para la firma del formato de un extracto: el separador o el contenedor. */
  readonly signatureDelimiter: string
  /** Avisos de la lectura (tildes rotas). */
  readonly issues: readonly ImportIssue[]
}

export type OpenTableResult =
  | { readonly ok: true; readonly table: OpenedTable }
  | { readonly ok: false; readonly issue: ImportIssue }

export type OpenTableInput = {
  readonly bytes: Uint8Array
  readonly fileName?: string | null
  readonly inflateRaw?: InflateRaw
}

function fail(code: Parameters<typeof issue>[1]): OpenTableResult {
  return { ok: false, issue: issue('error', code, null) }
}

function errorResult(e: unknown): OpenTableResult {
  if (e instanceof ZipError) {
    if (e.code === 'zip_encrypted') return fail('file_zip_encrypted')
    if (e.code === 'zip_too_big') return fail('file_too_big')
    return fail('file_zip_corrupt')
  }
  if (e instanceof XlsxError)
    return fail(e.code === 'xlsx_too_big' ? 'file_too_many_rows' : 'file_xlsx_corrupt')
  throw e
}

/** Texto → tabla (XML de Excel 2003, HTML o CSV/TXT). */
function textTable(bytes: Uint8Array, entryName: string | null, inZip: boolean): OpenTableResult {
  const decoded = decodeText(bytes)
  const issues: ImportIssue[] = []
  if (decoded.mojibake) issues.push(issue('review', 'file_mojibake', null))
  if (decoded.repaired) issues.push(issue('info', 'file_mojibake_repaired', null))
  const text = decoded.text
  const head = text.trimStart().slice(0, 2048).toLowerCase()
  if (head.startsWith('<') && head.includes('urn:schemas-microsoft-com:office:spreadsheet')) {
    const rows = readSpreadsheetMl(text)
    return {
      ok: true,
      table: {
        container: 'spreadsheetml',
        cellKind: 'sheet',
        rows,
        entryName,
        encoding: decoded.encoding,
        delimiter: null,
        signatureDelimiter: 'xml',
        issues,
      },
    }
  }
  if (looksLikeHtmlTable(text)) {
    return {
      ok: true,
      table: {
        container: 'html',
        cellKind: 'sheet',
        rows: readHtmlTable(text),
        entryName,
        encoding: decoded.encoding,
        delimiter: null,
        signatureDelimiter: 'html',
        issues,
      },
    }
  }
  const delimiter = sniffDelimiter(text.slice(0, 65536))
  // Corta apenas pasa el tope: un archivo de millones de líneas no llega a armarse entero.
  const rows = parseCsv(text, delimiter, XLSX_MAX_ROWS + 1)
  if (rows.length > XLSX_MAX_ROWS) return fail('file_too_many_rows')
  if (rows.every((r) => r.every((c) => c.trim() === ''))) return fail('file_empty')
  return {
    ok: true,
    table: {
      container: inZip ? 'zip_csv' : 'csv',
      cellKind: 'csv',
      rows,
      entryName,
      encoding: decoded.encoding,
      delimiter,
      signatureDelimiter: delimiter,
      issues,
    },
  }
}

/** De un ZIP que no es un Excel, el único archivo que se puede leer (o el único CSV/TXT). */
function pickEntry(entries: readonly ZipEntry[]): ZipEntry | 'none' | 'many' {
  const files = entries.filter((e) => !e.isDirectory && !e.isJunk)
  if (files.length === 0) return 'none'
  if (files.length === 1) return files[0] as ZipEntry
  const tables = files.filter((e) => /\.(csv|txt|tsv)$/i.test(e.name))
  if (tables.length === 1) return tables[0] as ZipEntry
  return 'many'
}

/**
 * Abre el archivo y devuelve sus filas. Nunca tira por un archivo roto: devuelve
 * el aviso (los errores de programación sí se propagan).
 */
export async function openTable(input: OpenTableInput): Promise<OpenTableResult> {
  const { bytes } = input
  const inflate = input.inflateRaw ?? defaultInflateRaw
  if (bytes.length === 0) return fail('file_empty')
  if (bytes.length > IMPORT_MAX_FILE_BYTES) return fail('file_too_big')
  try {
    const kind = sniffContainer(bytes)
    switch (kind) {
      case 'empty':
        return fail('file_empty')
      case 'ole':
        return fail('file_xls_biff')
      case 'pdf':
        return fail('file_pdf')
      case 'gzip':
      case 'binary':
        return fail('file_not_table')
      case 'zip': {
        const entries = listZip(bytes)
        if (entries.some((e) => e.encrypted)) return fail('file_zip_encrypted')
        if (isXlsxPackage(entries)) {
          const sheet = await readWorkbookSheet(bytes, inflate)
          return {
            ok: true,
            table: {
              container: 'xlsx',
              cellKind: 'sheet',
              rows: sheet.rows,
              entryName: null,
              encoding: null,
              delimiter: null,
              signatureDelimiter: 'xlsx',
              issues: [],
            },
          }
        }
        const picked = pickEntry(entries)
        if (picked === 'none') return fail('file_zip_empty')
        if (picked === 'many') return fail('file_zip_many')
        const inner = await readZipEntry(bytes, picked, inflate)
        const innerKind = sniffContainer(inner)
        if (innerKind === 'zip') {
          const sheet = await readWorkbookSheet(inner, inflate)
          return {
            ok: true,
            table: {
              container: 'zip_xlsx',
              cellKind: 'sheet',
              rows: sheet.rows,
              entryName: picked.name,
              encoding: null,
              delimiter: null,
              signatureDelimiter: 'xlsx',
              issues: [],
            },
          }
        }
        if (innerKind === 'ole') return fail('file_xls_biff')
        if (innerKind === 'pdf') return fail('file_pdf')
        if (innerKind === 'empty') return fail('file_empty')
        if (innerKind === 'binary' || innerKind === 'gzip') return fail('file_not_table')
        return textTable(inner, picked.name, true)
      }
      default:
        return textTable(bytes, null, false)
    }
  } catch (e) {
    return errorResult(e)
  }
}

/** Qué archivo es, por sus títulos (y, de respaldo, por el nombre o el título del Excel). */
export function detectTableSource(
  rows: readonly (readonly Cell[])[],
  fileName?: string | null,
): DetectedSource {
  const mc = findHeaderRow(rows, MC_HEADER_RULES, isMcHeader, 10)
  if (mc) {
    const c = mc.columns
    if (
      c.cf_computable !== undefined ||
      c.perc_iibb !== undefined ||
      c.perc_iva !== undefined ||
      c.perc_otros_nac !== undefined
    ) {
      return 'portal_iva_compras'
    }
    if (c.denom_emisor !== undefined || c.nro_doc_emisor !== undefined) return 'arca_recibidos'
    if (c.denom_receptor !== undefined || c.nro_doc_receptor !== undefined) return 'arca_emitidos'
    const title = `${rows
      .slice(0, mc.index)
      .flat()
      .map((x) => (x === null ? '' : String(x)))
      .join(' ')} ${fileName ?? ''}`
    if (/emitid/i.test(title)) return 'arca_emitidos'
    return 'arca_recibidos'
  }
  if (findHeaderRow(rows, MP_HEADER_RULES, isMpReleaseHeader, 15)) return 'mp_release'
  if (rows.slice(0, 15).some((r) => isMpSettlementHeader(r))) return 'mp_settlement'
  if (findHeaderRow(rows, BANK_HEADER_RULES, isBankHeader, 40)) return 'bank'
  return 'unknown'
}

export type DetectResult = {
  readonly source: DetectedSource
  /** La tabla ya abierta (para no volver a leer el archivo), o `null` si no se pudo abrir. */
  readonly table: OpenedTable | null
  /** Por qué no se pudo abrir. */
  readonly issue: ImportIssue | null
}

/**
 * `detectSource({ bytes, fileName })` del diseño: abre el archivo y dice qué es.
 * Devuelve también la tabla abierta para que el parser no lo lea dos veces.
 */
export async function detectSource(input: OpenTableInput): Promise<DetectResult> {
  const opened = await openTable(input)
  if (!opened.ok) return { source: 'unknown', table: null, issue: opened.issue }
  const name = opened.table.entryName ?? input.fileName ?? null
  return { source: detectTableSource(opened.table.rows, name), table: opened.table, issue: null }
}
