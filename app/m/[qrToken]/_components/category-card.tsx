'use client'

import { ChevronRight } from 'lucide-react'
import Image from 'next/image'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { cn } from '@/lib/utils'

type Category = ActiveSessionStateData['menu'][number]

export function CategoryCard({
  category,
  onSelect,
}: {
  category: Category
  onSelect: (id: string) => void
}) {
  const count = category.items.length
  const countLabel = `${count} ${count === 1 ? 'opción' : 'opciones'}`
  // Con imagen el texto va sobre un degradé fijo oscuro → blanco en ambos temas.
  // Sin imagen va sobre bg-primary → text-primary-foreground contrasta por
  // definición en light y dark. (text-primary-foreground es oscuro en dark mode,
  // así que NO sirve sobre el degradé de la foto.)
  const onImage = Boolean(category.image_url)

  return (
    <button
      type="button"
      onClick={() => onSelect(category.id)}
      className="card-hairline group relative flex h-28 w-full items-end overflow-hidden rounded-2xl border border-border/60 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {category.image_url ? (
        <>
          <Image
            src={category.image_url}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 480px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            unoptimized
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-[oklch(0.15_0.03_165_/_0.82)] via-[oklch(0.15_0.03_165_/_0.15)] to-transparent"
          />
        </>
      ) : (
        <div aria-hidden className="absolute inset-0 bg-primary">
          <div className="absolute -right-6 -top-6 size-28 rounded-full bg-[--forest-glow] blur-2xl" />
        </div>
      )}
      <div className="relative flex w-full items-end justify-between p-4">
        <div className="min-w-0">
          <p
            className={cn(
              'font-serif text-xl font-semibold leading-tight tracking-tight text-balance',
              onImage ? 'text-white' : 'text-primary-foreground',
            )}
          >
            {category.name}
          </p>
          <p
            className={cn(
              'mt-0.5 text-[11px] font-medium',
              onImage ? 'text-white/85' : 'text-primary-foreground/80',
            )}
          >
            {countLabel}
          </p>
        </div>
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full backdrop-blur-sm transition-transform group-hover:translate-x-0.5',
            onImage ? 'bg-white/20 text-white' : 'bg-primary-foreground/15 text-primary-foreground',
          )}
        >
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </div>
    </button>
  )
}
