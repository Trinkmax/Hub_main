import type { CSSProperties } from 'react'
import { stationInk } from '@/lib/menu/kitchen/color'
import type { KitchenStation } from '@/lib/menu/kitchen/types'
import { cn } from '@/lib/utils'

const inks = new Map<string, CSSProperties>()

/**
 * Las dos variables de color de una estación (`--st-l` de día, `--st-d` de noche), para poner en
 * línea junto a la clase `kc-ink`. Se calculan una vez por color.
 */
export function inkStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined
  const cached = inks.get(color)
  if (cached) return cached
  const ink = stationInk(color)
  const style = { '--st-l': ink.light, '--st-d': ink.dark } as CSSProperties
  inks.set(color, style)
  return style
}

/**
 * El punto de color de una estación. Es decorativo: el nombre de la estación va siempre al lado,
 * en palabras. `hollow` lo dibuja hueco (la estación viene heredada de arriba).
 */
export function StationDot({
  color,
  hollow = false,
  className,
}: {
  color: string | null | undefined
  hollow?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-hollow={hollow ? '' : undefined}
      style={inkStyle(color)}
      className={cn('kc-ink kc-dot', className)}
    />
  )
}

/** Las estaciones en el orden en que se ven: por posición y después por nombre. */
export function sortStations(stations: ReadonlyArray<KitchenStation>): KitchenStation[] {
  return [...stations].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'es'))
}

/** «el marcador» que se tiene en la mano: una estación, la goma (sacar la marca) o nada. */
export type Armed = { kind: 'station'; station: KitchenStation } | { kind: 'erase' } | null
