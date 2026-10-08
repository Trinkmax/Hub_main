/**
 * «Contanos qué es cada columna» (diseño §4.3.2): cuando el extracto del banco
 * viene con títulos que no reconocemos, la persona dice qué es cada columna una
 * vez; el mapeo se guarda con la firma de los títulos (`acc_import_layouts`) y
 * la próxima vez se reconoce solo.
 *
 * Puro: arma la vista previa, la primera sugerencia, valida lo elegido y busca
 * un mapeo guardado que calce con el archivo.
 */

import {
  BANK_COLUMNS,
  BANK_HEADER_RULES,
  type BankColumn,
  type BankLayout,
  candidateSignatures,
  isBankHeader,
  mappingToLayout,
} from '@/lib/imports/bank/statement'
import { classifyHeader } from '@/lib/imports/headers'
import type { Cell } from '@/lib/imports/types'

/** Un mapeo guardado, tal como llega de `listImportLayouts`. */
export type SavedLayout = {
  id: string
  signature: string
  mapping: Record<string, unknown>
}

/**
 * Si alguna de las primeras filas tiene la firma de un formato guardado, ese
 * mapeo, con la fila de títulos donde se encontró (el banco puede agregar o
 * sacar renglones arriba de los títulos).
 */
export function findSavedLayout(
  rows: readonly (readonly Cell[])[],
  signatureDelimiter: string,
  layouts: readonly SavedLayout[],
): { layout: BankLayout; layoutId: string } | null {
  if (layouts.length === 0) return null
  const bySignature = new Map(layouts.map((l) => [l.signature, l]))
  for (const candidate of candidateSignatures(rows, signatureDelimiter)) {
    const saved = bySignature.get(candidate.signature)
    if (!saved) continue
    const layout = mappingToLayout(saved.mapping)
    if (layout) return { layout: { ...layout, headerRow: candidate.index }, layoutId: saved.id }
  }
  return null
}

function cellText(c: Cell | undefined): string {
  if (c === null || c === undefined) return ''
  return String(c).replace(/\s+/g, ' ').trim()
}

/** Las filas que se pueden elegir como «la de los títulos» (con al menos dos celdas). */
export function headerRowOptions(
  rows: readonly (readonly Cell[])[],
  maxScan = 40,
): Array<{ index: number; preview: string }> {
  const out: Array<{ index: number; preview: string }> = []
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = (rows[i] ?? []).map(cellText).filter((c) => c !== '')
    if (cells.length < 2) continue
    const preview = cells.slice(0, 4).join(' · ')
    out.push({ index: i, preview: preview.length > 80 ? `${preview.slice(0, 79)}…` : preview })
  }
  return out
}

export type MappingPreview = {
  /** Una entrada por columna: el título del archivo (o «Columna N»). */
  columns: Array<{ index: number; title: string }>
  /** Las primeras filas debajo de los títulos, como texto. */
  sample: string[][]
}

/** Los títulos y las primeras `max` filas, para ver qué hay en cada columna. */
export function mappingPreview(
  rows: readonly (readonly Cell[])[],
  headerRow: number,
  max = 8,
): MappingPreview {
  const header = rows[headerRow] ?? []
  const body: string[][] = []
  for (let i = headerRow + 1; i < rows.length && body.length < max; i++) {
    const cells = (rows[i] ?? []).map(cellText)
    if (cells.every((c) => c === '')) continue
    body.push(cells)
  }
  const width = Math.max(header.length, ...body.map((r) => r.length), 0)
  // Sin las columnas vacías del final (títulos y muestra en blanco).
  let used = width
  while (
    used > 0 &&
    cellText(header[used - 1]) === '' &&
    body.every((r) => (r[used - 1] ?? '') === '')
  ) {
    used--
  }
  const columns = Array.from({ length: used }, (_, index) => {
    const title = cellText(header[index])
    return { index, title: title === '' ? `Columna ${index + 1}` : title }
  })
  return { columns, sample: body.map((r) => columns.map((c) => r[c.index] ?? '')) }
}

/** Qué es cada columna: índice → columna canónica (o nada). */
export type ColumnAssignment = Readonly<Record<number, BankColumn | null>>

/** La primera sugerencia: lo que reconocen los sinónimos de los títulos. */
export function guessAssignment(
  rows: readonly (readonly Cell[])[],
  headerRow: number,
): Record<number, BankColumn | null> {
  const out: Record<number, BankColumn | null> = {}
  const taken = new Set<BankColumn>()
  ;(rows[headerRow] ?? []).forEach((cell, j) => {
    const key = classifyHeader(cell, BANK_HEADER_RULES)
    if (key !== null && !taken.has(key)) {
      out[j] = key
      taken.add(key)
    } else {
      out[j] = null
    }
  })
  return out
}

/** Elegido → columnas del mapeo (si una columna canónica se eligió dos veces, vale la primera). */
export function assignmentColumns(
  assignment: ColumnAssignment,
): Partial<Record<BankColumn, number>> {
  const columns: Partial<Record<BankColumn, number>> = {}
  const indexes = Object.keys(assignment)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b)
  for (const j of indexes) {
    const key = assignment[j]
    if (key && columns[key] === undefined) columns[key] = j
  }
  return columns
}

/** Lo que falta o sobra en lo elegido, en palabras (vacío = se puede usar). */
export function mappingProblems(assignment: ColumnAssignment): string[] {
  const problems: string[] = []
  const chosen = Object.values(assignment).filter((v): v is BankColumn => v !== null)
  const columns = assignmentColumns(assignment)
  if (columns.date === undefined) problems.push('Falta elegir la columna de la fecha.')
  if (columns.description === undefined)
    problems.push('Falta elegir la columna de la descripción o el concepto.')
  const hasAmount = columns.amount !== undefined
  const hasBoth = columns.debit !== undefined && columns.credit !== undefined
  if (!hasAmount && !hasBoth) {
    problems.push(
      columns.debit !== undefined || columns.credit !== undefined
        ? 'Elegiste solo una de Débito o Crédito: marcá las dos, o una columna de Importe.'
        : 'Falta elegir dónde está la plata: una columna de Importe, o Débito y Crédito.',
    )
  }
  const repeated = BANK_COLUMNS.filter((c) => chosen.filter((x) => x === c).length > 1)
  if (repeated.length > 0) problems.push('Hay dos columnas con lo mismo: dejá una sola.')
  return problems
}

/** El mapeo elegido como `BankLayout` (o `null` si todavía no alcanza). */
export function layoutFromAssignment(
  headerRow: number,
  assignment: ColumnAssignment,
  dateOrder: 'dmy' | 'mdy',
): BankLayout | null {
  if (mappingProblems(assignment).length > 0) return null
  const columns = assignmentColumns(assignment)
  if (!isBankHeader(columns)) return null
  return { headerRow, columns, decimal: null, dateOrder }
}
