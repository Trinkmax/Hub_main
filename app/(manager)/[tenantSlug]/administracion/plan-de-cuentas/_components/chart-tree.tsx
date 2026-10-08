'use client'

import { ChevronRight, Ellipsis, ListTree, Search } from 'lucide-react'
import Link from 'next/link'
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar } from '@/components/ui/filter-bar'
import { type SlidingTab, SlidingTabs } from '@/components/ui/sliding-tabs'
import { isSystemAccountKey } from '@/lib/accounting/system-keys'
import { cn } from '@/lib/utils'
import { systemUse } from '../_lib/system-uses'
import {
  ACCOUNT_TYPE_NAMES,
  type ChartStatusFilter,
  type ChartTypeFilter,
  type ChartVisibleRow,
  chartView,
  expandedForLevel,
  levelOfExpanded,
} from '../_lib/tree'
import { AccountBadges } from './account-bits'
import { useChartWorkspace } from './workspace-context'

const TYPE_TABS: SlidingTab<ChartTypeFilter>[] = [
  { value: 'all', label: 'Todas' },
  { value: 'asset', label: 'Activo' },
  { value: 'liability', label: 'Pasivo' },
  { value: 'equity', label: 'Patrimonio' },
  { value: 'income', label: 'Ingresos' },
  { value: 'expense', label: 'Egresos' },
]

const STATUS_TABS: SlidingTab<ChartStatusFilter>[] = [
  { value: 'active', label: 'Activas' },
  { value: 'inactive', label: 'Inactivas' },
  { value: 'all', label: 'Todas' },
]

function rowDomId(id: string): string {
  return `cuenta-${id}`
}

function RowBalance({ row, available }: { row: ChartVisibleRow; available: boolean }) {
  if (!available || row.balanceCents === null) return <Amount cents={null} />
  if (row.balanceCents === 0)
    return (
      <span className="whitespace-nowrap text-muted-foreground tabular-nums">
        0,00
        {/* El lugar de la «D»/«A»: los centavos quedan en la misma columna que los demás saldos. */}
        <span aria-hidden="true" className="invisible ml-1">
          D
        </span>
      </span>
    )
  return <Amount cents={row.balanceCents} side />
}

/**
 * El plan de cuentas como árbol (H.16 + #16): buscar por código («1.1.01», «110101») o nombre, por
 * tipo, activas o inactivas, y ver hasta el nivel que se quiera. Cada cuenta muestra su código, su
 * nombre, el tipo, «Para qué se usa» y sus insignias. Tocar un grupo lo despliega; tocar una cuenta
 * (o «⋯ › Editar») la abre en la hoja de la derecha (`?cuenta=`). Con el teclado: ↑/↓ entre filas,
 * → abre un grupo y ← lo cierra.
 */
