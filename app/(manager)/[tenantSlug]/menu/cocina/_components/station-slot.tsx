'use client'

import { ChevronDown, Eraser, Highlighter, LoaderCircle, TriangleAlert } from 'lucide-react'
import { type KeyboardEvent, memo } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import type { KitchenStation } from '@/lib/menu/kitchen/types'
import type { SlotInfo } from '@/lib/menu/kitchen/view'
import { cn } from '@/lib/utils'
import { type Armed, inkStyle, StationDot } from './station-bits'

export type SlotContext = {
  /** Las estaciones prendidas, en orden: las que se pueden elegir. */
  stations: ReadonlyArray<KitchenStation>
  armed: Armed
  onAssign: (node: 'category' | 'item', id: string, to: string | null) => void
  /** Se tocó algo que ya está donde iría: se dice, no se cambia nada. */
  onAlready: (info: SlotInfo) => void
  onManage: () => void
}

const INHERIT = 'seguir'

/** La etiqueta siguiente o la anterior de la lista, para recorrerla con las flechas. */
function focusSibling(from: HTMLElement, step: 1 | -1) {
  const scope = from.closest('[data-kc-tree]')
  if (!scope) return
  const all = [...scope.querySelectorAll<HTMLElement>('[data-kc-slot]')]
  all[all.indexOf(from) + step]?.focus()
}

function Face({ info }: { info: SlotInfo }) {
  if (info.station) {
    return (
      <>
        <StationDot color={info.station.color} hollow={info.source === 'inherited'} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] leading-tight font-medium">
            {info.station.name}
          </span>
          {info.station.active ? null : (
            <span className="block truncate text-[11px] leading-tight text-warning-text">
              apagada
            </span>
          )}
          {info.station.active && info.source === 'inherited' && info.fromName ? (
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
              de {info.fromName}
            </span>
          ) : null}
        </span>
      </>
    )
  }
  if (info.mixed && info.mixed.length > 0) {
    return (
      <>
        <span aria-hidden className="flex shrink-0 -space-x-1">
          {info.mixed.slice(0, 3).map((station) => (
            <StationDot key={station.id} color={station.color} className="ring-2 ring-card" />
          ))}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] leading-tight font-medium">Varias</span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
            según lo de adentro
          </span>
        </span>
      </>
    )
  }
  return (
    <>
      {info.warn ? (
        <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning-text" />
      ) : null}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left text-[13px] leading-tight',
          info.warn ? 'font-medium' : 'text-muted-foreground',
        )}
      >
        Sin estación
      </span>
    </>
  )
}

/** Lo que dice un lector de pantalla de esta etiqueta. */
function spoken(info: SlotInfo): string {
  if (info.station) {
    const where =
      info.source === 'inherited' && info.fromName
        ? `${info.station.name}, la estación de ${info.fromName}`
        : info.station.name
    return `${info.name} va a ${where}${info.station.active ? '' : ', que está apagada'}`
  }
  if (info.mixed && info.mixed.length > 0) {
    return `${info.name} no tiene estación propia: lo de adentro va a varias`
  }
  return `${info.name} no tiene estación`
}

/**
 * La estación de un renglón, que es lo que se toca. Con las manos vacías abre el menú para
 * elegir; con un marcador en la mano, tocarla la marca. Con el teclado: los números eligen
 * estación, el 0 saca la marca y las flechas pasan a la de arriba o a la de abajo.
 */
