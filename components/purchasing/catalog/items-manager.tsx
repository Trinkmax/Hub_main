'use client'

import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Package,
  Plus,
  Route,
  Search,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { dataIssues } from '@/lib/purchasing/checks'
import {
  FREQUENCY_LABELS,
  type Frequency,
  type PurItem,
  type PurSupplier,
  type PurZone,
} from '@/lib/purchasing/types'
import { formatAmount, unitShort } from '@/lib/purchasing/units'
import { cn } from '@/lib/utils'
import { FIELD_INPUT, matchesSearch, Pill, PillCount } from './form-bits'
import { ItemEditorSheet } from './item-editor'
import { useSheetUrl } from './use-sheet-url'
import { type ZoneItemCounts, ZonesSheet } from './zones-sheet'

/** `?editar=<id>` abre la ficha · `?nuevo=1` una vacía · `?zonas=1` las zonas del recorrido. */
const SHEET_KEYS = ['editar', 'nuevo', 'zonas'] as const

type FilterKey = 'all' | 'fix' | Frequency | 'inactive'

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'fix', label: 'Para corregir' },
  { key: 'frequent', label: 'Frecuentes' },
  { key: 'secondary', label: 'Secundarios' },
  { key: 'occasional', label: 'Eventuales' },
  { key: 'inactive', label: 'Desactivados' },
]

/** «No está …»: dónde se buscó, para el estado vacío de cada filtro. */
const FILTER_PLACES: Record<FilterKey, string> = {
  all: 'en la lista',
  fix: 'entre los que tienen datos para corregir',
  frequent: 'entre los frecuentes',
  secondary: 'entre los secundarios',
  occasional: 'entre los eventuales',
  inactive: 'entre los desactivados',
}

