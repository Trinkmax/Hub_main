'use client'

import { useState } from 'react'
import { isStorageUrl, thumbUrlFor } from '@/lib/menu/media-urls'
import { cn } from '@/lib/utils'

/**
 * Imagen de Supabase Storage SIN next/image (la cuota del optimizer de Vercel
 * está agotada y no se upgradea). Sirve variantes pregeneradas vía srcSet:
 * thumb 320px (`_t.{ext}`, ver lib/menu/media-urls.ts) + full 1600px, y el
 * browser elige según `sizes`.
 *
 * - Fill-style: absolute inset-0 + object-cover; el caller envuelve en un
 *   contenedor `relative` (mismo contrato que next/image fill).
 * - Fade-in al cargar (el fondo del contenedor se ve mientras).
 * - onError en dos pasos: si falla con srcSet (thumb inexistente pre-backfill)
 *   reintenta sólo con el full; si vuelve a fallar, muestra `children` como
 *   fallback del caller.
 * - URLs que no son de Storage (logos externos, etc.) van como src plano.
 */
export function StorageImage({
  src,
  sizes,
  className,
  alt = '',
  priority = false,
  children,
}: {
  src: string
  sizes: string
  className?: string
  alt?: string
  priority?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  // 0 = srcSet (thumb + full) · 1 = sólo full · 2 = fallback del caller.
  // Sin thumb derivable (URLs ya derivadas, ej. posters `_vp.webp`) arrancamos en 1.
  const storage = isStorageUrl(src)
  const thumb = thumbUrlFor(src)
  const hasThumb = storage && thumb !== src
  const [attempt, setAttempt] = useState(hasThumb ? 0 : 1)

  // Si cambia el src (filas reutilizadas en listas), el estado de error/carga
  // del src anterior no aplica — se resetea durante el render (patrón React).
  const [prevSrc, setPrevSrc] = useState(src)
  if (prevSrc !== src) {
    setPrevSrc(src)
    setAttempt(hasThumb ? 0 : 1)
    setLoaded(false)
  }

  if (attempt >= 2) return <>{children ?? null}</>

  const useSrcSet = hasThumb && attempt === 0

  return (
    // biome-ignore lint/performance/noImgElement: optimizer de Vercel agotado — servimos variantes pregeneradas de Storage
    <img
      key={attempt}
      ref={(el) => {
        // Si la imagen ya estaba en caché al hidratar, onLoad no vuelve a
        // dispararse — detectamos `complete` para no dejarla en opacity-0.
        if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true)
      }}
      src={src}
      srcSet={useSrcSet ? `${thumb} 320w, ${src} 1600w` : undefined}
      sizes={useSrcSet ? sizes : undefined}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false)
        setAttempt((a) => a + 1)
      }}
      className={cn(
        'absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out',
        loaded ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  )
}
