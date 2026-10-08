'use server'

/**
 * Lecturas que la revisión de un lote pide desde el navegador (WP10), además de
 * las acciones de `actions.ts`:
 *
 * - `fetchPostQueue`: la cola de «Cargar N comprobantes» (clave y hash de las
 *   listas), leída justo al tocar el botón;
 * - `fetchProposalItemIds`: las filas de una propuesta («No es nuestro» y su
 *   «Deshacer»);
 * - `previewImportProposal`: «Ver asiento», armado en el servidor con el
 *   contexto DE LA BASE y el formulario guardado (el mismo camino que el
 *   «Ver asiento» de los formularios: `runPreviewDocument`).
 *
 * Todas empiezan con `authorizeAccounting` (la cola y las filas, lectura; el
 * asiento, carga, como cualquier vista previa) y nunca tiran: devuelven el
 * texto listo para mostrar. Nada de datos personales en los logs.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import { accFailure } from '@/lib/accounting/actions/support'
import { settleQuery } from '@/lib/accounting/queries/shared'
import type { PreviewBundleState } from '@/lib/accounting/server/document-types'
import { runPreviewDocument } from '@/lib/accounting/server/post-document'
import {
  getProposalForm,
  listPostQueue,
  listProposalItemIds,
  type PostQueueItem,
} from './server/review'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RELOAD = 'Recargá la página y probá de nuevo.'

function validBatch(input: unknown): input is { batchId: string } {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as { batchId?: unknown }).batchId === 'string' &&
    UUID_RE.test((input as { batchId: string }).batchId)
  )
}

function validKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 3 && value.length <= 200
}

/** La cola de «Cargar N comprobantes»: clave y hash de las listas (y las que quedaron a medias). */
export async function fetchPostQueue(
  slug: string,
  input: { batchId: string },
): Promise<AccSimpleState<{ items: PostQueueItem[] }>> {
  if (typeof slug !== 'string' || slug === '') return accFailure('forbidden')
  const auth = await authorizeAccounting(slug, 'read')
  if (!auth.ok) return auth.state
  if (!validBatch(input)) return { ok: false, code: 'invalid', message: RELOAD }
  const outcome = await settleQuery(listPostQueue(auth.tenantId, input.batchId))
  if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message }
  return { ok: true, data: { items: outcome.data }, message: '' }
}

/** Los ids de las filas de una propuesta. */
export async function fetchProposalItemIds(
  slug: string,
  input: { batchId: string; proposalKey: string },
): Promise<AccSimpleState<{ itemIds: string[] }>> {
  if (typeof slug !== 'string' || slug === '') return accFailure('forbidden')
  const auth = await authorizeAccounting(slug, 'read')
  if (!auth.ok) return auth.state
  if (!validBatch(input) || !validKey(input.proposalKey)) {
    return { ok: false, code: 'invalid', message: RELOAD }
  }
  const outcome = await settleQuery(
    listProposalItemIds(auth.tenantId, input.batchId, input.proposalKey),
  )
  if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message }
  if (outcome.data.length === 0) {
    return { ok: false, code: 'conflict', message: 'No encontramos sus filas. Recargá la página.' }
  }
  return { ok: true, data: { itemIds: outcome.data }, message: '' }
}

/**
 * «Ver asiento» de una propuesta: el formulario que guardó el importador,
 * armado de nuevo con el contexto de hoy. Devuelve el asiento y su hash (el que
 * hay que mandar para cargar exactamente eso).
 */
export async function previewImportProposal(
  slug: string,
  input: { batchId: string; proposalKey: string },
): Promise<PreviewBundleState> {
  if (typeof slug !== 'string' || slug === '') return accFailure('forbidden')
  const auth = await authorizeAccounting(slug, 'write')
  if (!auth.ok) return auth.state
  if (!validBatch(input) || !validKey(input.proposalKey)) {
    return { ok: false, code: 'invalid', message: RELOAD }
  }
  const outcome = await settleQuery(
    getProposalForm(auth.tenantId, input.batchId, input.proposalKey),
  )
  if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message }
  const row = outcome.data
  if (!row) return { ok: false, code: 'conflict', message: 'Eso ya no existe. Recargá la página.' }
  if (Object.keys(row.formValues).length === 0) {
    return {
      ok: false,
      code: 'invalid',
      message: 'Todavía no se puede armar el asiento: completá primero lo que pide arriba.',
    }
  }
  return runPreviewDocument(slug, { form: row.form, values: row.formValues })
}
