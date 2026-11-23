'use client'

import { ChevronRight, Search, X, Zap } from 'lucide-react'
import { memo, useCallback, useId, useMemo, useState } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Switch } from '@/components/ui/switch'
import {
  branchesWithMarks,
  categoryFirst,
  categoryFirstChange,
  categoryFirstNote,
  type FirstStats,
  firstHeadline,
  firstSay,
  firstStats,
  itemFirst,
  itemFirstChange,
  itemFirstNote,
} from '@/lib/menu/kitchen/first'
import { type CartaTree, pathLabel } from '@/lib/menu/kitchen/routing'
import { type CartaIndex, searchCarta } from '@/lib/menu/kitchen/search'
import { type CartaItem, firstKey } from '@/lib/menu/kitchen/types'
import { cn } from '@/lib/utils'
import { BAND, depthStyle, Highlight, INDENT, RowError, SHEET } from './route-tree'
import type { KitchenWrites } from './use-kitchen-writes'

/**
 * «Sale primero»: lo que encabeza la comanda en cocina (una entrada, una picada para ir comiendo).
 *
 * Pedido de los socios (22/11/2026): «que un producto pueda tener "prioridad" (el caso de una
 * entrada)». Se marca en la categoría y lo de adentro la sigue; un producto puede decir otra cosa.
 * No depende de las estaciones: un bar que no reparte su cocina en pantallas lo usa igual.
 *
 * Todo se guarda solo y se puede deshacer, como el resto de la pantalla (`use-kitchen-writes.ts`).
 */

type PaneContext = {
  tree: CartaTree
  stats: FirstStats
  saving: ReadonlySet<string>
  errors: Readonly<Record<string, string>>
  onCategory: (id: string, want: boolean) => void
  onItem: (item: CartaItem, want: boolean) => void
}

/**
 * El interruptor con su rayo. El área de toque es el renglón entero de alto (44 px): en el
 * celular se marca con el pulgar sin apuntar.
 */
function FirstSwitch({
  name,
  checked,
  disabled = false,
  saving,
  describedBy,
  onChange,
  testId,
}: {
  name: string
  checked: boolean
  disabled?: boolean
  saving: boolean
  describedBy: string | undefined
  onChange: (want: boolean) => void
  testId: string
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        '-my-1 flex min-h-11 shrink-0 items-center gap-1.5 pl-2',
        disabled ? 'cursor-default' : 'cursor-pointer',
      )}
    >
      <Zap
        aria-hidden
        className={cn(
          'size-4 transition-colors duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
          checked ? 'fill-current text-primary' : 'text-muted-foreground/40',
          disabled && 'opacity-60',
        )}
      />
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={`${name}: sale primero`}
        aria-describedby={describedBy}
        aria-busy={saving || undefined}
        data-testid={testId}
        className={cn(saving && 'opacity-70')}
      />
    </label>
  )
}

const ProductRow = memo(function ProductRow({
  item,
  depth,
  path,
  query,
  ctx,
}: {
  item: CartaItem
  depth: number
  /** En una búsqueda: el camino de la categoría. */
  path: string | null
  query: string
  ctx: PaneContext
}) {
  const noteId = useId()
  const errorId = useId()
  const key = firstKey('item', item.id)
  const error = ctx.errors[key]
  const resolution = ctx.stats.items.get(item.id) ?? itemFirst(ctx.tree, item)
  const note = itemFirstNote(ctx.tree, item)
  return (
    <li
      data-testid="first-product"
      data-item={item.id}
      data-first={resolution.first ? '' : undefined}
      style={depthStyle(depth)}
      className={cn('border-t border-border/60 first:border-t-0', INDENT)}
    >
      <div className="flex items-center gap-2 py-1">
        <div className="min-w-0 flex-1 py-1">
          <p className="text-[15px] leading-snug [overflow-wrap:anywhere]">
            <Highlight text={item.name} query={query} />
            {item.active ? null : (
              <StatusPill tone="muted" className="ml-2 align-[1px]">
                Pausado
              </StatusPill>
            )}
          </p>
          {path ? (
            <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              <Highlight text={path} query={query} />
            </p>
          ) : null}
          {note ? (
            <p id={noteId} className="mt-0.5 text-xs text-muted-foreground text-pretty">
              {note}
            </p>
          ) : null}
        </div>
        <FirstSwitch
          name={item.name}
          checked={resolution.first}
          saving={ctx.saving.has(key)}
          describedBy={error ? errorId : note ? noteId : undefined}
          onChange={(want) => ctx.onItem(item, want)}
          testId="first-switch-item"
        />
      </div>
      <RowError id={errorId} message={error} />
    </li>
  )
})

