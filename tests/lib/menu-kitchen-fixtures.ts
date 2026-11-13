import type {
  CartaCategory,
  CartaItem,
  KitchenSnapshot,
  KitchenStation,
  ModifierGroup,
  ModifierLink,
  ModifierOption,
} from '@/lib/menu/kitchen/types'

/**
 * Una carta chica con la forma de la de verdad: categorías de arriba con su estación, una
 * subcategoría que se aparta, un producto que se aparta, una rama sin estación, una categoría
 * pausada, un producto pausado y uno sin categoría.
 */

/** Ids con forma de uuid, legibles: `id('c', 1)` → `c0000000-0000-4000-8000-000000000001`. */
export function id(prefix: string, n: number): string {
  const head = `${prefix}0000000`.slice(0, 8).replace(/[^0-9a-f]/g, '0')
  return `${head}-0000-4000-8000-${String(n).padStart(12, '0')}`
}

export const COCINA = id('a', 1)
export const FRIOS = id('a', 2)
export const BARRA = id('a', 3)
export const PARRILLA = id('a', 4)

export const station = (over: Partial<KitchenStation> & { id: string }): KitchenStation => ({
  name: 'Cocina',
  color: '#b45309',
  position: 0,
  active: true,
  ...over,
})

export const STATIONS: KitchenStation[] = [
  station({ id: COCINA, name: 'Cocina', color: '#b45309', position: 0 }),
  station({ id: FRIOS, name: 'Fríos', color: '#0e7490', position: 1 }),
  station({ id: BARRA, name: 'Barra', color: '#6d28d9', position: 2 }),
]

export const COMIDA = id('c', 1)
export const HAMBURGUESAS = id('c', 2)
export const ENSALADAS = id('c', 3)
export const PIZZA = id('c', 4)
export const BEBIDAS = id('c', 5)
export const TRAGOS = id('c', 6)
export const CAFE = id('c', 7)
export const POSTRES = id('c', 8)
export const VACIA = id('c', 9)

export const category = (over: Partial<CartaCategory> & { id: string }): CartaCategory => ({
  name: 'Categoría',
  parentId: null,
  position: 0,
  active: true,
  stationId: null,
  ...over,
})

export const CATEGORIES: CartaCategory[] = [
  category({ id: COMIDA, name: 'Comida', position: 1, stationId: COCINA }),
  category({ id: HAMBURGUESAS, name: 'Hamburguesas', parentId: COMIDA, position: 2 }),
  category({
    id: ENSALADAS,
    name: 'Ensaladas',
    parentId: COMIDA,
    position: 3,
    stationId: FRIOS,
  }),
  category({ id: PIZZA, name: 'Pizza', parentId: COMIDA, position: 4 }),
  category({ id: BEBIDAS, name: 'Bebidas', position: 2, stationId: BARRA }),
  category({ id: TRAGOS, name: 'Tragos', parentId: BEBIDAS, position: 1 }),
  category({ id: CAFE, name: 'Café', parentId: BEBIDAS, position: 2, active: false }),
  category({ id: POSTRES, name: 'Postres', position: 3 }),
  category({ id: VACIA, name: 'Vacía', position: 4 }),
]

export const CLASICA = id('e', 1)
export const WRAP = id('e', 2)
export const CESAR = id('e', 3)
export const MUZZA = id('e', 4)
export const MOJITO = id('e', 5)
export const ESPRESSO = id('e', 6)
export const FLAN = id('e', 7)
export const HELADO = id('e', 8)
export const AGUA = id('e', 9)

export const item = (over: Partial<CartaItem> & { id: string }): CartaItem => ({
  name: 'Producto',
  categoryId: null,
  position: 0,
  active: true,
  priceCents: 1_000_000,
  stationId: null,
  ...over,
})

