/**
 * CSV y TXT con separador: detectar el separador y partir en filas
 * (`arca-mis-comprobantes.md` §9.1, `banco.md` §3.2, `mercadopago.md` §2.8).
 *
 * El parser sigue RFC 4180 y es tolerante donde los exportes reales se apartan:
 * - comillas dobles para encerrar un campo (con el separador o saltos de línea
 *   adentro) y `""` para una comilla literal;
 * - CRLF, LF y CR solos como fin de fila;
 * - una comilla en medio de un campo sin comillas es literal (Mercado Pago manda
 *   `[{"amount":-90.00,…}]` sin encerrar en los reportes con `;`);
 * - después de cerrar las comillas, lo que siga hasta el separador se agrega;
 * - espacios antes de la comilla de apertura se descartan (`a; "b;c"`).
 *
 * Las líneas en blanco quedan como `['']`, así el índice + 1 de cada fila es su
 * número de línea (salvo campos con saltos de línea adentro): los avisos dicen
 * «fila 14» y la persona la encuentra en el archivo.
 */

import type { Delimiter } from './types'

export const DELIMITERS: readonly Delimiter[] = [';', ',', '\t', '|']

/** Parte el texto en filas de campos. Ver el encabezado del archivo. */
export function parseCsv(text: string, delim: Delimiter | string, maxRows = Infinity): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  /** ¿Lo que hay en `field` es solo espacio previo a una posible comilla de apertura? */
  let onlyBlank = true
  const n = text.length
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  const endField = () => {
    row.push(field)
    field = ''
    onlyBlank = true
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  for (; i < n; i++) {
    const c = text[i] as string
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === delim) {
      endField()
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRow()
      if (rows.length >= maxRows) return rows
    } else if (c === '"' && onlyBlank) {
      inQuotes = true
      field = ''
      onlyBlank = false
    } else {
      field += c
      if (onlyBlank && c !== ' ' && c !== '\t') onlyBlank = false
    }
  }
  // Última fila sin salto de línea al final (o un campo con comillas sin cerrar).
  if (field !== '' || row.length > 0 || inQuotes) endRow()
  return rows
}

/**
 * Elige el separador mirando las primeras filas: para cada candidato parte el
 * texto y se queda con el que da la cantidad de columnas más estable (la moda,
 * y cuántas filas la tienen). Así ganan `;` en los CSV de ARCA aunque los
 * importes traigan coma decimal, y `,` en el reporte de Mercado Pago aunque el
 * JSON de impuestos tenga comas adentro (va entre comillas). También sirve con
 * una sola línea (la de títulos): gana el que más campos da, como el prototipo.
 *
 * Sin ningún separador (una sola columna) devuelve `;`.
 */
export function sniffDelimiter(sample: string, maxRows = 40): Delimiter {
  let best: { delim: Delimiter; agree: number; columns: number } = {
    delim: ';',
    agree: 0,
    columns: 1,
  }
  for (const delim of DELIMITERS) {
    const rows = parseCsv(sample, delim, maxRows).filter((r) => r.length > 1 || (r[0] ?? '') !== '')
    const counts = new Map<number, number>()
    for (const r of rows) if (r.length > 1) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)
    let modeColumns = 1
    let modeAgree = 0
    for (const [columns, agree] of counts) {
      if (agree > modeAgree || (agree === modeAgree && columns > modeColumns)) {
        modeColumns = columns
        modeAgree = agree
      }
    }
    if (
      modeAgree > best.agree ||
      (modeAgree === best.agree && modeAgree > 0 && modeColumns > best.columns)
    ) {
      best = { delim, agree: modeAgree, columns: modeColumns }
    }
  }
  return best.delim
}

/** ¿La fila está vacía (sin celdas o con todas en blanco)? */
export function isBlankRow(row: readonly unknown[] | undefined): boolean {
  if (!row) return true
  for (const cell of row) {
    if (cell === null || cell === undefined) continue
    if (typeof cell === 'string' && cell.trim() === '') continue
    return false
  }
  return true
}
