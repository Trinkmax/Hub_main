'use client'

import { Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { moveBy } from '@/lib/menu/kitchen/order'
import { type CartaTree, marksByStation } from '@/lib/menu/kitchen/routing'
import { MAX_STATIONS, STATION_NAME_MAX } from '@/lib/menu/kitchen/schemas'
import { CLASSIC_STATIONS, nextStationColor, STATION_COLORS } from '@/lib/menu/kitchen/suggest'
import type { KitchenStation } from '@/lib/menu/kitchen/types'
import { cn } from '@/lib/utils'
import { InlineText } from './inline-fields'
import { SideSheet, SideSheetBody } from './side-sheet'
import { DragGrip, MoveButtons, SortableList, useSortableRow } from './sortable'
import { inkStyle, sortStations } from './station-bits'
import type { KitchenWrites } from './use-kitchen-writes'

const plain = (text: string) => text.trim().toLocaleLowerCase('es')

/**
 * Las estaciones del bar: cada una es un lugar de la cocina con su pantalla. Acá se les cambia el
 * nombre y el color, se ordenan (es el orden de los marcadores y de la tele), se apagan o se borran.
 * Como todo en esta pantalla, se guarda solo y se puede deshacer.
 */
export function StationsSheet({
  open,
  onOpenChange,
  writes,
  tree,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  writes: KitchenWrites
  tree: CartaTree
}) {
  const { view, commit } = writes
  const stations = useMemo(() => sortStations(view.stations), [view.stations])
  const ids = stations.map((station) => station.id)
  const marks = useMemo(() => marksByStation(tree), [tree])
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const full = stations.length >= MAX_STATIONS

  const taken = (candidate: string, exceptId?: string) =>
    stations.some((station) => station.id !== exceptId && plain(station.name) === plain(candidate))

  const add = (label: string, color?: string) => {
    const clean = label.trim().replace(/\s+/g, ' ')
    if (clean === '') return 'Ponele un nombre.'
    if (clean.length > STATION_NAME_MAX) return `El nombre entra en ${STATION_NAME_MAX} letras.`
    if (taken(clean)) return `Ya hay una estación que se llama «${clean}».`
    if (full) return `Entran hasta ${MAX_STATIONS} estaciones.`
    const station: KitchenStation = {
      id: crypto.randomUUID(),
      name: clean,
      color: color ?? nextStationColor(stations),
      position: stations.length === 0 ? 0 : Math.max(...stations.map((item) => item.position)) + 1,
      active: true,
    }
    commit({ type: 'station.create', stations: [station] }, { say: `Estación nueva: ${clean}` })
    return null
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const why = add(name)
    setProblem(why)
    if (why === null) setName('')
  }

  const classics = CLASSIC_STATIONS.filter((classic) => !taken(classic.name))

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Estaciones"
      description="Cada una es un lugar de la cocina con su pantalla. El orden es el de los marcadores y el de la tele."
      testId="estaciones-hoja"
    >
      <SideSheetBody className="space-y-6">
        {stations.length > 0 ? (
          <SortableList
            id="estaciones"
            ids={ids}
            nameOf={(id) => stations.find((station) => station.id === id)?.name ?? 'la estación'}
            onReorder={(next) =>
              commit(
                { type: 'station.order', ids: next },
                { say: 'Estaciones reordenadas', toastId: 'orden-estaciones' },
              )
            }
          >
            <ul className="card-hairline divide-y divide-border/60 overflow-clip rounded-2xl border bg-card shadow-xs">
              {stations.map((station, index) => (
                <StationRow
                  key={station.id}
                  station={station}
                  marks={marks.get(station.id) ?? 0}
                  saving={writes.saving.has(`station:${station.id}`)}
                  error={writes.errors[`station:${station.id}`]}
                  canUp={index > 0}
                  canDown={index < stations.length - 1}
                  nameTaken={(candidate) => taken(candidate, station.id)}
                  onRename={(next) =>
                    commit(
                      { type: 'station.patch', id: station.id, patch: { name: next } },
                      { say: `${station.name} ahora se llama ${next}` },
                    )
                  }
                  onColor={(color) =>
                    commit(
                      { type: 'station.patch', id: station.id, patch: { color } },
                      { say: `${station.name}: color cambiado`, toastId: `color:${station.id}` },
                    )
                  }
                  onActive={(active) =>
                    commit(
                      { type: 'station.patch', id: station.id, patch: { active } },
                      {
                        say: active
                          ? `${station.name} volvió a estar prendida`
                          : `${station.name} quedó apagada: lo que iba ahí hay que mandarlo a otra`,
                      },
                    )
                  }
                  onMove={(delta) =>
                    commit(
                      { type: 'station.order', ids: moveBy(ids, station.id, delta) },
                      { say: 'Estaciones reordenadas', toastId: 'orden-estaciones' },
                    )
                  }
                  onDelete={() =>
                    commit(
                      { type: 'station.delete', ids: [station.id] },
                      { say: `${station.name} se borró` },
                    )
                  }
                />
              ))}
            </ul>
          </SortableList>
        ) : (
          <p className="text-sm text-muted-foreground text-pretty">
            Todavía no hay ninguna. Sin estaciones, cada pedido sale entero en todas las pantallas.
          </p>
        )}

        <form onSubmit={submit} className="space-y-2">
          <label htmlFor="estacion-nueva" className="text-sm font-medium">
            Agregar una estación
          </label>
          <div className="flex gap-2">
            <input
              id="estacion-nueva"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (problem) setProblem(null)
              }}
              maxLength={STATION_NAME_MAX}
              autoComplete="off"
              placeholder="Por ejemplo: Parrilla"
              disabled={full}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? 'estacion-nueva-error' : undefined}
              data-testid="estacion-nueva"
              className="h-11 w-full min-w-0 rounded-lg border border-input bg-background/60 px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive sm:h-10 sm:text-sm"
            />
            <Button type="submit" disabled={full} data-testid="estacion-agregar">
              <Plus aria-hidden className="size-4" />
              Agregar
            </Button>
          </div>
          {problem ? (
            <p id="estacion-nueva-error" role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}
          {classics.length > 0 && !full ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">Las de siempre:</span>
              {classics.map((classic) => (
                <button
                  key={classic.name}
                  type="button"
                  title={classic.hint}
                  onClick={() => setProblem(add(classic.name, classic.color))}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11"
                >
                  <span aria-hidden className="kc-ink kc-dot" style={inkStyle(classic.color)} />
                  {classic.name}
                </button>
              ))}
            </div>
          ) : null}
        </form>
      </SideSheetBody>
    </SideSheet>
  )
}

