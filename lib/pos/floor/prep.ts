/**
 * Los dibujos de comida y bebida sobre cada mesa del mapa — PURO y testeado (`tests/lib/pos-floor-prep.test.ts`).
 *
 * Pedido de Nacho (26/11/2026): «en las mesas, que aparezcan los emojis arriba de la mesa si hay comida y
 * bebida: uno de bebida y otro de comida». Cada estación que le debe algo a la mesa pone su dibujo (la
 * barra, la cocina, los pizzeros): apagado mientras lo preparan, prendido y con un tilde cuando ya está
 * para retirar. El mozo ve desde el mapa QUÉ salió y de DÓNDE se retira, sin entrar a la mesa.
 */
import { stationIcon, stationKind } from '@/lib/pos/kitchen/station-kind'
import type { MenuStation, StationPrep } from '@/lib/pos/types'

export type PrepChip = {
  /** Una identidad que no cambia al dibujar. */
  key: string
  stationId: string | null
  /** «Barra», «Cocina». */
  name: string
  icon: string
  kind: 'food' | 'drink'
  /** `ready` = hay algo para retirar · `cooking` = lo están preparando (o espera turno). */
  state: 'ready' | 'cooking'
  /** Unidades: las listas si hay algo listo; si no, las que faltan. */
  units: number
}

const NO_STATION = { name: 'Cocina', kind: 'food', icon: null } as const

/**
 * Los dibujos de una mesa, en el orden de las estaciones del bar. Lo que no tiene estación (o va a una
 * que el bar apagó) se suma a la primera, igual que en las pantallas de cocina. Dos estaciones con el
 * mismo dibujo siguen siendo dos: se retira en lugares distintos.
 */
export function prepChips(
  prep: readonly StationPrep[] | null | undefined,
  stations: readonly MenuStation[] | null | undefined,
): PrepChip[] {
  if (!prep || prep.length === 0) return []
  const list = stations ?? []
  const index = new Map(list.map((station, at) => [station.id, at]))
  const home = list[0] ?? null

  type Sum = { at: number; station: MenuStation | null; waiting: number; ready: number }
  const sums = new Map<string, Sum>()
  for (const row of prep) {
    const waiting = Math.max(0, row.queued) + Math.max(0, row.preparing)
    const ready = Math.max(0, row.ready)
    if (waiting + ready === 0) continue
    const known = row.station_id !== null && index.has(row.station_id)
    const station = known ? (list[index.get(row.station_id as string) as number] ?? null) : home
    const key = station?.id ?? 'sin-estacion'
    const sum = sums.get(key) ?? {
      at: station ? (index.get(station.id) ?? 0) : 0,
      station,
      waiting: 0,
      ready: 0,
    }
    sum.waiting += waiting
    sum.ready += ready
    sums.set(key, sum)
  }

  return [...sums.entries()]
    .sort(([, a], [, b]) => a.at - b.at)
    .map(([key, sum]) => {
      const look = sum.station ?? NO_STATION
      return {
        key,
        stationId: sum.station?.id ?? null,
        name: look.name,
        icon: stationIcon(look),
        kind: stationKind(look.kind),
        state: sum.ready > 0 ? ('ready' as const) : ('cooking' as const),
        units: sum.ready > 0 ? sum.ready : sum.waiting,
      }
    })
}

/** «bebidas listas en Barra, comida en preparación»: los dibujos, dichos para un lector de pantalla. */
export function prepSpoken(chips: readonly PrepChip[]): string {
  return chips
    .map((chip) =>
      chip.state === 'ready'
        ? `${chip.units} para retirar en ${chip.name}`
        : `${chip.units} en preparación en ${chip.name}`,
    )
    .join(', ')
}
