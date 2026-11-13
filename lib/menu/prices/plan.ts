/**
 * El viaje de un cambio de precios a la base, puro.
 *
 * Los precios se cambian con UNA sola operación (`menu_apply_price_changes`, en la base): entra entera
 * o no entra. La base es la que decide, precio por precio, con lo que hay en ese instante:
 *
 * - si el producto ya no está (o es de otro bar) → no se cambia (`missing`);
 * - si ya vale lo que se pidió → no hay nada que escribir (ni se aplica ni falla);
 * - si vale otra cosa que la que la persona estaba viendo → no se pisa (`changed`): dos socios
 *   cambiando precios a la vez no se borran el trabajo sin enterarse;
 * - si no, se escribe.
 *
 * Antes esa cuenta se hacía acá, leyendo primero y escribiendo después en decenas de idas a la base:
 * si una fallaba por la mitad, la carta quedaba a medio aumentar. Acá queda lo que es de este lado:
 * armar el pedido, leer la respuesta sin confiar en su forma y entender por qué falló.
 */

import type { PriceChange, PriceFailureReason, PriceWriteFailure } from './types'

export type RequestedChange = {
  itemId: string
  branchId: string | null
  /** Lo que tiene que quedar. En una sucursal, `null` = volver al precio de la carta. */
  priceCents: number | null
  /** Lo que la persona veía escrito ahí. En una sucursal, `null` = sin precio propio. */
  expectedCents: number | null
}

/** Una fila del pedido, con los nombres que espera la función de la base. */
export type RpcChange = {
  item_id: string
  branch_id: string | null
  expected_cents: number | null
  price_cents: number | null
}

export function toRpcChanges(changes: ReadonlyArray<RequestedChange>): RpcChange[] {
  return changes.map((change) => ({
    item_id: change.itemId,
    branch_id: change.branchId,
    expected_cents: change.expectedCents,
    price_cents: change.priceCents,
  }))
}

export type ApplyOutcome = {
  /** Con un aumento (o su deshacer): la tanda que comparten sus renglones del historial. */
  batchId: string | null
  applied: PriceChange[]
  failed: PriceWriteFailure[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isId = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** Centavos enteros, o vacío. La base los manda como número; un texto con dígitos también vale. */
function centsOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  const cents = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined
}

const REASONS: ReadonlySet<string> = new Set<PriceFailureReason>(['missing', 'changed', 'error'])

/**
 * Lee lo que contestó la base sin confiar en su forma. `null` si no es lo que tenía que venir: en ese
 * caso no se le dice a nadie «listo» por las dudas (los precios pudieron haberse escrito: se pide
 * recargar para ver la verdad).
 */
export function parseApplyResult(data: unknown): ApplyOutcome | null {
  if (!isRecord(data) || !Array.isArray(data.applied) || !Array.isArray(data.failed)) return null
  const batchId = data.batch_id === null || data.batch_id === undefined ? null : data.batch_id
  if (batchId !== null && !isId(batchId)) return null

  const applied: PriceChange[] = []
  for (const row of data.applied) {
    if (!isRecord(row) || !isId(row.item_id)) return null
    const branchId = row.branch_id ?? null
    if (branchId !== null && !isId(branchId)) return null
    const fromCents = centsOrNull(row.from_cents)
    const toCents = centsOrNull(row.to_cents)
    if (fromCents === undefined || toCents === undefined) return null
    // El precio de la carta nunca está vacío, ni antes ni después.
    if (branchId === null && (fromCents === null || toCents === null)) return null
    applied.push({ itemId: row.item_id, branchId, fromCents, toCents })
  }

  const failed: PriceWriteFailure[] = []
  for (const row of data.failed) {
    if (!isRecord(row) || !isId(row.item_id)) return null
    const branchId = row.branch_id ?? null
    if (branchId !== null && !isId(branchId)) return null
    if (typeof row.reason !== 'string' || !REASONS.has(row.reason)) return null
    const reason = row.reason as PriceFailureReason
    if (reason === 'changed') {
      const currentCents = centsOrNull(row.current_cents)
      if (currentCents === undefined) return null
      failed.push({ itemId: row.item_id, branchId, reason, currentCents })
    } else {
      failed.push({ itemId: row.item_id, branchId, reason })
    }
  }
  return { batchId, applied, failed }
}

/** Por qué la base no aplicó nada. */
export type ApplyErrorKind =
  /** Quien llama no puede cambiar precios en ese bar (o se quedó sin sesión). */
  | 'forbidden'
  /** Una sucursal del pedido ya no es de este bar. */
  | 'branch'
  /** El pedido no tiene la forma que se espera. */
  | 'invalid'
  /** Cualquier otra cosa (un corte, un tiempo de espera, dos aumentos a la vez). */
  | 'failed'

/** La base avisa con un mensaje corto y un código; con cualquiera de los dos alcanza. */
export function applyErrorKind(error: {
  code?: string | null
  message?: string | null
}): ApplyErrorKind {
  const message = error.message ?? ''
  if (message.includes('forbidden') || message.includes('unauthenticated')) return 'forbidden'
  if (error.code === '42501' || error.code === '28000') return 'forbidden'
  if (message.includes('branch_not_found')) return 'branch'
  if (message.includes('invalid_changes')) return 'invalid'
  return 'failed'
}

/** Parte una lista en tandas de a lo sumo `size`. */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size))
  return out
}

/** Corre tareas de a `limit` por vez y devuelve los resultados en el orden de entrada. */
export async function runLimited<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
