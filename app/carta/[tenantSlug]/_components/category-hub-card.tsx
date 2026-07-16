'use client'

import { ChevronRight, UtensilsCrossed } from 'lucide-react'
import { StorageImage } from '@/components/media/storage-image'
import { monogram } from './format'

/** Fallback sin foto: monograma grande sobre degradé. */
function CategoryMonogram({ name }: { name: string }): React.JSX.Element {
  return (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary/70 via-secondary/40 to-accent/40"
    >
      <span className="font-serif text-5xl font-semibold tracking-tight text-muted-foreground/35">
        {monogram(name)}
      </span>
      <UtensilsCrossed
        className="absolute right-3 top-3 size-4 text-muted-foreground/30"
        aria-hidden
      />
    </div>
  )
}

/**
 * Tarjeta de una sección de la carta en el hub drill-down. Tap → entra a esa
 * sección (subsecciones o ítems). Imagen de la categoría con fallback a monograma.
 */
export function CategoryHubCard({
  name,
  imageUrl,
  subtitle,
  onOpen,
}: {
  name: string
  imageUrl: string | null
  subtitle: string
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Ver ${name}`}
      className="card-hairline group relative flex aspect-[5/4] w-full flex-col justify-end overflow-hidden rounded-2xl border border-border/60 bg-card text-left shadow-sm transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99]"
    >
      <div className="absolute inset-0">
        {imageUrl ? (
          <StorageImage
            src={imageUrl}
            sizes="(max-width: 672px) 50vw, 320px"
            className="transition-transform duration-[var(--duration-slow)] group-hover:scale-105"
          >
            <CategoryMonogram name={name} />
          </StorageImage>
        ) : (
          <CategoryMonogram name={name} />
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent"
        />
      </div>

      <div className="relative flex items-end justify-between gap-2 p-3.5">
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-semibold leading-tight tracking-tight text-white text-balance drop-shadow-sm">
            {name}
          </h3>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-white/80">
            {subtitle}
          </p>
        </div>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5">
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </div>
    </button>
  )
}
