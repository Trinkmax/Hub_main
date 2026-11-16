'use client'

import { prepareTaskUploads } from '@/lib/marketing/actions'
import {
  checkTaskFile,
  MAX_FILES_PER_BATCH,
  TASK_FILE_MESSAGES,
  TASK_FILES_BUCKET,
} from '@/lib/marketing/files'
import type { UploadedTaskFile } from '@/lib/marketing/schemas'
import { createClient } from '@/lib/supabase/browser'

/**
 * La subida de los archivos de una tarea, del lado del navegador. Mismo camino
 * que los comprobantes de Administración (components/administracion/adjuntos):
 *   1. el servidor valida tipo y peso y da las rutas (`prepareTaskUploads`);
 *   2. cada archivo va DIRECTO al bucket privado con la sesión de la persona
 *      (una Server Action no puede llevar un video; el permiso es la política
 *      del bucket);
 *   3. quien llama registra lo subido (`registerTaskFiles` o `postTaskUpdate`).
 *
 * Nunca tira: lo que no se pudo subir vuelve en `failed` con el motivo listo.
 */
export type TaskUploadResult = {
  uploaded: UploadedTaskFile[]
  failed: Array<{ name: string; message: string }>
}

export async function uploadTaskFiles(
  tenantSlug: string,
  taskId: string,
  files: readonly File[],
): Promise<TaskUploadResult> {
  const failed: TaskUploadResult['failed'] = []
  const candidates: File[] = []

  for (const file of files.slice(0, MAX_FILES_PER_BATCH)) {
    const check = checkTaskFile(file)
    if (check.ok) candidates.push(file)
    else failed.push({ name: file.name, message: check.message })
  }
  for (const file of files.slice(MAX_FILES_PER_BATCH)) {
    failed.push({ name: file.name, message: TASK_FILE_MESSAGES.tooMany })
  }
  if (candidates.length === 0) return { uploaded: [], failed }

  let uploads: Array<{ path: string; mimeType: string }>
  try {
    const prepared = await prepareTaskUploads(tenantSlug, {
      taskId,
      files: candidates.map((file) => ({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      })),
    })
    if (!prepared.ok) {
      for (const file of candidates) failed.push({ name: file.name, message: prepared.message })
      return { uploaded: [], failed }
    }
    uploads = prepared.data.uploads
  } catch {
    for (const file of candidates)
      failed.push({ name: file.name, message: TASK_FILE_MESSAGES.offline })
    return { uploaded: [], failed }
  }

  const supabase = createClient()
  const bucket = supabase.storage.from(TASK_FILES_BUCKET)
  const uploaded: UploadedTaskFile[] = []

  // De a dos: un video de 40 MB no tiene que esperar a que terminen otros nueve.
  const queue = candidates.map((file, index) => ({ file, slot: uploads[index] }))
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const { file, slot } = item
      if (!slot) {
        failed.push({ name: file.name, message: TASK_FILE_MESSAGES.upload })
        continue
      }
      try {
        const { error } = await bucket.upload(slot.path, file, {
          contentType: slot.mimeType,
          upsert: false,
          cacheControl: '3600',
        })
        if (error) failed.push({ name: file.name, message: TASK_FILE_MESSAGES.upload })
        else {
          uploaded.push({
            path: slot.path,
            fileName: file.name,
            mimeType: slot.mimeType,
            sizeBytes: file.size,
          })
        }
      } catch {
        failed.push({ name: file.name, message: TASK_FILE_MESSAGES.offline })
      }
    }
  }
  await Promise.all([worker(), worker()])

  return { uploaded, failed }
}

/**
 * Si después de subir no se pudo registrar (se cortó, o la base dijo que no), lo recién
 * subido se borra con la misma sesión: el bucket deja borrar lo propio. Sin esto quedaban
 * archivos sueltos que no aparecen en ninguna tarea. Nunca tira.
 */
export async function discardUploads(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    const { error } = await createClient()
      .storage.from(TASK_FILES_BUCKET)
      .remove([...paths])
    if (error) console.error('[tareas.discardUploads]', error.message)
  } catch {
    // Sin conexión: queda para la limpieza del bucket (BACKLOG).
  }
}
