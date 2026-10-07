'use client'

import { ChevronRight, Ellipsis, ListTree, Search } from 'lucide-react'
import Link from 'next/link'
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react'
import { Amount } from '@/components/administracion/amount'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar } from '@/components/ui/filter-bar'
import { Label } from '@/components/ui/label'
import { type SlidingTab, SlidingTabs } from '@/components/ui/sliding-tabs'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { ACCOUNT_TYPE_LABELS } from '../../ajustes/_lib/labels'
import {
  allGroups,
  type ChartAccount,
  type ChartTypeFilter,
  defaultExpanded,
  visibleChartRows,
} from '../_lib/tree'
import { AccountBadges, AccountSheet, type AccountSheetState } from './account-sheet'

const TYPE_TABS: SlidingTab<ChartTypeFilter>[] = [
  { value: 'all', label: 'Todas' },
  { value: 'asset', label: 'Activo' },
  { value: 'liability', label: 'Pasivo' },
  { value: 'equity', label: 'Patrimonio' },
  { value: 'income', label: 'Ingresos' },
  { value: 'expense', label: 'Egresos' },
]

/** `?cuenta=` en la URL sin pedir la página de nuevo (la lista ya está acá). */
function syncCuentaParam(id: string | null) {
  try {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('cuenta', id)
    else url.searchParams.delete('cuenta')
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // Sin History API: la hoja funciona igual, solo no queda en la URL.
  }
}

/**
 * El plan de cuentas como árbol (H.16): buscar por código o nombre,
 * desplegar, filtrar por rubro y mostrar las inactivas. Con el teclado: ↑/↓
 * entre filas, → abre un grupo, ← lo cierra. Cada cuenta se abre en la hoja de
 * la derecha (`?cuenta=`).
 */
