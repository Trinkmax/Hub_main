'use client'

import { ChevronRight } from 'lucide-react'
import { type CSSProperties, memo, type ReactNode, useId } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { type CartaTree, NO_CATEGORY_ID, NO_CATEGORY_NAME } from '@/lib/menu/kitchen/routing'
import { nodeKey } from '@/lib/menu/kitchen/types'
import type { CategoryView, RouteModel, SlotInfo } from '@/lib/menu/kitchen/view'
import { highlightRanges } from '@/lib/menu/prices/search'
import { cn } from '@/lib/utils'
import { type SlotContext, StationSlot } from './station-slot'

/** Lo que cada renglón necesita: lo mismo para toda la lista. */
export type TreeContext = {
  tree: CartaTree
  model: RouteModel
  slot: SlotContext
  saving: ReadonlySet<string>
  flashed: ReadonlySet<string>
  errors: Readonly<Record<string, string>>
}

/** La hoja de la lista: una sola superficie con renglones separados por una raya suave. */
export const SHEET = 'card-hairline overflow-clip rounded-2xl border bg-card shadow-xs'
/** La franja de una categoría de arriba de todo. */
const BAND = 'bg-[color-mix(in_oklch,var(--secondary)_62%,var(--card))]'
/** La sangría: un escalón por nivel, del ancho de la flecha y su aire. */
const INDENT =
  'pl-[calc(0.5rem+var(--depth)*1.25rem)] sm:pl-[calc(0.875rem+var(--depth)*1.5rem)] pr-2 sm:pr-3'

const depthStyle = (depth: number) => ({ '--depth': depth }) as CSSProperties

/** Lo buscado, resaltado dentro del texto. */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (query === '') return text
  const ranges = highlightRanges(text, query)
  if (ranges.length === 0) return text
  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <mark key={start} className="rounded-[3px] bg-warning/30 text-inherit">
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function RowError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={id} data-testid="row-error" className="pb-2 text-xs text-destructive text-pretty">
      {message}
    </p>
  )
}

/** Un producto: el nombre y a qué estación va. */
const ProductRow = memo(function ProductRow({
  info,
  paused,
  depth,
  path,
  query,
  ctx,
}: {
  info: SlotInfo
  paused: boolean
  depth: number
  /** En una búsqueda: el camino de la categoría. */
  path: string | null
  query: string
  ctx: TreeContext
}) {
  const noteId = useId()
  const key = nodeKey('item', info.id)
  const error = ctx.errors[key]
  return (
    <li
      data-testid="product-row"
      data-item={info.id}
      style={depthStyle(depth)}
      className={cn('border-t border-border/60 first:border-t-0', INDENT)}
    >
      <div className="flex items-center gap-2 py-1">
        <div className="min-w-0 flex-1 py-1">
          <p className="text-[15px] leading-snug [overflow-wrap:anywhere]">
            <Highlight text={info.name} query={query} />
            {paused ? (
              <StatusPill tone="muted" className="ml-2 align-[1px]">
                Pausado
              </StatusPill>
            ) : null}
          </p>
          {path ? (
            <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              <Highlight text={path} query={query} />
            </p>
          ) : null}
        </div>
        <StationSlot
          info={info}
          ctx={ctx.slot}
          saving={ctx.saving.has(key)}
          flash={ctx.flashed.has(key)}
          describedBy={error ? noteId : undefined}
        />
      </div>
      <RowError id={noteId} message={error} />
    </li>
  )
})

/** La cabecera de una categoría: se despliega tocando el nombre y se marca tocando la estación. */
function CategoryHead({
  view,
  depth,
  open,
  onToggle,
  controls,
  path,
  query,
  ctx,
}: {
  view: CategoryView
  depth: number
  /** `null` = no se despliega (una búsqueda, o no tiene nada adentro). */
  open: boolean | null
  onToggle?: () => void
  controls?: string
  path: string | null
  query: string
  ctx: TreeContext
}) {
  const noteId = useId()
  const key = nodeKey('category', view.id)
  const error = ctx.errors[key]
  const top = depth === 0 && path === null
  const count = view.branch.products
  const hidden = view.branch.unrouted + view.branch.inactive
  const name = (
    <span className="min-w-0 flex-1 py-1">
      <span
        className={cn(
          'block leading-snug [overflow-wrap:anywhere]',
          top ? 'font-serif text-[17px] font-semibold tracking-tight' : 'text-[15px] font-semibold',
        )}
      >
        <Highlight text={view.name} query={query} />
        <span className="ml-2 inline-block rounded-full bg-background/70 px-1.5 py-px align-[2px] font-sans text-[11px] font-medium tracking-normal text-muted-foreground tabular-nums">
          {count}
          <span className="sr-only">{count === 1 ? ' producto' : ' productos'}</span>
        </span>
        {view.active ? null : (
          <StatusPill tone="muted" className="ml-2 align-[1px] font-sans tracking-normal">
            Pausada
          </StatusPill>
        )}
        {/* Plegada, lo que falta adentro se tiene que ver igual. */}
        {open === false && hidden > 0 && !view.slot.warn ? (
          <StatusPill tone="warn" className="ml-2 align-[1px] font-sans tracking-normal">
            {view.branch.inactive === 0
              ? `${hidden} sin estación`
              : view.branch.unrouted === 0
                ? `${hidden} en una apagada`
                : `${hidden} para revisar`}
          </StatusPill>
        ) : null}
      </span>
      {path ? (
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">
          <Highlight text={path} query={query} />
        </span>
      ) : null}
      {view.rule ? (
        <span className="mt-0.5 block font-sans text-xs font-normal tracking-normal text-muted-foreground text-pretty">
          {view.rule}
        </span>
      ) : null}
    </span>
  )

  return (
    <div
      data-testid="category-row"
      data-category={view.id}
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
        <StationSlot
          info={view.slot}
          ctx={ctx.slot}
          saving={ctx.saving.has(key)}
          flash={ctx.flashed.has(key)}
          describedBy={error ? noteId : undefined}
        />
      </div>
      <RowError id={noteId} message={error} />
    </div>
  )
}

