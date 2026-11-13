'use client'

import { Eraser, LoaderCircle, Settings2, TriangleAlert, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { namesSummary } from '@/lib/menu/kitchen/modifiers'
import { productsLabel } from '@/lib/menu/kitchen/routing'
import type { KitchenStation } from '@/lib/menu/kitchen/types'
import { cn } from '@/lib/utils'
import { type Armed, inkStyle, StationDot } from './station-bits'

/** Una estación con lo que recibe: cuántos productos y de qué ramas de la carta. */
export type StationFeed = {
  station: KitchenStation
  products: number
  /** Las categorías de arriba que le mandan productos, de la que más a la que menos. */
  feeds: ReadonlyArray<string>
}

export type MarkerProps = {
  stations: ReadonlyArray<StationFeed>
  armed: Armed
  onArm: (next: Armed) => void
  onManage: () => void
  onUndo: () => void
  undoLabel: string | null
  busy: boolean
  stumbled: boolean
}

const isArmed = (armed: Armed, station: KitchenStation) =>
  armed?.kind === 'station' && armed.station.id === station.id

/** Qué se está haciendo con el marcador que se tiene en la mano. */
function armedHint(armed: Armed): string | null {
  if (armed === null) return null
  return armed.kind === 'erase'
    ? 'Tocá en la carta a qué sacarle la marca: vuelve a seguir a su categoría.'
    : `Tocá en la carta lo que va a ${armed.station.name}.`
}

function SaveStatus({ busy, stumbled }: { busy: boolean; stumbled: boolean }) {
  return (
    <p
      role="status"
      data-testid="save-status"
      className={cn(
        'flex items-center gap-1.5 text-xs',
        stumbled && !busy ? 'text-warning-text' : 'text-muted-foreground',
      )}
    >
      {busy ? (
        <>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          Guardando…
        </>
      ) : stumbled ? (
        <>
          <TriangleAlert aria-hidden className="size-3.5" />
          El último cambio no se guardó
        </>
      ) : (
        'Se guarda solo'
      )}
    </p>
  )
}

/**
 * Las estaciones, en la compu: la lista de lo que recibe cada pantalla de la cocina, que además
 * son los marcadores. Se elige una y se toca en la carta lo que va ahí.
 */
export function StationPanel({
  stations,
  armed,
  onArm,
  onManage,
  onUndo,
  undoLabel,
  busy,
  stumbled,
}: MarkerProps) {
  const hint = armedHint(armed)
  // El número de cada estación prendida: el mismo que la elige con el teclado.
  const digit = new Map(
    stations
      .filter(({ station }) => station.active)
      .map(({ station }, index) => [station.id, index + 1]),
  )
  return (
    <aside aria-label="Estaciones" className="hidden lg:block">
      <div className="sticky top-20 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-lg leading-snug font-semibold tracking-tight">
            Estaciones
          </h2>
          <SaveStatus busy={busy} stumbled={stumbled} />
        </div>

        <ul
          aria-label="Marcadores"
          className="card-hairline overflow-clip rounded-2xl border bg-card shadow-xs"
        >
          {stations.map(({ station, products, feeds }) => {
            const on = isArmed(armed, station)
            const key = digit.get(station.id)
            return (
              <li key={station.id} className="border-t border-border/60 first:border-t-0">
                <button
                  type="button"
                  data-testid={station.active ? 'marker' : 'marker-off'}
                  data-station={station.id}
                  aria-pressed={station.active ? on : undefined}
                  // Con una apagada no se marca: tocarla lleva a donde se prende.
                  aria-label={
                    station.active ? undefined : `${station.name}, apagada. Editar estaciones`
                  }
                  onClick={() =>
                    station.active ? onArm(on ? null : { kind: 'station', station }) : onManage()
                  }
                  className="kc-marker flex w-full items-start gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <StationDot color={station.color} className="mt-[0.4rem]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'min-w-0 truncate text-[15px] font-semibold',
                          !station.active && 'text-muted-foreground',
                        )}
                      >
                        {station.name}
                      </span>
                      {key !== undefined && key <= 9 ? (
                        <Kbd aria-hidden className="shrink-0">
                          {key}
                        </Kbd>
                      ) : null}
                      <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">
                        {products}
                        <span className="sr-only">
                          {products === 1 ? ' producto' : ' productos'}
                        </span>
                      </span>
                    </span>
                    <span className="kc-marker-soft mt-0.5 block text-xs text-muted-foreground text-pretty">
                      {!station.active
                        ? products > 0
                          ? `Apagada, con ${productsLabel(products)} adentro`
                          : 'Apagada'
                        : feeds.length > 0
                          ? namesSummary(feeds, 2)
                          : 'Todavía no recibe nada'}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
          <li className="border-t border-border/60">
            <button
              type="button"
              data-testid="marker-erase"
              aria-pressed={armed?.kind === 'erase'}
              onClick={() => onArm(armed?.kind === 'erase' ? null : { kind: 'erase' })}
              className="kc-marker flex w-full items-start gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Eraser aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[15px] font-semibold">Sacar la marca</span>
                  <Kbd aria-hidden className="shrink-0">
                    0
                  </Kbd>
                </span>
                <span className="kc-marker-soft mt-0.5 block text-xs text-muted-foreground">
                  Vuelve a seguir a su categoría
                </span>
              </span>
            </button>
          </li>
        </ul>

        <p aria-live="polite" className="min-h-10 text-sm text-pretty">
          {hint ? (
            <>
              <span className="font-medium">{hint}</span>{' '}
              <span className="text-muted-foreground">
                <Kbd>Esc</Kbd> lo suelta.
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Elegí una estación y tocá en la carta lo que va ahí. O tocá la etiqueta de un renglón
              para cambiarlo solo a él.
            </span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" data-testid="open-stations" onClick={onManage}>
            <Settings2 aria-hidden />
            Editar estaciones
          </Button>
          <Button
            type="button"
            variant="ghost"
            data-testid="undo"
            disabled={undoLabel === null}
            title={undoLabel ? `Deshacer: ${undoLabel}` : undefined}
            onClick={onUndo}
          >
            <Undo2 aria-hidden />
            Deshacer
          </Button>
        </div>
      </div>
    </aside>
  )
}

/**
 * Los marcadores, en el celular: una barra abajo, al alcance del pulgar. Lo que recibe cada
 * estación se lee arriba, junto a la barra de reparto.
 */
export function MarkerDock({
  stations,
  armed,
  onArm,
  onManage,
  onUndo,
  undoLabel,
  busy,
  stumbled,
}: MarkerProps) {
  const hint = armedHint(armed)
  const chip =
    'kc-marker flex h-11 shrink-0 items-center gap-2 rounded-full border border-border/70 bg-card px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <div
      data-testid="marker-dock"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_20px_-14px_color-mix(in_oklch,var(--foreground)_35%,transparent)] lg:hidden"
    >
      <div className="flex min-h-7 items-center justify-between gap-3 px-4 pt-2">
        <p aria-live="polite" className="min-w-0 truncate text-xs font-medium">
          {hint ?? <span className="text-muted-foreground">Elegí con qué marcar</span>}
        </p>
        <SaveStatus busy={busy} stumbled={stumbled} />
      </div>
      <div className="flex items-center gap-2 py-2 pl-4">
        <ul
          aria-label="Marcadores"
          className="-my-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {stations
            .filter(({ station }) => station.active)
            .map(({ station }) => {
              const on = isArmed(armed, station)
              return (
                <li key={station.id} className="shrink-0">
                  <button
                    type="button"
                    data-testid="marker"
                    data-station={station.id}
                    aria-pressed={on}
                    style={inkStyle(station.color)}
                    onClick={() => onArm(on ? null : { kind: 'station', station })}
                    className={chip}
                  >
                    <StationDot color={station.color} />
                    {station.name}
                  </button>
                </li>
              )
            })}
          <li className="shrink-0">
            <button
              type="button"
              data-testid="marker-erase"
              aria-pressed={armed?.kind === 'erase'}
              onClick={() => onArm(armed?.kind === 'erase' ? null : { kind: 'erase' })}
              className={chip}
            >
              <Eraser aria-hidden className="size-4" />
              Sacar la marca
            </button>
          </li>
        </ul>
        <div className="flex shrink-0 items-center gap-1 pr-2">
          <button
            type="button"
            data-testid="undo"
            aria-label={undoLabel ? `Deshacer: ${undoLabel}` : 'Deshacer'}
            disabled={undoLabel === null}
            onClick={onUndo}
            className="flex size-11 items-center justify-center rounded-full text-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Undo2 aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            data-testid="open-stations"
            aria-label="Editar estaciones"
            onClick={onManage}
            className="flex size-11 items-center justify-center rounded-full text-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 aria-hidden className="size-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
