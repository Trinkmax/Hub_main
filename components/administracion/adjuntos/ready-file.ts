'use client'

import {
  ATTACHMENT_MESSAGES,
  type AttachmentMimeType,
  attachmentKind,
  checkAttachmentCandidate,
  checkAttachmentUpload,
  guessAttachmentMime,
} from '@/lib/accounting/attachments'
import { processImageForUpload } from '@/lib/menu/upload-image'

/** Una foto chica y en un formato que ya se ve en cualquier navegador va tal cual: recomprimirla solo la empeora. */
const KEEP_AS_IS_UNDER_BYTES = 1024 * 1024

export type ReadyFile = { file: File; blob: Blob; mimeType: AttachmentMimeType }

/**
 * Deja el archivo listo para subir: la foto se achica, el PDF va tal cual. Vive aparte de `upload.ts`
 * porque también lo usa la página pública del celular (`/subir/[token]`), que no carga nada de las
 * acciones de Administración.
 */
export async function readyFile(file: File): Promise<ReadyFile | { message: string }> {
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
