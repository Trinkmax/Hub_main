'use client'

import { ChevronRight, Sparkles, Star } from 'lucide-react'
import type { MenuItem } from '@/lib/menu/queries'
import { cn } from '@/lib/utils'
import { formatARS } from './format'
import { ItemImage, TagChip } from './item-visual'

/**
 * Fila de ítem en la carta (read-only). Tap abre el detalle. Muestra imagen,
 * nombre, descripción a 2 líneas, tags, hint de puntos y precio. Sin selector
 * de cantidad ni botón de agregar: la carta sólo informa.
 */
export function ItemCard({
  item,
  onOpen,
}: {
  item: MenuItem
  onOpen: (item: MenuItem) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`Ver ${item.name}`}
      className="card-hairline group flex w-full items-stretch gap-3 rounded-2xl border border-border/60 bg-card p-2.5 text-left shadow-sm transition-all duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99]"
    >
      <div className="relative size-[76px] shrink-0 overflow-hidden rounded-xl bg-secondary/40">
        <ItemImage src={item.image_url} name={item.name} sizes="76px" />
        {item.featured && (
          <span
            role="img"
            className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-warning/95 text-warning-foreground shadow-sm"
            aria-label="Recomendado"
          >
            <Star className="size-3 fill-current" aria-hidden />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="line-clamp-1 font-medium leading-tight">{item.name}</p>
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
              {item.description}
            </p>
          )}
        </div>
        {(item.tags.length > 0 || item.points_override != null) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
            {item.points_override != null && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-semibold leading-tight text-warning">
                <Sparkles className="size-2.5" aria-hidden />+{item.points_override} pts
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end justify-between py-0.5 pl-1">
        <span
          className={cn(
            'font-serif text-base font-semibold tabular-nums',
            '[color:var(--brand-accent,var(--primary))]',
          )}
        >
          {formatARS(item.price_cents)}
        </span>
        <ChevronRight
          className="size-4 text-muted-foreground/70 transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
    </button>
  )
}
