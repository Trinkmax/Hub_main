/**
 * Arrancar sin escribir, puro: las tres estaciones de siempre, los colores para elegir y una
 * propuesta de a dónde va cada categoría según cómo se llama («Bebidas» a la barra, «Postres» a
 * fríos). La propuesta nunca se aplica sola: se muestra y la persona decide.
 */

import { plainName } from './modifiers'
import { type CartaTree, resolveCategory } from './routing'
import type { KitchenStation, RouteChange } from './types'

/**
 * Los colores para una estación. Los tres primeros son los que ya usa la cocina. Los seis están
 * validados con la skill dataviz, todos contra todos (el orden de las estaciones lo elige el
 * bar): sobre el crema se distinguen entre sí también con daltonismo (ΔE ≥ 8,2) y del fondo
 * (3:1). Son seis y no más a propósito: con un séptimo, dos ya se confunden.
 */
export const STATION_COLORS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#b45309', name: 'Brasa' },
  { hex: '#0e7490', name: 'Petróleo' },
  { hex: '#6d28d9', name: 'Violeta' },
  { hex: '#9f0c54', name: 'Frambuesa' },
  { hex: '#02a05e', name: 'Albahaca' },
  { hex: '#b959c2', name: 'Malva' },
]

/** Las tres de siempre, con los colores que ya usa la cocina. */
export const CLASSIC_STATIONS: ReadonlyArray<{ name: string; color: string; hint: string }> = [
  { name: 'Cocina', color: '#b45309', hint: 'Plancha, horno y fuegos.' },
  { name: 'Fríos', color: '#0e7490', hint: 'Ensaladas, postres y lo que no lleva fuego.' },
  { name: 'Barra', color: '#6d28d9', hint: 'Tragos, cafetería y bebidas.' },
]

/** El primer color que todavía no usa ninguna estación (o el primero, si ya están todos). */
export function nextStationColor(stations: ReadonlyArray<Pick<KitchenStation, 'color'>>): string {
  const used = new Set(stations.map((station) => station.color.toLowerCase()))
  const free = STATION_COLORS.find((color) => !used.has(color.hex))
  return (free ?? (STATION_COLORS[0] as { hex: string })).hex
}

export type StationKind = 'kitchen' | 'cold' | 'bar'

const BAR_WORDS = new Set([
  'barra',
  'bar',
  'bebida',
  'bebidas',
  'trago',
  'tragos',
  'coctel',
  'cocteles',
  'cocteleria',
  'cocktails',
  'vino',
  'vinos',
  'espumante',
  'espumantes',
  'cerveza',
  'cervezas',
  'gaseosa',
  'gaseosas',
  'jugo',
  'jugos',
  'licuado',
  'licuados',
  'aperitivo',
  'aperitivos',
  'whisky',
  'cafe',
  'cafes',
  'cafeteria',
  'te',
  'infusion',
  'infusiones',
  'botella',
  'botellas',
  'cava',
])

const COLD_WORDS = new Set([
  'frio',
  'frios',
  'fria',
  'frias',
  'postre',
  'postres',
  'helado',
  'helados',
  'ensalada',
  'ensaladas',
  'pasteleria',
  'torta',
  'tortas',
  'fiambre',
  'fiambres',
])

const KITCHEN_WORDS = new Set([
  'cocina',
  'comida',
  'comidas',
  'plato',
  'platos',
  'principal',
  'principales',
  'entrada',
  'entradas',
  'minuta',
  'minutas',
  'parrilla',
  'plancha',
  'hamburguesa',
  'hamburguesas',
  'pizza',
  'pizzas',
  'pasta',
  'pastas',
  'milanesa',
  'milanesas',
  'lomito',
  'lomitos',
  'lomo',
  'lomos',
  'sandwich',
  'sandwiches',
  'tostado',
  'tostados',
  'papas',
  'empanada',
  'empanadas',
  'brunch',
  'desayuno',
  'desayunos',
])

/**
 * Qué clase de cosa es, por las palabras del nombre. Si hay de la barra y de la cocina a la vez
 * («Brunch & Café») no se adivina. Entre barra y fríos gana la barra («Bebidas frías»).
 */
export function kindOfName(name: string): StationKind | null {
  const words = plainName(name).split(' ')
  const bar = words.some((word) => BAR_WORDS.has(word))
  const kitchen = words.some((word) => KITCHEN_WORDS.has(word))
  const cold = words.some((word) => COLD_WORDS.has(word))
  if (bar && kitchen) return null
  if (bar) return 'bar'
  if (kitchen) return 'kitchen'
  return cold ? 'cold' : null
}

/** La estación del bar que hace de cocina, de fríos o de barra, por su nombre. Solo las activas. */
export function stationsByKind(
  stations: ReadonlyArray<KitchenStation>,
): Partial<Record<StationKind, string>> {
  const out: Partial<Record<StationKind, string>> = {}
  for (const station of stations) {
    if (!station.active) continue
    const kind = kindOfName(station.name)
    if (kind !== null && out[kind] === undefined) out[kind] = station.id
  }
  return out
}

export type RouteProposal = {
  change: RouteChange
  /** «Comida › Hamburguesas». */
  categoryName: string
  stationId: string
}

/**
 * Una propuesta para lo que todavía no tiene estación: cada categoría de arriba de todo va a la
 * estación que su nombre sugiere, y adentro solo se marca lo que se aparta («Postres» dentro de
 * «Comida»). Las categorías que ya tienen estación (propia o heredada) no se tocan, y lo que no
 * se entiende por el nombre queda para marcar a mano.
 */
export function proposeRouting(
  tree: CartaTree,
  stations: ReadonlyArray<KitchenStation>,
): RouteProposal[] {
  const byKind = stationsByKind(stations)
  const proposals: RouteProposal[] = []
  const walk = (id: string, inherited: string | null, trail: string[]) => {
    const category = tree.byId.get(id)
    if (!category) return
    const path = [...trail, category.name]
    let effective = inherited
    const current = resolveCategory(tree, id).stationId
    if (current !== null) {
      // Ya tiene (suya o de arriba): se respeta y lo de adentro la sigue.
      effective = current
    } else {
      const kind = kindOfName(category.name)
      const stationId = kind === null ? undefined : byKind[kind]
      if (stationId !== undefined && stationId !== inherited) {
        proposals.push({
          change: { node: 'category', id, to: stationId },
          categoryName: path.join(' › '),
          stationId,
        })
        effective = stationId
      }
    }
    for (const child of tree.children.get(id) ?? []) walk(child, effective, path)
  }
  for (const root of tree.children.get(null) ?? []) walk(root, null, [])
  return proposals
}
