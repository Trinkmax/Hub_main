'use client'

import { createBrowserClient } from '@supabase/ssr'

const BUCKET = 'menu-images'

// Lado mayor objetivo después de resize.
// 1600px cubre cualquier device retina sin sacrificar nitidez en el hero 4/3
// del sheet de detalle ni en thumbnails — y baja el peso a 80-250 KB típicos
// con codecs modernos.
const MAX_DIMENSION = 1600
const QUALITY = 0.82

// Variante thumbnail: lado mayor 320px, mismo formato que el full, path
// `{base}_t.{ext}` (ver lib/menu/media-urls.ts). La carta pública la sirve
// vía srcSet para que los thumbs de 76px no bajen el archivo de 1600px.
const THUMB_DIMENSION = 320

// Si el archivo ya viene chico y en un formato moderno, no lo recomprimimos —
// re-encodear destruye calidad sin ganancia. Threshold tunado para el caso de
// fotos exportadas pre-optimizadas (≤ 250 KB) en WebP/AVIF.
const SKIP_IF_UNDER_BYTES = 250 * 1024

type EncodeResult = { blob: Blob; ext: 'avif' | 'webp' | 'jpg'; contentType: string }

function getClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  )
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * Encoda el canvas al MIME pedido. Devuelve null si el browser cayó silenciosamente
 * a otro formato (algunos navegadores devuelven PNG cuando no soportan el codec).
 */
async function tryEncode(canvas: AnyCanvas, type: string, quality: number): Promise<Blob | null> {
  try {
    let blob: Blob | null
    if ('convertToBlob' in canvas) {
      blob = await canvas.convertToBlob({ type, quality })
    } else {
      blob = await new Promise<Blob | null>((resolve) => {
        ;(canvas as HTMLCanvasElement).toBlob((b) => resolve(b), type, quality)
      })
    }
    if (!blob) return null
    // Si el browser cayó a otro formato, lo rechazamos.
    return blob.type === type ? blob : null
  } catch {
    return null
  }
}

/**
 * Procesa la imagen: resize + re-encode con el mejor codec disponible.
 * Orden de preferencia: AVIF (mejor compresión) → WebP → JPEG.
 */
export async function processImageForUpload(file: File): Promise<EncodeResult> {
  // Atajo: ya viene chico + en formato moderno → subir tal cual.
  if (
    file.size <= SKIP_IF_UNDER_BYTES &&
    (file.type === 'image/webp' || file.type === 'image/avif')
  ) {
    const ext = file.type === 'image/avif' ? 'avif' : 'webp'
    return { blob: file, ext, contentType: file.type }
  }

  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(MAX_DIMENSION / bitmap.width, MAX_DIMENSION / bitmap.height, 1)
  const w = Math.max(1, Math.round(bitmap.width * ratio))
  const h = Math.max(1, Math.round(bitmap.height * ratio))

  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx)
    throw new Error('Canvas 2D no disponible en este navegador.')
    // biome-ignore lint/suspicious/noExplicitAny: drawImage acepta ImageBitmap en ambos contexts
  ;(ctx as any).drawImage(bitmap, 0, 0, w, h)
  // Liberar memoria del bitmap original (puede ser grande).
  bitmap.close?.()

  // 1) AVIF — Safari ≥16, Chrome ≥85, Firefox ≥113
  const avif = await tryEncode(canvas, 'image/avif', QUALITY)
  if (avif) return { blob: avif, ext: 'avif', contentType: 'image/avif' }

  // 2) WebP — soporte casi universal
  const webp = await tryEncode(canvas, 'image/webp', QUALITY)
  if (webp) return { blob: webp, ext: 'webp', contentType: 'image/webp' }

  // 3) JPEG — fallback final
  const jpeg = await tryEncode(canvas, 'image/jpeg', QUALITY)
  if (jpeg) return { blob: jpeg, ext: 'jpg', contentType: 'image/jpeg' }

  throw new Error('Tu navegador no pudo optimizar la imagen.')
}

