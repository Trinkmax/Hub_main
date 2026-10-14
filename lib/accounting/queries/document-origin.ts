import 'server-only'
import {
  chunks,
  dayOrNull,
  instantOrNull,
  isRecord,
  isUuid,
  queryError,
  readerClient,
  str,
  strOrNull,
  uniqueIds,
} from './shared'

/**
 * De qué archivo importado salió un comprobante (ARCA, Mercado Pago o el
 * banco), para que su ficha lo pueda decir: «Archivo de ARCA · lo subió … el
 * …». Sin esto la ficha no tiene cómo saberlo: lo importado del banco guarda
 * en su nota el texto del extracto, no «importado de…».
 *
 * Dos lecturas con la sesión de la persona, bajo las políticas de lectores que
 * ya existen (`acc_import_proposals` y `acc_import_batches`) y con el bar
 * explícito en cada una; sin `service_role` y sin migración. La segunda solo
 * corre si el comprobante vino de un archivo.
 *
 * - `role: 'current'`: la propuesta de ese archivo es hoy este comprobante.
 * - `role: 'previous'`: lo fue y se anuló; su línea volvió a quedar para
 *   revisar en ese archivo.
 *
 * `null`: no vino de ningún archivo (se cargó a mano).
 */
export type DocumentOrigin = {
  batchId: string
  /** `arca_recibidos` · `arca_emitidos` · `mp_release` · `bank_statement`. */
  source: string
  /** `null` cuando no hubo archivo (lo trajo la conexión con Mercado Pago). */
  fileName: string | null
  /** Instante (`timestamptz`) en que se subió. */
  uploadedAt: string
  uploadedByName: string
  role: 'current' | 'previous'
}

const PROPOSALS = 'acc_import_proposals'
const BATCHES = 'acc_import_batches'

export async function getDocumentOrigin(
  tenantId: string,
  documentId: string,
): Promise<DocumentOrigin | null> {
  if (!isUuid(documentId)) return null
  const supabase = await readerClient()
  const proposals = await supabase
    .from(PROPOSALS)
    .select('batch_id, document_id, previous_document_id, updated_at')
    .eq('tenant_id', tenantId)
    .or(`document_id.eq.${documentId},previous_document_id.eq.${documentId}`)
    .order('updated_at', { ascending: false })
    .limit(5)
  if (proposals.error) throw queryError(PROPOSALS, proposals.error)
  const rows = ((proposals.data ?? []) as unknown[]).filter(isRecord)
  // Si hay más de una, manda la que hoy ES este comprobante.
  const current = rows.find((row) => row.document_id === documentId)
  const proposal = current ?? rows[0]
  if (!proposal) return null
  const batchId = str(proposal.batch_id)
  if (!isUuid(batchId)) return null

  const batch = await supabase
    .from(BATCHES)
    .select('id, source, file_name, created_at, created_by_name')
    .eq('tenant_id', tenantId)
    .eq('id', batchId)
    .maybeSingle()
  if (batch.error) throw queryError(BATCHES, batch.error)
  if (!isRecord(batch.data)) return null

  return {
    batchId,
    source: str(batch.data.source),
    fileName: strOrNull(batch.data.file_name),
    uploadedAt: instantOrNull(batch.data.created_at) ?? '',
    uploadedByName: str(batch.data.created_by_name),
    role: current ? 'current' : 'previous',
  }
}

/** Lo que la ficha necesita de otro comprobante para nombrarlo: qué es y de qué día. */
export type LinkedDocument = { kind: string; issueDate: string }

const DOCUMENTS = 'acc_documents'

/**
 * Qué son y de qué día los comprobantes del otro lado de las uniones de una
 * ficha, por id. Sirve para que un cobro diga «Cierre del mar 01/09» en vez de
 * «Cierre del día #12», que no le dice a nadie qué noche cobró.
 *
 * Una lectura con la sesión de la persona, bajo la política de lectores de
 * `acc_documents` y con el bar explícito; sin `service_role` y sin migración.
 * Los que no se puedan leer simplemente no están en el mapa: la ficha los
 * nombra como siempre.
 */
export async function getLinkedDocuments(
  tenantId: string,
  documentIds: readonly string[],
): Promise<Map<string, LinkedDocument>> {
  const out = new Map<string, LinkedDocument>()
  const ids = uniqueIds(documentIds)
  if (ids.length === 0) return out
  const supabase = await readerClient()
  const results = await Promise.all(
    chunks(ids).map((chunk) =>
      supabase
        .from(DOCUMENTS)
        .select('id, kind, issue_date')
        .eq('tenant_id', tenantId)
        .in('id', chunk),
    ),
  )
  for (const result of results) {
    if (result.error) throw queryError(DOCUMENTS, result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (!isRecord(row)) continue
      const issueDate = dayOrNull(row.issue_date)
      if (issueDate) out.set(str(row.id), { kind: str(row.kind), issueDate })
    }
  }
  return out
}
