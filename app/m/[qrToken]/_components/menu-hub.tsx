'use client'

import { ArrowLeft, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { searchMenuItems } from '@/lib/m-session/menu-search'
import { CategoryCard } from './category-card'
import { ItemDetailSheet } from './item-detail-sheet'
import { ItemRow } from './item-row'
import type { CartItem } from './mesa-screen'
import { RecommendedCarousel } from './recommended-carousel'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]

export function MenuHub({
  categories,
  onAdd,
}: {
  categories: Category[]
  onAdd: (item: CartItem) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<Item | null>(null)

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.items.length > 0),
    [categories],
  )
  const featured = useMemo(
    () => categories.flatMap((c) => c.items.filter((i) => i.featured)).slice(0, 6),
    [categories],
  )
  const searchResults = useMemo(() => searchMenuItems(categories, query), [categories, query])
  const selected = useMemo(
    () => (selectedId ? (categories.find((c) => c.id === selectedId) ?? null) : null),
    [categories, selectedId],
  )

  const searching = query.trim().length > 0

  return (
    <div className="space-y-5">
      {!selected && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en toda la carta…"
            className="h-11 rounded-xl pl-9 text-sm"
            aria-label="Buscar en la carta"
          />
        </div>
      )}

      {!selected && searching ? (
        searchResults.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
            <p className="text-sm font-medium">Sin resultados</p>
            <p className="mt-1 text-xs text-muted-foreground">Probá con otra búsqueda.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {searchResults.map((it) => (
              <ItemRow key={it.id} item={it} onOpen={setOpening} />
            ))}
          </div>
        )
      ) : selected ? (
        <section aria-labelledby="cat-detail-title" className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="flex size-9 items-center justify-center rounded-full border border-border/60 bg-card text-foreground shadow-sm transition-colors hover:bg-[--cream-tint] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="Volver a las categorías"
            >
              <ArrowLeft className="size-4" />
            </button>
            <h2 id="cat-detail-title" className="font-serif text-xl font-semibold tracking-tight">
              {selected.name}
            </h2>
          </div>
          <div className="space-y-2">
            {selected.items.map((it) => (
              <ItemRow key={it.id} item={it} onOpen={setOpening} />
            ))}
          </div>
        </section>
      ) : (
        <>
          <RecommendedCarousel items={featured} onOpen={setOpening} />
          {visibleCategories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
              <p className="text-sm font-medium">La carta está vacía</p>
              <p className="mt-1 text-xs text-muted-foreground">Pedile al mozo que te ayude.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleCategories.map((cat) => (
                <CategoryCard key={cat.id} category={cat} onSelect={setSelectedId} />
              ))}
            </div>
          )}
        </>
      )}

      {!selected && searching && (
        <button
          type="button"
          onClick={() => setQuery('')}
          className="mx-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <X className="size-3.5" aria-hidden /> Limpiar búsqueda
        </button>
      )}

      <ItemDetailSheet item={opening} onClose={() => setOpening(null)} onAdd={onAdd} />
    </div>
  )
}
