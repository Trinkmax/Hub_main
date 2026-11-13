// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cartaTree, routingStats } from '@/lib/menu/kitchen/routing'
import {
  barParts,
  buildRouteModel,
  routeHeadline,
  splitPath,
  stationBreakdown,
  stationFeeds,
} from '@/lib/menu/kitchen/view'
import {
  AGUA,
  BARRA,
  BEBIDAS,
  CATEGORIES,
  CLASICA,
  COCINA,
  COMIDA,
  category,
  ENSALADAS,
  FLAN,
  FRIOS,
  HAMBURGUESAS,
  ITEMS,
  id,
  item,
  PIZZA,
  POSTRES,
  STATIONS,
  TRAGOS,
  VACIA,
  WRAP,
} from './menu-kitchen-fixtures'

/**
 * Lo que se lee en «A dónde va cada cosa»: la etiqueta de cada renglón, el titular con su
 * número y la barra de reparto. Las oraciones son parte de la pantalla: se prueban tal cual.
 */

const tree = cartaTree(CATEGORIES, ITEMS)
const stats = routingStats(tree, STATIONS)
const model = buildRouteModel(tree, stats, STATIONS)
const cocina = STATIONS[0]
const frios = STATIONS[1]

describe('buildRouteModel: las categorías', () => {
  it('con estación propia', () => {
    const comida = model.categories.get(COMIDA)
    expect(comida?.slot).toMatchObject({
      node: 'category',
      name: 'Comida',
      source: 'own',
      ownId: COCINA,
      station: cocina,
      fromName: null,
      fallback: { station: null, fromName: null },
      warn: false,
      mixed: null,
    })
    expect(comida?.depth).toBe(0)
    expect(comida?.branch.products).toBe(4)
    expect(comida?.hasInside).toBe(true)
  })

  it('heredada: dice de quién, y a quién seguiría', () => {
    expect(model.categories.get(PIZZA)?.slot).toMatchObject({
      source: 'inherited',
      ownId: null,
      station: cocina,
      fromName: 'Comida',
      fallback: { station: cocina, fromName: 'Comida' },
    })
    expect(model.categories.get(PIZZA)?.depth).toBe(1)
  })

  it('la que se aparta sabe a qué volvería', () => {
    expect(model.categories.get(ENSALADAS)?.slot).toMatchObject({
      source: 'own',
      station: frios,
      fallback: { station: cocina, fromName: 'Comida' },
    })
  })

  it('sin estación y con productos adentro: avisa', () => {
    expect(model.categories.get(POSTRES)?.slot).toMatchObject({
      source: 'none',
      station: null,
      warn: true,
      mixed: null,
    })
  })

  it('sin estación y vacía: no avisa (no hay nada que mandar)', () => {
    const vacia = model.categories.get(VACIA)
    expect(vacia?.slot).toMatchObject({ source: 'none', warn: false, mixed: null })
    expect(vacia?.hasInside).toBe(false)
  })

  it('sin estación pero con todo lo de adentro resuelto: «varias», en el orden de las estaciones', () => {
    const root = category({ id: id('c', 40), name: 'Brunch & Café', position: 9 })
    const kids = [
      category({ id: id('c', 41), name: 'Café', parentId: root.id, position: 1, stationId: BARRA }),
      category({
        id: id('c', 42),
        name: 'Tostados',
        parentId: root.id,
        position: 2,
        stationId: COCINA,
      }),
    ]
    const things = [
      item({ id: id('e', 41), name: 'Cortado', categoryId: id('c', 41) }),
      item({ id: id('e', 42), name: 'Tostado', categoryId: id('c', 42) }),
    ]
    const mixedTree = cartaTree([root, ...kids], things)
    const mixed = buildRouteModel(mixedTree, routingStats(mixedTree, STATIONS), STATIONS)
    expect(mixed.categories.get(root.id)?.slot).toMatchObject({
      source: 'none',
      warn: false,
      mixed: [cocina, STATIONS[2]],
    })
    // Una subcategoría sin estación dice a quién seguiría aunque esa tampoco tenga.
    expect(mixed.categories.get(id('c', 41))?.slot.fallback).toEqual({
      station: null,
      fromName: 'Brunch & Café',
    })
  })

  it('dice la regla solo cuando algo de adentro se aparta', () => {
    expect(model.categories.get(COMIDA)?.rule).toBe(
      'Todo a Cocina, menos Ensaladas (Fríos) y Wrap frío (Fríos).',
    )
    expect(model.categories.get(BEBIDAS)?.rule).toBeNull()
    expect(model.categories.get(POSTRES)?.rule).toBeNull()
  })

  it('guarda el camino de las de arriba', () => {
    expect(model.categoryPaths.get(COMIDA)).toBe('')
    expect(model.categoryPaths.get(HAMBURGUESAS)).toBe('Comida')
    expect(model.categoryPaths.get(TRAGOS)).toBe('Bebidas')
  })
})