function StationRow({
  station,
  marks,
  saving,
  error,
  canUp,
  canDown,
  nameTaken,
  onRename,
  onColor,
  onActive,
  onMove,
  onDelete,
}: {
  station: KitchenStation
  /** Cuántas categorías y productos la tienen marcada. */
  marks: number
  saving: boolean
  error: string | undefined
  canUp: boolean
  canDown: boolean
  nameTaken: (candidate: string) => boolean
  onRename: (next: string) => void
  onColor: (hex: string) => void
  onActive: (active: boolean) => void
  onMove: (delta: -1 | 1) => void
  onDelete: () => void
}) {
  const row = useSortableRow(station.id)
  const [palette, setPalette] = useState(false)
  const [asking, setAsking] = useState(false)

  return (
    <li
      ref={row.setNodeRef}
      style={row.style}
      data-testid={`estacion-${station.name}`}
      className={cn('bg-card px-2 py-3 sm:px-3', row.dragging && 'shadow-md')}
    >
      <div className="flex items-center gap-1.5">
        <DragGrip row={row} label={`Reordenar ${station.name}`} />
        <button
          type="button"
          aria-expanded={palette}
          aria-label={`Color de ${station.name}`}
          onClick={() => setPalette((current) => !current)}
          className="flex size-9 shrink-0 items-center justify-center rounded-md outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
        >
          <span aria-hidden className="kc-ink kc-dot size-4" style={inkStyle(station.color)} />
        </button>
        <InlineText
          value={station.name}
          label={`Nombre de la estación ${station.name}`}
          maxLength={STATION_NAME_MAX}
          check={(next) => (nameTaken(next) ? `Ya hay una estación que se llama «${next}».` : null)}
          error={error}
          onCommit={onRename}
          className="min-w-0 flex-1"
        />
        <Switch
          checked={station.active}
          disabled={saving}
          aria-label={`${station.name} prendida`}
          onCheckedChange={onActive}
        />
      </div>

      {palette ? (
        <div className="mt-2 flex flex-wrap gap-2 pl-11">
          {STATION_COLORS.map((color) => {
            const chosen = color.hex.toLowerCase() === station.color.toLowerCase()
            return (
              <button
                key={color.hex}
                type="button"
                aria-pressed={chosen}
                title={color.name}
                onClick={() => {
                  if (!chosen) onColor(color.hex)
                  setPalette(false)
                }}
                className={cn(
                  'flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11',
                  chosen && 'ring-2 ring-foreground ring-offset-2 ring-offset-card',
                )}
              >
                <span aria-hidden className="kc-ink kc-dot size-5" style={inkStyle(color.hex)} />
                <span className="sr-only">{color.name}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 pl-11">
        <p className="text-xs text-muted-foreground">
          {station.active ? null : 'Apagada · '}
          {marks === 0
            ? 'Nada marcado'
            : marks === 1
              ? '1 marca en la carta'
              : `${marks} marcas en la carta`}
        </p>
        <div className="flex items-center gap-1">
          <MoveButtons name={station.name} canUp={canUp} canDown={canDown} onMove={onMove} />
          {asking ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setAsking(false)
                  onDelete()
                }}
                data-testid="estacion-borrar-si"
              >
                Sí, borrar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
                No
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Borrar ${station.name}`}
              onClick={() => setAsking(true)}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {asking ? (
        <p className="mt-1.5 pl-11 text-xs text-muted-foreground text-pretty">
          {marks > 0
            ? 'Lo que tenía marcado queda sin estación. Si ya recibió pedidos, en vez de borrarse queda apagada.'
            : 'Si ya recibió pedidos, en vez de borrarse queda apagada.'}
        </p>
      ) : null}
    </li>
  )
}
