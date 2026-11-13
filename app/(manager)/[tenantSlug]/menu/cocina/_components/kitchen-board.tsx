'use client'

import { ChefHat, ListChecks, Search, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { Pill, PillLink } from '@/components/administracion/kit/pill'
import { Button } from '@/components/ui/button'
import { cartaTree, NO_CATEGORY_ID, productsLabel, routingStats } from '@/lib/menu/kitchen/routing'
import { buildCartaIndex, searchCarta } from '@/lib/menu/kitchen/search'
import { CLASSIC_STATIONS, proposeRouting } from '@/lib/menu/kitchen/suggest'
import type { KitchenSnapshot, KitchenStation } from '@/lib/menu/kitchen/types'
import {
  barParts,
  buildRouteModel,
  routeHeadline,
  type SlotInfo,
  stationBreakdown,
  stationFeeds,
} from '@/lib/menu/kitchen/view'
import { cn } from '@/lib/utils'
import { ChoicesPane } from './choices-pane'
import { notify } from './notify'
import { CartaTreeView, FlatList, SHEET, type TreeContext } from './route-tree'
import { type Armed, inkStyle, sortStations } from './station-bits'
import { MarkerDock, type MarkerProps, StationPanel } from './station-panel'
import type { SlotContext } from './station-slot'
import { StationsSheet } from './stations-sheet'
import { useKitchenWrites } from './use-kitchen-writes'
import './cocina.css'

/**
 * «Cocina y aclaraciones»: a qué pantalla de la cocina va cada cosa de la carta, y qué se le puede
 * aclarar a cada producto (el punto de la carne, sin cebolla, un extra que se cobra).
 *
 * Las estaciones se marcan como con un resaltador: se elige una (o la goma) y se toca en la carta
 * lo que va ahí. Marcar una categoría alcanza: lo de adentro la sigue, salvo lo que tenga su
 * propia marca. Todo se guarda solo y se puede deshacer (`use-kitchen-writes.ts`).
 */
export function KitchenBoard({
  tenantSlug,
  snapshot,
  tab,
}: {
  tenantSlug: string
  snapshot: KitchenSnapshot
  tab: 'estaciones' | 'aclaraciones'
}) {
  const writes = useKitchenWrites(tenantSlug, snapshot)
  const { view, commit } = writes

  const stations = useMemo(() => sortStations(view.stations), [view.stations])
  const activeStations = useMemo(() => stations.filter((station) => station.active), [stations])
  const tree = useMemo(() => cartaTree(view.categories, view.items), [view.categories, view.items])
  const stats = useMemo(() => routingStats(tree, view.stations), [tree, view.stations])
  const model = useMemo(
    () => buildRouteModel(tree, stats, view.stations),
    [tree, stats, view.stations],
  )
  const index = useMemo(() => buildCartaIndex(tree), [tree])

  const [armed, setArmed] = useState<Armed>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [onlyPending, setOnlyPending] = useState(false)
  const [manage, setManage] = useState(false)

  // La estación que se tenía en la mano se apagó o se borró: se suelta.
  const armedId = armed?.kind === 'station' ? armed.station.id : null
  useEffect(() => {
    if (armedId === null) return
    const still = activeStations.find((station) => station.id === armedId)
    if (!still) setArmed(null)
    else if (armed?.kind === 'station' && still !== armed.station) {
      setArmed({ kind: 'station', station: still })
    }
  }, [armedId, activeStations, armed])

  const nameOf = useCallback(
    (node: 'category' | 'item', id: string) =>
      node === 'category'
        ? (tree.byId.get(id)?.name ?? 'esa categoría')
        : (model.items.get(id)?.name ?? 'ese producto'),
    [tree, model],
  )

  const assign = useCallback(
    (node: 'category' | 'item', id: string, to: string | null) => {
      const name = nameOf(node, id)
      const station = to === null ? null : (view.stations.find((item) => item.id === to) ?? null)
      commit(
        { type: 'route', changes: [{ node, id, to }] },
        {
          say: station ? `${name} va a ${station.name}` : `${name} vuelve a seguir a lo de arriba`,
          reason: 'mark',
          toastId: 'marca',
          nameOf,
        },
      )
    },
    [commit, nameOf, view.stations],
  )

  const already = useCallback((info: SlotInfo) => {
    notify.ok(
      info.station
        ? `${info.name} ya va a ${info.station.name}.`
        : `${info.name} no tiene marca para sacar.`,
      'ya-estaba',
    )
  }, [])

  const openManage = useCallback(() => {
    notify.clear()
    setManage(true)
  }, [])

  const slot = useMemo<SlotContext>(
    () => ({
      stations: activeStations,
      armed,
      onAssign: assign,
      onAlready: already,
      onManage: openManage,
    }),
    [activeStations, armed, assign, already, openManage],
  )
  const ctx = useMemo<TreeContext>(
    () => ({
      tree,
      model,
      slot,
      saving: writes.saving,
      flashed: writes.flashed,
      errors: writes.errors,
    }),
    [tree, model, slot, writes.saving, writes.flashed, writes.errors],
  )

  // Con el teclado: el número elige la estación, 0 la goma y Esc suelta el marcador.
  useEffect(() => {
    if (tab !== 'estaciones' || manage) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
        return
      if (event.key === 'Escape') {
        setArmed(null)
        return
      }
      if (event.key === '0') {
        setArmed((current) => (current?.kind === 'erase' ? null : { kind: 'erase' }))
        return
      }
      const digit = Number(event.key)
      if (!Number.isInteger(digit) || digit < 1) return
      const station = activeStations[digit - 1]
      if (!station) return
      setArmed((current) =>
        current?.kind === 'station' && current.station.id === station.id
          ? null
          : { kind: 'station', station },
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, manage, activeStations])

  const headline = routeHeadline(stats, view.stations)
  const breakdown = stationBreakdown(stats, view.stations)
  const bar = barParts(stats, view.stations)
  const pending = useMemo(
    () => [...stats.routes].filter(([, route]) => route.problem !== null).map(([id]) => id),
    [stats],
  )
  const proposals = useMemo(
    () => (stats.unrouted > 0 ? proposeRouting(tree, activeStations) : []),
    [stats.unrouted, tree, activeStations],
  )
  const hits = useMemo(() => searchCarta(index, query), [index, query])

  const marker: MarkerProps = {
    stations: stations.map((station) => ({
      station,
      products: stats.byStation.get(station.id) ?? 0,
      feeds: stationFeeds(tree, stats, station.id),
    })),
    armed,
    onArm: setArmed,
    onManage: openManage,
    onUndo: writes.undo,
    undoLabel: writes.undoLabel,
    busy: writes.busy,
    stumbled: writes.stumbled,
  }

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const acceptProposal = () => {
    const names = new Map(view.stations.map((station) => [station.id, station.name]))
    const sample = proposals
      .slice(0, 2)
      .map((item) => `${item.categoryName} a ${names.get(item.stationId) ?? 'su estación'}`)
      .join(', ')
    commit(
      { type: 'route', changes: proposals.map((item) => item.change) },
      {
        say:
          proposals.length === 1
            ? `Marcada por su nombre: ${sample}`
            : `Marcadas ${proposals.length} categorías por su nombre`,
        reason: 'proposal',
        nameOf,
      },
    )
  }

  const startClassic = () => {
    const taken = new Set(view.stations.map((station) => station.name.toLocaleLowerCase('es')))
    const fresh: KitchenStation[] = CLASSIC_STATIONS.filter(
      (classic) => !taken.has(classic.name.toLocaleLowerCase('es')),
    ).map((classic, offset) => ({
      id: crypto.randomUUID(),
      name: classic.name,
      color: classic.color,
      position: view.stations.length + offset,
      active: true,
    }))
    if (fresh.length === 0) return
    commit(
      { type: 'station.create', stations: fresh },
      { say: 'Listas las tres de siempre: Cocina, Fríos y Barra' },
    )
  }

  return (
    <AdmPage width="comfortable" className={cn(tab === 'estaciones' && 'pb-36 lg:pb-8')}>
      <AdmHeader
        back={{ href: `/${tenantSlug}/menu`, label: 'Carta' }}
        title="Cocina y aclaraciones"
        description="A qué pantalla de la cocina va cada cosa de la carta, y qué se le puede aclarar a cada producto."
        actions={
          <>
            <PillLink
              href={`/${tenantSlug}/menu/cocina`}
              active={tab === 'estaciones'}
              icon={ChefHat}
              scroll={false}
            >
              Estaciones
            </PillLink>
            <PillLink
              href={`/${tenantSlug}/menu/cocina?ver=aclaraciones`}
              active={tab === 'aclaraciones'}
              icon={ListChecks}
              scroll={false}
              data-testid="ver-aclaraciones"
            >
              Aclaraciones
            </PillLink>
          </>
        }
      />

      {tab === 'aclaraciones' ? (
        <ChoicesPane writes={writes} />
      ) : stations.length === 0 ? (
        <section className={cn(SHEET, 'p-6 text-center sm:p-10')} data-testid="sin-estaciones">
          <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
            Todavía no hay estaciones
          </h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground text-pretty">
            Una estación es un lugar de la cocina con su pantalla. Cada pedido se reparte solo: la
            hamburguesa a la plancha, la ensalada a fríos, el trago a la barra. Sin estaciones, todo
            sale junto en todas las pantallas.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={startClassic} data-testid="estaciones-clasicas">
              Empezar con Cocina, Fríos y Barra
            </Button>
            <Button variant="outline" onClick={openManage}>
              Armar las mías
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section aria-label="Cómo está repartida la carta" className="space-y-3">
            <p className="text-pretty">
              <span
                className={cn(
                  'font-serif text-4xl font-semibold leading-none tracking-tight tabular-nums',
                  headline.tone === 'warn' && 'text-warning-text',
                )}
                data-testid="reparto-numero"
              >
                {headline.figure}
              </span>{' '}
              <span className="text-lg font-medium">{headline.lead}</span>
            </p>
            {headline.detail || breakdown ? (
              <p className="max-w-prose text-sm text-muted-foreground text-pretty">
                {headline.detail ?? breakdown}
              </p>
            ) : null}
            {bar.length > 0 ? (
              <div className="space-y-2">
                <div className="kc-bar" aria-hidden>
                  {bar.map((part) => (
                    <span
                      key={part.key}
                      data-kind={part.kind}
                      className="kc-ink kc-bar-part"
                      style={{ ...inkStyle(part.color), flexGrow: Math.max(part.count, 1) }}
                    />
                  ))}
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground lg:hidden">
                  {bar.map((part) => (
                    <li key={part.key} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        data-kind={part.kind}
                        className="kc-ink kc-bar-part inline-block size-2 rounded-full"
                        style={inkStyle(part.color)}
                      />
                      {part.name} · {productsLabel(part.count)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {proposals.length > 0 ? (
            <section
              className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between"
              data-testid="propuesta"
            >
              <p className="flex items-start gap-2 text-sm text-pretty">
                <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  Por el nombre,{' '}
                  {proposals.length === 1 ? 'una categoría' : `${proposals.length} categorías`} ya{' '}
                  {proposals.length === 1 ? 'tiene' : 'tienen'} una estación obvia. La marcás de un
                  toque y después corregís lo que no sea así.
                </span>
              </p>
              <Button variant="outline" size="sm" onClick={acceptProposal} className="shrink-0">
                Marcar por su nombre
              </Button>
            </section>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
            <StationPanel {...marker} />
            <div className="min-w-0 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
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
                    data-testid="carta-buscar"
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
                {pending.length > 0 ? (
                  <Pill
                    active={onlyPending}
                    onClick={() => setOnlyPending((current) => !current)}
                    count={pending.length}
                    data-testid="ver-lo-que-falta"
                  >
                    Lo que falta
                  </Pill>
                ) : null}
              </div>

              {hits ? (
                hits.categories.length + hits.items.length > 0 ? (
                  <FlatList
                    ctx={ctx}
                    categories={hits.categories}
                    items={hits.items}
                    query={query}
                    testId="carta-resultados"
                  />
                ) : (
                  <p className={cn(SHEET, 'p-6 text-center text-sm text-muted-foreground')}>
                    Nada en la carta se llama así.
                  </p>
                )
              ) : onlyPending && pending.length > 0 ? (
                <FlatList ctx={ctx} categories={[]} items={pending} query="" testId="carta-falta" />
              ) : (
                <CartaTreeView ctx={ctx} expanded={expanded} onToggle={toggle} />
              )}

              {(tree.items.get(NO_CATEGORY_ID) ?? []).length > 0 && !hits ? (
                <p className="text-xs text-muted-foreground text-pretty">
                  Los productos sin categoría no los ve el mozo: en la carta, ponelos en una.
                </p>
              ) : null}
            </div>
          </div>
          <MarkerDock {...marker} />
          {/* En el celular la barra de marcadores ocupa el borde de abajo: el asistente se corre. */}
          <span data-tex-away hidden />
        </>
      )}

      <StationsSheet open={manage} onOpenChange={setManage} writes={writes} tree={tree} />
    </AdmPage>
  )
}