function CategoryHead({
  id,
  depth,
  open,
  onToggle,
  controls,
  path,
  query,
  ctx,
}: {
  id: string
  depth: number
  /** `null` = no se despliega (una búsqueda, o no tiene nada adentro). */
  open: boolean | null
  onToggle?: () => void
  controls?: string
  path: string | null
  query: string
  ctx: PaneContext
}) {
  const noteId = useId()
  const errorId = useId()
  const category = ctx.tree.byId.get(id)
  if (!category) return null
  const key = firstKey('category', id)
  const error = ctx.errors[key]
  const resolution = categoryFirst(ctx.tree, id)
  const note = categoryFirstNote(ctx.tree, ctx.stats, id)
  const count = ctx.stats.byBranch.get(id)?.products ?? 0
  const top = depth === 0 && path === null
  const name = (
    <span className="min-w-0 flex-1 py-1">
      <span
        className={cn(
          'block leading-snug [overflow-wrap:anywhere]',
          top ? 'font-serif text-[17px] font-semibold tracking-tight' : 'text-[15px] font-semibold',
        )}
      >
        <Highlight text={category.name} query={query} />
        <span className="ml-2 inline-block rounded-full bg-background/70 px-1.5 py-px align-[2px] font-sans text-[11px] font-medium tracking-normal text-muted-foreground tabular-nums">
          {count}
          <span className="sr-only">{count === 1 ? ' producto' : ' productos'}</span>
        </span>
        {category.active ? null : (
          <StatusPill tone="muted" className="ml-2 align-[1px] font-sans tracking-normal">
            Pausada
          </StatusPill>
        )}
      </span>
      {path ? (
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">
          <Highlight text={path} query={query} />
        </span>
      ) : null}
      {note ? (
        <span
          id={noteId}
          className="mt-0.5 block font-sans text-xs font-normal tracking-normal text-muted-foreground text-pretty"
        >
          {note}
        </span>
      ) : null}
    </span>
  )

  return (
    <div
      data-testid="first-category"
      data-category={id}
      data-first={resolution.first ? resolution.source : undefined}
      style={depthStyle(depth)}
      className={cn(INDENT, top && BAND)}
    >
      <div className="flex items-center gap-2 py-1">
        {open === null ? (
          <div className="flex min-h-11 min-w-0 flex-1 items-center gap-1 sm:gap-2">
            <span aria-hidden className="size-4 shrink-0" />
            {name}
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? controls : undefined}
            onClick={onToggle}
            className="-ml-1 flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-md pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:gap-2"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
                open && 'rotate-90',
              )}
            />
            {name}
          </button>
        )}
        <FirstSwitch
          name={category.name}
          checked={resolution.first}
          // Viene de una categoría de arriba: se saca ahí (o producto por producto).
          disabled={resolution.source === 'inherited'}
          saving={ctx.saving.has(key)}
          describedBy={error ? errorId : note ? noteId : undefined}
          onChange={(want) => ctx.onCategory(id, want)}
          testId="first-switch-category"
        />
      </div>
      <RowError id={errorId} message={error} />
    </div>
  )
}

