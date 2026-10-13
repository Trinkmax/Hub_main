'use client'

import { toast } from 'sonner'
import {
  prepareAttachmentUploads,
  registerDocumentAttachments,
} from '@/lib/accounting/actions/attachments'
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MESSAGES,
  type AttachmentMimeType,
  attachmentKind,
  checkAttachmentCandidate,
  checkAttachmentUpload,
  guessAttachmentMime,
  MAX_ATTACHMENTS_PER_DOCUMENT,
  pendingAttachmentsMessage,
} from '@/lib/accounting/attachments'
import { processImageForUpload } from '@/lib/menu/upload-image'
import { createClient } from '@/lib/supabase/browser'

/**
 * La subida de la foto del comprobante, del lado del navegador.
 *
 * El archivo va DIRECTO a Storage con la sesión de la persona (una Server
 * Action no puede llevar una foto de celular; el permiso son las políticas del
 * bucket `acc-comprobantes`). Antes, el servidor valida y da la ruta; después,
 * registra el archivo en su comprobante. El detalle de cada paso está en
 * `lib/accounting/actions/attachments.ts`.
 *
 * Las fotos grandes se achican antes de subir con el mismo achicador de las
 * fotos de la carta (lado mayor 1600 px): una foto de celular de 4 MB queda en
 * unos 200 KB y la factura se sigue leyendo.
 */

export type AttachmentUploadFailure = { file: File; message: string }

export type AttachmentUploadResult = {
  /** Cuántos archivos quedaron adjuntos. */
  uploaded: number
  /** Los que no, con el motivo listo para mostrar. */
  failed: AttachmentUploadFailure[]
}

/** Una foto chica y en un formato que ya se ve en cualquier navegador va tal cual: recomprimirla solo la empeora. */
const KEEP_AS_IS_UNDER_BYTES = 1024 * 1024

type ReadyFile = { file: File; blob: Blob; mimeType: AttachmentMimeType }

/** Deja el archivo listo para subir: la foto se achica, el PDF va tal cual. */
async function readyFile(file: File): Promise<ReadyFile | { message: string }> {
  const candidate = checkAttachmentCandidate(file)
  if (!candidate.ok) return { message: candidate.message }
  const declared = guessAttachmentMime(file)

  let blob: Blob = file
  let mimeType: string = declared ?? ''
  const keep =
    candidate.kind === 'pdf' ||
    (declared !== null &&
      attachmentKind(declared) === 'image' &&
      file.size <= KEEP_AS_IS_UNDER_BYTES)
  if (!keep) {
    try {
      const processed = await processImageForUpload(file)
      blob = processed.blob
      mimeType = processed.contentType
    } catch {
      // El navegador no la pudo leer (pasa con HEIC fuera de Safari): va la original si el
      // bucket acepta ese formato.
      if (declared === null) return { message: ATTACHMENT_MESSAGES.unreadableImage }
    }
  }

  const check = checkAttachmentUpload({ mimeType, sizeBytes: blob.size })
  if (!check.ok) return { message: check.message }
  return { file, blob, mimeType: check.mimeType }
}

/**
 * Sube archivos a un comprobante que YA existe y devuelve cuántos quedaron y
 * cuáles no. Nunca tira: un corte de conexión vuelve como un archivo que falló.
 * Hasta 5 por llamada (los que sobran vuelven en `failed`); el tope real contra
 * lo que el comprobante ya tiene lo decide el servidor.
 */