export const ITEMS: CartaItem[] = [
  item({
    id: CLASICA,
    name: 'Clásica simple',
    categoryId: HAMBURGUESAS,
    position: 1,
    priceCents: 1_700_000,
  }),
  item({ id: WRAP, name: 'Wrap frío', categoryId: HAMBURGUESAS, position: 2, stationId: FRIOS }),
  item({ id: CESAR, name: 'Ensalada César', categoryId: ENSALADAS, position: 1 }),
  item({ id: MUZZA, name: 'Muzza', categoryId: PIZZA, position: 1 }),
  item({ id: MOJITO, name: 'Mojito', categoryId: TRAGOS, position: 1 }),
  item({ id: ESPRESSO, name: 'Espresso', categoryId: CAFE, position: 1 }),
  item({ id: FLAN, name: 'Flan', categoryId: POSTRES, position: 1 }),
  item({ id: HELADO, name: 'Helado', categoryId: POSTRES, position: 2, active: false }),
  item({ id: AGUA, name: 'Agua', categoryId: null, position: 1 }),
]

export const PUNTO = id('b', 1)
export const SIN = id('b', 2)
export const EXTRAS = id('b', 3)
export const HIELO = id('b', 4)

export const group = (over: Partial<ModifierGroup> & { id: string }): ModifierGroup => ({
  name: 'Grupo',
  selection: 'multi',
  required: false,
  position: 0,
  active: true,
  ...over,
})

export const GROUPS: ModifierGroup[] = [
  group({ id: PUNTO, name: 'Punto de la carne', selection: 'single', position: 0 }),
  group({ id: SIN, name: 'Sin…', position: 1 }),
  group({ id: EXTRAS, name: 'Extras', position: 2 }),
  group({ id: HIELO, name: 'Hielo y limón', position: 3 }),
]

export const JUGOSO = id('d', 1)
export const A_PUNTO = id('d', 2)
export const COCIDO = id('d', 3)
export const SIN_LECHUGA = id('d', 4)
export const SIN_TOMATE = id('d', 5)
export const CHEDDAR = id('d', 6)
export const BACON = id('d', 7)
export const SIN_HIELO = id('d', 8)

export const option = (
  over: Partial<ModifierOption> & { id: string; groupId: string },
): ModifierOption => ({
  label: 'Opción',
  priceDeltaCents: 0,
  position: 0,
  active: true,
  ...over,
})

export const OPTIONS: ModifierOption[] = [
  option({ id: JUGOSO, groupId: PUNTO, label: 'Jugoso', position: 0 }),
  option({ id: A_PUNTO, groupId: PUNTO, label: 'A punto', position: 1 }),
  option({ id: COCIDO, groupId: PUNTO, label: 'Bien cocido', position: 2 }),
  option({ id: SIN_LECHUGA, groupId: SIN, label: 'Sin lechuga', position: 0 }),
  option({ id: SIN_TOMATE, groupId: SIN, label: 'Sin tomate', position: 1 }),
  option({
    id: CHEDDAR,
    groupId: EXTRAS,
    label: 'Extra cheddar',
    position: 0,
    priceDeltaCents: 150_000,
  }),
  option({
    id: BACON,
    groupId: EXTRAS,
    label: 'Extra bacon',
    position: 1,
    priceDeltaCents: 200_000,
  }),
  option({ id: SIN_HIELO, groupId: HIELO, label: 'Sin hielo', position: 0 }),
]

export const link = (
  groupId: string,
  target: ModifierLink['target'],
  targetId: string,
): ModifierLink => ({ groupId, target, targetId })

export const LINKS: ModifierLink[] = [
  link(PUNTO, 'category', HAMBURGUESAS),
  link(SIN, 'category', COMIDA),
  link(EXTRAS, 'item', CLASICA),
  link(HIELO, 'category', BEBIDAS),
]

export function snapshot(over: Partial<KitchenSnapshot> = {}): KitchenSnapshot {
  return {
    loadedAt: 1_000,
    stations: STATIONS,
    categories: CATEGORIES,
    items: ITEMS,
    groups: GROUPS,
    options: OPTIONS,
    links: LINKS,
    ...over,
  }
}