function Branch({
  id,
  depth,
  ctx,
  expanded,
  onToggle,
}: {
  id: string
  depth: number
  ctx: PaneContext
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  const listId = useId()
  const items = ctx.tree.items.get(id) ?? []
  const children = ctx.tree.children.get(id) ?? []
  const open = items.length + children.length > 0 ? expanded.has(id) : null
  return (
    <li className="border-t border-border/60 first:border-t-0">
      <CategoryHead
        id={id}
        depth={depth}
        open={open}
        onToggle={() => onToggle(id)}
        controls={listId}
        path={null}
        query=""
        ctx={ctx}
      />
      {open ? (
        <ul id={listId} className="border-t border-border/60">
          {items.map((item) => (
            <ProductRow
              key={item.id}
              item={item}
              depth={depth + 1}
              path={null}
              query=""
              ctx={ctx}
            />
          ))}
          {children.map((child) => (
            <Branch
              key={child}
              id={child}
              depth={depth + 1}
              ctx={ctx}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function FirstPane({
  writes,
  tree,
  index,
}: {
  writes: KitchenWrites
  tree: CartaTree
  index: CartaIndex
}) {
  const { commit } = writes
  const stats = useMemo(() => firstStats(tree), [tree])
  const [query, setQuery] = useState('')
  // Al entrar, abierto lo que tiene algo marcado adentro: se ve de un vistazo qué sale primero.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(branchesWithMarks(tree, stats)),
  )

  const onCategory = useCallback(
    (id: string, want: boolean) => {
      const change = categoryFirstChange(tree, id, want)
      if (!change) return
      commit(
        { type: 'first', changes: [change] },
        { say: firstSay(tree.byId.get(id)?.name ?? 'Esa categoría', want), toastId: 'primero' },
      )
    },
    [commit, tree],
  )
  const onItem = useCallback(
    (item: CartaItem, want: boolean) => {
      const change = itemFirstChange(tree, item, want)
      if (!change) return
      commit(
        { type: 'first', changes: [change] },
        { say: firstSay(item.name, want), toastId: 'primero' },
      )
    },
    [commit, tree],
  )

  const ctx = useMemo<PaneContext>(
    () => ({ tree, stats, saving: writes.saving, errors: writes.errors, onCategory, onItem }),
    [tree, stats, writes.saving, writes.errors, onCategory, onItem],
  )
  const itemsById = useMemo(() => {
    const map = new Map<string, CartaItem>()
    for (const list of tree.items.values()) for (const item of list) map.set(item.id, item)
    return map
  }, [tree])

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** En una búsqueda: de qué cuelga la categoría encontrada. */
  const parentPath = (id: string) => {
    const parent = tree.parent.get(id) ?? null
    return parent === null ? 'Categoría de arriba de todo' : pathLabel(tree, parent)
  }

  const headline = firstHeadline(stats)
  const hits = useMemo(() => searchCarta(index, query), [index, query])
  const roots = tree.children.get(null) ?? []

  const searchBox = (
    <div className="relative w-full lg:w-80 lg:shrink-0">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar una categoría o un producto"
        aria-label="Buscar en la carta"
        data-testid="primero-buscar"
        className="h-11 w-full rounded-lg border border-input bg-background/60 pl-9 pr-10 text-base shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:h-10 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          onClick={() => setQuery('')}
          aria-label="Borrar la búsqueda"
          className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  )

  return (
    <div className="space-y-4" data-testid="primero">
      {/* El número y el buscador comparten renglón cuando hay ancho: la carta empieza más arriba. */}
      <section aria-label="Qué sale primero" className="space-y-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
          <p className="text-pretty">
            <span
              className="font-serif text-4xl font-semibold leading-none tracking-tight tabular-nums"
              data-testid="primero-numero"
            >
              {headline.figure}
            </span>{' '}
            <span className="text-lg font-medium">{headline.lead}</span>
          </p>
          {roots.length > 0 ? searchBox : null}
        </div>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          Lo que marques acá encabeza la comanda en cocina: ideal para entradas. Marcar una
          categoría alcanza: lo de adentro la sigue, y un producto puede decir otra cosa.
        </p>
      </section>

      {roots.length === 0 ? (
        <p className={cn(SHEET, 'p-6 text-center text-sm text-muted-foreground')}>
          La carta todavía no tiene categorías. Cargalas en Carta y volvé a marcar qué sale primero.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Qué es cada columna, una vez: los interruptores de abajo no repiten el rótulo. */}
          <div
            aria-hidden
            className="flex items-end justify-between px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:px-3"
          >
            <span>La carta</span>
            <span>Sale primero</span>
          </div>

          {hits ? (
            hits.categories.length + hits.items.length > 0 ? (
              <ul data-kc-tree="" data-testid="primero-resultados" className={SHEET}>
                {hits.categories.map((id) => (
                  <li key={id} className="border-t border-border/60 first:border-t-0">
                    <CategoryHead
                      id={id}
                      depth={0}
                      open={null}
                      path={parentPath(id)}
                      query={query}
                      ctx={ctx}
                    />
                  </li>
                ))}
                {hits.items.map((id) => {
                  const item = itemsById.get(id)
                  // Los sueltos (sin categoría) no se pueden pedir: acá no se marcan.
                  if (!item || item.categoryId === null || !tree.byId.has(item.categoryId)) {
                    return null
                  }
                  return (
                    <ProductRow
                      key={id}
                      item={item}
                      depth={1}
                      path={pathLabel(tree, item.categoryId)}
                      query={query}
                      ctx={ctx}
                    />
                  )
                })}
              </ul>
            ) : (
              <p className={cn(SHEET, 'p-6 text-center text-sm text-muted-foreground')}>
                Nada en la carta se llama así.
              </p>
            )
          ) : (
            <ul data-kc-tree="" data-testid="primero-arbol" className={SHEET}>
              {roots.map((id) => (
                <Branch
                  key={id}
                  id={id}
                  depth={0}
                  ctx={ctx}
                  expanded={expanded}
                  onToggle={toggle}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
