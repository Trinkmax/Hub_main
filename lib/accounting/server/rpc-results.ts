/**
 * Resultados de las RPC de comprobantes, tipados a mano (los clientes de
 * Supabase no tienen el genérico `Database` para las `acc_*`, G.7).
 *
 * Puro y defensivo: un `bigint` puede llegar como número o como texto
 * (`Number()`), y una clave que falta no rompe la acción (lo guardado ya está
 * guardado: la base confirmó la transacción). Lo que no se puede leer queda en
 * `null` o en una lista vacía.
 */

import type { PostBundleResult } from '@/lib/accounting/action-state'
import type {
  AllocateItemsResult,
  ReverseDocumentResult,
  TreasuryCheckedResult,
  VoidDocumentResult,
} from './document-types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Entero de la base (`bigint`, `int`): número, o texto con un entero. */
function integer(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v !== '')
}

/**
 * `acc_post_bundle` (C.3.3 paso 10):
 * `{ bundle_id, replayed, documents: [{ ref, id, seq, entry_id, provisional_number, lines: [{ line_no, journal_line_id }] }], allocations: [id] }`.
 */
export function parsePostBundleResult(data: unknown): PostBundleResult {
  const root = isRecord(data) ? data : {}
  const documents: PostBundleResult['documents'] = []
  if (Array.isArray(root.documents)) {
    for (const raw of root.documents) {
      if (!isRecord(raw)) continue
      const id = text(raw.id)
      if (!id) continue
      const lines: PostBundleResult['documents'][number]['lines'] = []
      if (Array.isArray(raw.lines)) {
        for (const line of raw.lines) {
          if (!isRecord(line)) continue
          const lineNo = integer(line.line_no)
          const journalLineId = text(line.journal_line_id)
          if (lineNo !== null && journalLineId) {
            lines.push({ line_no: lineNo, journal_line_id: journalLineId })
          }
        }
      }
      documents.push({
        ref: text(raw.ref) ?? '',
        id,
        seq: integer(raw.seq) ?? 0,
        entry_id: text(raw.entry_id) ?? '',
        provisional_number: integer(raw.provisional_number),
        lines,
      })
    }
  }
  return {
    bundle_id: text(root.bundle_id) ?? '',
    replayed: root.replayed === true,
    documents,
    allocations: textList(root.allocations),
  }
}

/** `acc_void_document` (C.4.1): `{ voided_document_ids, unallocated_count }`. */
export function parseVoidResult(data: unknown): VoidDocumentResult {
  const root = isRecord(data) ? data : {}
  return {
    voidedDocumentIds: textList(root.voided_document_ids),
    unallocatedCount: integer(root.unallocated_count) ?? 0,
  }
}

/**
 * `acc_reverse_document` (C.4.3). La spec no fija la forma del retorno: se
 * acepta `{ reversal_id }`, `{ reversal_document_id }`, `{ document_id }` o
 * `{ id }`, y `replayed` como en `acc_post_bundle`.
 */
export function parseReverseResult(data: unknown): ReverseDocumentResult {
  if (typeof data === 'string') return { reversalDocumentId: text(data), replayed: false }
  const root = isRecord(data) ? data : {}
  const nested = isRecord(root.document) ? text(root.document.id) : null
  return {
    reversalDocumentId:
      text(root.reversal_id) ??
      text(root.reversal_document_id) ??
      text(root.document_id) ??
      nested ??
      text(root.id),
    replayed: root.replayed === true,
  }
}

/** `acc_allocate` (C.4.4): la lista de imputaciones creadas (`allocation_ids`, `allocations` o una lista pelada). */
export function parseAllocateResult(data: unknown): AllocateItemsResult {
  if (Array.isArray(data)) return { allocationIds: textList(data) }
  const root = isRecord(data) ? data : {}
  const ids = textList(root.allocation_ids)
  return { allocationIds: ids.length > 0 ? ids : textList(root.allocations) }
}

/** `acc_mark_treasury_checked` (#8): devuelve la fila de la caja. */
export function parseTreasuryChecked(data: unknown, treasuryId: string): TreasuryCheckedResult {
  const root = isRecord(data) ? data : {}
  return {
    treasuryAccountId: text(root.id) ?? treasuryId,
    lastCheckedOn: text(root.last_checked_on),
  }
}
