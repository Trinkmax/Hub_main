/**
 * «Cargar una lista» de los saldos iniciales (pedido de los socios,
 * 12/10/2026): las deudas con proveedores pegadas desde una planilla —
 * proveedor y monto, y si están, vencimiento y comprobante. Puro: lo prueba
 * `administracion-apertura-lista.test.ts`.
 */

import { partyNameKey } from '@/lib/accounting/party-profile'
import { detectDecimalMark, parseAmount } from '@/lib/imports/amounts'
import { toIsoDay } from '@/lib/imports/dates'

/** El asiento de apertura lleva hasta 200 deudas (`openingSchema`). */
export const OPENING_ITEMS_MAX = 200
const REFERENCE_MAX = 60
const NAME_MAX = 120

export type OpeningImportParty = { id: string; name: string; tradeName: string | null }

export type OpeningImportLine = {
  /** Renglón del texto pegado (desde 1). */
  line: number
  name: string
  amountCents: number
  dueDate: string | null
  reference: string
  /** El proveedor ya cargado; `null` si hay que crearlo. */
  partyId: string | null
}

export type OpeningImportSkipReason = 'no_amount' | 'negative' | 'name'

export type OpeningImportResult = {
  lines: OpeningImportLine[]
  /** Nombres sin proveedor cargado, sin repetir y como vinieron escritos. */
  missing: string[]
  /** Renglones que no se cargan y por qué (el nombre, para avisarlo). */
  skipped: Array<{ line: number; name: string; reason: OpeningImportSkipReason }>
  /** Renglones con saldo en cero: no son una deuda y no se avisan uno por uno. */
  zeros: number
  /** Deudas que no entran porque el asiento ya llega al tope. */
  overflow: number
  totalCents: number
}

const NUMBER_CELL = /^[\s$()+\-−]*\d[\d.,\s]*[\s$()\-−]*$/
const DATE_CELL = /^\d{1,4}[/-]\d{1,2}[/-]\d{2,4}$|^\d{1,2}[\s/-]+[a-záéíóú]{3,}\.?[\s/-]+\d{2,4}$/i
const TOTAL_ROW = /^(sub)?total(es)?\b|^suma\b|^saldo total\b/
/** «Coca Cola 150.000», «Coca Cola: $ 150.000»: sin columnas, el monto es lo último. */
const TRAILING_AMOUNT = /^(.*?\S)[\s:–—-]+(\$?\s*\(?[-−]?\d[\d.,]*\)?)$/

/** Un renglón → sus columnas: tabulaciones (copiado de una planilla) o `;`. */
function cellsOf(raw: string): string[] {
  const text = raw.replace(/ /g, ' ')
  const cells = text.includes('\t')
    ? text.split('\t')
    : text.includes(';')
      ? text.split(';')
      : (TRAILING_AMOUNT.exec(text.trim())?.slice(1, 3) ?? [text])
  return cells.map((c) => c.replace(/\s+/g, ' ').trim())
}

/**
 * Lo pegado → las deudas a cargar. La primera columna es el proveedor; de las
 * demás, la primera que es un número es el monto, la que es una fecha es el
 * vencimiento y el primer texto es el comprobante. Se saltean el encabezado,
 * los totales y los saldos en cero.
 *
 * `room`: cuántas deudas más entran en el asiento (las que no, van a `overflow`).
 */
export function parseOpeningList(
  text: string,
  parties: readonly OpeningImportParty[],
  room = OPENING_ITEMS_MAX,
): OpeningImportResult {
  const byKey = new Map<string, string>()
  for (const p of parties) {
    for (const name of [p.name, p.tradeName]) {
      const key = name ? partyNameKey(name) : ''
      if (key && !byKey.has(key)) byKey.set(key, p.id)
    }
  }

  const rows = text
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, cells: cellsOf(raw) }))
    .filter((r) => r.cells.some((c) => c !== ''))
  // Un separador decimal para toda la lista: «1.500» es mil quinientos salvo
  // que el resto de los montos diga otra cosa. Sin pistas, la coma (es-AR).
  const mark =
    detectDecimalMark(rows.flatMap((r) => r.cells.slice(1)).filter((c) => NUMBER_CELL.test(c))) ??
    ','

  const out: OpeningImportResult = {
    lines: [],
    missing: [],
    skipped: [],
    zeros: 0,
    overflow: 0,
    totalCents: 0,
  }
  const missingKeys = new Set<string>()

  for (const [index, row] of rows.entries()) {
    const cells = row.cells.filter((c) => c !== '')
    const name = cells[0] ?? ''
    let amount: number | null = null
    let dueDate: string | null = null
    let reference = ''
    for (const cell of cells.slice(1)) {
      if (dueDate === null && DATE_CELL.test(cell)) {
        const iso = toIsoDay(cell)
        if (iso) {
          dueDate = iso
          continue
        }
      }
      if (amount === null && NUMBER_CELL.test(cell)) {
        const parsed = parseAmount(cell, mark)
        if (parsed.ok) {
          amount = parsed.cents
          continue
        }
      }
      if (reference === '') reference = cell.slice(0, REFERENCE_MAX)
    }

    const key = partyNameKey(name)
    if (TOTAL_ROW.test(key)) continue
    if (amount === null) {
      // El primer renglón sin monto es el encabezado de la planilla.
      if (index > 0) out.skipped.push({ line: row.line, name, reason: 'no_amount' })
      continue
    }
    if (amount === 0) {
      out.zeros += 1
      continue
    }
    if (amount < 0) {
      out.skipped.push({ line: row.line, name, reason: 'negative' })
      continue
    }
    if (name.length < 2 || name.length > NAME_MAX || NUMBER_CELL.test(name)) {
      out.skipped.push({ line: row.line, name, reason: 'name' })
      continue
    }
    if (out.lines.length >= room) {
      out.overflow += 1
      continue
    }

    const partyId = byKey.get(key) ?? null
    if (partyId === null && !missingKeys.has(key)) {
      missingKeys.add(key)
      out.missing.push(name)
    }
    out.lines.push({ line: row.line, name, amountCents: amount, dueDate, reference, partyId })
    out.totalCents += amount
  }
  return out
}

/** Le pone el proveedor a los renglones que no lo tenían (los recién creados). */
export function resolveOpeningLines(
  lines: readonly OpeningImportLine[],
  parties: readonly OpeningImportParty[],
): OpeningImportLine[] {
  const byKey = new Map(parties.map((p) => [partyNameKey(p.name), p.id]))
  return lines.map((l) =>
    l.partyId === null ? { ...l, partyId: byKey.get(partyNameKey(l.name)) ?? null } : l,
  )
}
