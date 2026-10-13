'use server'

/**
 * Server actions de la foto del comprobante (adjuntos de un comprobante de
 * Administración; pedido de los socios del 12/10/2026, punto 1.5).
 *
 * **Cómo se sube un archivo.** El navegador lo manda DIRECTO a Storage con la
 * sesión de la persona, igual que las fotos de la carta y de las landings: una
 * Server Action no puede llevar una foto de celular, y las políticas del
 * bucket privado `acc-comprobantes` son el permiso (sube y borra quien escribe
 * en Administración de ese bar; lee quien lee). Estas acciones van antes y
 * después de esa subida:
 *
 * 1. `prepareAttachmentUploads`: permiso de escritura, que el comprobante sea
 *    de este bar, tipo y peso de cada archivo y que haya lugar (hasta 5).
 *    Devuelve la ruta de cada uno: la ruta la decide el servidor.
 * 2. (navegador) `storage.from('acc-comprobantes').upload(ruta, archivo)`.
 * 3. `registerDocumentAttachments`: registra los que se subieron
 *    (`acc_attach_document_file`, que vuelve a chequear todo y audita). El que
 *    la base rechaza se borra del bucket.
 *
 * `removeDocumentAttachment` quita la fila (`acc_detach_document_file`) y
 * después el archivo. `fetchDocumentAttachmentUrl` es de lectura: un link
 * nuevo cuando el de la pantalla ya venció.
 *
 * El orquestador del lado del navegador está en
 * `components/administracion/adjuntos/upload.ts`.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MESSAGES,
  attachmentFileName,
  attachmentRoom,
  buildAttachmentPath,
  checkAttachmentUpload,
  isAttachmentMimeType,
  isAttachmentPathFor,
  MAX_ATTACHMENTS_PER_DOCUMENT,
  parseAttachmentPath,
} from '@/lib/accounting/attachments'
import { type AttachmentUrl, getDocumentAttachmentUrl } from '@/lib/accounting/queries/attachments'
import {
  QUERY_FAILED_MESSAGE,
  type QueryOutcome,
  settleQuery,
} from '@/lib/accounting/queries/shared'
import { createClient } from '@/lib/supabase/server'
import {
  accFailure,
  asRecord,
  boolOf,
  revalidateAccounting,
  rpcFailure,
  textOf,
  unexpectedFailure,
} from './support'

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** La ruta del bucket donde subir cada archivo, en el orden en que se pidieron. */
export type PreparedAttachmentUploads = { paths: string[] }

export type RegisteredAttachments = {
  /** Cuántos quedaron adjuntos. */
  saved: number
  /** Los que la base no aceptó, por ruta, con el motivo listo para mostrar. */
  failed: Array<{ path: string; message: string }>
}

export type RemovedAttachment = { id: string; removed: boolean }

// ─── Entrada ─────────────────────────────────────────────────────────────────

/** En minúsculas: así los escribe la base, y la ruta del archivo se arma con ellos. */
const uuid = z.uuid('El identificador no es válido.').transform((value) => value.toLowerCase())

const uploadSpec = z
  .object({
    mimeType: z.string().max(60),
    sizeBytes: z.number().int(),
  })
  .superRefine((file, ctx) => {
    const check = checkAttachmentUpload(file)
    if (!check.ok) ctx.addIssue({ code: 'custom', message: check.message })
  })

const prepareSchema = z.object({
  documentId: uuid,
  files: z
    .array(uploadSpec)
    .min(1, 'Elegí al menos un archivo.')
    .max(MAX_ATTACHMENTS_PER_DOCUMENT, ATTACHMENT_MESSAGES.limit),
})

const registerSchema = z.object({
  documentId: uuid,
  files: z
    .array(
      z
        .object({
          path: z.string().max(160),
          fileName: z.string().max(400),
          mimeType: z.string().max(60),
          sizeBytes: z.number().int(),
        })
        .superRefine((file, ctx) => {
          const check = checkAttachmentUpload(file)
          if (!check.ok) ctx.addIssue({ code: 'custom', message: check.message })
        }),
    )
    .min(1, 'Elegí al menos un archivo.')
    .max(MAX_ATTACHMENTS_PER_DOCUMENT, ATTACHMENT_MESSAGES.limit),
})

const attachmentRef = z.object({ attachmentId: uuid })

// ─── Subir ───────────────────────────────────────────────────────────────────

/**
 * Antes de subir: valida y devuelve la ruta de cada archivo. Con el
 * comprobante lleno (o si los pedidos no entran), `attachment_limit`, y no se
 * sube nada.
 */
