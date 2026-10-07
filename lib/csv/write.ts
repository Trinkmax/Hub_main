/**
 * Escritores de CSV. Puros: andan en Node y en el navegador, sin dependencias.
 *
 * Dos capas:
 *
 * 1. `csvEscape` / `rowsToCsv`: el escritor de siempre (se mudó desde
 *    `lib/stats/csv.ts`, que lo reexporta sin cambios). Escribe cada celda con
 *    `String(v)`; el que llama decide qué guardar y cómo formatear.
 * 2. Celdas tipadas (`buildCsv`, `writeCsvStream`): para los exportes de
 *    Administración (Sprint 1 F.15). Ahí el texto pasa SIEMPRE por
 *    `csvFormulaGuard` y la plata y las fechas van como celdas ya formateadas
 *    (`csvMoney`, `csvDate`), que nunca se guardan: un negativo empieza con `-`.
 *    Por defecto escriben para Excel en es-AR: `;`, BOM y CRLF.
 */

import { formatIsoDay } from '@/lib/dates/format'
import { formatCentsCsv } from '@/lib/money/format'
import { csvFormulaGuard } from './guard'

export type CsvSeparator = ',' | ';'

export type CsvOptions = {
  /**
   * `,` es el default histórico (exports de stats). Para lo que abre el dueño
   * en Excel en es-AR conviene `;`: Excel en español usa la coma como decimal
   * y con `,` mete todo en una sola columna.
   */
  separator?: CsvSeparator
  /**
   * BOM UTF-8 al principio: sin él, Excel abre "García" como "GarcÃ­a".
   * Google Sheets y Numbers lo ignoran sin problema.
   */
  bom?: boolean
  /**
   * Fin de línea. Default: CRLF con BOM (es lo que Excel espera) y LF sin BOM,
   * que es como escribió siempre `rowsToCsv`.
   */
  eol?: '\n' | '\r\n'
}

/** Lo que abre bien Excel en es-AR: `;`, BOM y CRLF. Default de las celdas tipadas. */
export const EXCEL_ES_AR: Readonly<Required<CsvOptions>> = {
  separator: ';',
  bom: true,
  eol: '\r\n',
}

const BOM = '﻿'

function eolOf(opts: CsvOptions): '\n' | '\r\n' {
  return opts.eol ?? (opts.bom ? '\r\n' : '\n')
}

/** Las opciones de las celdas tipadas: lo que no se pide sale como Excel es-AR. */
function excelOptions(opts: CsvOptions): Required<CsvOptions> {
  return {
    separator: opts.separator ?? EXCEL_ES_AR.separator,
    bom: opts.bom ?? EXCEL_ES_AR.bom,
    eol: opts.eol ?? EXCEL_ES_AR.eol,
  }
}

export function csvEscape(value: unknown, separator: CsvSeparator = ','): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'string' ? value : String(value)
  if (s.includes(separator) || /["\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function rowsToCsv(
  headers: string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  opts: CsvOptions = {},
): string {
  const sep = opts.separator ?? ','
  const lines: string[] = []
  lines.push(headers.map((h) => csvEscape(h, sep)).join(sep))
  for (const row of rows) {
    lines.push(row.map((v) => csvEscape(v, sep)).join(sep))
  }
  // CRLF: es lo que Excel espera; el resto lo lee igual.
  const body = lines.join(eolOf(opts))
  return opts.bom ? `${BOM}${body}` : body
}

// ─── Celdas tipadas ──────────────────────────────────────────────────────────

/** Una celda ya formateada (plata, fecha, número): se escapa pero no se guarda. */
export type CsvRawCell = { readonly csv: string }

/**
 * - `string`: texto libre → pasa por `csvFormulaGuard`.
 * - `number` / `bigint`: un número (cantidad, código AFIP) → tal cual, con coma
 *   decimal si tiene decimales. Para plata en centavos, `csvMoney`.
 * - `null` / `undefined`: celda vacía (lo que falta no es cero).
 * - `CsvRawCell`: ya formateada.
 */
export type CsvCell = string | number | bigint | null | undefined | CsvRawCell

/** Plata en centavos → `-1234,50` (coma decimal, sin miles); vacía si no hay dato. */
export function csvMoney(cents: number | bigint | null | undefined): CsvRawCell {
  return { csv: formatCentsCsv(cents) }
}

/** `'2026-09-15'` → `15/09/2026`, cortando el string; vacía si no hay fecha. */
export function csvDate(iso: string | null | undefined): CsvRawCell {
  return { csv: formatIsoDay(iso) }
}

/** Un número que no es plata, con coma decimal (`2.5` → `2,5`); vacío si no es finito. */
export function csvNumber(value: number | bigint | null | undefined): CsvRawCell {
  if (value === null || value === undefined) return { csv: '' }
  if (typeof value === 'bigint') return { csv: value.toString() }
  return { csv: Number.isFinite(value) ? String(value).replace('.', ',') : '' }
}

/**
 * Texto libre guardado contra fórmulas, para armar filas a mano con `rowsToCsv`
 * (en `buildCsv` y `writeCsvStream` todo `string` ya pasa por la guarda).
 */
export function csvText(text: string | null | undefined): string {
  return csvFormulaGuard(text ?? '')
}

/** Una celda tipada, escapada para el separador. */
export function csvCell(cell: CsvCell, separator: CsvSeparator = ';'): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'string') return csvEscape(csvFormulaGuard(cell), separator)
  if (typeof cell === 'number' || typeof cell === 'bigint') {
    return csvEscape(csvNumber(cell).csv, separator)
  }
  return csvEscape(cell.csv, separator)
}

