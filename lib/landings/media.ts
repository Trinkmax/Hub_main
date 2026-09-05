'use client'

import { createBrowserClient } from '@supabase/ssr'
import { processImageForUpload } from '@/lib/menu/upload-image'

/**
 * Las imágenes de las landings.
 *
 * Suben DESDE EL BROWSER, igual que las fotos de la carta: una Server Action
 * tiene 1 MB de límite de body y una foto de celular pesa cuatro veces eso.
 * La sesión del dueño más las policies del bucket (`landing-media`, una carpeta
 * por bar) son las que autorizan — ver la migración 20260905120000.
 *
 * El bucket es público a propósito: estas imágenes se ven en una página que
 * abre cualquiera. Por eso también tiene allowlist de MIME (nada de .html ni
 * SVG, que son contenido activo).
 */

const BUCKET = 'landing-media'

/** El techo del bucket. Avisamos antes de subir para no comerse un 413 mudo. */
const MAX_BYTES = 10 * 1024 * 1024

export type LandingImage = {
  path: string
  name: string
  publicUrl: string
  bytes: number
  createdAt: string | null
}

function getClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  )
}

export async function listLandingImages(tenantId: string): Promise<LandingImage[]> {
  const supabase = getClient()
  const { data, error } = await supabase.storage.from(BUCKET).list(tenantId, {
    limit: 100,
    sortBy: { column: 'created_at', order: 'desc' },
  })
  if (error) throw error

  return (
    (data ?? [])
      // Storage devuelve un placeholder para las carpetas vacías: no es un archivo.
      .filter((file) => file.name !== '.emptyFolderPlaceholder')
      .map((file) => {
        const path = `${tenantId}/${file.name}`
        const {
          data: { publicUrl },
        } = supabase.storage.from(BUCKET).getPublicUrl(path)
        return {
          path,
          name: file.name,
          publicUrl,
          bytes: Number((file.metadata as { size?: number } | null)?.size ?? 0),
          createdAt: file.created_at ?? null,
        }
      })
  )
}

export async function uploadLandingImage(opts: {
  tenantId: string
  file: File
}): Promise<LandingImage> {
  const { tenantId, file } = opts

  if (!file.type.startsWith('image/')) {
    throw new Error('Solo imágenes (JPG, PNG, WebP, AVIF o GIF).')
  }
  if (file.size > MAX_BYTES) {
    throw new Error('La imagen pesa más de 10 MB. Reducila antes de subir.')
  }

  // El GIF va tal cual: pasarlo por el canvas lo dejaría en un solo cuadro, y
  // media de las promos del bar son gifs animados.
  const isGif = file.type === 'image/gif'
  const { blob, ext, contentType } = isGif
    ? { blob: file as Blob, ext: 'gif', contentType: 'image/gif' }
    : await processImageForUpload(file)

  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  const path = `${tenantId}/${stamp}_${rand}.${ext}`

  const supabase = getClient()
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType,
    // Un año: el nombre lleva un random, así que la URL nunca se reusa.
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw error

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return {
    path,
    name: path.split('/').pop() ?? path,
    publicUrl,
    bytes: blob.size,
    createdAt: new Date().toISOString(),
  }
}

export async function deleteLandingImage(path: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}
