import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptToken } from './crypto'
import { graphUrl } from './env'
import { metaFetch } from './http'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type MediaChannelLike = {
  id: string
  encrypted_access_token: string | null
  tenant_id: string
}

type MediaMetaResponse = {
  url: string
  mime_type: string
  file_size?: number
  sha256?: string
  id?: string
}

// ---------------------------------------------------------------------------
// Mapa MIME → extensión (pure, testeable)
// ---------------------------------------------------------------------------

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'text/plain': 'txt',
}

export function extForMime(mime: string): string {
  const base = mime.toLowerCase().split(';')[0] ?? ''
  return MIME_TO_EXT[base.trim()] ?? 'bin'
}

// ---------------------------------------------------------------------------
// Paso 1: Obtener metadatos del media (URL de descarga temporal + mime_type)
// GET /{media-id}?phone_number_id={phone_number_id}
// Responde: { url, mime_type, file_size, sha256, id }
// ---------------------------------------------------------------------------

export async function getMediaMeta(
  accessToken: string,
  mediaId: string,
): Promise<{ url: string; mime_type: string }> {
  const url = graphUrl(mediaId)
  const res = await metaFetch<MediaMetaResponse>(url, { accessToken })
  if (!res.url || !res.mime_type) {
    throw new Error(`getMediaMeta: respuesta inesperada para media_id=${mediaId}`)
  }
  return { url: res.url, mime_type: res.mime_type }
}

// ---------------------------------------------------------------------------
// Paso 2: Descargar bytes crudos
// GET <url> con mismo Bearer token — metaFetch es JSON-only; usar fetch directo
// ---------------------------------------------------------------------------

export async function downloadMediaBytes(
  url: string,
  accessToken: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`downloadMediaBytes: HTTP ${res.status} al descargar media`)
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  const bytes = await res.arrayBuffer()
  return { bytes, contentType }
}

// ---------------------------------------------------------------------------
// Paso 3: Orquestador completo — descarga + sube a Storage + actualiza mensaje
// ---------------------------------------------------------------------------

export type DownloadAndStoreOpts = {
  messageId: string
  channelId: string
  mediaId: string
  mediaType: string
  tenantId: string
}

export async function downloadAndStoreMedia(opts: DownloadAndStoreOpts): Promise<void> {
  const { messageId, channelId, mediaId, mediaType, tenantId } = opts
  const service = createServiceClient()

  // Resolver canal y obtener token de acceso
  const { data: channel, error: chErr } = await service
    .from('channels')
    .select('id, encrypted_access_token, tenant_id')
    .eq('id', channelId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (chErr || !channel) {
    throw new Error(`downloadAndStoreMedia: canal no encontrado (id=${channelId})`)
  }
  if (!channel.encrypted_access_token) {
    throw new Error(`downloadAndStoreMedia: canal sin access_token (id=${channelId})`)
  }

  const accessToken = await decryptToken(channel.encrypted_access_token)

  try {
    // 1. Meta media meta → URL firmada temporal
    const { url, mime_type } = await getMediaMeta(accessToken, mediaId)

    // 2. Descargar bytes
    const { bytes, contentType } = await downloadMediaBytes(url, accessToken)

    // 3. Derivar extensión y ruta en Storage
    const ext = extForMime(mime_type)
    const storagePath = `${tenantId}/${messageId}.${ext}`

    // 4. Subir a bucket message-media (service role bypasses RLS)
    const { error: uploadErr } = await service.storage
      .from('message-media')
      .upload(storagePath, new Uint8Array(bytes), {
        contentType,
        upsert: true,
      })
    if (uploadErr) {
      throw new Error(`downloadAndStoreMedia: upload falló — ${uploadErr.message}`)
    }

    // 5. Actualizar messages.media mergeando los campos de descarga
    const { error: updateErr } = await service
      .from('messages')
      .update({
        media: {
          type: mediaType,
          id: mediaId,
          storage_path: storagePath,
          mime: contentType,
          downloaded: true,
        },
      })
      .eq('id', messageId)
      .eq('tenant_id', tenantId)
    if (updateErr) {
      throw new Error(`downloadAndStoreMedia: update messages falló — ${updateErr.message}`)
    }
  } catch (err) {
    // Intentar registrar el error en el envelope (best-effort, sin lanzar)
    const msg = err instanceof Error ? err.message : String(err)
    try {
      await service
        .from('messages')
        .update({
          media: {
            type: mediaType,
            id: mediaId,
            downloaded: false,
            download_error: msg,
          },
        })
        .eq('id', messageId)
        .eq('tenant_id', tenantId)
    } catch {
      // Ignorar: error en el registro del error no debe ocultar el original
    }

    // Re-lanzar para que el job runner aplique backoff (Error genérico = recoverable)
    throw err
  }
}