/** La fila: en el celular, dos columnas apiladas; en la compu, cinco columnas alineadas. */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 md:grid-cols-[minmax(0,2.3fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_6.5rem] md:items-center md:gap-x-4'

function inFilter(item: PurItem, filter: FilterKey, issues: ReadonlyMap<string, number>) {
  if (filter === 'inactive') return !item.active
  if (!item.active) return false
  if (filter === 'all') return true
  if (filter === 'fix') return (issues.get(item.id) ?? 0) > 0
  return item.frequency === filter
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`
}

/**
 * Los insumos: la lista maestra que antes vivía en la planilla, agrupada por zona en el orden del
 * recorrido (y «Sin zona» al final), con búsqueda y filtros. Tocar uno abre su ficha.
 */
export function ItemsManager({
  tenantSlug,
  items,
  zones,
  suppliers,
  usedIn,
}: {
  tenantSlug: string
  items: readonly PurItem[]
  zones: readonly PurZone[]
  suppliers: readonly PurSupplier[]
  /** Por insumo, las recetas que lo usan («Noche de Ramen · Cerdo»). */
  usedIn: Readonly<Record<string, string[]>>
}) {
  const router = useRouter()
  const { params, open: openSheet, close: closeSheet } = useSheetUrl(SHEET_KEYS)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')

  const { itemsById, supplierNames, issues, zoneCounts } = useMemo(() => {
    const issueCount = new Map<string, number>()
    for (const issue of dataIssues({ items, suppliers: [], recipes: [], upcoming: [] })) {
      if (issue.target.kind !== 'item') continue
      issueCount.set(issue.target.id, (issueCount.get(issue.target.id) ?? 0) + 1)
    }
    const counts: Record<string, { active: number; total: number }> = {}
    for (const item of items) {
      if (!item.zoneId) continue
      const entry = counts[item.zoneId] ?? { active: 0, total: 0 }
      entry.total += 1
      if (item.active) entry.active += 1
      counts[item.zoneId] = entry
    }
    return {
      itemsById: new Map(items.map((item) => [item.id, item])),
      supplierNames: new Map(suppliers.map((s) => [s.id, s.name])),
      issues: issueCount as ReadonlyMap<string, number>,
      zoneCounts: counts as ZoneItemCounts,
    }
  }, [items, suppliers])

  // ── Las hojas (salen de la URL) ──────────────────────────────────────────────
  const editId = params.get('editar')
  const creating = params.get('nuevo') === '1'
  const editing = editId ? (itemsById.get(editId) ?? null) : null
  const editorOpen = creating || editing !== null
  const zonesOpen = !editorOpen && params.get('zonas') === '1'
  // Lo que muestra la hoja mientras se cierra (la URL ya no lo tiene).
  const [mode, setMode] = useState<'new' | 'edit'>(creating ? 'new' : 'edit')
  const [shown, setShown] = useState<PurItem | null>(editing)
  if (creating && mode !== 'new') setMode('new')
  if (editing && mode !== 'edit') setMode('edit')
  if (editing && editing !== shown) setShown(editing)
  const sheetItem = mode === 'edit' ? shown : null

  const missing = editId !== null && !itemsById.has(editId)
  useEffect(() => {
    if (!missing) return
    toast.error('Ese insumo ya no está en la lista.', { id: 'pur-item-missing' })
    closeSheet()
  }, [missing, closeSheet])

  // ── La lista ────────────────────────────────────────────────────────────────
  const searchTexts = (item: PurItem) => [
    item.name,
    item.brand,
    item.code,
    item.supplierId ? supplierNames.get(item.supplierId) : null,
  ]
  const counts = Object.fromEntries(
    FILTERS.map(({ key }) => [key, items.filter((item) => inFilter(item, key, issues)).length]),
  ) as Record<FilterKey, number>
  const visible = items.filter(
    (item) => inFilter(item, filter, issues) && matchesSearch(query, searchTexts(item)),
  )
  const hiddenInactive =
    filter === 'all' && query.trim()
      ? items.filter((item) => !item.active && matchesSearch(query, searchTexts(item))).length
      : 0

  const zoneIds = new Set(zones.map((zone) => zone.id))
  const groups: Array<{ key: string; zone: PurZone | null; items: PurItem[] }> = [
    ...zones.map((zone) => ({
      key: zone.id,
      zone,
      items: visible.filter((item) => item.zoneId === zone.id),
    })),
    {
      key: 'sin-zona',
      zone: null,
      items: visible.filter((item) => !item.zoneId || !zoneIds.has(item.zoneId)),
    },
  ].filter((group) => group.items.length > 0)

  const activeCount = counts.all
  const fixCount = counts.fix

  return (
    <>
      <PageHeader
        eyebrow="Compras"
        title="Insumos"
        description={
          items.length ? (
            <>
              La lista que antes vivía en la planilla: qué se cuenta, cuánto tiene que haber y a
              quién se le pide.{' '}
              <span className="text-foreground">
                {plural(activeCount, 'insumo activo', 'insumos activos')}
                {fixCount
                  ? ` · ${fixCount.toLocaleString('es-AR')} con datos para corregir`
                  : ' · todos con sus datos completos'}
                .
              </span>
            </>
          ) : (
            'La lista de lo que se cuenta en la cocina y se le pide a cada proveedor.'
          )
        }
        actions={
          // Los tres en una fila desde tablet (la descripción se angosta); en un celular chico pasan a dos.
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
            <Button
              type="button"
              onClick={() => openSheet({ nuevo: '1' })}
              className="h-11 flex-1 sm:flex-none md:h-10"
            >
              <Plus className="size-4" aria-hidden />
              <span className="sm:hidden">Agregar</span>
              <span className="hidden sm:inline">Agregar insumo</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => openSheet({ zonas: '1' })}
              className="h-11 flex-1 sm:flex-none md:h-10"
            >
              <Route className="size-4" aria-hidden />
              <span className="sm:hidden">Zonas</span>
              <span className="hidden sm:inline">Zonas del recorrido</span>
            </Button>
            <Button asChild variant="outline" className="h-11 flex-1 sm:flex-none md:h-10">
              <Link href={`/${tenantSlug}/compras/insumos/planilla`}>
                <FileSpreadsheet className="size-4" aria-hidden />
                Planilla
              </Link>
            </Button>
          </div>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Todavía no hay insumos"
          description="Cargá lo que se cuenta en la cocina. Si primero armás las zonas del recorrido, cada insumo va a su lugar y la cocina cuenta en orden."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                onClick={() => openSheet({ nuevo: '1' })}
                className="h-11 md:h-10"
              >
                <Plus className="size-4" aria-hidden />
                Agregar insumo
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => openSheet({ zonas: '1' })}
                className="h-11 md:h-10"
              >
                <Route className="size-4" aria-hidden />
                Armar las zonas
              </Button>
              <Button asChild variant="outline" className="h-11 md:h-10">
                <Link href={`/${tenantSlug}/compras/insumos/planilla`}>
                  <FileSpreadsheet className="size-4" aria-hidden />
                  Cargar con una planilla
                </Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {/* Búsqueda y filtros: quedan a mano mientras se baja por la lista. */}
          <div className="sticky top-14 z-10 -mx-4 space-y-3 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar insumo, marca o proveedor"
                aria-label="Buscar insumos"
                enterKeyHint="search"
                autoComplete="off"
                className={cn(FIELD_INPUT, 'pr-11 pl-9 [&::-webkit-search-cancel-button]:hidden')}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Borrar la búsqueda"
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <fieldset className="min-w-0">
              <legend className="sr-only">Filtrar insumos</legend>
              <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
                <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
                  {FILTERS.map(({ key, label }) => (
                    <Pill key={key} pressed={filter === key} onClick={() => setFilter(key)}>
                      {key === 'fix' && counts.fix > 0 && filter !== key ? (
                        <AlertTriangle className="size-3.5 text-warning-text" aria-hidden />
                      ) : null}
                      {label}
                      <PillCount value={counts[key]} pressed={filter === key} />
                    </Pill>
                  ))}
                </div>
              </div>
            </fieldset>
          </div>

          <p className="sr-only" aria-live="polite">
            {plural(visible.length, 'insumo', 'insumos')} en la lista.
          </p>

          {hiddenInactive ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {hiddenInactive === 1
                ? 'Hay 1 desactivado que coincide con la búsqueda.'
                : `Hay ${hiddenInactive} desactivados que coinciden con la búsqueda.`}
              <Button
                type="button"
                variant="link"
                onClick={() => setFilter('inactive')}
                className="h-auto p-0 pointer-coarse:min-h-11"
              >
                Ver desactivados
              </Button>
            </p>
          ) : null}

          {groups.length === 0 ? (
            <NoResults
              filter={filter}
              query={query}
              onClear={() => {
                setQuery('')
                setFilter('all')
              }}
            />
          ) : (
            <div className="space-y-8">
              {groups.map((group) => (
                <section
                  key={group.key}
                  aria-labelledby={`zona-${group.key}`}
                  className="space-y-2.5"
                >
                  <header className="flex items-baseline justify-between gap-3 px-1">
                    <h2
                      id={`zona-${group.key}`}
                      className="min-w-0 font-serif text-lg font-semibold tracking-tight text-balance"
                    >
                      {group.zone ? group.zone.name : 'Sin zona'}
                      {group.zone?.area ? (
                        <span className="font-sans text-sm font-normal text-muted-foreground">
                          {' '}
                          · {group.zone.area}
                        </span>
                      ) : null}
                      {group.zone ? null : (
                        <span className="font-sans text-sm font-normal text-muted-foreground">
                          {' '}
                          · la cocina los cuenta al final
                        </span>
                      )}
                    </h2>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {plural(group.items.length, 'insumo', 'insumos')}
                    </span>
                  </header>
                  <div className="card-hairline overflow-hidden rounded-xl border bg-card shadow-xs">
                    <div
                      aria-hidden
                      className={cn(
                        ROW_GRID,
                        'hidden border-b border-border/60 px-4 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:grid',
                      )}
                    >
                      <span>Insumo</span>
                      <span>Objetivo</span>
                      <span>Cómo se compra</span>
                      <span>Proveedor</span>
                      <span className="text-right">Frecuencia</span>
                    </div>
                    <ul className="divide-y divide-border/60">
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <ItemRow
                            item={item}
                            supplierName={
                              item.supplierId ? (supplierNames.get(item.supplierId) ?? null) : null
                            }
                            issueCount={issues.get(item.id) ?? 0}
                            onOpen={() => openSheet({ editar: item.id })}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <ItemEditorSheet
        tenantSlug={tenantSlug}
        open={editorOpen}
        item={sheetItem}
        zones={zones}
        suppliers={suppliers}
        hadIssues={sheetItem ? (issues.get(sheetItem.id) ?? 0) > 0 : false}
        usedIn={sheetItem ? (usedIn[sheetItem.id] ?? []) : []}
        onClose={closeSheet}
        onSaved={() => {
          closeSheet()
          router.refresh()
        }}
      />
      <ZonesSheet
        tenantSlug={tenantSlug}
        open={zonesOpen}
        zones={zones}
        counts={zoneCounts}
        onClose={closeSheet}
      />
    </>
  )
}

/** Cómo se compra, como se lee en la fila: «Caja x 150 u», o lo que falta. */
function purchaseText(item: PurItem): { text: string; warn: boolean } {
  const occasional = item.frequency === 'occasional'
  const label = item.packLabel?.trim()
  if (item.packSize)
    return { text: label || `x ${formatAmount(item.packSize, item.unit)}`, warn: false }
  if (label) return { text: `${label} · falta cuánto trae`, warn: !occasional }
  return occasional
    ? { text: `se pide en ${unitShort(item.unit)}`, warn: false }
    : { text: 'sin presentación', warn: true }
}

function ItemRow({
  item,
  supplierName,
  issueCount,
  onOpen,
}: {
  item: PurItem
  supplierName: string | null
  issueCount: number
  onOpen: () => void
}) {
  const occasional = item.frequency === 'occasional'
  const purchase = purchaseText(item)
  const sub = [item.brand, item.code].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        ROW_GRID,
        'w-full px-4 py-3 text-left transition-colors hover:bg-cream-tint focus-visible:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
        !item.active && 'text-muted-foreground',
      )}
    >
      <span className="min-w-0">
        <span className="block leading-snug font-medium text-pretty">{item.name}</span>
        {sub ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sub}</span>
        ) : null}
        {issueCount ? (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-text">
            <AlertTriangle className="size-3" aria-hidden />
            {issueCount === 1 ? '1 dato para corregir' : `${issueCount} datos para corregir`}
          </span>
        ) : null}
      </span>

      <span className="justify-self-end md:order-last">
        <FrequencyTag frequency={item.frequency} active={item.active} />
      </span>

      <span className="col-span-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm md:contents">
        <span className="tabular-nums">
          {item.targetQty != null ? (
            <>
              <span className="text-muted-foreground md:sr-only">objetivo </span>
              {formatAmount(item.targetQty, item.unit)}
            </>
          ) : (
            <span className={occasional ? 'text-muted-foreground' : 'text-warning-text'}>
              sin objetivo <span className="text-muted-foreground">({unitShort(item.unit)})</span>
            </span>
          )}
        </span>
        <span aria-hidden className="text-muted-foreground md:hidden">
          ·
        </span>
        <span className={cn('min-w-0', purchase.warn ? 'text-warning-text' : 'text-foreground')}>
          <span className="sr-only">se compra: </span>
          {purchase.text}
        </span>
      </span>

      <span
        className={cn(
          'col-span-2 min-w-0 truncate text-sm md:col-span-1',
          supplierName ? 'text-muted-foreground md:text-foreground' : 'text-warning-text',
        )}
      >
        <span className="sr-only">proveedor: </span>
        {supplierName ?? 'sin proveedor'}
      </span>
    </button>
  )
}

function FrequencyTag({ frequency, active }: { frequency: Frequency; active: boolean }) {
  if (!active) {
    return (
      <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
        Desactivado
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        frequency === 'frequent' && 'bg-primary/10 text-primary',
        frequency === 'secondary' && 'bg-secondary text-secondary-foreground',
        frequency === 'occasional' && 'border border-dashed border-border text-muted-foreground',
      )}
    >
      {FREQUENCY_LABELS[frequency]}
    </span>
  )
}

function NoResults({
  filter,
  query,
  onClear,
}: {
  filter: FilterKey
  query: string
  onClear: () => void
}) {
  if (filter === 'fix' && !query.trim()) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Nada para corregir"
        description="Todos los insumos activos tienen proveedor, objetivo, zona y presentación."
      />
    )
  }
  return (
    <EmptyState
      icon={Search}
      title={query.trim() ? `No encontramos «${query.trim()}»` : 'No hay insumos acá'}
      description={
        query.trim()
          ? filter === 'all'
            ? 'Probá con otra palabra, o con la marca o el proveedor.'
            : `No está ${FILTER_PLACES[filter]}. Probá buscando en todos.`
          : 'Cuando haya insumos con este filtro, aparecen acá.'
      }
      action={
        <Button type="button" variant="outline" onClick={onClear} className="h-11 md:h-10">
          Ver todos los insumos
        </Button>
      }
    />
  )
}
