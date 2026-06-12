'use client'

import { UtensilsCrossed } from 'lucide-react'
import Image from 'next/image'
import type { ItemTag } from '@/lib/item-tags/queries'
import { cn } from '@/lib/utils'
import { monogram, pickContrastText } from './format'

/**
 * Imagen del ítem con fallback elegante: si no hay `src`, mostramos un
 * monograma sobre un degradé sutil con un glyph de cubiertos. `unoptimized`
 * porque las imágenes vienen de Storage del tenant (dominios variables).
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
      <Image
        src={src}
        alt=""
        fill
        sizes={sizes}
        className={cn('object-cover', className)}
        unoptimized
        priority={priority}
      />
    )
  }
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
