'use client'

import { createBrowserClient } from '@supabase/ssr'
import { storagePathFromUrl, type UploadProgress } from './upload-image'

// Subida de videos de ítems al bucket `menu-images` (mismo bucket que las
// fotos, límite 60MB / MIME whitelist configurados en Storage). Convención de
// paths en lib/menu/media-urls.ts:
//   video   `{tenantId}/{stamp}_{rand}_v.{ext}`
//   poster  `{tenantId}/{stamp}_{rand}_vp.webp` (frame ~0.5s, lado mayor 1280)

const BUCKET = 'menu-images'

// Margen bajo el file_size_limit de 60MB del bucket para no chocar con el 413.
const MAX_VIDEO_BYTES = 55 * 1024 * 1024
const MAX_DURATION_SECONDS = 90

const POSTER_MAX_DIMENSION = 1280
const POSTER_QUALITY = 0.8
const POSTER_SEEK_SECONDS = 0.5

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

function getClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  )
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * Carga el file en un <video> offscreen hasta tener metadata. Devuelve null si
 * el browser no puede (formato no soportado para playback, etc.) — en ese caso
 * seguimos sin validar duración ni generar poster.
 */
async function loadOffscreenVideo(
  file: File,
): Promise<{ video: HTMLVideoElement; cleanup: () => void } | null> {
  if (typeof document === 'undefined') return null
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = url
  const cleanup = () => {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('video error')), { once: true })
      }),
      8000,
    )
    return { video, cleanup }
  } catch {
    cleanup()
    return null
  }
}

/** Captura un frame ~0.5s como WebP (lado mayor 1280, q0.8). Best-effort. */
async function capturePosterBlob(video: HTMLVideoElement): Promise<Blob | null> {
  try {
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const target = duration > 0 ? Math.min(POSTER_SEEK_SECONDS, duration * 0.5) : 0
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.addEventListener('seeked', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('seek error')), { once: true })
        video.currentTime = target
      }),
      8000,
    )
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return null
    const ratio = Math.min(POSTER_MAX_DIMENSION / vw, POSTER_MAX_DIMENSION / vh, 1)
    const w = Math.max(1, Math.round(vw * ratio))
    const h = Math.max(1, Math.round(vh * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', POSTER_QUALITY)
    })
    // Algunos browsers caen silenciosamente a PNG si no encodean WebP.
    return blob && blob.type === 'image/webp' ? blob : null
  } catch {
    return null
  }
}

export async function uploadMenuVideo(opts: {
  tenantId: string
  file: File
  onProgress?: (p: UploadProgress) => void
}): Promise<{ publicUrl: string; path: string; bytes: number }> {
  const ext = EXT_BY_MIME[opts.file.type]
  if (!ext) {
    throw new Error('Formato no soportado. Subí un video MP4, WebM o MOV.')
  }
  if (opts.file.size > MAX_VIDEO_BYTES) {
    throw new Error('El video pesa más de 55 MB. Comprimilo antes de subir.')
  }

  opts.onProgress?.({ stage: 'optimizing', originalBytes: opts.file.size })

  // Metadata + poster con un <video> offscreen. Si el browser no puede leer
  // el archivo, seguimos sin validar duración ni poster (no bloquea el upload).
  let posterBlob: Blob | null = null
  const loaded = await loadOffscreenVideo(opts.file)
  if (loaded) {
    try {
      const { duration } = loaded.video
      if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) {
        throw new Error(
          `El video dura ${Math.round(duration)}s. El máximo es ${MAX_DURATION_SECONDS}s.`,
        )
      }
      posterBlob = await capturePosterBlob(loaded.video)
    } finally {
      loaded.cleanup()
    }
  }

  opts.onProgress?.({
    stage: 'uploading',
    originalBytes: opts.file.size,
    finalBytes: opts.file.size,
  })

  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  const path = `${opts.tenantId}/${stamp}_${rand}_v.${ext}`

  const supabase = getClient()
  const { error } = await supabase.storage.from(BUCKET).upload(path, opts.file, {
    contentType: opts.file.type,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw error

  // Poster best-effort: si la captura o la subida fallan, el video queda sin
  // poster (el player muestra el primer frame vía preload="metadata").
  if (posterBlob) {
    try {
      await supabase.storage
        .from(BUCKET)
        .upload(`${opts.tenantId}/${stamp}_${rand}_vp.webp`, posterBlob, {
          contentType: 'image/webp',
          cacheControl: '31536000',
          upsert: false,
        })
    } catch {
      // best-effort
    }
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path)

  opts.onProgress?.({
    stage: 'done',
    originalBytes: opts.file.size,
    finalBytes: opts.file.size,
  })

  return { publicUrl, path, bytes: opts.file.size }
}

/** Borra el video y su poster derivado (`..._v.{ext}` + `..._vp.webp`). */
export async function deleteMenuVideoByUrl(url: string): Promise<void> {
  const path = storagePathFromUrl(url)
  if (!path) return
  const paths = [path]
  const dot = path.lastIndexOf('.')
  if (dot > path.lastIndexOf('/')) {
    const base = path.slice(0, dot)
    if (base.endsWith('_v')) paths.push(`${base.slice(0, -2)}_vp.webp`)
  }
  const supabase = getClient()
  await supabase.storage.from(BUCKET).remove(paths)
}
