/**
 * La tanda de un aumento, pura: lo que se escribió, para poder deshacerlo entero. Vive en la
 * memoria de la pantalla y en `sessionStorage` (sobrevive a recargar la página mientras dure
 * la sesión del navegador), nunca en la base.
 *
 * «Deshacer» devuelve cada precio a lo que había, pero solo si sigue como lo dejó la tanda: si
 * alguien lo cambió después, ese no se toca y se avisa.
 */

import { bulkDoneSentence } from './bulk'
import type { ApplyPricesResult, PriceChange, PriceFailureReason, PriceWriteFailure } from './types'

export const BATCH_VERSION = 1
/** Cuántos nombres de los que fallaron se guardan para decirlos (el resto se cuenta). */
const MAX_FAILURE_NAMES = 30
/** Tope de lo que se lee del navegador: una tanda más grande que esto no la escribió esta pantalla. */
const MAX_STORED_CHANGES = 5_000

export type BatchFailure = { name: string; reason: PriceFailureReason }

export type PriceBatch = {
  v: typeof BATCH_VERSION
  id: string
  /** Cuándo se aplicó (reloj del dispositivo, ms). */
  at: number
  percentBp: number
  roundingCents: number
  /** Dónde se aplicó: vacío = toda la carta. */
  branchId: string | null
  branchName: string | null
  /** Productos que se pidió cambiar y los que de verdad cambiaron. */
  requested: number
  applied: number
  /** Solo lo que se escribió: es lo que «Deshacer» devuelve. */
  changes: PriceChange[]
  /** Los que no se pudieron cambiar, con nombre. */
  failures: BatchFailure[]
}

export function batchStorageKey(tenantSlug: string): string {
  return `hub_precios_tanda_${tenantSlug}`
}

/** La misma lista al revés: lo que quedó vuelve a lo que había. */
export function invertChanges(changes: ReadonlyArray<PriceChange>): PriceChange[] {
  return changes.map((change) => ({
    itemId: change.itemId,
    branchId: change.branchId,
    fromCents: change.toCents,
    toCents: change.fromCents,
  }))
}

/** Productos distintos en una lista de precios (un producto puede tener el de la carta y uno propio). */
export function countProducts(changes: ReadonlyArray<{ itemId: string }>): number {
  return new Set(changes.map((change) => change.itemId)).size
}

/**
 * Arma la tanda con lo que contestó el servidor. Un producto cuenta como cambiado si ninguno
 * de sus precios falló. `null` si no se escribió nada (no hay qué deshacer).
 */
export function buildBatch(args: {
  id: string
  at: number
  percentBp: number
  roundingCents: number
  branchId: string | null
  branchName: string | null
  requested: ReadonlyArray<PriceChange>
  result: Extract<ApplyPricesResult, { ok: true }>
  /** El nombre de un precio que falló: el producto y, si es propio, la sucursal. */
  nameOf: (failure: PriceWriteFailure) => string
}): PriceBatch | null {
  if (args.result.applied.length === 0) return null
  const requested = countProducts(args.requested)
  const failedProducts = countProducts(args.result.failed)
  return {
    v: BATCH_VERSION,
    id: args.id,
    at: args.at,
    percentBp: args.percentBp,
    roundingCents: args.roundingCents,
    branchId: args.branchId,
    branchName: args.branchName,
    requested,
    applied: Math.max(0, requested - failedProducts),
    changes: args.result.applied.map((change) => ({ ...change })),
    failures: args.result.failed
      .slice(0, MAX_FAILURE_NAMES)
      .map((failure) => ({ name: args.nameOf(failure), reason: failure.reason })),
  }
}

export function serializeBatch(batch: PriceBatch): string {
  return JSON.stringify(batch)
}