describe('buildRouteModel: los productos', () => {
  it('heredado de la categoría que la define, no de la más cercana', () => {
    expect(model.items.get(CLASICA)).toMatchObject({
      node: 'item',
      name: 'Clásica simple',
      source: 'inherited',
      station: cocina,
      fromName: 'Comida',
      fallback: { station: cocina, fromName: 'Comida' },
      warn: false,
    })
    expect(model.itemPaths.get(CLASICA)).toBe('Comida › Hamburguesas')
  })

  it('con estación propia sabe a qué volvería', () => {
    expect(model.items.get(WRAP)).toMatchObject({
      source: 'own',
      ownId: FRIOS,
      station: frios,
      fallback: { station: cocina, fromName: 'Comida' },
    })
  })

  it('sin estación: avisa, y seguiría a su categoría aunque no tenga', () => {
    expect(model.items.get(FLAN)).toMatchObject({
      source: 'none',
      warn: true,
      fallback: { station: null, fromName: 'Postres' },
    })
  })

  it('sin categoría no tiene a quién seguir', () => {
    expect(model.items.get(AGUA)).toMatchObject({
      source: 'none',
      warn: true,
      fallback: { station: null, fromName: null },
    })
    expect(model.itemPaths.get(AGUA)).toBe('Sin categoría')
  })

  it('una estación que ya no está se muestra como «sin estación»', () => {
    const fewer = STATIONS.filter((each) => each.id !== FRIOS)
    const gone = buildRouteModel(tree, routingStats(tree, fewer), fewer)
    expect(gone.items.get(WRAP)).toMatchObject({ source: 'none', station: null, warn: true })
    expect(gone.categories.get(ENSALADAS)?.slot).toMatchObject({ source: 'none', warn: true })
  })
})

describe('routeHeadline', () => {
  const routed = (over: Parameters<typeof cartaTree>[1]) => {
    const each = cartaTree(CATEGORIES, over)
    return routingStats(each, STATIONS)
  }
  const allRouted = ITEMS.filter((each) => ![FLAN, AGUA, id('e', 8)].includes(each.id))

  it('todo con estación: el total y a dónde sale cada cosa', () => {
    expect(routeHeadline(routed(allRouted), STATIONS)).toEqual({
      tone: 'ok',
      figure: 6,
      lead: 'productos, cada uno con su estación.',
      detail: '2 salen en Cocina, 2 en Fríos y 2 en Barra.',
    })
  })

  it('un solo producto', () => {
    const one = routed(allRouted.filter((each) => each.id === CLASICA))
    expect(routeHeadline(one, STATIONS)).toMatchObject({
      figure: 1,
      lead: 'producto, con su estación.',
      detail: 'Sale en Cocina.',
    })
  })

  it('sin estación: cuántos, y qué pasa mientras tanto', () => {
    expect(routeHeadline(stats, STATIONS)).toEqual({
      tone: 'warn',
      figure: 3,
      lead: 'productos sin estación.',
      detail:
        'Hasta que les pongas una, salen en todas las pantallas de la cocina. Los otros 6 ya tienen la suya.',
    })
  })

  it('uno solo sin estación, en singular', () => {
    const one = routed([...allRouted, ITEMS.find((each) => each.id === FLAN) as (typeof ITEMS)[0]])
    expect(routeHeadline(one, STATIONS)).toMatchObject({
      figure: 1,
      lead: 'producto sin estación.',
      detail:
        'Hasta que le pongas una, sale en todas las pantallas de la cocina. Los otros 6 ya tienen la suya.',
    })
  })

  it('una estación apagada con productos adentro', () => {
    const off = STATIONS.map((each) => (each.id === BARRA ? { ...each, active: false } : each))
    const each = cartaTree(CATEGORIES, allRouted)
    expect(routeHeadline(routingStats(each, off), off)).toEqual({
      tone: 'warn',
      figure: 2,
      lead: 'productos en una estación apagada.',
      detail:
        'Barra está apagada: una pantalla que elige estaciones no los muestra. Prendela o pasalos a otra.',
    })
  })

  it('las dos cosas a la vez', () => {
    const off = STATIONS.map((each) => (each.id === BARRA ? { ...each, active: false } : each))
    expect(routeHeadline(routingStats(tree, off), off)).toEqual({
      tone: 'warn',
      figure: 5,
      lead: 'productos para revisar.',
      detail: '3 sin estación (salen en todas las pantallas) y 2 en Barra, que está apagada.',
    })
  })

  it('carta vacía', () => {
    expect(routeHeadline(routed([]), STATIONS)).toMatchObject({ tone: 'empty', figure: 0 })
  })
})

