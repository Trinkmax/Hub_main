import 'server-only'
import {
  ATTACHMENT_BUCKET,
  type AttachmentKind,
  attachmentKind,
} from '@/lib/accounting/attachments'
import { AccQueryError, int, isRecord, isUuid, queryError, readerClient, str } from './shared'

/**
 * Los archivos adjuntos de un comprobante (foto o PDF de la factura, el tique
 * o el remito). Se lee con la sesión de la persona: la fila pasa por la RLS de
 * lectores de Administración y el link firmado por la política de lectura del
 * bucket privado `acc-comprobantes` (dueños con acceso y la contadora). Nunca
 * `service_role`.
 *
 * El link es de vida corta: sirve para la miniatura y para abrir el archivo en
 * ese momento. Si la pantalla quedó abierta más que eso, el componente pide
 * uno nuevo con `getDocumentAttachmentUrl` antes de abrir.
 */

/** Cuánto vive un link firmado. */
export const ATTACHMENT_URL_TTL_SECONDS = 10 * 60

export type DocumentAttachment = {
  id: string
  documentId: string
  /** El nombre para mostrar (con la extensión de lo que se subió). */
  fileName: string
  mimeType: string
  kind: AttachmentKind
  sizeBytes: number
  /** Instante (`timestamptz`) en que se subió. */
  createdAt: string
  /** Link firmado; `null` si el archivo ya no está en el bucket. */
  url: string | null
  /** Hasta cuándo sirve `url` (milisegundos de época). */
  urlExpiresAt: number
}

export type AttachmentUrl = { url: string; expiresAt: number }

const COLUMNS = 'id, document_id, storage_path, file_name, mime_type, size_bytes, created_at'

const SOURCE = 'acc_document_attachments'

function expiry(startedAt: number): number {
  return startedAt + ATTACHMENT_URL_TTL_SECONDS * 1000
}

/** Los adjuntos de un comprobante, en el orden en que se subieron, cada uno con su link. */
export async function listDocumentAttachments(
  tenantId: string,
  documentId: string,
): Promise<DocumentAttachment[]> {
  if (!isUuid(documentId)) return []
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from(SOURCE)
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('document_id', documentId)
    .order('created_at', { ascending: true })
  if (error) throw queryError(SOURCE, error)
  const rows = (Array.isArray(data) ? data : []).filter(isRecord)
  if (rows.length === 0) return []

  // Una sola llamada a Storage para todos los links.
  const startedAt = Date.now()
  const paths = rows.map((row) => str(row.storage_path)).filter((path) => path !== '')
  const urlByPath = new Map<string, string>()
  const signed = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls(paths, ATTACHMENT_URL_TTL_SECONDS)
  if (signed.error) {
    // La lista se muestra igual (nombre, tipo, peso); cada archivo pide su link al abrirse.
    console.error('[acc.query]', 'acc-comprobantes.sign', signed.error.name)
  } else {
    for (const item of signed.data ?? []) {
      if (item.path && item.signedUrl && !item.error) urlByPath.set(item.path, item.signedUrl)
    }
  }

  return rows.map((row) => {
    const mimeType = str(row.mime_type)
    return {
      id: str(row.id),
      documentId: str(row.document_id),
      fileName: str(row.file_name, 'comprobante'),
      mimeType,
      kind: attachmentKind(mimeType),
      sizeBytes: int(row.size_bytes),
      createdAt: str(row.created_at),
      url: urlByPath.get(str(row.storage_path)) ?? null,
      urlExpiresAt: expiry(startedAt),
    }
  })
}

/**
 * Un link nuevo para UN adjunto (la pantalla quedó abierta y el anterior
 * venció). `null` si el adjunto ya no existe en este bar.
 */
export async function getDocumentAttachmentUrl(
  tenantId: string,
  attachmentId: string,
): Promise<AttachmentUrl | null> {
  if (!isUuid(attachmentId)) return null
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from(SOURCE)
    .select('storage_path')
    .eq('tenant_id', tenantId)
    .eq('id', attachmentId)
    .maybeSingle()
  if (error) throw queryError(SOURCE, error)
  const path = isRecord(data) ? str(data.storage_path) : ''
  if (path === '') return null

  const startedAt = Date.now()
  const signed = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, ATTACHMENT_URL_TTL_SECONDS)
  if (signed.error || !signed.data?.signedUrl) {
    console.error('[acc.query]', 'acc-comprobantes.sign', signed.error?.name ?? 'sin-link')
    throw new AccQueryError(
      'acc-comprobantes',
      'error',
      'No pudimos abrir el archivo. Probá de nuevo; si sigue, avisanos.',
    )
  }
  return { url: signed.data.signedUrl, expiresAt: expiry(startedAt) }
}