const REASONS: ReadonlySet<string> = new Set<PriceFailureReason>(['missing', 'changed', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isCentsOrNull = (value: unknown): value is number | null => value === null || isCount(value)

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

/**
 * Lee la tanda guardada en el navegador sin confiar en ella: cualquier cosa que no tenga la
 * forma exacta se descarta (un valor viejo, uno a medio escribir, uno tocado a mano).
 */
export function parseStoredBatch(raw: string | null | undefined): PriceBatch | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data) || data.v !== BATCH_VERSION) return null
  const { id, at, percentBp, roundingCents, branchId, branchName, requested, applied } = data
  if (typeof id !== 'string' || id === '') return null
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  if (typeof percentBp !== 'number' || !Number.isInteger(percentBp) || percentBp === 0) return null
  if (!isCount(roundingCents) || !isCount(requested) || !isCount(applied)) return null
  if (!isTextOrNull(branchId) || !isTextOrNull(branchName)) return null
  if (!Array.isArray(data.changes) || !Array.isArray(data.failures)) return null
  if (data.changes.length === 0 || data.changes.length > MAX_STORED_CHANGES) return null

  const changes: PriceChange[] = []
  for (const entry of data.changes) {
    if (!isRecord(entry) || typeof entry.itemId !== 'string' || entry.itemId === '') return null
    if (!isTextOrNull(entry.branchId)) return null
    if (!isCentsOrNull(entry.fromCents) || !isCentsOrNull(entry.toCents)) return null
    // El precio de la carta nunca está vacío: una fila así no la escribió esta pantalla.
    if (entry.branchId === null && (entry.fromCents === null || entry.toCents === null)) return null
    changes.push({
      itemId: entry.itemId,
      branchId: entry.branchId,
      fromCents: entry.fromCents,
      toCents: entry.toCents,
    })
  }

  const failures: BatchFailure[] = []
  for (const entry of data.failures) {
    if (!isRecord(entry) || typeof entry.name !== 'string') return null
    if (typeof entry.reason !== 'string' || !REASONS.has(entry.reason)) return null
    failures.push({ name: entry.name, reason: entry.reason as PriceFailureReason })
  }

  return {
    v: BATCH_VERSION,
    id,
    at,
    percentBp,
    roundingCents,
    branchId,
    branchName,
    requested,
    applied,
    changes,
    failures,
  }
}

// ─── Cómo se dice ────────────────────────────────────────────────────────────

/** «Bacon», «Bacon y Café», «Bacon, Café, Lomo y 3 más». */
export function joinNames(names: ReadonlyArray<string>, max = 4): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0] ?? ''
  if (names.length <= max) {
    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
  }
  return `${names.slice(0, max - 1).join(', ')} y ${names.length - (max - 1)} más`
}

/** «Aumentaste 46 productos un 10 %» (o «44 de 46» si alguno no se pudo). */
export function batchSentence(batch: PriceBatch): string {
  return bulkDoneSentence({
    applied: batch.applied,
    requested: batch.requested,
    percentBp: batch.percentBp,
    branchName: batch.branchName,
  })
}

/**
 * Qué pasó con los que no se pudieron cambiar y qué hacer. `null` si salieron todos.
 * Dice el porqué más útil: si alguien los cambió recién, eso; si no, que no se guardaron.
 */
export function batchFailureSentence(batch: PriceBatch): string | null {
  const missed = batch.requested - batch.applied
  if (missed <= 0) return null
  const names = joinNames(batch.failures.map((failure) => failure.name))
  const one = missed === 1
  const head = one ? 'Este no se pudo cambiar' : `Estos ${missed} no se pudieron cambiar`
  const reasons = new Set(batch.failures.map((failure) => failure.reason))
  const why =
    reasons.size === 1 && reasons.has('changed')
      ? one
        ? 'alguien lo cambió mientras armabas el aumento'
        : 'alguien los cambió mientras armabas el aumento'
      : reasons.size === 1 && reasons.has('missing')
        ? one
          ? 'ya no está en la carta'
          : 'ya no están en la carta'
        : one
          ? 'no se guardó'
          : 'no se guardaron'
  const fix = one ? 'Buscalo y cambialo a mano.' : 'Buscalos y cambialos a mano.'
  return names ? `${head}: ${names} (${why}). ${fix}` : `${head} (${why}). ${fix}`
}

/** Lo que pasó al deshacer: cuántos precios volvieron y cuántos se dejaron como están. */
export function undoSentence(args: { undone: number; total: number }): string {
  const { undone, total } = args
  if (undone >= total) {
    return total === 1
      ? 'Listo: el precio volvió a como estaba.'
      : `Listo: los ${total} precios volvieron a como estaban.`
  }
  const left = total - undone
  const rest =
    left === 1
      ? 'El otro cambió después y quedó como está.'
      : `Los otros ${left} cambiaron después y quedaron como están.`
  if (undone === 0) {
    return total === 1
      ? 'No se deshizo: el precio cambió después y quedó como está.'
      : 'No se deshizo nada: esos precios cambiaron después y quedaron como están.'
  }
  return `Volvieron ${undone} de ${total} precios. ${rest}`
}
