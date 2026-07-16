'use client'

import { Sparkles, Star } from 'lucide-react'
import { posterUrlFor } from '@/lib/menu/media-urls'
import type { MenuItem } from '@/lib/menu/queries'
import { formatARS } from './format'
import { ItemImage } from './item-visual'

/**
 * Scroller horizontal de "Recomendados": ítems con featured=true de todo el
 * árbol. Se oculta si no hay ninguno. Tap abre el detalle del ítem.
 */
export function FeaturedCarousel({
  items,
  onOpen,
}: {
  items: MenuItem[]
  onOpen: (item: MenuItem) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null

  return (
    <section aria-labelledby="carta-recomendados" className="pt-1">
      <h2
        id="carta-recomendados"
        className="mb-3 flex items-center gap-1.5 px-1 font-serif text-lg font-semibold tracking-tight"
      >
        <Sparkles className="size-4 text-warning" aria-hidden />
        Recomendados
      </h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => (
          <li key={`rec-${it.id}`} className="snap-start">
            <button
              type="button"
              onClick={() => onOpen(it)}
              aria-label={`Ver ${it.name}`}
              className="card-hairline group flex w-[15.5rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card text-left shadow-sm ring-1 ring-[color:var(--brand-accent,var(--primary))]/15 transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99]"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary/40">
                <ItemImage
                  src={it.image_url ?? (it.video_url ? posterUrlFor(it.video_url) : null)}
                  name={it.name}
                  sizes="248px"
                  className="transition-transform duration-[var(--duration-slow)] group-hover:scale-105"
                />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-warning/95 px-2 py-0.5 text-[10px] font-semibold text-warning-foreground shadow-sm">
                  <Star className="size-3 fill-current" aria-hidden />
                  Destacado
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="line-clamp-1 font-medium leading-tight">{it.name}</p>
                {it.description && (
                  <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {it.description}
                  </p>
                )}
                <p className="mt-auto pt-1 font-serif text-base font-semibold tabular-nums [color:var(--brand-accent,var(--primary))]">
                  {formatARS(it.price_cents)}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
