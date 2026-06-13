'use client'

import { SearchX, UtensilsCrossed } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import type { MenuTreeNode } from '@/lib/menu/tree'
import { cn } from '@/lib/utils'
import { CartaSearch } from './carta-search'
import { CategorySection } from './category-section'
import { FeaturedCarousel } from './featured-carousel'
import { ItemCard } from './item-card'
import { ItemDetailSheet } from './item-detail-sheet'

/** Recorre el bosque y devuelve TODOS los ítems en orden de árbol. */
function collectItems(tree: MenuTreeNode[]): MenuItem[] {
  const out: MenuItem[] = []
  const walk = (nodes: MenuTreeNode[]) => {
    for (const n of nodes) {
      out.push(...n.items)
      walk(n.children)
    }
  }
  walk(tree)
  return out
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function CartaView(props: {
  tenantName: string
  logoUrl: string | null
  tree: MenuTreeNode[]
  flatCategories: MenuCategory[]
}): React.JSX.Element {
  const { tenantName, logoUrl, tree } = props

  const [query, setQuery] = useState('')
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null)
  const [activeCat, setActiveCat] = useState<string | null>(tree[0]?.id ?? null)

  const openItem = useCallback((item: MenuItem) => setActiveItem(item), [])

  const allItems = useMemo(() => collectItems(tree), [tree])
  const featured = useMemo(() => allItems.filter((i) => i.featured), [allItems])

  const trimmed = query.trim()
  const isSearching = trimmed.length > 0

  const results = useMemo(() => {
    if (!isSearching) return []
    const q = normalize(trimmed)
    return allItems.filter((it) => {
      const haystack = normalize(`${it.name} ${it.description ?? ''}`)
      return haystack.includes(q)
    })
  }, [allItems, trimmed, isSearching])

  // Categorías raíz que tienen contenido (ítems propios o en algún descendiente).
  const rootCats = useMemo(() => tree.filter((n) => hasContent(n)), [tree])

  // --- Scroll-spy: marca el chip de la sección visible más alta ---
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el)
    else sectionRefs.current.delete(id)
  }, [])

  useEffect(() => {
    if (isSearching || rootCats.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const top = visible[0]
        if (top) {
          const id = top.target.getAttribute('data-cat-id')
          if (id) setActiveCat(id)
        }
      },
      // El chip-bar + header miden ~9rem; arrancamos la zona "activa" debajo.
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    )
    const refs = sectionRefs.current
    for (const [id, el] of refs) {
      el.setAttribute('data-cat-id', id)
      observer.observe(el)
    }
    return () => observer.disconnect()
  }, [isSearching, rootCats])

  const scrollToCat = useCallback((id: string) => {
    setActiveCat(id)
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const showChipBar = !isSearching && rootCats.length > 1

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* HEADER STICKY */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto w-full max-w-2xl px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)]">
          <div className="flex items-center gap-3 py-2">
            {logoUrl ? (
              <div className="relative size-10 shrink-0 overflow-hidden rounded-xl ring-1 ring-border/60">
                <Image
                  src={logoUrl}
                  alt={tenantName}
                  fill
                  sizes="40px"
                  className="object-cover"
                  unoptimized
                  priority
                />
              </div>
            ) : (
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-accent,var(--primary))] text-[color:var(--brand-accent-foreground,var(--primary-foreground))] shadow-sm"
                aria-hidden
              >
                <UtensilsCrossed className="size-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-serif text-xl font-semibold leading-tight tracking-tight">
                {tenantName}
              </h1>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Carta</p>
            </div>
          </div>

          <CartaSearch value={query} onChange={setQuery} className="mt-1" />
        </div>

        {/* CHIP-BAR con scroll-spy */}
        {showChipBar && (
          <nav
            aria-label="Categorías"
            className="mx-auto w-full max-w-2xl border-t border-border/40"
          >
            <ul className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {rootCats.map((cat) => {
                const isActive = activeCat === cat.id
                return (
                  <li key={cat.id}>
                    <button
                      type="button"
                      onClick={() => scrollToCat(cat.id)}
                      aria-current={isActive ? 'true' : undefined}
                      className={cn(
                        'whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                        isActive
                          ? 'border-transparent bg-[color:var(--brand-accent,var(--primary))] text-[color:var(--brand-accent-foreground,var(--primary-foreground))] shadow-sm'
                          : 'border-border/70 bg-card/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
                      )}
                    >
                      {cat.name}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}
      </header>

      {/* CONTENIDO */}
      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4">
        {isSearching ? (
          <SearchResults query={trimmed} results={results} onOpenItem={openItem} />
        ) : (
          <div className="flex flex-col gap-8">
            <FeaturedCarousel items={featured} onOpen={openItem} />
            {rootCats.length === 0 ? (
              <EmptyMenu />
            ) : (
              rootCats.map((node) => (
                <CategorySection
                  key={node.id}
                  node={node}
                  onOpenItem={openItem}
                  registerRef={registerRef}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="mx-auto w-full max-w-2xl px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-2">
        <div className="border-t border-border/50 pt-5 text-center">
          <p className="font-serif text-sm text-foreground/70">Carta de {tenantName}</p>
          <p className="mt-1 text-[11px] tracking-wide text-muted-foreground/70">Hecho con HUB</p>
        </div>
      </footer>

      <ItemDetailSheet item={activeItem} onClose={() => setActiveItem(null)} />
    </div>
  )
}

/** ¿La categoría tiene algún ítem propio o en su subárbol? */
function hasContent(node: MenuTreeNode): boolean {
  if (node.items.length > 0) return true
  return node.children.some(hasContent)
}

function SearchResults({
  query,
  results,
  onOpenItem,
}: {
  query: string
  results: MenuItem[]
  onOpenItem: (item: MenuItem) => void
}): React.JSX.Element {
  if (results.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center gap-3 py-20 text-center"
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground">
          <SearchX className="size-6" aria-hidden />
        </span>
        <p className="font-serif text-lg font-semibold tracking-tight">Sin resultados</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          No encontramos nada para “{query}”. Probá con otra palabra.
        </p>
      </div>
    )
  }

  return (
    <section aria-label={`Resultados de búsqueda para ${query}`}>
      <p className="mb-3 px-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
      </p>
      <ul className="flex flex-col gap-2">
        {results.map((item) => (
          <li key={item.id}>
            <ItemCard item={item} onOpen={onOpenItem} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EmptyMenu(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground">
        <UtensilsCrossed className="size-6" aria-hidden />
      </span>
      <p className="font-serif text-lg font-semibold tracking-tight">Carta en preparación</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Todavía no hay productos para mostrar. Volvé en un rato.
      </p>
    </div>
  )
}
