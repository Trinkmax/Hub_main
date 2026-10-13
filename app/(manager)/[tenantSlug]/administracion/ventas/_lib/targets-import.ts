/**
 * «Cargar una lista» de los objetivos de un mes (pedido de los socios,
 * 12/10/2026): se pega la columna «Objetivo» de la planilla, un monto por
 * renglón, y el primer renglón es el día 1. Puro: lo prueba
 * `administracion-proyeccion.test.ts`.
 */

import { MAX_CENTS } from '@/lib/accounting/schemas'
import { daysInMonth, toIsoDay } from '@/lib/dates'
import { detectDecimalMark, parseAmount } from '@/lib/imports/amounts'

export type TargetsImportItem = {
  day: string
  /** `null`: ese día queda sin objetivo (renglón vacío o en cero). */
  targetCents: number | null
}

export type TargetsImportResult = {
  /** Un ítem por renglón que se entiende, hasta el último día del mes. */
  items: TargetsImportItem[]
  /** Días que quedan con objetivo y cuánto suman. */
  withTarget: number
  totalCents: number
  /** Días que quedan sin objetivo (renglón vacío o en cero). */
  cleared: number
  /** Renglones que no se entienden: no se cargan y ese día queda como estaba. */
  invalid: Array<{ line: number; day: string; text: string }>
  /** Renglones que sobran: el mes no tiene tantos días. */
  overflow: number
  /** El primer renglón era el título de la columna («Objetivo») y se salteó. */
  headerSkipped: boolean
}

const NUMBER_CELL = /^[\s$()+\-−]*\d[\d.,\s]*[\s$()\-−]*$/

/** El monto de un renglón: su última columna con algo (si se copió más de una). */
function amountCell(raw: string): string {
  const text = raw.replace(/\u00a0/g, ' ')
  const cells = (text.includes('\t') ? text.split('\t') : text.split(';'))
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter((c) => c !== '')
  return cells.at(-1) ?? ''
}

/**
 * Lo pegado → el objetivo de cada día de `month` (`yyyy-MM`). El renglón 1 es
 * el día 1; un renglón vacío en el medio deja ese día sin objetivo, y los que
 * no se pegan (la lista es más corta que el mes) quedan como estaban.
 */
export function parseTargetsList(text: string, month: string): TargetsImportResult {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const monthDays = daysInMonth(year, monthNumber)

  const lines = text.split(/\r?\n/).map(amountCell)
  // Lo vacío del final no cuenta: es el salto de línea que deja copiar de una planilla.
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  // El título de la columna, si vino: el primer renglón con letras y sin números.
  const first = lines[0] ?? ''
  const headerSkipped = first !== '' && !/\d/.test(first)
  if (headerSkipped) lines.shift()

  // Un separador decimal para toda la lista («1.500» es mil quinientos salvo que el
  // resto diga otra cosa). Sin pistas, la coma (es-AR).
  const mark = detectDecimalMark(lines.filter((l) => NUMBER_CELL.test(l))) ?? ','

  const out: TargetsImportResult = {
    items: [],
    withTarget: 0,
    totalCents: 0,
    cleared: 0,
    invalid: [],
    overflow: 0,
    headerSkipped,
  }
  for (const [index, cell] of lines.entries()) {
    if (index >= monthDays) {
      if (cell !== '') out.overflow += 1
      continue
    }
    const day = toIsoDay(year, monthNumber, index + 1)
    const line = index + 1 + (headerSkipped ? 1 : 0)
    if (cell === '') {
      out.items.push({ day, targetCents: null })
      out.cleared += 1
      continue
    }
    const parsed = NUMBER_CELL.test(cell) ? parseAmount(cell, mark) : null
    if (!parsed?.ok || parsed.cents < 0 || parsed.cents > MAX_CENTS) {
      out.invalid.push({ line, day, text: cell.slice(0, 40) })
      continue
    }
    if (parsed.cents === 0) {
      out.items.push({ day, targetCents: null })
      out.cleared += 1
      continue
    }
    out.items.push({ day, targetCents: parsed.cents })
    out.withTarget += 1
    out.totalCents += parsed.cents
  }
  return out
}
