'use client'

import { ChevronDown } from 'lucide-react'
import { memo, useId } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { type PriceItem, pointKey, type ViewId } from '@/lib/menu/prices/types'
import { type PriceBook, type PriceGroup, priceRange, rowPrice } from '@/lib/menu/prices/view'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { type GuardState, PriceRow, type PriceRowProps } from './price-row'

/** Lo que cada renglón necesita para avisar: los mismos para toda la lista, así no se redibuja de más. */
export type RowHandlers = Pick<
  PriceRowProps,
  'onCommit' | 'onCancel' | 'onGuardPick' | 'onHistory' | 'onReset' | 'onAvailable'
>

export type ListContext = {
  book: PriceBook
  view: ViewId
  /** La sucursal que se mira; vacío en «Toda la carta». */
  branchName: string | null
  branchColor: string | null
  guards: Readonly<Record<string, GuardState>>
  errors: Readonly<Record<string, string>>
  handlers: RowHandlers
}

/** La hoja de la lista: una sola superficie con renglones separados por una raya suave. */
const SHEET = 'card-hairline overflow-clip rounded-2xl border bg-card shadow-xs'
/** La franja de un grupo: opaca, porque se queda pegada arriba mientras pasan sus renglones. */
const BAND = 'bg-[color-mix(in_oklch,var(--secondary)_62%,var(--card))]'

function Row({
  item,
  ctx,
  path,
  query,
}: {
  item: PriceItem
  ctx: ListContext
  path: string | null
  query: string
}) {
  const key = pointKey(ctx.view, item.id)
  const price = rowPrice(ctx.book, item, ctx.view)
  return (
    <PriceRow
      itemId={item.id}
      name={item.name}
      path={path}
      query={query}
      paused={!item.active}
      effectiveCents={price.effectiveCents}
      menuCents={price.menuCents}
      ownCents={price.ownCents}
      available={price.available}
      saving={ctx.book.saving.has(key)}
      branchName={ctx.branchName}
      branchColor={ctx.branchColor}
      guard={ctx.guards[key]}
      error={ctx.errors[key]}
      {...ctx.handlers}
    />
  )
}

const GroupSection = memo(function GroupSection({
  group,
  ctx,
  collapsed,
  onToggle,
}: {
  group: PriceGroup
  ctx: ListContext
  collapsed: boolean
  onToggle: (id: string) => void
}) {
  const listId = useId()
  const range = priceRange(
    group.items.map((item) => rowPrice(ctx.book, item, ctx.view).effectiveCents),
  )
  const count = group.items.length

  return (
    <section data-testid="price-group" data-group={group.id}>
      <h2
        className={cn(
          'sticky top-[7.5rem] z-10 flex min-h-11 items-center gap-2 border-border/60 px-3 sm:top-[8.25rem] sm:gap-3 sm:px-4',
          // Plegado no lleva raya abajo: la del grupo que sigue ya lo separa (si no, quedaban dos).
          !collapsed && 'border-b',
          BAND,
        )}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : listId}
          onClick={() => onToggle(group.id)}
          className="-mx-1 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
              collapsed && '-rotate-90',
            )}
          />
          <span className="min-w-0 truncate text-sm">
            {group.ancestors.length > 0 ? (
              <span className="text-muted-foreground">{group.ancestors.join(' › ')} › </span>
            ) : null}
            <span className="font-semibold">{group.name}</span>
          </span>
          <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-px text-[11px] font-medium text-muted-foreground tabular-nums">
            {count}
            <span className="sr-only">{count === 1 ? ' producto' : ' productos'}</span>
          </span>
          {group.active ? null : <StatusPill tone="muted">Pausada</StatusPill>}
        </button>
        {ctx.branchName ? (
          <span
            aria-hidden
            className="hidden w-24 shrink-0 text-center text-[11px] font-medium text-muted-foreground sm:block"
          >
            Se vende acá
          </span>
        ) : null}
        {range ? (
          <span className="hidden w-36 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
            {range.min === range.max
              ? formatCentsShort(range.min)
              : `${formatCentsShort(range.min)} a ${formatCentsShort(range.max)}`}
          </span>
        ) : null}
        <span aria-hidden className="hidden w-9 shrink-0 sm:block" />
      </h2>
      {collapsed ? null : (
        <ul id={listId} className="divide-y divide-border/60">
          {group.items.map((item) => (
            <Row key={item.id} item={item} ctx={ctx} path={null} query="" />
          ))}
        </ul>
      )}
    </section>
  )
})

/** La carta entera, por categoría. Cada grupo se pliega tocando su título. */
export function GroupedList({
  groups,
  ctx,
  collapsed,
  onToggle,
}: {
  groups: ReadonlyArray<PriceGroup>
  ctx: ListContext
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  return (
    <div
      data-testid="price-list"
      className={cn(
        SHEET,
        '[&>section+section>h2]:border-t [&>section+section>h2]:border-t-border/60',
      )}
    >
      {groups.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          ctx={ctx}
          collapsed={collapsed.has(group.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

/** Lo que encontró el buscador: una lista corrida, del mejor resultado al peor. */
export function ResultList({
  items,
  paths,
  ctx,
  query,
}: {
  items: ReadonlyArray<PriceItem>
  paths: ReadonlyMap<string, string>
  ctx: ListContext
  query: string
}) {
  return (
    <ul data-testid="price-results" className={cn(SHEET, 'divide-y divide-border/60')}>
      {items.map((item) => (
        <Row key={item.id} item={item} ctx={ctx} path={paths.get(item.id) ?? null} query={query} />
      ))}
    </ul>
  )
}