describe('stationBreakdown', () => {
  it('con una sola estación', () => {
    const only = cartaTree(
      [category({ id: COMIDA, name: 'Comida', stationId: COCINA })],
      [item({ id: id('e', 1), categoryId: COMIDA }), item({ id: id('e', 2), categoryId: COMIDA })],
    )
    expect(stationBreakdown(routingStats(only, STATIONS), STATIONS)).toBe('Todos salen en Cocina.')
  })

  it('con una estación y algunos afuera', () => {
    const some = cartaTree(
      [category({ id: COMIDA, name: 'Comida', stationId: COCINA })],
      [item({ id: id('e', 1), categoryId: COMIDA }), item({ id: id('e', 2), categoryId: null })],
    )
    expect(stationBreakdown(routingStats(some, STATIONS), STATIONS)).toBe('1 sale en Cocina.')
  })

  it('sin nada marcado no hay qué decir', () => {
    expect(stationBreakdown(routingStats(cartaTree([], []), STATIONS), STATIONS)).toBeNull()
  })
})

describe('barParts', () => {
  it('una parte por estación que recibe algo, en orden, y lo que no tiene al final', () => {
    expect(barParts(stats, STATIONS)).toEqual([
      { key: COCINA, kind: 'station', name: 'Cocina', color: '#b45309', count: 2, share: 22 },
      { key: FRIOS, kind: 'station', name: 'Fríos', color: '#0e7490', count: 2, share: 22 },
      { key: BARRA, kind: 'station', name: 'Barra', color: '#6d28d9', count: 2, share: 22 },
      {
        key: 'sin-estacion',
        kind: 'problem',
        name: 'Sin estación',
        color: null,
        count: 3,
        share: 33,
      },
    ])
  })

  it('una estación apagada se dibuja distinta; una vacía no se dibuja', () => {
    const off = [
      ...STATIONS.map((each) => (each.id === BARRA ? { ...each, active: false } : each)),
      { id: id('a', 9), name: 'Parrilla', color: '#9f0c54', position: 9, active: true },
    ]
    const parts = barParts(routingStats(tree, off), off)
    expect(parts.find((part) => part.key === BARRA)?.kind).toBe('off')
    expect(parts.some((part) => part.name === 'Parrilla')).toBe(false)
  })

  it('sin productos no hay barra', () => {
    expect(barParts(routingStats(cartaTree(CATEGORIES, []), STATIONS), STATIONS)).toEqual([])
  })
})

describe('stationFeeds', () => {
  it('nombra las ramas de arriba que le mandan productos, de la que más a la que menos', () => {
    expect(stationFeeds(tree, stats, COCINA)).toEqual(['Comida'])
    expect(stationFeeds(tree, stats, BARRA)).toEqual(['Bebidas'])
    const more = cartaTree(CATEGORIES, [
      ...ITEMS,
      item({ id: id('e', 80), categoryId: POSTRES, stationId: FRIOS }),
      item({ id: id('e', 81), categoryId: POSTRES, stationId: FRIOS }),
      item({ id: id('e', 82), categoryId: POSTRES, stationId: FRIOS }),
      item({ id: id('e', 83), categoryId: null, stationId: FRIOS }),
    ])
    expect(stationFeeds(more, routingStats(more, STATIONS), FRIOS)).toEqual([
      'Postres',
      'Comida',
      'Sin categoría',
    ])
  })

  it('dos ramas de arriba con el mismo nombre cuentan como una', () => {
    const twins = cartaTree(
      [
        category({ id: id('c', 90), name: 'Bebidas', position: 1, stationId: BARRA }),
        category({ id: id('c', 91), name: 'Bebidas', position: 2, stationId: BARRA }),
      ],
      [
        item({ id: id('e', 90), categoryId: id('c', 90) }),
        item({ id: id('e', 91), categoryId: id('c', 91) }),
      ],
    )
    expect(stationFeeds(twins, routingStats(twins, STATIONS), BARRA)).toEqual(['Bebidas'])
  })

  it('una estación a la que no va nada', () => {
    expect(stationFeeds(tree, stats, id('a', 99))).toEqual([])
  })
})

describe('splitPath', () => {
  it('separa lo de arriba de lo último', () => {
    expect(splitPath('Comida › Hamburguesas')).toEqual({ above: 'Comida', last: 'Hamburguesas' })
    expect(splitPath('A › B › C')).toEqual({ above: 'A › B', last: 'C' })
    expect(splitPath('Comida')).toEqual({ above: '', last: 'Comida' })
  })
})
