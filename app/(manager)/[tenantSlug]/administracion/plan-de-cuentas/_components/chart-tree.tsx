'use client'

import { ChevronRight, Ellipsis, Search } from 'lucide-react'
import Link from 'next/link'
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import {
  Planilla,
  PlanillaBar,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
} from '@/components/administracion/planilla'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isSystemAccountKey } from '@/lib/accounting/system-keys'
import { cn } from '@/lib/utils'
import { SLIDING_SHEET } from '../../libros/_components/book-page'
import { SEG_ITEM, SEG_OFF, SEG_ON, SEG_ROOT } from '../../libros/_components/seg'
import { systemUse } from '../_lib/system-uses'
import {
  ACCOUNT_TYPE_NAMES,
  type ChartStatusFilter,
  type ChartTypeFilter,
  type ChartVisibleRow,
  chartView,
  expandedForLevel,
  levelOfExpanded,
  simplePlanIds,
} from '../_lib/tree'
import { AccountBadges } from './account-bits'
import { useChartWorkspace } from './workspace-context'

const TYPE_OPTIONS: ReadonlyArray<{ value: ChartTypeFilter; label: string }> = [
  { value: 'all', label: 'Todos los tipos' },
  { value: 'asset', label: 'Activo' },
  { value: 'liability', label: 'Pasivo' },
  { value: 'equity', label: 'Patrimonio' },
  { value: 'income', label: 'Ingresos' },
  { value: 'expense', label: 'Egresos' },
]

const STATUS_OPTIONS: ReadonlyArray<{ value: ChartStatusFilter; label: string }> = [
  { value: 'active', label: 'Activas' },
  { value: 'inactive', label: 'Inactivas' },
  { value: 'all', label: 'Todas' },
]

const NO_MOVEMENT: ReadonlySet<string> = new Set()

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
  return <Amount cents={row.balanceCents} side currency={false} />
}

/**
 * El plan de cuentas: la tabla jerárquica Código · Cuenta · Saldo. «Plan simple» (`mode="simple"`) es
 * lo de todos los días: lo que se movió, lo que tiene saldo, lo que se elige al cargar y las cajas, con
 * sus grupos, sin abrir nada. «Todas» es el árbol entero: se despliega por grupo o hasta un nivel, se
 * filtra por tipo y se ven las inactivas.
 *
 * Tocar una cuenta lleva a su Mayor; tocar un grupo lo despliega. Editar, mover, desactivar y reasignar
 * están en «⋯». Con el teclado: ↑/↓ entre filas, → abre un grupo y ← lo cierra.
 */