export async function uploadDocumentAttachments(
  tenantSlug: string,
  documentId: string,
  files: readonly File[],
): Promise<AttachmentUploadResult> {
  const failed: AttachmentUploadFailure[] = []
  for (const file of files.slice(MAX_ATTACHMENTS_PER_DOCUMENT)) {
    failed.push({ file, message: ATTACHMENT_MESSAGES.limit })
  }

  const ready: ReadyFile[] = []
  for (const file of files.slice(0, MAX_ATTACHMENTS_PER_DOCUMENT)) {
    const result = await readyFile(file)
    if ('message' in result) failed.push({ file, message: result.message })
    else ready.push(result)
  }
  if (ready.length === 0) return { uploaded: 0, failed }

  const failAll = (items: readonly ReadyFile[], message: string): AttachmentUploadResult => {
    for (const item of items) failed.push({ file: item.file, message })
    return { uploaded: 0, failed }
  }

  // 1. El servidor valida (permiso, comprobante, tipo, peso, lugar) y da las rutas.
  let paths: string[]
  try {
    const prepared = await prepareAttachmentUploads(tenantSlug, {
      documentId,
      files: ready.map((item) => ({ mimeType: item.mimeType, sizeBytes: item.blob.size })),
    })
    if (!prepared.ok) return failAll(ready, prepared.message)
    paths = prepared.data.paths
  } catch {
    return failAll(ready, ATTACHMENT_MESSAGES.offline)
  }

  // 2. Cada archivo, directo al bucket.
  const supabase = createClient()
  const sent: Array<ReadyFile & { path: string }> = []
  for (const [index, item] of ready.entries()) {
    const path = paths[index]
    if (!path) {
      failed.push({ file: item.file, message: ATTACHMENT_MESSAGES.upload })
      continue
    }
    try {
      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, item.blob, { contentType: item.mimeType, upsert: false })
      if (error) failed.push({ file: item.file, message: ATTACHMENT_MESSAGES.upload })
      else sent.push({ ...item, path })
    } catch {
      failed.push({ file: item.file, message: ATTACHMENT_MESSAGES.offline })
    }
  }
  if (sent.length === 0) return { uploaded: 0, failed }

  // 3. El servidor los registra en el comprobante (y borra del bucket el que la base no acepta).
  try {
    const registered = await registerDocumentAttachments(tenantSlug, {
      documentId,
      files: sent.map((item) => ({
        path: item.path,
        fileName: item.file.name,
        mimeType: item.mimeType,
        sizeBytes: item.blob.size,
      })),
    })
    if (!registered.ok) return failAll(sent, registered.message)
    const rejected = new Map(registered.data.failed.map((f) => [f.path, f.message]))
    for (const item of sent) {
      const message = rejected.get(item.path)
      if (message) failed.push({ file: item.file, message })
    }
    return { uploaded: registered.data.saved, failed }
  } catch {
    // Un corte justo acá: no se sabe si quedaron. La pantalla del comprobante dice la verdad.
    return failAll(sent, ATTACHMENT_MESSAGES.offline)
  }
}

/**
 * Para un formulario que recién guardó el comprobante: sube lo que la persona
 * eligió en `AttachmentPicker`. El comprobante ya está guardado, así que un
 * archivo que falla NO es un error del guardado: avisá con
 * `pendingAttachmentsMessage(failed.length, files.length)` y dejá que lo sume
 * después desde la pantalla del comprobante.
 */
export async function uploadPendingAttachments(
  tenantSlug: string,
  documentId: string,
  files: readonly File[],
): Promise<AttachmentUploadResult> {
  if (files.length === 0) return { uploaded: 0, failed: [] }
  return uploadDocumentAttachments(tenantSlug, documentId, files)
}

/** Cuánto queda a la vista el aviso de que un archivo no subió (tiene un botón). */
const PENDING_NOTICE_MS = 12_000

/**
 * Lo que hace un formulario después de guardar («Nuevo gasto», la compra):
 * sube lo elegido y, si algo no subió, avisa con un botón para abrir el
 * comprobante y sumarlo ahí. El comprobante ya está guardado: acá no se
 * reintenta ni se vuelve a mandar nada. Sin archivos o sin comprobante no hace
 * nada. Nunca tira.
 */
export async function attachPendingFiles(opts: {
  tenantSlug: string
  /** El comprobante recién guardado (`result.documents[0].id`). */
  documentId: string | null
  files: readonly File[]
  /** Lleva a la pantalla del comprobante. */
  openDocument: (documentId: string) => void
}): Promise<void> {
  const { tenantSlug, documentId, files, openDocument } = opts
  if (!documentId || files.length === 0) return
  let failedCount = files.length
  try {
    const result = await uploadPendingAttachments(tenantSlug, documentId, files)
    failedCount = result.failed.length
  } catch {
    // Algo que no esperábamos: se avisa como si no hubiera subido ninguno.
  }
  const message = pendingAttachmentsMessage(failedCount, files.length)
  if (!message) return
  toast.warning(message, {
    duration: PENDING_NOTICE_MS,
    action: { label: 'Abrir el comprobante', onClick: () => openDocument(documentId) },
  })
}
