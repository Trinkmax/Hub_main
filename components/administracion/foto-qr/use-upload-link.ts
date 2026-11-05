'use client'

/**
 * El link de subida por QR, del lado de la compu: lo abre, mira cada 2,5 s qué subió el celular (solo
 * con la pestaña a la vista y hasta que vence), baja cada archivo a la memoria y al terminar lo
 * cierra y borra la copia temporal. Todo con la sesión de la persona.
 *
 * Lo que baja queda como un `File` más del formulario: lo sube a la carpeta del comprobante el flujo
 * de adjuntos de siempre. Si la pestaña se cierra sin terminar, la copia temporal la limpia el próximo
 * link de este bar (`stale_paths`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { createUploadLink, type UploadLink } from '@/lib/accounting/actions/upload-links'
import { ATTACHMENT_BUCKET, ATTACHMENT_MESSAGES } from '@/lib/accounting/attachments'
import { createClient } from '@/lib/supabase/browser'

const POLL_MS = 2_500
/** Cuántas veces se reintenta bajar un archivo antes de avisar. */
const DOWNLOAD_TRIES = 4

const remoteFilesSchema = z.array(
  z.object({
    path: z.string().min(1),
    file_name: z.string().min(1),
    mime_type: z.string().min(1),
  }),
)
type RemoteFile = z.infer<typeof remoteFilesSchema>[number]

export type UploadLinkState =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'ready'; link: UploadLink }
  | { status: 'expired' }
  | { status: 'error'; message: string }

async function listRemote(link: UploadLink): Promise<RemoteFile[] | null> {
  const { data, error } = await createClient().rpc('acc_upload_link_files_list', {
    p_tenant_id: link.tenantId,
    p_link_id: link.linkId,
  })
  if (error) return null
  const parsed = remoteFilesSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** Cierra el link y borra lo que subió el celular. Lo que no se pueda lo limpia un link futuro. */
async function closeLink(link: UploadLink): Promise<void> {
  const supabase = createClient()
  try {
    await supabase.rpc('acc_upload_link_close', {
      p_tenant_id: link.tenantId,
      p_link_id: link.linkId,
    })
    // Después de cerrar: lo que el celular haya llegado a subir recién también tiene que irse.
    const remote = await listRemote(link)
    if (remote && remote.length > 0) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove(remote.map((file) => file.path))
    }
  } catch {
    // Sin conexión al salir: queda para `stale_paths`.
  }
}

/** Baja un archivo del celular. Va con la sesión: el bucket es privado. */
async function downloadRemote(remote: RemoteFile): Promise<File | null> {
  const { data, error } = await createClient().storage.from(ATTACHMENT_BUCKET).download(remote.path)
  if (error || !data) return null
  return new File([data], remote.file_name, { type: remote.mime_type, lastModified: Date.now() })
}

export function useUploadLink(options: {
  tenantSlug: string
  /** En el celular o sin permiso no hay QR: no se abre nada. */
  enabled: boolean
  /** Llegó un archivo del celular. */
  onFile: (file: File) => void
}): {
  state: UploadLinkState
  /** Lo que no se pudo traer del celular. */
  problem: string | null
  /** «Generar otro», después de que venció o falló. */
  retry: () => void
} {
  const { tenantSlug, enabled, onFile } = options
  const [state, setState] = useState<UploadLinkState>({ status: 'idle' })
  const [problem, setProblem] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const onFileRef = useRef(onFile)
  onFileRef.current = onFile

  // Abrir el link, y cerrarlo al salir. Con una respuesta que llega tarde (se fue de la pantalla, o
  // el doble montaje de desarrollo) se cierra sin haberlo usado.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` es justamente lo que pide otro link
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' })
      return
    }
    let alive = true
    let opened: UploadLink | null = null
    setState({ status: 'creating' })
    createUploadLink(tenantSlug)
      .then((result) => {
        if (!result.ok) {
          if (alive) setState({ status: 'error', message: result.message })
          return
        }
        if (!alive) {
          void closeLink(result.data)
          return
        }
        opened = result.data
        setState({ status: 'ready', link: result.data })
      })
      .catch(() => {
        if (alive) setState({ status: 'error', message: ACC_UNREACHABLE.offline })
      })
    return () => {
      alive = false
      if (opened) void closeLink(opened)
    }
  }, [enabled, tenantSlug, attempt])

  const link = state.status === 'ready' ? state.link : null

  // Mirar lo que subió el celular.
  useEffect(() => {
    if (!link) return
    const seen = new Set<string>()
    const tries = new Map<string, number>()
    const expiresAt = Date.parse(link.expiresAt)
    let busy = false
    let alive = true

    const tick = async () => {
      if (busy || !alive) return
      if (Date.now() >= expiresAt) {
        setState({ status: 'expired' })
        return
      }
      if (document.visibilityState !== 'visible') return
      busy = true
      try {
        const remote = await listRemote(link)
        for (const file of remote ?? []) {
          if (!alive || seen.has(file.path)) continue
          const downloaded = await downloadRemote(file)
          if (!alive) return
          if (downloaded) {
            seen.add(file.path)
            setProblem(null)
            onFileRef.current(downloaded)
            continue
          }
          const count = (tries.get(file.path) ?? 0) + 1
          tries.set(file.path, count)
          if (count >= DOWNLOAD_TRIES) {
            seen.add(file.path)
            setProblem(ATTACHMENT_MESSAGES.upload)
          }
        }
      } catch {
        // Un corte: se reintenta en la próxima vuelta.
      } finally {
        busy = false
      }
    }

    const timer = window.setInterval(() => void tick(), POLL_MS)
    // Al volver a la pestaña, no esperar la próxima vuelta.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [link])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, problem, retry }
}