export function ChartTree() {
  const {
    tenantSlug,
    index,
    readOnly,
    canAdmin,
    balancesAvailable,
    expanded,
    setExpanded,
    focusId,
    clearFocus,
    openAccount,
    createAccount,
    moveAccount,
    changeActive,
    remapKey,
  } = useChartWorkspace()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<ChartTypeFilter>('all')
  const [status, setStatus] = useState<ChartStatusFilter>('active')
  const [flashId, setFlashId] = useState<string | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)

  const view = useMemo(
    () => chartView(index, { query, status, type, expanded }),
    [index, query, status, type, expanded],
  )
  const rows = view.rows
  const autoOpen = view.autoOpen
  const level = useMemo(() => levelOfExpanded(index, expanded), [index, expanded])
  const levels = useMemo(
    () => Array.from({ length: Math.max(1, index.maxLevel) }, (_, i) => i + 1),
    [index.maxLevel],
  )
  const filtered = query.trim() !== '' || type !== 'all' || status !== 'active'

  // La última cuenta creada, movida o reactivada: se abre su camino, se muestra y se resalta.
  useEffect(() => {
    if (!focusId || !index.byId.has(focusId)) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of index.ancestors.get(focusId) ?? []) next.add(id)
      return next
    })
    setFlashId(focusId)
    clearFocus()
  }, [focusId, index, setExpanded, clearFocus])

  useEffect(() => {
    if (!flashId) return
    document
      .getElementById(rowDomId(flashId))
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const timer = window.setTimeout(() => setFlashId(null), 2400)
    return () => window.clearTimeout(timer)
  }, [flashId])

  const toggle = useCallback(
    (id: string, open?: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        const shouldOpen = open ?? !next.has(id)
        if (shouldOpen) next.add(id)
        else next.delete(id)
        return next
      })
    },
    [setExpanded],
  )

  const focusRow = (at: number) => {
    const buttons = tableRef.current?.querySelectorAll<HTMLButtonElement>('[data-chart-row]')
    buttons?.[Math.max(0, Math.min(at, buttons.length - 1))]?.focus()
  }

  const onRowKey = (event: KeyboardEvent<HTMLButtonElement>, at: number, row: ChartVisibleRow) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(at + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(at - 1)
    } else if (event.key === 'ArrowRight' && row.expandable && !autoOpen) {
      event.preventDefault()
      if (!row.open) toggle(row.id, true)
      else focusRow(at + 1)
    } else if (event.key === 'ArrowLeft' && !autoOpen) {
      event.preventDefault()
      if (row.expandable && row.open) toggle(row.id, false)
      else if (row.parentId) {
        const parentAt = rows.findIndex((r) => r.id === row.parentId)
        if (parentAt >= 0) focusRow(parentAt)
      }
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar>
        <label className="relative flex flex-1 items-center">
          <Search
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">Buscar una cuenta por código o nombre</span>
          <input
            type="search"
            value={query}
            placeholder="Código («1.1.01») o nombre"
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-lg border border-transparent bg-background/40 pl-9 pr-3 text-base shadow-none outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40 md:h-9 md:text-sm"
          />
        </label>
        <div className="-mx-2 overflow-x-auto px-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <SlidingTabs tabs={STATUS_TABS} value={status} onChange={setStatus} size="sm" />
        </div>
      </FilterBar>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <SlidingTabs tabs={TYPE_TABS} value={type} onChange={setType} size="sm" />
        </div>
        {levels.length > 1 ? (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Ver el plan hasta el nivel</legend>
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              Ver hasta el nivel
            </span>
            {levels.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={!autoOpen && level === n}
                aria-label={`Ver hasta el nivel ${n}`}
                disabled={autoOpen}
                onClick={() => setExpanded(expandedForLevel(index, n))}
                className={cn(
                  'inline-flex h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-medium tabular-nums transition-colors md:h-9 md:min-w-9',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:opacity-60',
                  !autoOpen && level === n
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
                )}
              >
                {n}
              </button>
            ))}
          </fieldset>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title={
            index.ordered.length === 0
              ? 'Todavía no hay cuentas'
              : filtered
                ? 'No hay cuentas con eso'
                : 'No hay cuentas para mostrar'
          }
          description={
            index.ordered.length === 0
              ? 'Creá la primera o importá el plan que te pasó la contadora.'
              : query.trim()
                ? 'Probá con el código con puntos («1.1.01»), sin puntos («110101») o con otra palabra.'
                : 'Probá con otro tipo o mirá todas.'
          }
          action={
            index.ordered.length === 0 && !readOnly ? (
              <Button type="button" className="h-11 md:h-9" onClick={() => createAccount(null)}>
                Crear una cuenta principal
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTableShell>
          <div ref={tableRef}>
            <DataTableScroll>
              <DataTableRoot>
                <DataTableHead>
                  <tr>
                    <DataTableHeader>Cuenta</DataTableHeader>
                    <DataTableHeader className="hidden sm:table-cell">Tipo</DataTableHeader>
                    <DataTableHeader className="hidden text-right sm:table-cell">
                      Saldo<span className="sr-only"> (deudor D, acreedor A)</span>
                    </DataTableHeader>
                    <DataTableHeader className="w-14">
                      <span className="sr-only">Acciones</span>
                    </DataTableHeader>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((row, at) => {
                    const isGroup = !row.postable
                    const dim = !row.match && (autoOpen || filtered)
                    const use = systemUse(row.systemKey)
                    const hasBadges =
                      Boolean(row.systemKey) ||
                      row.requiresParty ||
                      row.isTreasury ||
                      (row.purchaseSelectable && row.postable) ||
                      !row.active
                    return (
                      <tr
                        key={row.id}
                        id={rowDomId(row.id)}
                        className={cn(
                          'transition-colors duration-[var(--duration-fast)] hover:bg-cream-tint',
                          !row.active && 'text-muted-foreground',
                          flashId === row.id && 'bg-cream-tint',
                        )}
                      >
                        <DataTableCell className="py-1.5">
                          <div
                            className="flex min-w-0 items-start gap-1 pl-[calc(var(--depth)*0.75rem)] sm:pl-[calc(var(--depth)*1.25rem)]"
                            style={{ '--depth': row.depth } as CSSProperties}
                          >
                            {row.expandable ? (
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label={row.open ? `Cerrar ${row.name}` : `Abrir ${row.name}`}
                                disabled={autoOpen}
                                onClick={() => toggle(row.id)}
                                className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                              >
                                <ChevronRight
                                  className={cn(
                                    'size-4 transition-transform duration-[var(--duration-fast)]',
                                    row.open && 'rotate-90',
                                  )}
                                  aria-hidden
                                />
                              </button>
                            ) : (
                              <span aria-hidden="true" className="mt-1 size-8 shrink-0" />
                            )}
                            <button
                              type="button"
                              data-chart-row
                              aria-expanded={row.expandable ? row.open : undefined}
                              onKeyDown={(event) => onRowKey(event, at, row)}
                              onClick={() =>
                                row.expandable && !autoOpen ? toggle(row.id) : openAccount(row.id)
                              }
                              className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 rounded-md px-1 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
                            >
                              <span className="flex flex-col items-start gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
                                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                  {row.code}
                                </span>
                                <span
                                  className={cn(
                                    'text-sm',
                                    isGroup ? 'font-semibold' : 'font-medium',
                                    dim && 'text-muted-foreground',
                                  )}
                                >
                                  {row.name}
                                </span>
                              </span>
                              {hasBadges ? (
                                <span className="flex max-w-full flex-wrap gap-1">
                                  <AccountBadges account={row} />
                                </span>
                              ) : null}
                              {row.description ? (
                                <span className="line-clamp-2 max-w-prose text-xs text-muted-foreground text-pretty sm:line-clamp-1">
                                  {row.description}
                                </span>
                              ) : null}
                              <span className="text-xs text-muted-foreground sm:hidden">
                                {ACCOUNT_TYPE_NAMES[row.type]}
                                {balancesAvailable ? (
                                  <>
                                    {/* El punto queda pegado al tipo: si no entra, baja el saldo entero. */}
                                    {' · '}
                                    <span className="whitespace-nowrap">
                                      Saldo <RowBalance row={row} available={balancesAvailable} />
                                    </span>
                                  </>
                                ) : null}
                              </span>
                            </button>
                          </div>
                        </DataTableCell>
                        <DataTableCell className="hidden py-2 text-xs text-muted-foreground sm:table-cell">
                          {ACCOUNT_TYPE_NAMES[row.type]}
                        </DataTableCell>
                        <DataTableCell
                          className={cn(
                            'hidden py-2 text-right text-sm sm:table-cell',
                            isGroup && 'font-semibold',
                          )}
                        >
                          <RowBalance row={row} available={balancesAvailable} />
                        </DataTableCell>
                        <DataTableCell className="py-2 text-right align-top sm:align-middle">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-11 text-muted-foreground md:size-8"
                                aria-label={`Más opciones de ${row.code} ${row.name}`}
                              >
                                <Ellipsis className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem
                                className="min-h-11 md:min-h-8"
                                onSelect={() => openAccount(row.id)}
                              >
                                {readOnly ? 'Ver detalle' : 'Editar'}
                              </DropdownMenuItem>
                              {!readOnly && isGroup && row.active ? (
                                <DropdownMenuItem
                                  className="min-h-11 md:min-h-8"
                                  onSelect={() => createAccount(row.id)}
                                >
                                  Agregar cuenta adentro
                                </DropdownMenuItem>
                              ) : null}
                              {!readOnly ? (
                                <DropdownMenuItem
                                  className="min-h-11 md:min-h-8"
                                  onSelect={() => moveAccount(row.id)}
                                >
                                  Mover a otro grupo
                                </DropdownMenuItem>
                              ) : null}
                              {canAdmin && isSystemAccountKey(row.systemKey) ? (
                                <DropdownMenuItem
                                  className="min-h-11 md:min-h-8"
                                  onSelect={() => {
                                    if (isSystemAccountKey(row.systemKey)) remapKey(row.systemKey)
                                  }}
                                >
                                  {use
                                    ? `Usar otra cuenta para «${use.label}»`
                                    : 'Usar otra cuenta'}
                                </DropdownMenuItem>
                              ) : null}
                              {row.postable ? (
                                <DropdownMenuItem asChild className="min-h-11 md:min-h-8">
                                  <Link
                                    href={`/${tenantSlug}/administracion/libros/mayor?cuenta=${row.id}`}
                                  >
                                    Ver mayor
                                  </Link>
                                </DropdownMenuItem>
                              ) : null}
                              {!readOnly ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="min-h-11 md:min-h-8"
                                    onSelect={() => changeActive(row.id, !row.active)}
                                  >
                                    {row.active ? 'Desactivar' : 'Reactivar'}
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </DataTableCell>
                      </tr>
                    )
                  })}
                </DataTableBody>
              </DataTableRoot>
            </DataTableScroll>
          </div>
          {filtered ? (
            <DataTableFooter>
              <span role="status">
                {`${plural(view.matches, 'cuenta cumple', 'cuentas cumplen')} los filtros.`}
              </span>
            </DataTableFooter>
          ) : null}
        </DataTableShell>
      )}
    </div>
  )
}
