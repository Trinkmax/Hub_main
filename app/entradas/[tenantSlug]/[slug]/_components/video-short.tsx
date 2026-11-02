'use client'

import { Play } from 'lucide-react'
import { useState } from 'react'
import { youtubeEmbedUrl, youtubeThumbnailUrl } from '@/lib/ticketing/video'

/**
 * El video de la experiencia (un Short de YouTube) en un celular, como en las
 * landings de los socios. Hasta que la persona toca «play» es solo la
 * miniatura: el reproductor de YouTube pesa y la página no lo carga de más.
 * Al tocar, se monta el embed sin cookies de seguimiento y arranca solo.
 */
export function VideoShort({ id, title }: { id: string; title: string }) {
  const [playing, setPlaying] = useState(false)
  const [thumb, setThumb] = useState(() => youtubeThumbnailUrl(id, 'max'))

  return (
    <div className="ent-phone relative mx-auto aspect-[9/16] w-full max-w-[16.5rem]">
      {playing ? (
        <iframe
          src={youtubeEmbedUrl(id)}
          title={`Así es ${title} en el bar`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 size-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 size-full cursor-pointer"
          aria-label={`Ver el video de ${title}`}
        >
          {/* biome-ignore lint/performance/noImgElement: miniatura de YouTube (i.ytimg.com), fuera del cargador de Supabase */}
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            // Sin la grande, YouTube devuelve un gris de 120 × 90 en vez de un error.
            onLoad={(e) => {
              if (e.currentTarget.naturalWidth <= 120) setThumb(youtubeThumbnailUrl(id, 'hq'))
            }}
            onError={() => setThumb(youtubeThumbnailUrl(id, 'hq'))}
            className="absolute inset-0 size-full object-cover"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.65),transparent_45%,rgb(0_0_0/0.25))]"
          />
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="ent-press grid size-16 place-items-center rounded-full bg-(--ent-cream) text-(--ent-ink) shadow-[0_18px_40px_-12px_rgb(0_0_0/0.7)] transition-transform duration-200 ease-out group-hover:scale-105">
              <Play className="ml-1 size-7 fill-current" />
            </span>
          </span>
        </button>
      )}
    </div>
  )
}
