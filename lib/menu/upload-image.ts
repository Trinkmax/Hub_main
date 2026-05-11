'use client'

import { createBrowserClient } from '@supabase/ssr'

const BUCKET = 'menu-images'

// Reduce el lado mayor a este valor antes de subir. WhatsApp/IG/mobiles
// rara vez necesitan más; payload baja de MBs a ~200 KB típico.
const MAX_DIMENSION = 800
const JPEG_QUALITY = 0.85

function getClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  )
}

async function resizeToBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(MAX_DIMENSION / bitmap.width, MAX_DIMENSION / bitmap.height, 1)
  const w = Math.round(bitmap.width * ratio)
  const h = Math.round(bitmap.height * ratio)

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : (() => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          return c
        })()

  // OffscreenCanvas y HTMLCanvasElement comparten 2D context API
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx)
    throw new Error('Canvas 2D no disponible')
    // biome-ignore lint/suspicious/noExplicitAny: drawImage acepta ImageBitmap en ambos contexts
  ;(ctx as any).drawImage(bitmap, 0, 0, w, h)

  if ('convertToBlob' in canvas) {
    return await canvas.convertToBlob({ type: 'image/webp', quality: JPEG_QUALITY })
  }
  return await new Promise<Blob>((resolve, reject) => {
    ;(canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob falló'))),
      'image/webp',
      JPEG_QUALITY,
    )
  })
}

export async function uploadMenuImage(opts: {
  tenantId: string
  file: File
}): Promise<{ publicUrl: string; path: string }> {
  if (!opts.file.type.startsWith('image/')) {
    throw new Error('Solo imágenes (PNG, JPG, WebP).')
  }
  if (opts.file.size > 8 * 1024 * 1024) {
    throw new Error('La imagen pesa más de 8 MB. Reducila antes de subir.')
  }

  const blob = await resizeToBlob(opts.file)
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  const path = `${opts.tenantId}/${stamp}_${rand}.webp`

  const supabase = getClient()
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw error

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { publicUrl, path }
}

export async function deleteMenuImageByUrl(url: string): Promise<void> {
  // El path es lo que viene después de `/menu-images/`. Tolera URLs firmadas
  // y públicas; si no podemos extraer el path lo dejamos pasar.
  const marker = `/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return
  const path = url.slice(idx + marker.length).split('?')[0]
  if (!path) return
  const supabase = getClient()
  await supabase.storage.from(BUCKET).remove([path])
}
