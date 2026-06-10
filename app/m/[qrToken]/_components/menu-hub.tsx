'use client'

import { ChevronRight, Home, Search, X } from 'lucide-react'
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
type Node = Category & { children: Node[] }

// Arma el bosque por parent_id. Cada categoría conserva sus ítems directos.
function buildForest(categories: Category[]): {
  roots: Node[]
  byId: Map<string, Node>
} {
  const byId = new Map<string, Node>()
  for (const c of categories) byId.set(c.id, { ...c, children: [] })
  const roots: Node[] = []
  for (const n of byId.values()) {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)?.children.push(n)
    else roots.push(n)
  }
  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position
  const sortRec = (ns: Node[]) => {
    ns.sort(byPos)
    for (const n of ns) sortRec(n.children)
  }
  sortRec(roots)
  return { roots, byId }
}

// ¿La categoría tiene contenido (ítems directos o algún descendiente con ítems)?
function hasContent(node: Node): boolean {
  if (node.items.length > 0) return true
  return node.children.some(hasContent)
}

export function MenuHub({
  categories,
  onAdd,
}: {
  categories: Category[]
  onAdd: (item: CartItem) => void
}) {
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<Item | null>(null)

  const { roots, byId } = useMemo(() => buildForest(categories), [categories])
  const featured = useMemo(
    () => categories.flatMap((c) => c.items.filter((i) => i.featured)).slice(0, 6),
    [categories],
  )
  const searchResults = useMemo(() => searchMenuItems(categories, query), [categories, query])
  const searching = query.trim().length > 0

  const current = currentId ? (byId.get(currentId) ?? null) : null
  const levelNodes = (current ? current.children : roots).filter(hasContent)
  const levelItems = current ? current.items : []

  // Breadcrumb (ancestros).
  const breadcrumb = useMemo(() => {
    const out: Node[] = []
    let cur = current
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      out.unshift(cur)
      cur = cur.parent_id ? (byId.get(cur.parent_id) ?? null) : null
    }
    return out
  }, [current, byId])

  return (
    <div className="space-y-5">
      {!current && (
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

      {!current && searching ? (
        searchResults.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
            <p className="text-sm font-medium">Sin resultados</p>
            <p className="mt-1 text-xs text-muted-foreground">Probá con otra búsqueda.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {searchResults.map((it) => (
              <div key={it.id} className="space-y-1">
                {it.path ? (
                  <p className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground">
                    {it.path}
                  </p>
                ) : null}
                <ItemRow item={it} onOpen={setOpening} />
              </div>
            ))}
          </div>
        )
      ) : current ? (
        <section aria-labelledby="cat-detail-title" className="space-y-4">
          {/* Breadcrumb */}
          <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Ruta">
            <button
              type="button"
              onClick={() => setCurrentId(null)}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card px-2.5 py-1 text-muted-foreground shadow-sm"
            >
              <Home className="size-3.5" aria-hidden /> Carta
            </button>
            {breadcrumb.map((c, idx) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
                {idx === breadcrumb.length - 1 ? (
                  <span
                    id="cat-detail-title"
                    className="px-1.5 py-1 font-serif text-base font-semibold"
                  >
                    {c.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCurrentId(c.id)}
                    className="rounded-md px-1.5 py-1 font-medium"
                  >
                    {c.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          {/* Ítems directos */}
          {levelItems.length > 0 ? (
            <div className="space-y-2">
              {levelItems.map((it) => (
                <ItemRow key={it.id} item={it} onOpen={setOpening} />
              ))}
            </div>
          ) : null}

          {/* Subcategorías */}
          {levelNodes.length > 0 ? (
            <div className="space-y-3">
              {levelItems.length > 0 ? (
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Más opciones
                </p>
              ) : null}
              {levelNodes.map((node) => (
                <CategoryCard
                  key={node.id}
                  category={node}
                  subcatCount={node.children.filter(hasContent).length}
                  onSelect={setCurrentId}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <RecommendedCarousel items={featured} onOpen={setOpening} />
          {levelNodes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
              <p className="text-sm font-medium">La carta está vacía</p>
              <p className="mt-1 text-xs text-muted-foreground">Pedile al mozo que te ayude.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {levelNodes.map((node) => (
                <CategoryCard
                  key={node.id}
                  category={node}
                  subcatCount={node.children.filter(hasContent).length}
                  onSelect={setCurrentId}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!current && searching && (
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
