import { Film } from 'lucide-react'
import Image from 'next/image'
import type { CSSProperties } from 'react'
import { eventInk } from '@/lib/salon/event-ink'
import { cn } from '@/lib/utils'

/** Los GIF van tal cual: el transformador de imágenes los dejaría en un solo cuadro. */
export function isGifUrl(url: string): boolean {
  return /\.gif(?:$|\?)/i.test(url)
}

/**
 * El afiche de una película (2:3). Sin afiche, un cartón del color del formato
 * del calendario: la misma tinta domada de «Cómo nos fue» (lib/salon/event-ink),
 * así un amarillo limón del calendario igual se lee sobre el crema.
 */
export function PosterThumb({
  url,
  color,
  sizes = '80px',
  className,
}: {
  url: string | null
  /** Hex del formato del calendario, para el cartón sin afiche. */
  color: string | null
  sizes?: string
  className?: string
}) {
  const ink = eventInk(color)
  return (
    <div
      style={ink ? ({ '--ev-l': ink.light, '--ev-d': ink.dark } as CSSProperties) : undefined}
      className={cn(
        'ev-ink relative aspect-[2/3] shrink-0 overflow-hidden rounded-lg border border-border/70 bg-(--ev)/10',
        className,
      )}
    >
      {url ? (
        <Image
          src={url}
          alt=""
          fill
          sizes={sizes}
          className="object-cover"
          unoptimized={isGifUrl(url)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-(--ev)">
          <Film className="size-6" aria-hidden />
        </div>
      )}
    </div>
  )
}
