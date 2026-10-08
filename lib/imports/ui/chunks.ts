/**
 * Tandas de los importadores (fase2-estado §6.1, punto 3).
 *
 * - **Filas al servidor** (`addImportItems`): la acción acepta hasta 1000 filas,
 *   pero el cuerpo de una server action tiene un tope (4 MB en este repo, 4,5 MB
 *   en Vercel) y una fila puede pesar hasta ~8 KB. Por eso se mandan tandas de
 *   **500 filas o 1 MB serializado**, lo que llegue primero. Reenviar una tanda
 *   no duplica (la base saltea lo que ya está).
 * - **Propuestas a cargar** (`postImportProposals`): de a 15.
 *
 * Puro: lo usan el navegador y los tests.
 */

import type { ImportIssue, ImportRow } from '@/lib/imports/types'

/** Filas por llamada a `addImportItems`. */
export const ITEMS_CHUNK_ROWS = 500
/** Bytes (JSON en UTF-8) por llamada a `addImportItems`. */
export const ITEMS_CHUNK_BYTES = 1_000_000
/** Propuestas por llamada a `postImportProposals` (el tope del esquema). */
export const POST_CHUNK_SIZE = 15

/** Una fila lista para `addImportItems`. */
export type StagedRowInput = {
  rowNo: number
  naturalKey: string
  data: unknown
  issues: ImportIssue[]
}

/** La fila del parser (`ImportRow`) → lo que recibe `addImportItems`. */
export function toStagedRow<T>(row: ImportRow<T>): StagedRowInput {
  return { rowNo: row.row, naturalKey: row.key, data: row.item, issues: [...row.issues] }
}

const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null

/** Bytes del JSON de un valor en UTF-8 (lo que viaja en el cuerpo de la acción). */
export function jsonBytes(value: unknown): number {
  const json = JSON.stringify(value) ?? ''
  if (encoder) return encoder.encode(json).length
  // Sin TextEncoder (no pasa en navegadores ni en Node ≥ 11): cota superior.
  return json.length * 3
}

/**
 * Parte la lista en tandas de hasta `maxRows` filas y `maxBytes` bytes
 * serializados (contando las comas del arreglo). Una fila sola más grande que
 * `maxBytes` va sola en su tanda: el servidor decide si la acepta.
 */
export function chunkByRowsAndBytes<T>(
  items: readonly T[],
  opts: { maxRows?: number; maxBytes?: number; sizeOf?: (item: T) => number } = {},
): T[][] {
  const maxRows = Math.max(1, Math.trunc(opts.maxRows ?? ITEMS_CHUNK_ROWS))
  const maxBytes = Math.max(1, Math.trunc(opts.maxBytes ?? ITEMS_CHUNK_BYTES))
  const sizeOf = opts.sizeOf ?? jsonBytes
  const out: T[][] = []
  let current: T[] = []
  // `[` y `]` del arreglo; cada fila después de la primera suma su coma.
  let bytes = 2
  for (const item of items) {
    const size = sizeOf(item)
    const withComma = current.length > 0 ? size + 1 : size
    if (current.length > 0 && (current.length >= maxRows || bytes + withComma > maxBytes)) {
      out.push(current)
      current = [item]
      bytes = 2 + size
      continue
    }
    current.push(item)
    bytes += withComma
  }
  if (current.length > 0) out.push(current)
  return out
}

/** Tandas fijas de `size` (las cargas de a 15). */
export function chunkList<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.trunc(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}
