'use client'

import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  SearchX,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MenuItem } from '@/lib/menu/queries'
import type { MenuTreeNode } from '@/lib/menu/tree'
import { CartaBrand } from './carta-brand'
import { CartaSearch } from './carta-search'
import { CategoryHubCard } from './category-hub-card'
import { ClubSheet } from './club-sheet'
import { FeaturedCarousel } from './featured-carousel'
import { ItemCard } from './item-card'
import { ItemDetailSheet } from './item-detail-sheet'
import { WalletDrawer, type WalletSummary } from './wallet-drawer'

/** Estado de apertura pasado por deep-link (?club / ?wallet). */
type InitialSheet = 'none' | 'club' | 'wallet'
/** El único overlay que este componente controla directamente es el club: la
 *  billetera es un cajón autónomo (WalletDrawer) que maneja su propio open. */
type SheetState = 'none' | 'club'

/** Todos los ítems del bosque en orden de árbol. */
function collectItems(nodes: MenuTreeNode[]): MenuItem[] {
  const out: MenuItem[] = []
  const walk = (ns: MenuTreeNode[]) => {
    for (const n of ns) {
      out.push(...n.items)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** ¿La categoría tiene algún ítem propio o en su subárbol? */
function hasContent(node: MenuTreeNode): boolean {
  return node.items.length > 0 || node.children.some(hasContent)
}

/** Cantidad de ítems en todo el subárbol. */
function countSubtreeItems(node: MenuTreeNode): number {
  return node.items.length + node.children.reduce((acc, c) => acc + countSubtreeItems(c), 0)
}

function cardSubtitle(node: MenuTreeNode): string {
  const withContent = node.children.filter(hasContent)
  if (withContent.length > 0) {
    return `${withContent.length} ${withContent.length === 1 ? 'sección' : 'secciones'}`
  }
  const n = countSubtreeItems(node)
  return `${n} ${n === 1 ? 'producto' : 'productos'}`
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function CartaExperience(props: {
  tenantName: string
  logoUrl: string | null
  tree: MenuTreeNode[]
  tenantSlug: string
  captureLinkSlug: string | null
  walletContent: React.ReactNode | null
  walletSummary: WalletSummary | null
  initialSheet: InitialSheet
}): React.JSX.Element {
  const { tenantName, logoUrl, tree, tenantSlug, captureLinkSlug, walletContent } = props
  const { walletSummary } = props

  const [path, setPath] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null)
  const [sheet, setSheet] = useState<SheetState>(props.initialSheet === 'club' ? 'club' : 'none')
  const walletInitiallyOpen = props.initialSheet === 'wallet'

  // El sheet inicial ya se sembró desde ?club/?wallet; limpiamos el query de la
  // URL para que al cerrar y recargar/compartir no se vuelva a abrir solo.
  useEffect(() => {
    if (props.initialSheet !== 'none' && typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }
  }, [props.initialSheet])

  const openItem = useCallback((item: MenuItem) => setActiveItem(item), [])

  const nodeById = useMemo(() => {
    const map = new Map<string, MenuTreeNode>()
    const walk = (ns: MenuTreeNode[]) => {
      for (const n of ns) {
        map.set(n.id, n)
        walk(n.children)
      }
    }
    walk(tree)
    return map
  }, [tree])

  const allItems = useMemo(() => collectItems(tree), [tree])
  const featured = useMemo(() => allItems.filter((i) => i.featured), [allItems])
  const rootNodes = useMemo(() => tree.filter(hasContent), [tree])

  const trimmed = query.trim()
  const isSearching = trimmed.length > 0
  const results = useMemo(() => {
    if (!isSearching) return []
    const q = normalize(trimmed)
    return allItems.filter((it) => normalize(`${it.name} ${it.description ?? ''}`).includes(q))
  }, [allItems, trimmed, isSearching])

  const currentNode = path.length > 0 ? (nodeById.get(path[path.length - 1] ?? '') ?? null) : null
  const breadcrumb = useMemo(
    () => path.map((id) => nodeById.get(id)).filter((n): n is MenuTreeNode => Boolean(n)),
    [path, nodeById],
  )
  const childrenToShow = (currentNode ? currentNode.children : rootNodes).filter(hasContent)
  const itemsToShow = currentNode ? currentNode.items : []

  const openCategory = useCallback((id: string) => {
    setPath((p) => [...p, id])
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }, [])
  const goHome = useCallback(() => setPath([]), [])
  const goBack = useCallback(() => setPath((p) => p.slice(0, -1)), [])
  const jumpTo = useCallback((index: number) => setPath((p) => p.slice(0, index + 1)), [])

  return (
    <div className="min-h-dvh bg-background pb-24 text-foreground">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto w-full max-w-2xl px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)]">
          <div className="flex items-center gap-3 py-2">
            {/* Sólo el logo (sin duplicar el nombre) + el rótulo de la página. */}
            <CartaBrand tenantName={tenantName} logoUrl={logoUrl} />
            <span className="ml-auto text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Carta
            </span>
          </div>

          <CartaSearch value={query} onChange={setQuery} className="mt-1" />

          {/* BREADCRUMB */}
          {!isSearching && breadcrumb.length > 0 ? (
            <nav
              aria-label="Migas de pan"
              className="mt-2.5 flex items-center gap-1 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <button
                type="button"
                onClick={goBack}
                aria-label="Volver"
                className="-ml-1 mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={goHome}
                className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Carta
              </button>
              {breadcrumb.map((node, i) => {
                const isLast = i === breadcrumb.length - 1
                return (
                  <span key={node.id} className="flex shrink-0 items-center gap-1">
                    <ChevronRight className="size-3.5 text-muted-foreground/50" aria-hidden />
                    {isLast ? (
                      <span className="px-1.5 py-0.5 font-semibold text-foreground">
                        {node.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => jumpTo(i)}
                        className="rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {node.name}
                      </button>
                    )}
                  </span>
                )
              })}
            </nav>
          ) : null}
        </div>
      </header>

      {/* CONTENIDO */}
      <main className="mx-auto w-full max-w-2xl px-4 pt-4">
        {isSearching ? (
          <SearchResults query={trimmed} results={results} onOpenItem={openItem} />
        ) : (
          <div key={path.join('/') || 'root'} className="animate-in fade-in duration-200">
            {path.length === 0 ? (
              <div className="flex flex-col gap-8">
                <FeaturedCarousel items={featured} onOpen={openItem} />
                {rootNodes.length === 0 ? (
                  <EmptyMenu />
                ) : (
                  <CardGrid nodes={rootNodes} onOpen={openCategory} />
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {currentNode ? (
                  <h2 className="px-1 font-serif text-2xl font-semibold tracking-tight text-balance">
                    {currentNode.name}
                  </h2>
                ) : null}
                {itemsToShow.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {itemsToShow.map((item) => (
                      <li key={item.id}>
                        <ItemCard item={item} onOpen={openItem} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {childrenToShow.length > 0 ? (
                  <CardGrid nodes={childrenToShow} onOpen={openCategory} />
                ) : null}
                {itemsToShow.length === 0 && childrenToShow.length === 0 ? <EmptyMenu /> : null}
              </div>
            )}
          </div>
        )}

        <footer className="mt-12 border-t border-border/50 pt-5 text-center">
          <p className="font-serif text-sm text-foreground/70">Carta de {tenantName}</p>
          <p className="mt-1 text-[11px] tracking-wide text-muted-foreground/70">Hecho con HUB</p>
        </footer>
      </main>

      {/* CAJÓN DE LA BILLETERA — el borde verde asoma desde abajo y se arrastra
          hacia arriba para abrir. Si el cliente aún no tiene wallet, el mismo
          labio invita a sumarse al club (tap → ClubSheet). */}
      {walletContent && walletSummary ? (
        <WalletDrawer summary={walletSummary} initialOpen={walletInitiallyOpen}>
          {walletContent}
        </WalletDrawer>
      ) : (
        <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
          <button
            type="button"
            onClick={() => setSheet('club')}
            aria-label="Sumate al club"
            className="group pointer-events-auto flex w-full flex-col items-center gap-1.5 rounded-t-[1.75rem] bg-[color:var(--brand-accent,var(--primary))] px-4 pb-[max(env(safe-area-inset-bottom),0.875rem)] pt-2.5 text-[color:var(--brand-accent-foreground,var(--primary-foreground))] shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.5)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 active:scale-[0.995]"
          >
            <span className="h-1.5 w-10 rounded-full bg-current/40" aria-hidden />
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="size-4" aria-hidden />
              Sumate al club
              <ChevronUp
                className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5"
                aria-hidden
              />
            </span>
          </button>
        </nav>
      )}

      <ItemDetailSheet item={activeItem} onClose={() => setActiveItem(null)} />

      <ClubSheet
        open={sheet === 'club'}
        onClose={() => setSheet('none')}
        tenantName={tenantName}
        tenantSlug={tenantSlug}
        linkSlug={captureLinkSlug}
      />
    </div>
  )
}

function CardGrid({
  nodes,
  onOpen,
}: {
  nodes: MenuTreeNode[]
  onOpen: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3">
      {nodes.map((node) => (
        <CategoryHubCard
          key={node.id}
          name={node.name}
          imageUrl={node.image_url}
          subtitle={cardSubtitle(node)}
          onOpen={() => onOpen(node.id)}
        />
      ))}
    </div>
  )
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
    <section aria-label={`Resultados para ${query}`}>
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
