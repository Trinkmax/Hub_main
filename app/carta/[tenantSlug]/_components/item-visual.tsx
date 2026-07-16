'use client'

import { UtensilsCrossed } from 'lucide-react'
import { StorageImage } from '@/components/media/storage-image'
import type { ItemTag } from '@/lib/item-tags/queries'
import { cn } from '@/lib/utils'
import { monogram, pickContrastText } from './format'

/** Fallback elegante: monograma sobre degradé sutil con glyph de cubiertos. */
function ItemMonogram({ name }: { name: string }): React.JSX.Element {
  return (
    <div
      aria-hidden
      className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-secondary/60 via-secondary/30 to-accent/30 text-muted-foreground/60"
    >
      <span className="font-serif text-lg font-semibold tracking-tight">{monogram(name)}</span>
      <UtensilsCrossed className="size-4 opacity-50" />
    </div>
  )
}

/**
 * Imagen del ítem servida directo de Storage (variantes pregeneradas vía
 * StorageImage — el optimizer de Vercel está agotado). Si no hay `src` o la
 * carga falla dos veces, cae al monograma.
 */
export function ItemImage({
  src,
  name,
  className,
  sizes,
  priority = false,
}: {
  src: string | null
  name: string
  className?: string
  sizes: string
  priority?: boolean
}): React.JSX.Element {
  if (src) {
    return (
      <StorageImage src={src} sizes={sizes} className={className} priority={priority}>
        <ItemMonogram name={name} />
      </StorageImage>
    )
  }
  return <ItemMonogram name={name} />
}

/** Chip de tag tintado con el color del tag y texto de contraste legible. */
export function TagChip({
  tag,
  className,
}: {
  tag: ItemTag
  className?: string
}): React.JSX.Element {
  const tone = pickContrastText(tag.color)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-px text-[10px] font-medium leading-tight shadow-2xs',
        tone === 'light' ? 'text-white' : 'text-foreground',
        className,
      )}
      style={{ backgroundColor: tag.color }}
    >
      {tag.name}
    </span>
  )
}
