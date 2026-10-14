/**
 * «Pegar los montos desde mi planilla»: lo pegado (concepto, monto y, si está,
 * vencimiento) se junta con el gasto fijo que se llama igual. Puro.
 *
 * No lee columnas por su cuenta: reusa `parseOpeningList`, el pegado de los
 * saldos iniciales, que ya está probado (primera columna el nombre, el primer
 * número es el monto, la fecha es el vencimiento; saltea encabezado, totales y
 * ceros). Acá solo se agrega lo que es propio de un gasto fijo: de la fecha
 * importa el DÍA, y la planilla de los socios trae «Vencimiento» antes que
 * «Monto», a veces como un número suelto («10»).
 *
 * No guarda nada: devuelve qué renglón se completa con qué. Lo prueba
 * `administracion-gastos-fijos-planilla.test.ts`.
 */

import { parseOpeningList } from '@/app/(manager)/[tenantSlug]/administracion/configurar/_lib/opening-import'
import { parseAmount } from '@/lib/imports/amounts'

export type PasteRow = { id: string; name: string }

export type PasteMatch = {
  id: string
  name: string
  amountCents: number
  /** El día del vencimiento, si vino (`null`: no se toca el día). */
  day: number | null
}

export type PasteResult = {
  matches: PasteMatch[]
  /** Gastos fijos de la planilla que no vinieron en lo pegado. */
  notInPaste: string[]
  /** Renglones pegados que no son ningún gasto fijo cargado. */
  notInSheet: string[]
}

const DAY_ONLY = /^(\d{1,2})$/
const DAY_MONTH = /^(\d{1,2})\s*[/-]\s*\d{1,2}$/
const NUMBER_LIKE = /^[\s$]*\d[\d.,\s]*$/

function dayOf(value: number): number | null {
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null
}

/** El día suelto que quedó en la columna de texto: «10» o «10/11». */
function dayFromText(text: string): number | null {
  const match = DAY_ONLY.exec(text.trim()) ?? DAY_MONTH.exec(text.trim())
  return match ? dayOf(Number(match[1])) : null
}

function amountFromText(text: string): number | null {
  if (!NUMBER_LIKE.test(text)) return null
  for (const mark of [',', '.'] as const) {
    const parsed = parseAmount(text, mark)
    if (parsed.ok && parsed.cents > 0) return parsed.cents
  }
  return null
}

/**
 * Lo pegado contra los gastos fijos de la pantalla. Si un nombre viene dos
 * veces, vale el primero.
 */
export function matchPastedAmounts(text: string, rows: readonly PasteRow[]): PasteResult {
  const parsed = parseOpeningList(
    text,
    rows.map((row) => ({ id: row.id, name: row.name, tradeName: null })),
    // Sin tope propio: lo que no coincide igual se informa.
    Number.MAX_SAFE_INTEGER,
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  const matches: PasteMatch[] = []
  const seen = new Set<string>()
  const notInSheet: string[] = []

  for (const line of parsed.lines) {
    if (line.partyId === null) {
      if (!notInSheet.includes(line.name)) notInSheet.push(line.name)
      continue
    }
    const row = byId.get(line.partyId)
    if (!row || seen.has(row.id)) continue
    seen.add(row.id)

    let amountCents = line.amountCents
    let day = line.dueDate ? dayOf(Number(line.dueDate.slice(8, 10))) : null
    if (day === null) {
      // «Vencimiento» como un número suelto ANTES del monto: el primer número era el día.
      const asDay = amountCents % 100 === 0 ? dayOf(amountCents / 100) : null
      const realAmount = asDay === null ? null : amountFromText(line.reference)
      if (asDay !== null && realAmount !== null && realAmount > 3100) {
        day = asDay
        amountCents = realAmount
      } else {
        day = dayFromText(line.reference)
      }
    }
    matches.push({ id: row.id, name: row.name, amountCents, day })
  }

  return {
    matches,
    notInPaste: rows.filter((row) => !seen.has(row.id)).map((row) => row.name),
    notInSheet,
  }
}

function listWords(names: readonly string[], max = 4): string {
  const shown = names.slice(0, max).join(', ')
  const rest = names.length - max
  return rest > 0 ? `${shown} y ${rest} más` : shown
}

/** Lo que se dice en vivo debajo del cuadro de pegado. */
export function pasteSummary(
  result: PasteResult,
  total: number,
): { headline: string; missing: string | null; extra: string | null } {
  const found = result.matches.length
  return {
    headline:
      found === 0
        ? 'Todavía no encontré ninguno con monto.'
        : `Encontré ${found} de ${total === 1 ? 'tu único gasto fijo' : `tus ${total}`}.`,
    missing:
      found > 0 && result.notInPaste.length > 0
        ? `No ${result.notInPaste.length === 1 ? 'vino' : 'vinieron'} en lo que pegaste: ${listWords(result.notInPaste)}.`
        : null,
    extra:
      result.notInSheet.length > 0
        ? `En lo que pegaste hay ${result.notInSheet.length} que no ${
            result.notInSheet.length === 1 ? 'está' : 'están'
          } en tu planilla: ${listWords(result.notInSheet)} (se agregan con «Pegar una lista»).`
        : null,
  }
}