export function ChartTree({
  mode = 'all',
  moved = NO_MOVEMENT,
  segment,
  actions,
}: {
  mode?: 'simple' | 'all'
  /** Las cuentas con movimiento: las que el «Plan simple» no puede esconder. */
  moved?: ReadonlySet<string>
  /** Plan simple · Todas: lo dibuja la página, porque cada uno es una URL. */
  segment?: ReactNode
  /** Los botones chicos de la derecha. */
  actions?: ReactNode
}) {
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
  const simple = mode === 'simple'

  const only = useMemo(
    () => (simple ? simplePlanIds(index, moved) : undefined),
    [simple, index, moved],
  )
  // En el Plan simple no hay filtros de tipo ni de estado: si se tocaron en «Todas», no cuentan.
  const shownType = simple ? 'all' : type
  const shownStatus = simple ? 'active' : status
  const view = useMemo(
    () => chartView(index, { query, status: shownStatus, type: shownType, expanded, only }),
    [index, query, shownStatus, shownType, expanded, only],
  )
  const rows = view.rows
  const autoOpen = view.autoOpen
  const level = useMemo(() => levelOfExpanded(index, expanded), [index, expanded])
  const levels = useMemo(
    () => Array.from({ length: Math.max(1, index.maxLevel) }, (_, i) => i + 1),
    [index.maxLevel],
  )
  const filtered = query.trim() !== '' || shownType !== 'all' || shownStatus !== 'active'
  const mayorHref = (id: string) => `/${tenantSlug}/administracion/libros/mayor?cuenta=${id}`

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
    const items = tableRef.current?.querySelectorAll<HTMLElement>('[data-chart-row]')
    items?.[Math.max(0, Math.min(at, items.length - 1))]?.focus()
  }

  const onRowKey = (event: KeyboardEvent<HTMLElement>, at: number, row: ChartVisibleRow) => {
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
    <>
      <PlanillaBar>
        <label className="relative flex w-full items-center sm:w-64">
          <Search
            className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">Buscar una cuenta por código o nombre</span>
          <input
            type="search"
            value={query}
            placeholder="Código o nombre"
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-card pl-8 pr-2.5 text-base outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40 md:pointer-fine:h-8 md:text-sm"
          />
        </label>
        {segment}
        {actions ? (
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">{actions}</div>
        ) : null}
      </PlanillaBar>

      {simple ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <fieldset className={SEG_ROOT}>
            <legend className="sr-only">Activas o inactivas</legend>
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={status === option.value}
                onClick={() => setStatus(option.value)}
                className={cn(SEG_ITEM, status === option.value ? SEG_ON : SEG_OFF)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="sr-only">Tipo de cuenta</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as ChartTypeFilter)}
              className="adm-select h-11 rounded-md border border-input bg-card px-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:h-8"
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {levels.length > 1 ? (
            <fieldset className="flex items-center gap-2">
              <legend className="sr-only">Ver el plan hasta el nivel</legend>
              <span aria-hidden="true" className="text-xs text-muted-foreground">
                Ver hasta el nivel
              </span>
              <div className={SEG_ROOT}>
                {levels.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={!autoOpen && level === n}
                    aria-label={`Ver hasta el nivel ${n}`}
                    disabled={autoOpen}
                    onClick={() => setExpanded(expandedForLevel(index, n))}
                    className={cn(SEG_ITEM, !autoOpen && level === n ? SEG_ON : SEG_OFF)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>
      )}

      <Planilla className={SLIDING_SHEET}>
        <div ref={tableRef}>
          <PTable minWidth={520} label="Plan de cuentas">
            <thead>
              <tr>
                <PTh>Código</PTh>
                <PTh>Cuenta</PTh>
                <PTh align="right">
                  Saldo<span className="sr-only"> (deudor D, acreedor A)</span>
                </PTh>
                <PTh className="w-12">
                  <span className="sr-only">Acciones</span>
                </PTh>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <PTd colSpan={4} className="py-6 text-center text-muted-foreground">
                    <div className="grid justify-items-center gap-3">
                      <p className="text-pretty">
                        {index.ordered.length === 0
                          ? 'Todavía no hay cuentas: creá la primera o importá el plan que te pasó la contadora.'
                          : query.trim()
                            ? 'No hay cuentas con eso. Probá con el código con puntos («1.1.01»), sin puntos («110101») o con otra palabra.'
                            : 'No hay cuentas para mostrar con estos filtros.'}
                      </p>
                      {index.ordered.length === 0 && !readOnly ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 md:pointer-fine:h-9"
                          onClick={() => createAccount(null)}
                        >
                          Crear una cuenta principal
                        </Button>
                      ) : null}
                    </div>
                  </PTd>
                </tr>
              ) : null}
              {rows.map((row, at) => {
                const isGroup = !row.postable
                const dim = !row.match && (autoOpen || filtered)
                const use = systemUse(row.systemKey)
                const hasBadges =
                  !simple &&
                  (Boolean(row.systemKey) ||
                    row.requiresParty ||
                    row.isTreasury ||
                    (row.purchaseSelectable && row.postable) ||
                    !row.active)
                const name = (
                  <span className={cn(isGroup && 'font-semibold', dim && 'text-muted-foreground')}>
                    {row.name}
                  </span>
                )
                const nameClass =
                  'flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 rounded-md px-1 py-1 text-left outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-7'
                return (
                  <PRow
                    key={row.id}
                    className={cn(
                      !row.active && 'text-muted-foreground',
                      flashId === row.id && 'bg-secondary',
                    )}
                  >
                    <PTd className="align-top font-mono text-xs whitespace-nowrap text-muted-foreground">
                      <span id={rowDomId(row.id)} className="inline-block pt-1.5">
                        {row.code}
                      </span>
                    </PTd>
                    <PTd className="align-top">
                      <div
                        className="flex min-w-0 items-start gap-0.5 pl-[calc(var(--depth)*0.75rem)]"
                        style={{ '--depth': row.depth } as CSSProperties}
                      >
                        {row.expandable && !autoOpen ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={row.open ? `Cerrar ${row.name}` : `Abrir ${row.name}`}
                            onClick={() => toggle(row.id)}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          >
                            <ChevronRight
                              className={cn(
                                'size-4 transition-transform duration-(--duration-fast) motion-reduce:transition-none',
                                row.open && 'rotate-90',
                              )}
                              aria-hidden
                            />
                          </button>
                        ) : null}
                        {row.postable ? (
                          <Link
                            href={mayorHref(row.id)}
                            data-chart-row=""
                            onKeyDown={(event) => onRowKey(event, at, row)}
                            className={nameClass}
                          >
                            {name}
                            {hasBadges ? (
                              <span className="flex max-w-full flex-wrap gap-1">
                                <AccountBadges account={row} />
                              </span>
                            ) : null}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            data-chart-row=""
                            aria-expanded={row.expandable && !autoOpen ? row.open : undefined}
                            onKeyDown={(event) => onRowKey(event, at, row)}
                            onClick={() =>
                              row.expandable && !autoOpen ? toggle(row.id) : openAccount(row.id)
                            }
                            className={nameClass}
                          >
                            {name}
                            {hasBadges ? (
                              <span className="flex max-w-full flex-wrap gap-1">
                                <AccountBadges account={row} />
                              </span>
                            ) : null}
                          </button>
                        )}
                      </div>
                    </PTd>
                    <PTd align="right" className={cn('align-top', isGroup && 'font-semibold')}>
                      <span className="inline-block pt-1.5">
                        <RowBalance row={row} available={balancesAvailable} />
                      </span>
                    </PTd>
                    <PTd className="w-12 p-1 text-right align-top">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11 text-muted-foreground md:pointer-fine:size-8"
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
                              {use ? `Usar otra cuenta para «${use.label}»` : 'Usar otra cuenta'}
                            </DropdownMenuItem>
                          ) : null}
                          {row.postable ? (
                            <DropdownMenuItem asChild className="min-h-11 md:min-h-8">
                              <Link href={mayorHref(row.id)}>Ver mayor</Link>
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
                    </PTd>
                  </PRow>
                )
              })}
            </tbody>
          </PTable>
        </div>
        {filtered && rows.length > 0 ? (
          <PlanillaFoot className="text-xs text-muted-foreground">
            <span role="status">
              {`${plural(view.matches, 'cuenta cumple', 'cuentas cumplen')} los filtros.`}
            </span>
            {shownType !== 'all' ? <span>{ACCOUNT_TYPE_NAMES[shownType]}</span> : null}
          </PlanillaFoot>
        ) : null}
      </Planilla>
    </>
  )
}
