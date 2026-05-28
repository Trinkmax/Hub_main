'use client'

import { ChevronRight, ImageOff, Search, Sparkles, Star } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { cn } from '@/lib/utils'
import { ItemDetailSheet } from './item-detail-sheet'
import type { CartItem } from './mesa-screen'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]
type Tag = Item['tags'][number]

const FEATURED_FILTER = '__featured__'

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

/**
 * Decide si un tag con color hex `#RRGGBB` necesita texto claro u oscuro
 * para conservar contraste legible (YIQ aproximado).
 */
function pickContrastText(bgHex: string): 'light' | 'dark' {
  if (!bgHex.startsWith('#') || bgHex.length !== 7) return 'light'
  const r = Number.parseInt(bgHex.slice(1, 3), 16)
  const g = Number.parseInt(bgHex.slice(3, 5), 16)
  const b = Number.parseInt(bgHex.slice(5, 7), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 'light'
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? 'dark' : 'light'
}

/** Debounce simple para búsqueda — evita filtrar en cada keystroke. */
function useDebouncedValue<T>(value: T, delay = 150): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return v
}

export function MenuList({
  categories,
  onAdd,
}: {
  categories: Category[]
  onAdd: (item: CartItem) => void
}) {
  const [opening, setOpening] = useState<Item | null>(null)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 150)
  // Filtro activo: id de tag, FEATURED_FILTER, o null = todo
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  // Categoría que está visible en el scroll — usada para resaltar el chip
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())
  const tabsScrollRef = useRef<HTMLDivElement | null>(null)

  // Tags únicos a través de todo el menú (deduplicados por id, preservando primer color encontrado)
  const allTags = useMemo<Tag[]>(() => {
    const map = new Map<string, Tag>()
    for (const cat of categories) {
      for (const item of cat.items) {
        for (const tag of item.tags) {
          if (!map.has(tag.id)) map.set(tag.id, tag)
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [categories])

  // ¿Tenemos al menos un item destacado para mostrar el chip "Destacados"?
  const hasFeaturedItems = useMemo(
    () => categories.some((cat) => cat.items.some((it) => it.featured)),
    [categories],
  )

  // Filtrado de categorías/items por búsqueda + chip
  const filteredCategories = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    return categories
      .map((cat) => {
        const filteredItems = cat.items.filter((item) => {
          // Filtro de búsqueda
          if (q.length > 0) {
            const haystack = `${item.name} ${item.description ?? ''}`.toLowerCase()
            if (!haystack.includes(q)) return false
          }
          // Filtro de chip
          if (activeFilter === FEATURED_FILTER) {
            if (!item.featured) return false
          } else if (activeFilter !== null) {
            if (!item.tags.some((t) => t.id === activeFilter)) return false
          }
          return true
        })
        return { ...cat, items: filteredItems }
      })
      .filter((cat) => cat.items.length > 0)
  }, [categories, debouncedQuery, activeFilter])

  // Sección "Destacados del bar" — solo cuando no hay filtros activos
  const featuredItems = useMemo<Item[]>(() => {
    if (activeFilter !== null || debouncedQuery.trim().length > 0) return []
    return categories.flatMap((cat) => cat.items.filter((it) => it.featured)).slice(0, 6)
  }, [categories, activeFilter, debouncedQuery])

  // Intersection observer para detectar categoría activa en scroll
  useEffect(() => {
    if (filteredCategories.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        // Tomamos la primera entrada visible cerca del top
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0 && visible[0]) {
          const id = visible[0].target.getAttribute('data-cat-id')
          if (id) setActiveCategoryId(id)
        }
      },
      { rootMargin: '-180px 0px -55% 0px', threshold: 0 },
    )
    sectionRefs.current.forEach((el) => {
      observer.observe(el)
    })
    return () => observer.disconnect()
  }, [filteredCategories])

  // Cuando cambia la categoría activa, hacer scroll del chip al viewport
  useEffect(() => {
    if (!activeCategoryId || !tabsScrollRef.current) return
    const el = tabsScrollRef.current.querySelector(
      `[data-cat-chip="${activeCategoryId}"]`,
    ) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [activeCategoryId])

  const scrollToCategory = (catId: string) => {
    const el = sectionRefs.current.get(catId)
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 160
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }

  return (
    <div className="space-y-5">
      {/* Sticky toolbar: search + filtros + tabs de categorías */}
      <div className="sticky top-0 z-10 -mx-4 space-y-2.5 bg-gradient-to-b from-background via-background to-background/95 px-4 pt-1 pb-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        {/* Search */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar plato, café, postre…"
            className="h-11 rounded-xl pl-9 text-sm"
            aria-label="Buscar en la carta"
          />
        </div>

        {/* Chips de filtros — solo si hay tags o destacados */}
        {(allTags.length > 0 || hasFeaturedItems) && (
          <div
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Filtros"
          >
            <FilterChip
              label="Todo"
              active={activeFilter === null}
              onClick={() => setActiveFilter(null)}
            />
            {hasFeaturedItems && (
              <FilterChip
                label="Destacados"
                icon={<Star className="size-3.5 fill-current" aria-hidden />}
                active={activeFilter === FEATURED_FILTER}
                onClick={() =>
                  setActiveFilter((prev) => (prev === FEATURED_FILTER ? null : FEATURED_FILTER))
                }
              />
            )}
            {allTags.map((tag) => (
              <FilterChip
                key={tag.id}
                label={tag.name}
                color={tag.color}
                active={activeFilter === tag.id}
                onClick={() => setActiveFilter((prev) => (prev === tag.id ? null : tag.id))}
              />
            ))}
          </div>
        )}

        {/* Tabs sticky de categorías */}
        {filteredCategories.length > 1 && (
          <nav
            ref={tabsScrollRef}
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Categorías"
          >
            {filteredCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                data-cat-chip={cat.id}
                onClick={() => scrollToCategory(cat.id)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  activeCategoryId === cat.id
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border/60 bg-card/60 text-foreground hover:bg-[--cream-tint]',
                )}
              >
                {cat.name}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Sección Destacados (solo si aplica) */}
      {featuredItems.length > 0 && (
        <section aria-labelledby="featured-title">
          <h2
            id="featured-title"
            className="mb-3 flex items-center gap-1.5 font-serif text-lg font-semibold tracking-tight"
          >
            <Sparkles className="size-4 text-warning" aria-hidden />
            Destacados del bar
          </h2>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {featuredItems.map((it) => (
              <button
                key={`featured-${it.id}`}
                type="button"
                onClick={() => setOpening(it)}
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
      )}

      {/* Listado por categoría */}
      {filteredCategories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="mt-1 text-xs text-muted-foreground">Probá con otra búsqueda o filtro.</p>
        </div>
      ) : (
        filteredCategories.map((cat) => (
          <section
            key={cat.id}
            id={`cat-${cat.id}`}
            data-cat-id={cat.id}
            ref={(el) => {
              if (el) sectionRefs.current.set(cat.id, el)
              else sectionRefs.current.delete(cat.id)
            }}
            className="scroll-mt-40"
            aria-labelledby={`cat-title-${cat.id}`}
          >
            <h2
              id={`cat-title-${cat.id}`}
              className="mb-2.5 font-serif text-lg font-semibold tracking-tight"
            >
              {cat.name}
            </h2>
            <div className="space-y-2">
              {cat.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setOpening(it)}
                  className="card-hairline group flex w-full items-stretch gap-3 rounded-2xl border border-border/60 bg-card p-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-card/95 hover:shadow-md"
                >
                  <div className="relative size-[72px] shrink-0 overflow-hidden rounded-xl bg-secondary/40">
                    {it.image_url ? (
                      <Image
                        src={it.image_url}
                        alt=""
                        fill
                        sizes="72px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                        <ImageOff className="size-5" aria-hidden />
                      </div>
                    )}
                    {it.featured && (
                      <span
                        role="img"
                        className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-warning/95 text-warning-foreground shadow-sm"
                        aria-label="Destacado"
                      >
                        <Star className="size-3 fill-current" aria-hidden />
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                    <div className="min-w-0">
                      <p className="line-clamp-1 font-medium leading-tight">{it.name}</p>
                      {it.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {it.description}
                        </p>
                      )}
                    </div>
                    {(it.tags.length > 0 || it.points_override != null) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {it.tags.slice(0, 3).map((tag) => {
                          const tone = pickContrastText(tag.color)
                          return (
                            <span
                              key={tag.id}
                              className={cn(
                                'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium leading-tight',
                                tone === 'light' ? 'text-white' : 'text-foreground',
                              )}
                              style={{ backgroundColor: tag.color }}
                            >
                              {tag.name}
                            </span>
                          )
                        })}
                        {it.points_override != null && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-semibold leading-tight text-warning">
                            +{it.points_override} pts
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end justify-between py-0.5 pl-1">
                    <span className="font-serif text-base font-semibold tabular-nums">
                      {ARSFormat(it.price_cents)}
                    </span>
                    <ChevronRight
                      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      <ItemDetailSheet item={opening} onClose={() => setOpening(null)} onAdd={onAdd} />
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
  color,
  icon,
}: {
  label: string
  active: boolean
  onClick: () => void
  color?: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border/60 bg-card/60 text-foreground hover:bg-[--cream-tint]',
      )}
    >
      {icon}
      {color && !active && (
        <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
      )}
      {label}
    </button>
  )
}
