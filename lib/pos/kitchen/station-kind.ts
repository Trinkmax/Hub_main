/**
 * De qué es una estación y con qué dibujo se la reconoce — PURO y testeado.
 *
 * Cada estación de la cocina es de comida o de bebida (`kitchen_stations.kind`) y puede tener su
 * dibujo (`icon`, un emoji). De acá sale el dibujo que va sobre la mesa en el mapa, cómo se la nombra
 * en un aviso al mozo («bebidas listas») y si su comanda muestra los vasos de la mesa.
 */
export type StationKind = 'food' | 'drink'

/** Lo mínimo que hace falta saber de una estación para dibujarla. */
export type StationLook = {
  id: string
  name: string
  color?: string | null
  kind?: string | null
  icon?: string | null
}

/** Una estación sin tipo conocido es de comida: es lo que eran todas antes de que existiera el tipo. */
export function stationKind(kind: string | null | undefined): StationKind {
  return kind === 'drink' ? 'drink' : 'food'
}

const BY_NAME: readonly [RegExp, string][] = [
  [/pizz/i, '🍕'],
  [/planch|grill/i, '🍔'],
  [/freid|frit/i, '🍟'],
  [/parrill|asador/i, '🥩'],
  [/caf[eé]|barista/i, '☕'],
  [/postre|pastel|fr[ií]o/i, '🍰'],
  [/sushi/i, '🍣'],
  [/ensalad/i, '🥗'],
]
const BY_KIND: Record<StationKind, string> = { food: '🍽️', drink: '🍹' }

/**
 * El dibujo de una estación: el que eligió el bar; si no eligió, uno que sale del nombre («Pizzeros»
 * → pizza); y si el nombre no dice nada, el de su tipo.
 */
export function stationIcon(
  station: Pick<StationLook, 'name' | 'kind' | 'icon'> | null | undefined,
): string {
  const chosen = station?.icon?.trim()
  if (chosen) return chosen
  const name = station?.name ?? ''
  for (const [pattern, icon] of BY_NAME) if (pattern.test(name)) return icon
  return BY_KIND[stationKind(station?.kind)]
}

/** Cómo se dice lo de esa estación en una frase: «las bebidas», «la comida». */
export function stationGoods(kind: string | null | undefined): string {
  return stationKind(kind) === 'drink' ? 'las bebidas' : 'la comida'
}

/** Los dibujos que el bar puede elegir para una estación, lo más usado primero. */
export const STATION_ICON_CHOICES: readonly string[] = [
  '🍳',
  '🍔',
  '🍕',
  '🍟',
  '🍹',
  '🍺',
  '☕',
  '🍰',
  '🥗',
  '🥩',
  '🍝',
  '🍣',
  '🍷',
  '🍽️',
]

/**
 * Los vasos que hay que mandar con lo de una mesa: uno por persona, en las estaciones de bebida
 * («viene una mesa de 6: son 6 vasos»). `null` cuando no corresponde mostrarlos.
 */
export function glassesFor(
  kind: string | null | undefined,
  partySize: number | null | undefined,
): number | null {
  if (stationKind(kind) !== 'drink') return null
  if (typeof partySize !== 'number' || !Number.isFinite(partySize) || partySize < 1) return null
  return Math.floor(partySize)
}