export async function prepareAttachmentUploads(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<PreparedAttachmentUploads>> {
  const op = 'attachments.prepare'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = prepareSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)
    const { documentId, files } = parsed.data

    const supabase = await createClient()
    const doc = await supabase
      .from('acc_documents')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('id', documentId)
      .maybeSingle()
    if (doc.error) return rpcFailure(op, doc.error)
    if (!doc.data) return accFailure('document_not_found')

    const current = await supabase
      .from('acc_document_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenantId)
      .eq('document_id', documentId)
    if (current.error) return rpcFailure(op, current.error)
    if (attachmentRoom(current.count ?? 0, files.length).overflow > 0) {
      return accFailure('attachment_limit')
    }

    const paths: string[] = []
    for (const file of files) {
      // El esquema ya lo validó: esto es para el tipo.
      if (!isAttachmentMimeType(file.mimeType)) return accFailure('invalid_payload')
      paths.push(buildAttachmentPath(auth.tenantId, documentId, randomUUID(), file.mimeType))
    }
    return { ok: true, data: { paths }, message: '' }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

/**
 * Después de subir: registra cada archivo en su comprobante. Devuelve cuántos
 * quedaron y cuáles no (con el motivo). Si no quedó ninguno, el estado es el
 * error del primero.
 */
export async function registerDocumentAttachments(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<RegisteredAttachments>> {
  const op = 'attachments.register'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = registerSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)
    const { documentId, files } = parsed.data

    const supabase = await createClient()
    const failed: RegisteredAttachments['failed'] = []
    let firstFailure: AccFailureState | null = null
    let saved = 0

    for (const file of files) {
      const expected = { tenantId: auth.tenantId, documentId, mimeType: file.mimeType }
      if (!isAttachmentMimeType(file.mimeType) || !isAttachmentPathFor(file.path, expected)) {
        // Una ruta que no es de este comprobante: no se registra ni se toca.
        const state = accFailure('invalid_payload')
        firstFailure ??= state
        failed.push({ path: file.path, message: state.message })
        continue
      }
      const { error } = await supabase.rpc('acc_attach_document_file', {
        p_tenant_id: auth.tenantId,
        p_document_id: documentId,
        p_path: file.path,
        p_file_name: attachmentFileName(file.fileName, file.mimeType),
        p_mime_type: file.mimeType,
        p_size_bytes: file.sizeBytes,
      })
      if (!error) {
        saved += 1
        continue
      }
      const state = rpcFailure(op, error)
      firstFailure ??= state
      failed.push({ path: file.path, message: state.message })
      // La base lo rechazó (hay código): el archivo no queda suelto en el bucket. Sin
      // código fue un corte y no se sabe si se registró: no se borra.
      if (error.code) {
        const removal = await supabase.storage.from(ATTACHMENT_BUCKET).remove([file.path])
        if (removal.error) console.error(`[accounting.${op}] limpieza`, removal.error.name)
      }
    }

    if (saved === 0 && firstFailure) return firstFailure
    revalidateAccounting(slug)
    return {
      ok: true,
      data: { saved, failed },
      message: saved === 1 ? 'Archivo adjuntado.' : `${saved} archivos adjuntados.`,
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Quitar ──────────────────────────────────────────────────────────────────

/**
 * Quita un adjunto: primero la fila (queda auditado) y después el archivo del
 * bucket. Si otra persona ya lo había quitado, también es un «listo».
 */
export async function removeDocumentAttachment(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<RemovedAttachment>> {
  const op = 'attachments.remove'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = attachmentRef.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_detach_document_file', {
      p_tenant_id: auth.tenantId,
      p_attachment_id: parsed.data.attachmentId,
    })
    if (error) return rpcFailure(op, error, { operation: 'delete' })

    const row = asRecord(data)
    const removed = boolOf(row?.removed)
    const path = textOf(row?.storage_path)
    // Solo se borra un archivo de la carpeta de este bar (la política del bucket igual lo exige).
    if (removed && path && parseAttachmentPath(path)?.tenantId === auth.tenantId.toLowerCase()) {
      const removal = await supabase.storage.from(ATTACHMENT_BUCKET).remove([path])
      // La fila ya no está: la persona no lo ve más. El archivo suelto se anota para limpiarlo.
      if (removal.error) console.error(`[accounting.${op}] archivo`, removal.error.name)
    }

    revalidateAccounting(slug)
    return {
      ok: true,
      data: { id: parsed.data.attachmentId, removed },
      message: 'Archivo quitado.',
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

// ─── Abrir (lectura) ─────────────────────────────────────────────────────────

/**
 * Un link nuevo para abrir un adjunto cuando el de la pantalla ya venció.
 * Lectura: dueños con acceso y la contadora. Nunca tira.
 */
export async function fetchDocumentAttachmentUrl(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<AttachmentUrl>> {
  try {
    const parsed = attachmentRef.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        code: 'invalid',
        message: parsed.error.issues[0]?.message ?? 'Revisá los datos.',
      }
    }
    const auth = await authorizeAccounting(slug, 'read')
    if (!auth.ok) return { ok: false, code: auth.state.code, message: auth.state.message }
    const outcome = await settleQuery(
      getDocumentAttachmentUrl(auth.tenantId, parsed.data.attachmentId),
    )
    if (!outcome.ok) return outcome
    if (!outcome.data) {
      return { ok: false, code: 'conflict', message: 'Ese archivo ya no está. Recargá la página.' }
    }
    return { ok: true, data: outcome.data }
  } catch (error) {
    console.error(
      '[accounting.attachments.url] inesperado',
      error instanceof Error ? error.name : 'unknown',
    )
    return { ok: false, code: 'error', message: QUERY_FAILED_MESSAGE }
  }
}
