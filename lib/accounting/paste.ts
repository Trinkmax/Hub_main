/**
 * Lo que se pega desde Thinkeon (o desde una planilla) en los formularios de
 * Administración (Sprint 1, H.6 y H.9):
 *
 * - `parsePastedColumn`: una columna de importes del cierre de caja → un valor
 *   por medio de cobro, en orden. Pegada en el primer campo, se reparte hacia
 *   abajo (meta del cierre del día: menos de un minuto).
 * - `parseVoucherNumber`: «0003-00001290» → punto de venta y número.
 * - `parseRange`: «0003-00014501 a 0003-00014662» → la fila facturada del cierre.
 *
 * Los dos últimos viven en `@/lib/fiscal` (los usa también CodeField del kit):
 * acá se reexportan con la forma que esperan los formularios contables.
 * La plata pasa SIEMPRE por `parseMoneyToCents` (sin flotantes).
 */

import {
  parseVoucherNumber,
  parseVoucherRange,
  VOUCHER_RANGE_MESSAGES,
  type VoucherRangeIssue,
} from '@/lib/fiscal'
import { moneyParseMessage, parseMoneyToCents } from '@/lib/money'
import type { Cents } from './types'

export { parseVoucherNumber, type VoucherNumber } from '@/lib/fiscal'

export type PastedCellError = {
  /** Fila de lo pegado, desde 0 (la del primer medio). */
  index: number
  /** Lo que había en la fila, para mostrarlo junto al error. */
  raw: string
  message: string
}

export type PastedColumn = {
  /** Un valor por fila: centavos, o `null` si la fila estaba vacía (ese medio no tuvo ventas). */
  values: Array<Cents | null>
  errors: PastedCellError[]
}

/** Celdas que en un cierre significan «nada»: vacío o solo guiones («-», «—»). */
function isBlankCell(cell: string): boolean {
  return /^[\s\-–—]*$/.test(cell)
}

/**
 * Una columna copiada de Thinkeon o de Excel → importes en centavos.
 *
 * - Una fila por línea (`\n`, `\r\n` o `\r`); las líneas vacías del final (el
 *   salto que agrega el portapapeles) no cuentan, las del medio sí: un medio sin
 *   ventas queda vacío y el resto no se corre.
 * - Si una fila trae varias celdas separadas por tab («Efectivo⇥$ 350.000,00»),
 *   se toma la última que se lee como importe (el monto va a la derecha). Una
 *   etiqueta con el importe vacío o con un guion («Rappi⇥-») es un medio sin ventas.
 * - Acepta «$», miles con punto o con coma y decimales (las reglas de
 *   `parseMoneyToCents`). Un negativo o algo ilegible es un error de esa fila,
 *   con el mensaje del campo de plata.
 */
export function parsePastedColumn(text: string): PastedColumn {
  const lines = text.split(/\r\n|\r|\n/)
  while (lines.length > 0 && isBlankCell(lines[lines.length - 1] ?? '')) lines.pop()

  const values: Array<Cents | null> = []
  const errors: PastedCellError[] = []
  lines.forEach((line, index) => {
    const rawCells = line.split('\t')
    const cells = rawCells.filter((cell) => !isBlankCell(cell))
    // Fila vacía, o etiqueta con el importe vacío («Rappi⇥» o «Rappi⇥-»): ese medio no tuvo ventas.
    if (
      cells.length === 0 ||
      (rawCells.length > 1 && isBlankCell(rawCells[rawCells.length - 1] ?? ''))
    ) {
      values.push(null)
      return
    }
    let parsed: Cents | null = null
    for (let i = cells.length - 1; i >= 0; i--) {
      const result = parseMoneyToCents(cells[i])
      if (result.ok) {
        parsed = result.cents
        break
      }
    }
    if (parsed !== null) {
      values.push(parsed)
      return
    }
    // Ninguna celda se lee: el error es el de la última (la que debería tener el monto).
    const last = cells[cells.length - 1] ?? ''
    const failure = parseMoneyToCents(last)
    values.push(null)
    errors.push({
      index,
      raw: line.trim(),
      message: failure.ok ? 'No pudimos leer el importe.' : moneyParseMessage(failure, last),
    })
  })
  return { values, errors }
}

/** ¿Lo pegado es una columna (más de una fila) y no un solo importe? */
export function isPastedColumn(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => !isBlankCell(l))
  return lines.length > 1
}

export type RangeParse =
  | { ok: true; pointOfSale: number; from: number; to: number; count: number }
  | { ok: false; reason: VoucherRangeIssue; message: string }

/**
 * «0003-00014501 a 0003-00014662» → `{ pointOfSale: 3, from: 14501, to: 14662,
 * count: 162 }`. También «a 00014662» (sin punto de venta en el «hasta»),
 * «al», «hasta», «..» o un guion con espacios. Con el mensaje listo si no se lee.
 */
export function parseRange(text: string | null | undefined): RangeParse {
  const result = parseVoucherRange(text)
  if (result.ok) return result
  return { ok: false, reason: result.reason, message: VOUCHER_RANGE_MESSAGES[result.reason] }
}

/** Pegar «0003-00001290» en el campo del punto de venta separa los dos campos. */
export function splitPastedVoucher(text: string): { pointOfSale: number; number: number } | null {
  return parseVoucherNumber(text)
}