/** Una fila de celdas tipadas. */
export function csvRow(cells: ReadonlyArray<CsvCell>, separator: CsvSeparator = ';'): string {
  return cells.map((cell) => csvCell(cell, separator)).join(separator)
}

/**
 * El CSV entero en memoria, con celdas tipadas. Los encabezados también pasan
 * por la guarda (son texto). Lo que no se pide en `opts` sale como Excel es-AR
 * (`;`, BOM, CRLF).
 */
export function buildCsv(
  headers: ReadonlyArray<string>,
  rows: Iterable<ReadonlyArray<CsvCell>>,
  opts: CsvOptions = {},
): string {
  const { separator, bom, eol } = excelOptions(opts)
  const lines = [csvRow(headers, separator)]
  for (const row of rows) lines.push(csvRow(row, separator))
  const body = lines.join(eol)
  return bom ? `${BOM}${body}` : body
}

function isAsyncIterable<T>(value: Iterable<T> | AsyncIterable<T>): value is AsyncIterable<T> {
  return typeof (value as Partial<AsyncIterable<T>>)[Symbol.asyncIterator] === 'function'
}

/** Cuánto texto se junta antes de mandar un pedazo del stream. */
const STREAM_CHUNK_CHARS = 64 * 1024

/**
 * El CSV como `ReadableStream` de bytes UTF-8, fila por fila, para un Route
 * Handler que pagina en la base (Sprint 1 F.15: páginas de 500 con cursor). Las
 * filas pueden venir de un generador asíncrono: se piden recién cuando el
 * cliente consume, así un libro de 200.000 líneas no se arma entero en memoria.
 * Da el mismo texto que `buildCsv` con las mismas filas y opciones. Si la fuente
 * falla, el stream termina con ese error (no se manda un CSV cortado como si
 * estuviera completo).
 */
export function writeCsvStream(
  headers: ReadonlyArray<string>,
  rows: Iterable<ReadonlyArray<CsvCell>> | AsyncIterable<ReadonlyArray<CsvCell>>,
  opts: CsvOptions = {},
): ReadableStream<Uint8Array> {
  const { separator, bom, eol } = excelOptions(opts)
  const encoder = new TextEncoder()
  const iterator: Iterator<ReadonlyArray<CsvCell>> | AsyncIterator<ReadonlyArray<CsvCell>> =
    isAsyncIterable(rows) ? rows[Symbol.asyncIterator]() : rows[Symbol.iterator]()
  let pending: string | null = `${bom ? BOM : ''}${csvRow(headers, separator)}`

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        let chunk = pending ?? ''
        pending = null
        while (chunk.length < STREAM_CHUNK_CHARS) {
          const next = await iterator.next()
          if (next.done) {
            if (chunk) controller.enqueue(encoder.encode(chunk))
            controller.close()
            return
          }
          chunk += `${eol}${csvRow(next.value, separator)}`
        }
        controller.enqueue(encoder.encode(chunk))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      await iterator.return?.(reason)
    },
  })
}