export function ChartTree({
  tenantSlug,
  accounts,
  readOnly,
  balancesAvailable,
  initialAccountId,
}: {
  tenantSlug: string
  accounts: readonly ChartAccount[]
  readOnly: boolean
  balancesAvailable: boolean
  initialAccountId: string | null
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState<ChartTypeFilter>('all')
  const [showInactive, setShowInactive] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = defaultExpanded(accounts)
    // Si se llega con `?cuenta=`, su camino arranca abierto.
    const byId = new Map(accounts.map((a) => [a.id, a]))
    let parent = initialAccountId ? byId.get(initialAccountId)?.parentId : null
    while (parent) {
      open.add(parent)
      parent = byId.get(parent)?.parentId ?? null
    }
    return open
  })
  const [sheet, setSheet] = useState<AccountSheetState>(() => {
    const account = initialAccountId ? accounts.find((a) => a.id === initialAccountId) : undefined
    return account ? { mode: 'edit', account } : null
  })
  const tableRef = useRef<HTMLDivElement | null>(null)

  const rows = useMemo(
    () => visibleChartRows(accounts, { query, showInactive, type, expanded }),
    [accounts, query, showInactive, type, expanded],
  )
  const groups = useMemo(() => allGroups(accounts), [accounts])
  const everythingOpen = groups.size > 0 && [...groups].every((id) => expanded.has(id))
  const searching = query.trim() !== ''

  const toggle = useCallback((id: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      const shouldOpen = open ?? !next.has(id)
      if (shouldOpen) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const openSheet = (next: AccountSheetState) => {
    setSheet(next)
    syncCuentaParam(next?.mode === 'edit' ? next.account.id : null)
  }

  // Si el plan cambia (se guardó algo), la hoja abierta muestra la versión nueva.
  const sheetState: AccountSheetState = useMemo(() => {
    if (!sheet) return null
    if (sheet.mode === 'edit') {
      const fresh = accounts.find((a) => a.id === sheet.account.id)
      return fresh ? { mode: 'edit', account: fresh } : null
    }
    const parent = accounts.find((a) => a.id === sheet.parent.id)
    return parent ? { mode: 'create', parent } : null
  }, [sheet, accounts])

  const focusRow = (index: number) => {
    const buttons = tableRef.current?.querySelectorAll<HTMLButtonElement>('[data-chart-row]')
    buttons?.[Math.max(0, Math.min(index, buttons.length - 1))]?.focus()
  }

  const onRowKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    row: (typeof rows)[number],
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(index - 1)
    } else if (event.key === 'ArrowRight' && row.hasChildren && !searching) {
      event.preventDefault()
      if (!row.open) toggle(row.id, true)
      else focusRow(index + 1)
    } else if (event.key === 'ArrowLeft' && !searching) {
      event.preventDefault()
      if (row.hasChildren && row.open) toggle(row.id, false)
      else if (row.parentId) {
        const parentIndex = rows.findIndex((r) => r.id === row.parentId)
        if (parentIndex >= 0) focusRow(parentIndex)
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
          <span className="sr-only">Buscar una cuenta</span>
          <input
            type="search"
            value={query}
            placeholder="Código o nombre («1101», «proveedores»)"
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-lg border border-transparent bg-background/40 pl-9 pr-3 text-base shadow-none outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40 md:h-9 md:text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
          <div className="flex items-center gap-2">
            <Switch id="pc-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
            <Label htmlFor="pc-inactive" className="text-sm">
              Mostrar inactivas
            </Label>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 md:h-8"
            disabled={searching}
            onClick={() =>
              setExpanded(everythingOpen ? defaultExpanded(accounts) : new Set(groups))
            }
          >
            {everythingOpen ? 'Contraer' : 'Expandir todo'}
          </Button>
        </div>
      </FilterBar>

      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <SlidingTabs tabs={TYPE_TABS} value={type} onChange={setType} size="sm" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title={searching ? 'No hay cuentas con eso' : 'No hay cuentas para mostrar'}
          description={
            searching
              ? 'Probá con el código sin puntos («1101») o con otra palabra.'
              : 'Probá con otro rubro o mostrá las inactivas.'
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
                    <DataTableHeader className="hidden md:table-cell">Rubro</DataTableHeader>
                    <DataTableHeader className="text-right">
                      Saldo<span className="sr-only"> (deudor D, acreedor A)</span>
                    </DataTableHeader>
                    <DataTableHeader className="w-14">
                      <span className="sr-only">Acciones</span>
                    </DataTableHeader>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((row, index) => {
                    const isGroup = row.hasChildren || !row.postable
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          'transition-colors hover:bg-cream-tint',
                          !row.active && 'text-muted-foreground',
                          row.match && 'bg-secondary/30',
                        )}
                      >
                        <DataTableCell className="py-2">
                          <div
                            className="flex min-w-0 items-center gap-1"
                            style={{ paddingLeft: `${row.depth * 1.25}rem` }}
                          >
                            {row.hasChildren ? (
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label={row.open ? `Cerrar ${row.name}` : `Abrir ${row.name}`}
                                disabled={searching}
                                onClick={() => toggle(row.id)}
                                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
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
                              <span aria-hidden="true" className="size-8 shrink-0" />
                            )}
                            <button
                              type="button"
                              data-chart-row
                              aria-expanded={row.hasChildren ? row.open : undefined}
                              onKeyDown={(event) => onRowKey(event, index, row)}
                              onClick={() =>
                                isGroup && !searching && row.hasChildren
                                  ? toggle(row.id)
                                  : openSheet({ mode: 'edit', account: row })
                              }
                              className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
                            >
                              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                {row.code}
                              </span>
                              <span
                                className={cn('text-sm', isGroup ? 'font-semibold' : 'font-medium')}
                              >
                                {row.name}
                              </span>
                              <span className="flex flex-wrap gap-1">
                                <AccountBadges account={row} />
                              </span>
                            </button>
                          </div>
                        </DataTableCell>
                        <DataTableCell className="hidden py-2 text-xs text-muted-foreground md:table-cell">
                          {ACCOUNT_TYPE_LABELS[row.type]}
                        </DataTableCell>
                        <DataTableCell
                          className={cn('py-2 text-right text-sm', isGroup && 'font-semibold')}
                        >
                          {!balancesAvailable || row.balanceCents === null ? (
                            <Amount cents={null} />
                          ) : row.balanceCents === 0 ? (
                            <span className="text-muted-foreground tabular-nums">0,00</span>
                          ) : (
                            <Amount cents={row.balanceCents} side />
                          )}
                        </DataTableCell>
                        <DataTableCell className="py-2 text-right">
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
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem
                                className="min-h-11 md:min-h-8"
                                onSelect={() => openSheet({ mode: 'edit', account: row })}
                              >
                                {readOnly ? 'Ver detalle' : 'Editar'}
                              </DropdownMenuItem>
                              {!readOnly && isGroup ? (
                                <DropdownMenuItem
                                  className="min-h-11 md:min-h-8"
                                  onSelect={() => openSheet({ mode: 'create', parent: row })}
                                >
                                  Agregar cuenta adentro
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
        </DataTableShell>
      )}

      <AccountSheet
        tenantSlug={tenantSlug}
        state={sheetState}
        accounts={accounts}
        readOnly={readOnly}
        balancesAvailable={balancesAvailable}
        onClose={() => openSheet(null)}
        onCreated={(parentId) => toggle(parentId, true)}
      />
    </div>
  )
}
