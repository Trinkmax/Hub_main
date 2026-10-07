/**
 * Numeración de asientos (Sprint 1, C.5.3), espejo de la SQL para la paridad.
 *
 * - **Definitiva:** la congela el cierre de cada período, siguiendo la del
 *   período anterior del ejercicio, en el orden `(entry_date, order_key,
 *   posting_seq)`. N° 1 = apertura (la real del primer ejercicio o la espejo de
 *   los siguientes).
 * - **Provisoria** (períodos abiertos): `acc_entry_number_base(ejercicio) +
 *   row_number()` sobre TODOS los asientos vigentes sin número del ejercicio,
 *   en el mismo orden (no sobre el rango filtrado: no cambia según el filtro).
 * - Anular en un período abierto no deja huecos (el anulado no cuenta) y
 *   reabrir el último mes vuelve sus números a provisorios.
 *
 * Puro: recibe filas ya leídas.
 */

import type { EntryKind, IsoDate } from './types'

/**
 * `acc_journal_entries.order_key` (columna generada): la apertura va primero
 * en su día, la liquidación de IVA después de lo del día, y los asientos del
 * cierre de ejercicio al final (ajustes 7, refundición 8, cierre espejo 9).
 */
export function entryOrderKey(kind: EntryKind): number {
  switch (kind) {
    case 'opening':
    case 'fy_opening':
      return 0
    case 'iva_settlement':
      return 6
    case 'fy_adjustment':
      return 7
    case 'fy_result':
      return 8
    case 'fy_closing':
      return 9
    default:
      return 5
  }
}

export type NumberingEntry = {
  id: string
  entryDate: IsoDate
  /** `order_key`; si falta se calcula desde `kind`. */
  orderKey?: number
  kind?: EntryKind
  /** Orden de carga global (identidad): desempata. */
  postingSeq: number
  /** Número congelado, o `null` mientras su período está abierto. */
  number: number | null
  status: 'posted' | 'voided'
}

function orderKeyOf(e: NumberingEntry): number {
  if (e.orderKey !== undefined) return e.orderKey
  return e.kind ? entryOrderKey(e.kind) : 5
}

/** Orden del diario: `(entry_date, order_key, posting_seq)`. */
export function compareEntryOrder(a: NumberingEntry, b: NumberingEntry): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1
  const ka = orderKeyOf(a)
  const kb = orderKeyOf(b)
  if (ka !== kb) return ka - kb
  return a.postingSeq - b.postingSeq
}

export type NumberBaseInput = {
  /** El mayor número congelado del ejercicio, o `null` si todavía no hay ninguno. */
  maxFrozenNumber: number | null
  /** `acc_fiscal_years.opening_number_reserved`: el N° 1 es de la apertura. */
  openingNumberReserved: boolean
  /** ¿Ya hay una apertura vigente (`opening` o `fy_opening`) en el ejercicio? */
  hasPostedOpening: boolean
}

/**
 * `acc_entry_number_base`: último número congelado; si no hay ninguno, 1 si el
 * N° 1 está reservado para una apertura que todavía no existe, si no 0.
 */
export function entryNumberBase(input: NumberBaseInput): number {
  if (input.maxFrozenNumber !== null) return input.maxFrozenNumber
  return input.openingNumberReserved && !input.hasPostedOpening ? 1 : 0
}

/** La base calculada desde los asientos del ejercicio (todos, con o sin número). */
export function entryNumberBaseFor(
  entries: readonly NumberingEntry[],
  openingNumberReserved: boolean,
): number {
  let maxFrozen: number | null = null
  let hasPostedOpening = false
  for (const e of entries) {
    if (e.number !== null && (maxFrozen === null || e.number > maxFrozen)) maxFrozen = e.number
    if (e.status === 'posted' && (e.kind === 'opening' || e.kind === 'fy_opening')) {
      hasPostedOpening = true
    }
  }
  return entryNumberBase({ maxFrozenNumber: maxFrozen, openingNumberReserved, hasPostedOpening })
}

export type AssignedNumber = { number: number; provisional: boolean }

/**
 * Número de cada asiento vigente del ejercicio: el congelado si lo tiene; si
 * no, `base + posición` entre los vigentes sin número, en el orden del diario.
 * Los anulados no llevan número (ni dejan hueco).
 */
export function assignEntryNumbers(
  entries: readonly NumberingEntry[],
  base: number,
): Map<string, AssignedNumber> {
  const out = new Map<string, AssignedNumber>()
  const pending: NumberingEntry[] = []
  for (const e of entries) {
    if (e.status !== 'posted') continue
    if (e.number !== null) out.set(e.id, { number: e.number, provisional: false })
    else pending.push(e)
  }
  pending.sort(compareEntryOrder)
  pending.forEach((e, i) => {
    out.set(e.id, { number: base + i + 1, provisional: true })
  })
  return out
}

/**
 * Lo que congela `acc_close_period` (C.5.1 paso 6): `base + row_number()`
 * sobre los asientos vigentes sin número del período que se cierra.
 * Devuelve `id → número` y el rango `number_from`/`number_to` (null si el
 * período no tuvo asientos sin número).
 */
export function freezePeriodNumbers(
  periodEntries: readonly NumberingEntry[],
  base: number,
): { numbers: Map<string, number>; numberFrom: number | null; numberTo: number | null } {
  const pending = periodEntries
    .filter((e) => e.status === 'posted' && e.number === null)
    .sort(compareEntryOrder)
  const numbers = new Map<string, number>()
  pending.forEach((e, i) => {
    numbers.set(e.id, base + i + 1)
  })
  return {
    numbers,
    numberFrom: pending.length > 0 ? base + 1 : null,
    numberTo: pending.length > 0 ? base + pending.length : null,
  }
}
