'use client'

import { ArrowRight, Search, X } from 'lucide-react'
import {
  type Ref,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ItemTag } from '@/lib/item-tags/queries'
import type { CartaRoot } from '@/lib/menu/carta'
import type { MenuItem } from '@/lib/menu/queries'
import {
  buildSearchIndex,
  MIN_QUERY_LENGTH,
  type SearchSection,
  searchMenu,
} from '@/lib/menu/search'
import { cn } from '@/lib/utils'
import { DishRow } from './dish'
import { useDismissOnBack } from './use-dismiss-on-back'

export type CartaSearchHandle = { open: () => void }

/**
 * El buscador de la carta, a pantalla completa (`lib/menu/search.ts` es el que entiende lo que se escribe).
 *
 * - Antes de escribir muestra la carta entera como índice: cada rubro con sus secciones, para ir de un toque.
 * - Las etiquetas del bar (vegetariano, sin alcohol…) filtran con un toque, solas o junto con el texto.
 * - Los resultados dicen dónde está cada cosa y marcan qué parte del nombre coincide.
 *
 * Está siempre montado y se abre con `open()`: en el iPhone el teclado solo aparece si el campo recibe
 * el foco en el mismo toque que lo pide, así que el campo tiene que existir antes de ese toque.
 */
export function CartaSearch({
  ref,
  roots,
  onOpenItem,
  onGo,
  onOpenChange,
}: {
  ref?: Ref<CartaSearchHandle>
  roots: CartaRoot[]
  onOpenItem: (item: MenuItem, from: HTMLElement | null, list: MenuItem[]) => void
  /** Ir a un rubro (y a una de sus secciones, si viene). */
  onGo: (rootSlug: string, sectionSlug: string | null) => void
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [tagId, setTagId] = useState<string | null>(null)
  /** El índice se arma recién la primera vez que se abre. */
  const [used, setUsed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  useDismissOnBack(open, close)

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        const root = rootRef.current
        if (root) {
          // Antes de que React lo dibuje abierto: el campo tiene que poder recibir el foco YA, en este
          // mismo toque. Cerrado está oculto con una demora (`.carta-overlay`): sin apagar esa demora
          // un instante, seguiría oculto y el foco no entraría.
          root.inert = false
          root.style.transition = 'none'
          root.style.visibility = 'visible'
        }
        inputRef.current?.focus({ preventScroll: true })
        if (root) {
          void root.offsetHeight
          root.style.transition = ''
        }
        setUsed(true)
        setOpen(true)
      },
    }),
    [],
  )

  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])
  useEffect(() => {
    onOpenChangeRef.current(open)
    const root = rootRef.current
    if (root) root.style.visibility = ''
    if (!open) inputRef.current?.blur()
  }, [open])

  const index = useMemo(() => (used ? buildSearchIndex(roots) : null), [used, roots])
  const tags = useMemo(() => {
    const byId = new Map<string, ItemTag>()
    for (const root of roots) {
      for (const section of root.sections) {
        for (const item of section.items) for (const tag of item.tags) byId.set(tag.id, tag)
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [roots])
  // Una etiqueta que ya no está en la carta (se actualizó con el buscador abierto) deja de filtrar.
  const activeTag = tagId && tags.some((tag) => tag.id === tagId) ? tagId : null

  const deferredQuery = useDeferredValue(query)
  const results = useMemo(
    () => (index ? searchMenu(index, deferredQuery, { tagId: activeTag }) : null),
    [index, deferredQuery, activeTag],
  )
  const typed = deferredQuery.trim().length >= MIN_QUERY_LENGTH
  const searching = typed || activeTag !== null
  const hits = results?.items ?? []
  const list = useMemo(() => hits.map((hit) => hit.entry.item), [hits])

  // Cada búsqueda nueva arranca desde arriba.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se vuelve arriba cuando cambia lo buscado, no cuando cambia la lista de nodos
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
  }, [deferredQuery, activeTag])

  // Ir a un lugar de la carta desde acá son dos pasos de historial: el buscador suelta su entrada (un
  // «atrás» que dispara `useDismissOnBack` al cerrarse) y el rubro suma la suya. Si el rubro la sumara
  // antes, ese «atrás» se la llevaría puesta y la carta volvería al inicio. Por eso se espera a que el
  // navegador avise que ya soltó (`popstate`); el reloj es por si ese aviso no llegara nunca.
  const go = useCallback(
    (place: Pick<SearchSection, 'rootSlug' | 'sectionSlug'>) => {
      let done = false
      const navigate = () => {
        if (done) return
        done = true
        window.removeEventListener('popstate', navigate)
        window.clearTimeout(fallback)
        onGo(place.rootSlug, place.sectionSlug)
      }
      const fallback = window.setTimeout(navigate, 500)
      window.addEventListener('popstate', navigate)
      setOpen(false)
    },
    [onGo],
  )

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal={open || undefined}
      aria-label="Buscar en la carta"
      inert={!open}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
      data-open={open ? '' : undefined}
      className="carta-overlay fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="mx-auto w-full max-w-3xl px-4 pt-[max(env(safe-area-inset-top),0.75rem)] sm:px-6">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-(--carta-green)"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="Buscar en la carta"
              placeholder="Buscar un plato o una bebida"
              value={query}
              tabIndex={open ? 0 : -1}
              onChange={(event) => setQuery(event.target.value)}
              className="h-[3.25rem] w-full rounded-full bg-card pl-12 pr-12 text-[1.0625rem] text-foreground shadow-sm outline-none ring-1 ring-(--carta-line) placeholder:text-(--carta-soft) focus:ring-2 focus:ring-(--carta-green) [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus({ preventScroll: true })
                }}
                aria-label="Borrar lo escrito"
                className="carta-focus absolute right-1.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-(--carta-soft)"
              >
                <X className="size-[1.125rem]" aria-hidden />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={close}
            className="carta-focus h-11 shrink-0 rounded-full px-3 text-[1rem] font-semibold text-(--carta-green)"
          >
            Cerrar
          </button>
        </div>

        {tags.length > 0 ? (
          <fieldset className="carta-scroller -mx-4 mt-3 flex gap-2 px-4 pb-1 sm:-mx-6 sm:px-6">
            <legend className="sr-only">Filtrar por etiqueta</legend>
            {tags.map((tag) => {
              const active = tag.id === activeTag
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTagId(active ? null : tag.id)}
                  className={cn(
                    'carta-focus flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[0.9375rem] font-semibold transition-colors duration-200',
                    active
                      ? 'bg-(--carta-green) text-(--carta-on-green)'
                      : 'bg-(--carta-paper-2) text-foreground',
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              )
            })}
          </fieldset>
        ) : null}
      </div>

      <div
        ref={listRef}
        data-art-scope
        className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-3xl px-4 pb-[max(env(safe-area-inset-bottom),2.5rem)] sm:px-6">
          {!open ? null : searching ? (
            <>
              {results && results.sections.length > 0 ? (
                <ul className="flex flex-wrap gap-2 pb-1 pt-3">
                  {results.sections.map((section) => (
                    <li key={`${section.rootSlug}/${section.sectionSlug ?? ''}`}>
                      <button
                        type="button"
                        onClick={() => go(section)}
                        className="carta-press carta-focus flex h-11 items-center gap-2 rounded-full bg-(--carta-night) pl-4 pr-3.5 text-[0.9375rem] font-semibold text-(--carta-on-night)"
                      >
                        {section.sectionSlug && section.title !== section.rootName
                          ? section.title
                          : `Todo ${section.title}`}
                        <ArrowRight className="size-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p aria-live="polite" className="pb-1 pt-4 text-[0.875rem] text-(--carta-soft)">
                {hits.length === 0
                  ? typed
                    ? `No encontramos nada para «${deferredQuery.trim()}».`
                    : 'Nada con esa etiqueta por ahora.'
                  : `${hits.length} ${hits.length === 1 ? 'resultado' : 'resultados'}`}
              </p>

              {hits.length > 0 ? (
                <ul className="divide-y divide-(--carta-line)">
                  {hits.map((hit) => (
                    <li key={hit.entry.item.id}>
                      <DishRow
                        item={hit.entry.item}
                        ranges={hit.ranges}
                        where={hit.entry.where}
                        onOpen={(item, from) => onOpenItem(item, from, list)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p className="pb-2 text-[0.9375rem] leading-[1.5] text-foreground">
                    Probá con otra palabra, o andá directo a una sección:
                  </p>
                  <SectionIndex roots={roots} onGo={go} />
                </>
              )}
            </>
          ) : (
            <SectionIndex roots={roots} onGo={go} />
          )}
        </div>
      </div>
    </div>
  )
}

/** La carta entera como índice: cada rubro y sus secciones, para ir de un toque. */
function SectionIndex({
  roots,
  onGo,
}: {
  roots: CartaRoot[]
  onGo: (place: { rootSlug: string; sectionSlug: string | null }) => void
}): React.JSX.Element {
  return (
    <ul className="pt-2">
      {roots.map((root) => (
        <li key={root.id} className="border-b border-(--carta-line) py-5 last:border-b-0">
          <button
            type="button"
            onClick={() => onGo({ rootSlug: root.slug, sectionSlug: null })}
            className="carta-press carta-focus flex w-full items-center justify-between gap-3 rounded-lg text-left"
          >
            <span className="font-serif text-[1.625rem] font-medium leading-none tracking-[-0.025em]">
              {root.name}
            </span>
            <ArrowRight className="size-5 shrink-0 text-(--carta-green)" aria-hidden />
          </button>
          {root.sections.length > 1 ? (
            <ul className="mt-3.5 flex flex-wrap gap-2">
              {root.sections.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => onGo({ rootSlug: root.slug, sectionSlug: section.slug })}
                    className="carta-press carta-focus flex h-10 items-center rounded-full bg-(--carta-paper-2) px-4 text-[0.9375rem] font-medium text-foreground"
                  >
                    {section.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
