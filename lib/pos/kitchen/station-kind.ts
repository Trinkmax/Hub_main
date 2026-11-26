/**
 * De qué es una estación y con qué ícono se la reconoce — PURO y testeado.
 *
 * Cada estación de la cocina es de comida o de bebida (`kitchen_stations.kind`) y puede tener su
 * ícono (`icon`, la clave de uno del catálogo). De acá sale el ícono que va sobre la mesa en el mapa,
 * cómo se la nombra en un aviso al mozo («bebidas listas») y si su comanda muestra los vasos de la mesa.
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

/**
 * Los íconos con los que se reconoce una estación (pedido de Nacho, 26/11: «en vez de emojis prefiero
 * que sean íconos»). Acá vive solo la CLAVE de cada uno; el dibujo está en
 * `components/pos/ui/station-icon.tsx`. El orden es el del selector: lo más usado primero.
 */
export const STATION_ICON_KEYS = [
  'chef',
  'burger',
  'pizza',
  'cocktail',
  'pot',
  'flame',
  'grill',
  'pasta',
  'salad',
  'sandwich',
  'fish',
  'cake',
  'croissant',
  'icecream',
  'coffee',
  'wine',
  'beer',
  'soda',
  'plate',
] as const
export type StationIconKey = (typeof STATION_ICON_KEYS)[number]

/** Cómo se dice cada ícono (para quien usa lector de pantalla y para el selector). */
export const STATION_ICON_LABEL: Record<StationIconKey, string> = {
  chef: 'Gorro de cocinero',
  burger: 'Hamburguesa',
  pizza: 'Pizza',
  cocktail: 'Copa de trago',
  pot: 'Olla',
  flame: 'Fuego',
  grill: 'Carne',
  pasta: 'Plato hondo',
  salad: 'Ensalada',
  sandwich: 'Sándwich',
  fish: 'Pescado',
  cake: 'Torta',
  croissant: 'Medialuna',
  icecream: 'Helado',
  coffee: 'Café',
  wine: 'Copa de vino',
  beer: 'Cerveza',
  soda: 'Gaseosa',
  plate: 'Cubiertos',
}

const KEYS: ReadonlySet<string> = new Set(STATION_ICON_KEYS)

/** Los emojis que se guardaron el primer día (26/11) valen como el ícono que les corresponde. */
const FROM_EMOJI: Record<string, StationIconKey> = {
  '🍳': 'chef',
  '🍔': 'burger',
  '🍕': 'pizza',
  '🍟': 'burger',
  '🍹': 'cocktail',
  '🍺': 'beer',
  '☕': 'coffee',
  '🍰': 'cake',
  '🥗': 'salad',
  '🥩': 'grill',
  '🍝': 'pasta',
  '🍣': 'fish',
  '🍷': 'wine',
  '🍽️': 'plate',
  '🍽': 'plate',
}

/** Lo guardado en la estación (una clave, o un emoji del primer día) como clave; `null` si no dice nada. */
export function stationIconKey(value: string | null | undefined): StationIconKey | null {
  const clean = value?.trim()
  if (!clean) return null
  if (KEYS.has(clean)) return clean as StationIconKey
  return FROM_EMOJI[clean] ?? null
}

const BY_NAME: readonly [RegExp, StationIconKey][] = [
  [/pizz/i, 'pizza'],
  [/planch|grill|hamburg/i, 'burger'],
  [/parrill|asador/i, 'grill'],
  [/freid|frit/i, 'flame'],
  [/caf[eé]|barista/i, 'coffee'],
  [/postre|pastel/i, 'cake'],
  [/fr[ií]o|ensalad/i, 'salad'],
  [/sushi/i, 'fish'],
  [/vino|cava/i, 'wine'],
  [/cervez/i, 'beer'],
  [/cocina/i, 'chef'],
  [/barra|trago/i, 'cocktail'],
]
const BY_KIND: Record<StationKind, StationIconKey> = { food: 'plate', drink: 'cocktail' }

/**
 * El ícono de una estación: el que eligió el bar; si no eligió, uno que sale del nombre («Pizzeros»
 * → pizza); y si el nombre no dice nada, el de su tipo.
 */
export function stationIcon(
  station: Pick<StationLook, 'name' | 'kind' | 'icon'> | null | undefined,
): StationIconKey {
  const chosen = stationIconKey(station?.icon)
  if (chosen) return chosen
  const name = station?.name ?? ''
  for (const [pattern, icon] of BY_NAME) if (pattern.test(name)) return icon
  return BY_KIND[stationKind(station?.kind)]
}

/** Cómo se dice lo de esa estación en una frase: «las bebidas», «la comida». */
export function stationGoods(kind: string | null | undefined): string {
  return stationKind(kind) === 'drink' ? 'las bebidas' : 'la comida'
}

/** Los íconos que el bar puede elegir para una estación, lo más usado primero. */
export const STATION_ICON_CHOICES: readonly StationIconKey[] = STATION_ICON_KEYS

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
