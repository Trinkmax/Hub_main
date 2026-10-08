import 'server-only'

/**
 * Lecturas chicas de la revisión de un lote (WP10), además de las de
 * `queries.ts`: la cola de lo que se va a cargar (solo clave y hash, para el
 * bucle de a 15), las filas de una propuesta («No es nuestro» necesita sus ids)
 * y el formulario guardado de una propuesta («Ver asiento»).
 *
 * Con la sesión del usuario (RLS de lectores) y el bar explícito en cada
 * `select`. Errores → `AccQueryError` (los que llaman usan `settleQuery`).
 */

import {
  asRecord,
  asRecords,
  isUuid,
  queryError,
  readerClient,
  str,
  strOrNull,
} from '@/lib/accounting/queries/shared'
import { PROPOSAL_FORMS, type ProposalStatus } from './types'

const PAGE = 1000
/** Tope de la cola (un lote enorme se carga en varias vueltas). */
const MAX_QUEUE = 20_000

export type PostQueueItem = {
  key: string
  previewHash: string
  status: Extract<ProposalStatus, 'ready' | 'posting'>
}

/**
 * Lo que «Cargar N comprobantes» manda a `postImportProposals`: las listas y
 * las que quedaron a medio cargar (`posting`, de una carga que se cortó), en
 * orden de clave. Solo clave y hash: nada más viaja al navegador.
 */
export async function listPostQueue(tenantId: string, batchId: string): Promise<PostQueueItem[]> {
  if (!isUuid(batchId)) return []
  const supabase = await readerClient()
  const out: PostQueueItem[] = []
  for (let from = 0; from < MAX_QUEUE; from += PAGE) {
    const { data, error } = await supabase
      .from('acc_import_proposals')
      .select('key, preview_hash, status')
      .eq('tenant_id', tenantId)
      .eq('batch_id', batchId)
      .in('status', ['ready', 'posting'])
      .order('key')
      .range(from, from + PAGE - 1)
    if (error) throw queryError('acc_import_proposals', error)
    const page = asRecords(data)
    for (const r of page) {
      const hash = strOrNull(r.preview_hash)
      const key = str(r.key)
      if (!hash || !/^[0-9a-f]{64}$/.test(hash) || key.length < 3) continue
      out.push({ key, previewHash: hash, status: r.status === 'posting' ? 'posting' : 'ready' })
    }
    if (page.length < PAGE) break
  }
  return out
}

/** Los ids de las filas de una propuesta (para «No es nuestro» y deshacerlo). */
export async function listProposalItemIds(
  tenantId: string,
  batchId: string,
  proposalKey: string,
): Promise<string[]> {
  if (!isUuid(batchId) || proposalKey.length < 3 || proposalKey.length > 200) return []
  const supabase = await readerClient()
  const out: string[] = []
  for (let from = 0; from < 5000; from += PAGE) {
    const { data, error } = await supabase
      .from('acc_import_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('batch_id', batchId)
      .contains('proposal_keys', [proposalKey])
      .order('row_no')
      .range(from, from + PAGE - 1)
    if (error) throw queryError('acc_import_items', error)
    const page = asRecords(data)
    for (const r of page) {
      const id = str(r.id)
      if (isUuid(id)) out.push(id)
    }
    if (page.length < PAGE) break
  }
  return out
}

export type ProposalFormRow = {
  form: (typeof PROPOSAL_FORMS)[number]
  status: string
  formValues: Record<string, unknown>
  previewHash: string | null
}

/** El formulario guardado de una propuesta (para «Ver asiento»); `null` si no existe. */
export async function getProposalForm(
  tenantId: string,
  batchId: string,
  proposalKey: string,
): Promise<ProposalFormRow | null> {
  if (!isUuid(batchId) || proposalKey.length < 3 || proposalKey.length > 200) return null
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_import_proposals')
    .select('form, status, form_values, preview_hash')
    .eq('tenant_id', tenantId)
    .eq('batch_id', batchId)
    .eq('key', proposalKey)
    .maybeSingle()
  if (error) throw queryError('acc_import_proposals', error)
  if (!data) return null
  const r = asRecord(data)
  const form = PROPOSAL_FORMS.find((f) => f === r.form)
  if (!form) return null
  return {
    form,
    status: str(r.status),
    formValues: asRecord(r.form_values),
    previewHash: strOrNull(r.preview_hash),
  }
}