function Branch({
  id,
  ctx,
  expanded,
  onToggle,
}: {
  id: string
  ctx: TreeContext
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  const listId = useId()
  const view = ctx.model.categories.get(id)
  if (!view) return null
  const open = view.hasInside ? expanded.has(id) : null
  const items = ctx.tree.items.get(id) ?? []
  const children = ctx.tree.children.get(id) ?? []

  return (
    <li className="border-t border-border/60 first:border-t-0">
      <CategoryHead
        view={view}
        depth={view.depth}
        open={open}
        onToggle={() => onToggle(id)}
        controls={listId}
        path={null}
        query=""
        ctx={ctx}
      />
      {open ? (
        <ul id={listId} className="border-t border-border/60">
          {items.map((item) => {
            const info = ctx.model.items.get(item.id)
            return info ? (
              <ProductRow
                key={item.id}
                info={info}
                paused={!item.active}
                depth={view.depth + 1}
                path={null}
                query=""
                ctx={ctx}
              />
            ) : null
          })}
          {children.map((child) => (
            <Branch key={child} id={child} ctx={ctx} expanded={expanded} onToggle={onToggle} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** La carta entera, como árbol: categoría, subcategoría, producto. */
export function CartaTreeView({
  ctx,
  expanded,
  onToggle,
}: {
  ctx: TreeContext
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  const looseId = useId()
  const roots = ctx.tree.children.get(null) ?? []
  const loose = ctx.tree.items.get(NO_CATEGORY_ID) ?? []
  const looseOpen = expanded.has(NO_CATEGORY_ID)
  return (
    <ul data-kc-tree="" data-testid="carta-tree" className={SHEET}>
      {roots.map((id) => (
        <Branch key={id} id={id} ctx={ctx} expanded={expanded} onToggle={onToggle} />
      ))}
      {loose.length > 0 ? (
        <li className="border-t border-border/60 first:border-t-0">
          <div style={depthStyle(0)} className={cn(INDENT, BAND)}>
            <button
              type="button"
              aria-expanded={looseOpen}
              aria-controls={looseOpen ? looseId : undefined}
              onClick={() => onToggle(NO_CATEGORY_ID)}
              className="-ml-1 flex min-h-11 w-full items-center gap-1 rounded-md py-1 pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:gap-2"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
                  looseOpen && 'rotate-90',
                )}
              />
              <span className="font-serif text-[17px] leading-snug font-semibold tracking-tight">
                {NO_CATEGORY_NAME}
                <span className="ml-2 inline-block rounded-full bg-background/70 px-1.5 py-px align-[2px] font-sans text-[11px] font-medium tracking-normal text-muted-foreground tabular-nums">
                  {loose.length}
                  <span className="sr-only">{loose.length === 1 ? ' producto' : ' productos'}</span>
                </span>
              </span>
            </button>
          </div>
          {looseOpen ? (
            <ul id={looseId} className="border-t border-border/60">
              {loose.map((item) => {
                const info = ctx.model.items.get(item.id)
                return info ? (
                  <ProductRow
                    key={item.id}
                    info={info}
                    paused={!item.active}
                    depth={1}
                    path={null}
                    query=""
                    ctx={ctx}
                  />
                ) : null
              })}
            </ul>
          ) : null}
        </li>
      ) : null}
    </ul>
  )
}

/** Una lista corrida: lo que encontró el buscador, o lo que falta marcar. */
export function FlatList({
  ctx,
  categories,
  items,
  query,
  testId,
}: {
  ctx: TreeContext
  /** Las categorías que coinciden, del mejor resultado al peor. */
  categories: ReadonlyArray<string>
  items: ReadonlyArray<string>
  query: string
  testId: string
}) {
  const paused = new Set(
    [...ctx.tree.items.values()].flatMap((list) =>
      list.filter((item) => !item.active).map((item) => item.id),
    ),
  )
  return (
    <ul data-kc-tree="" data-testid={testId} className={SHEET}>
      {categories.map((id) => {
        const view = ctx.model.categories.get(id)
        return view ? (
          <li key={id} className="border-t border-border/60 first:border-t-0">
            <CategoryHead
              view={view}
              depth={0}
              open={null}
              path={ctx.model.categoryPaths.get(id) || 'Categoría de arriba de todo'}
              query={query}
              ctx={ctx}
            />
          </li>
        ) : null
      })}
      {items.map((id) => {
        const info = ctx.model.items.get(id)
        return info ? (
          <ProductRow
            key={id}
            info={info}
            paused={paused.has(id)}
            // Un escalón: el nombre queda alineado con el de las categorías de la lista.
            depth={1}
            path={ctx.model.itemPaths.get(id) ?? null}
            query={query}
            ctx={ctx}
          />
        ) : null
      })}
    </ul>
  )
}