/**
 * Genera el thumbnail (lado mayor THUMB_DIMENSION) en el MISMO formato que el
 * full — la convención `_t.{ext}` exige extensión idéntica para que
 * `thumbUrlFor` sea derivable por string. Devuelve null si el browser no puede
 * encodear ese formato (p. ej. AVIF que entró por el skip de recompresión):
 * el thumb es best-effort, la carta cae al full vía onError.
 */
async function makeThumbBlob(file: File, targetType: string): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const ratio = Math.min(THUMB_DIMENSION / bitmap.width, THUMB_DIMENSION / bitmap.height, 1)
    const w = Math.max(1, Math.round(bitmap.width * ratio))
    const h = Math.max(1, Math.round(bitmap.height * ratio))
    const canvas = makeCanvas(w, h)
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!ctx)
      return null
      // biome-ignore lint/suspicious/noExplicitAny: drawImage acepta ImageBitmap en ambos contexts
    ;(ctx as any).drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    return await tryEncode(canvas, targetType, QUALITY)
  } catch {
    return null
  }
}

export type UploadProgress = {
  stage: 'optimizing' | 'uploading' | 'done'
  originalBytes?: number
  finalBytes?: number
}

export async function uploadMenuImage(opts: {
  tenantId: string
  file: File
  onProgress?: (p: UploadProgress) => void
}): Promise<{ publicUrl: string; path: string; originalBytes: number; finalBytes: number }> {
  if (!opts.file.type.startsWith('image/')) {
    throw new Error('Solo imágenes (PNG, JPG, WebP, AVIF, HEIC).')
  }
  if (opts.file.size > 20 * 1024 * 1024) {
    throw new Error('La imagen pesa más de 20 MB. Reducila antes de subir.')
  }

  opts.onProgress?.({ stage: 'optimizing', originalBytes: opts.file.size })

  const { blob, ext, contentType } = await processImageForUpload(opts.file)

  opts.onProgress?.({
    stage: 'uploading',
    originalBytes: opts.file.size,
    finalBytes: blob.size,
  })

  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  const path = `${opts.tenantId}/${stamp}_${rand}.${ext}`

  const supabase = getClient()
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw error

  // Thumb SIEMPRE (aunque el full haya salteado la recompresión): mismo
  // formato, path `{base}_t.{ext}`. Best-effort — un fallo acá no rompe el
  // upload: la carta cae al full vía onError de StorageImage.
  try {
    const thumb = await makeThumbBlob(opts.file, contentType)
    if (thumb) {
      const thumbPath = `${opts.tenantId}/${stamp}_${rand}_t.${ext}`
      await supabase.storage.from(BUCKET).upload(thumbPath, thumb, {
        contentType,
        cacheControl: '31536000',
        upsert: false,
      })
    }
  } catch {
    // best-effort
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path)

  opts.onProgress?.({
    stage: 'done',
    originalBytes: opts.file.size,
    finalBytes: blob.size,
  })

  return { publicUrl, path, originalBytes: opts.file.size, finalBytes: blob.size }
}

/** Path dentro del bucket a partir de la URL pública, o null si no matchea. */
export function storagePathFromUrl(url: string): string | null {
  const marker = `/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  const path = url.slice(idx + marker.length).split('?')[0]
  return path && path.length > 0 ? path : null
}

/**
 * Borra una imagen del bucket junto con sus derivados por convención
 * (ver lib/menu/media-urls.ts): el thumb `_t.{ext}` siempre; y si la URL
 * resulta ser de un video (`_v.{ext}`), también su poster `_vp.webp` —
 * defensa por si un caller le pasa la URL equivocada (para videos usar
 * `deleteMenuVideoByUrl` de lib/menu/upload-video.ts).
 */
export async function deleteMenuImageByUrl(url: string): Promise<void> {
  const path = storagePathFromUrl(url)
  if (!path) return
  const paths = [path]
  const dot = path.lastIndexOf('.')
  if (dot > path.lastIndexOf('/')) {
    const base = path.slice(0, dot)
    const ext = path.slice(dot)
    if (base.endsWith('_v')) {
      paths.push(`${base.slice(0, -2)}_vp.webp`)
    } else {
      paths.push(`${base}_t${ext}`)
    }
  }
  const supabase = getClient()
  await supabase.storage.from(BUCKET).remove(paths)
}