export const StationSlot = memo(function StationSlot({
  info,
  ctx,
  saving,
  flash,
  describedBy,
}: {
  info: SlotInfo
  ctx: SlotContext
  saving: boolean
  flash: boolean
  describedBy?: string
}) {
  const { armed, stations } = ctx
  const assign = (to: string | null) => ctx.onAssign(info.node, info.id, to)

  // Con un marcador: ¿tocarla cambiaría algo?
  const target = armed?.kind === 'station' ? armed.station : null
  const applies =
    armed === null
      ? false
      : armed.kind === 'erase'
        ? info.ownId !== null
        : info.station?.id !== armed.station.id

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusSibling(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === '0' || event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      if (info.ownId === null) ctx.onAlready(info)
      else assign(null)
      return
    }
    if (/^[1-9]$/.test(event.key)) {
      const station = stations[Number(event.key) - 1]
      if (!station) return
      event.preventDefault()
      if (info.ownId === station.id) ctx.onAlready(info)
      else assign(station.id)
    }
  }

  const face = (
    <>
      <Face info={info} />
      {saving ? (
        <LoaderCircle
          aria-hidden
          className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      ) : armed === null ? (
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
      ) : null}
    </>
  )

  const className = cn(
    'kc-slot kc-ink flex h-11 w-[9.25rem] shrink-0 items-center gap-2 rounded-full border border-transparent px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:w-48',
    info.source !== 'own' && !info.warn && 'hover:border-border hover:bg-background/60',
    armed !== null && !applies && 'cursor-default',
  )
  const shared = {
    type: 'button' as const,
    'data-kc-slot': '',
    'data-testid': 'station-slot',
    'data-source': info.source,
    'data-station': info.station?.id ?? '',
    'data-warn': info.warn ? '' : undefined,
    'data-flash': flash ? '' : undefined,
    'aria-describedby': describedBy,
    style: inkStyle(info.station?.color),
    className,
    onKeyDown,
  }

  if (armed !== null) {
    const action = armed.kind === 'erase' ? 'Sacarle la marca' : `Pasar a ${armed.station.name}`
    return (
      <button
        {...shared}
        aria-label={applies ? `${spoken(info)}. ${action}` : `${spoken(info)}. Ya está así`}
        onClick={() => {
          if (!applies) ctx.onAlready(info)
          else assign(target ? target.id : null)
        }}
      >
        {face}
        {applies ? (
          <span aria-hidden className="kc-slot-ghost kc-ink" style={inkStyle(target?.color)}>
            {armed.kind === 'erase' ? (
              <Eraser className="size-3.5 shrink-0" />
            ) : (
              <Highlighter className="size-3.5 shrink-0" />
            )}
            <span className="truncate text-[13px] font-medium">
              {armed.kind === 'erase' ? 'Sacar la marca' : `A ${armed.station.name}`}
            </span>
          </span>
        ) : null}
      </button>
    )
  }

  const inherits = info.fallback.station
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button {...shared} aria-label={`${spoken(info)}. Cambiar`}>
          {face}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="truncate font-serif text-base font-semibold">
          ¿A dónde va {info.name}?
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={info.ownId ?? INHERIT}
          onValueChange={(value) => assign(value === INHERIT ? null : value)}
        >
          {stations.map((station, index) => (
            <DropdownMenuRadioItem
              key={station.id}
              value={station.id}
              className="min-h-9 pointer-coarse:min-h-11"
            >
              <StationDot color={station.color} />
              <span className="min-w-0 flex-1 truncate">{station.name}</span>
              {index < 9 ? (
                <Kbd aria-hidden className="hidden pointer-fine:inline-flex">
                  {index + 1}
                </Kbd>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
          {/* Una estación apagada no se ofrece, salvo que sea la que tiene puesta. */}
          {info.source === 'own' && info.station && !info.station.active ? (
            <DropdownMenuRadioItem
              value={info.station.id}
              className="min-h-9 pointer-coarse:min-h-11"
            >
              <StationDot color={info.station.color} />
              <span className="min-w-0 flex-1 truncate">{info.station.name}</span>
              <span className="text-xs text-warning-text">apagada</span>
            </DropdownMenuRadioItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={INHERIT} className="min-h-9 pointer-coarse:min-h-11">
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {info.fallback.fromName ? `Seguir a ${info.fallback.fromName}` : 'Sin estación'}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {inherits
                  ? `Hoy es ${inherits.name}. Si cambia, cambia con ella.`
                  : 'Sale en todas las pantallas de la cocina.'}
              </span>
            </span>
            <Kbd aria-hidden className="hidden pointer-fine:inline-flex">
              0
            </Kbd>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={ctx.onManage} className="min-h-9 pointer-coarse:min-h-11">
          Editar estaciones…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
