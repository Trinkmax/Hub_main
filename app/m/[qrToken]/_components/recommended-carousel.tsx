'use client'

import { ImageOff, Sparkles, Star } from 'lucide-react'
import Image from 'next/image'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { ARSFormat } from './item-row'

type Item = ActiveSessionStateData['menu'][number]['items'][number]

export function RecommendedCarousel({
  items,
  onOpen,
}: {
  items: Item[]
  onOpen: (item: Item) => void
}) {
  if (items.length === 0) return null

  return (
    <section aria-labelledby="recommended-title">
      <h2
        id="recommended-title"
        className="mb-3 flex items-center gap-1.5 font-serif text-lg font-semibold tracking-tight"
      >
        <Sparkles className="size-4 text-warning" aria-hidden />
        Recomendados
      </h2>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => (
          <button
            key={`rec-${it.id}`}
            type="button"
            onClick={() => onOpen(it)}
            className="card-hairline group flex w-[15.5rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary/40">
              {it.image_url ? (
                <Image
                  src={it.image_url}
                  alt=""
                  fill
                  sizes="248px"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                  <ImageOff className="size-8" aria-hidden />
                </div>
              )}
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-warning/95 px-2 py-0.5 text-[10px] font-semibold text-warning-foreground shadow-sm">
                <Star className="size-3 fill-current" aria-hidden />
                Destacado
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <p className="line-clamp-1 font-medium leading-tight">{it.name}</p>
              {it.description && (
                <p className="line-clamp-2 text-xs text-muted-foreground">{it.description}</p>
              )}
              <p className="mt-auto pt-1 font-serif text-base font-semibold tabular-nums">
                {ARSFormat(it.price_cents)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
