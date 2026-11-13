// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ancestorsOf,
  cartaTree,
  EMPTY_BRANCH,
  exceptionsOf,
  inheritedByCategory,
  inheritedByItem,
  marksByStation,
  marksOfStation,
  NO_CATEGORY_ID,
  pathLabel,
  productsLabel,
  redundantMarks,
  resolveCategory,
  resolveItem,
  routingStats,
  ruleSentence,
  STATION_DEPTH,
} from '@/lib/menu/kitchen/routing'
import type { CartaCategory } from '@/lib/menu/kitchen/types'
import {
  AGUA,
  BARRA,
  BEBIDAS,
  CAFE,
  CATEGORIES,
  CESAR,
  CLASICA,
  COCINA,
  COMIDA,
  category,
  ENSALADAS,
  ESPRESSO,
  FLAN,
  FRIOS,
  HAMBURGUESAS,
  HELADO,
  ITEMS,
  id,
  item,
  MOJITO,
  MUZZA,
  PARRILLA,
  PIZZA,
  POSTRES,
  STATIONS,
  station,
  TRAGOS,
  VACIA,
  WRAP,
} from './menu-kitchen-fixtures'

/**
 * A qué estación va cada cosa. La regla es la de la base (`private.pos_item_station`): la del
 * producto y, si no tiene, la de la categoría más cercana que tenga una, subiendo doce a lo sumo.
 */

const tree = cartaTree(CATEGORIES, ITEMS)
const itemById = (itemId: string) => {
  const found = ITEMS.find((each) => each.id === itemId)
  if (!found) throw new Error('producto de prueba inexistente')
  return found
}

describe('cartaTree', () => {
  it('cuelga cada categoría de su madre, en el orden de la carta', () => {
    expect(tree.children.get(null)).toEqual([COMIDA, BEBIDAS, POSTRES, VACIA])
    expect(tree.children.get(COMIDA)).toEqual([HAMBURGUESAS, ENSALADAS, PIZZA])
    expect(tree.order.slice(0, 4)).toEqual([COMIDA, HAMBURGUESAS, ENSALADAS, PIZZA])
    expect(tree.parent.get(PIZZA)).toBe(COMIDA)
    expect(tree.parent.get(COMIDA)).toBeNull()
  })

  it('junta los productos de cada categoría y deja aparte los que no tienen', () => {
    expect(tree.items.get(HAMBURGUESAS)?.map((each) => each.id)).toEqual([CLASICA, WRAP])
    expect(tree.items.get(NO_CATEGORY_ID)?.map((each) => each.id)).toEqual([AGUA])
  })

  it('una categoría cuya madre no existe va arriba de todo', () => {
    const orphan = category({ id: id('c', 50), name: 'Huérfana', parentId: id('c', 99) })
    const withOrphan = cartaTree([...CATEGORIES, orphan], [])
    expect(withOrphan.children.get(null)).toContain(orphan.id)
    expect(withOrphan.parent.get(orphan.id)).toBeNull()
  })

  it('un producto de una categoría que no existe queda como suelto', () => {
    const lost = item({ id: id('e', 50), categoryId: id('c', 99) })
    expect(cartaTree(CATEGORIES, [lost]).items.get(NO_CATEGORY_ID)).toEqual([lost])
  })

  it('un ciclo no cuelga nada y cada categoría sale una sola vez', () => {
    const a = category({ id: id('c', 60), name: 'A', parentId: id('c', 61), position: 1 })
    const b = category({ id: id('c', 61), name: 'B', parentId: id('c', 60), position: 2 })
    const cyclic = cartaTree([a, b], [])
    expect(cyclic.order).toEqual([a.id, b.id])
    expect(cyclic.children.get(null)).toEqual([a.id])
    expect(cyclic.children.get(a.id)).toEqual([b.id])
    expect(cyclic.children.get(b.id)).toEqual([])
    expect(ancestorsOf(cyclic, b.id)).toEqual([a.id])
    // Como la base: da doce vueltas, no encuentra estación y se rinde.
    expect(resolveCategory(cyclic, a.id).source).toBe('none')
  })

  it('una categoría que es su propia madre va arriba de todo', () => {
    const self = category({ id: id('c', 70), parentId: id('c', 70) })
    expect(cartaTree([self], []).children.get(null)).toEqual([self.id])
  })
})

describe('pathLabel', () => {
  it('arma el camino desde arriba', () => {
    expect(pathLabel(tree, HAMBURGUESAS)).toBe('Comida › Hamburguesas')
    expect(pathLabel(tree, COMIDA)).toBe('Comida')
  })

  it('lo que no tiene categoría se llama así', () => {
    expect(pathLabel(tree, null)).toBe('Sin categoría')
    expect(pathLabel(tree, id('c', 99))).toBe('Sin categoría')
  })
})

describe('resolveItem', () => {
  it('la estación propia del producto gana', () => {
    expect(resolveItem(tree, itemById(WRAP))).toEqual({
      stationId: FRIOS,
      source: 'own',
      fromId: null,
    })
  })

  it('sin estación propia, la de la categoría más cercana que tenga una', () => {
    expect(resolveItem(tree, itemById(CESAR))).toEqual({
      stationId: FRIOS,
      source: 'inherited',
      fromId: ENSALADAS,
    })
    // Hamburguesas no tiene: sube hasta Comida.
    expect(resolveItem(tree, itemById(CLASICA))).toEqual({
      stationId: COCINA,
      source: 'inherited',
      fromId: COMIDA,
    })
  })

  it('una categoría pausada también pasa su estación (la base no mira si está activa)', () => {
    expect(resolveItem(tree, itemById(ESPRESSO))).toEqual({
      stationId: BARRA,
      source: 'inherited',
      fromId: BEBIDAS,
    })
  })

  it('si nadie tiene, no hay estación', () => {
    expect(resolveItem(tree, itemById(FLAN)).source).toBe('none')
    expect(resolveItem(tree, itemById(AGUA))).toEqual({
      stationId: null,
      source: 'none',
      fromId: null,
    })
  })

  it('un producto sin categoría puede tener la suya', () => {
    expect(resolveItem(tree, { stationId: BARRA, categoryId: null }).stationId).toBe(BARRA)
  })

  it('si la categoría del producto no existe, se corta ahí', () => {
    expect(resolveItem(tree, { stationId: null, categoryId: id('c', 99) }).source).toBe('none')
  })
})

/** Una fila de categorías, cada una dentro de la anterior; solo la de arriba tiene estación. */
function nested(levels: number): CartaCategory[] {
  return Array.from({ length: levels }, (_, index) =>
    category({
      id: id('c', 100 + index),
      name: `Nivel ${index + 1}`,
      parentId: index === 0 ? null : id('c', 100 + index - 1),
      stationId: index === 0 ? COCINA : null,
    }),
  )
}

describe('el tope de doce categorías', () => {
  it('con doce de profundidad todavía llega a la de arriba', () => {
    const chain = nested(STATION_DEPTH)
    const deepest = chain[chain.length - 1] as CartaCategory
    const deep = cartaTree(chain, [])
    expect(resolveItem(deep, { stationId: null, categoryId: deepest.id }).stationId).toBe(COCINA)
    expect(resolveCategory(deep, deepest.id).stationId).toBe(COCINA)
  })

  it('con trece ya no: la base se rinde antes de llegar', () => {
    const chain = nested(STATION_DEPTH + 1)
    const deepest = chain[chain.length - 1] as CartaCategory
    const deep = cartaTree(chain, [])
    expect(resolveItem(deep, { stationId: null, categoryId: deepest.id }).source).toBe('none')
    // La categoría dice lo mismo que le va a pasar a un producto suyo.
    expect(resolveCategory(deep, deepest.id).source).toBe('none')
  })
})

describe('resolveCategory', () => {
  it('propia, heredada o ninguna', () => {
    expect(resolveCategory(tree, COMIDA)).toEqual({
      stationId: COCINA,
      source: 'own',
      fromId: null,
    })
    expect(resolveCategory(tree, PIZZA)).toEqual({
      stationId: COCINA,
      source: 'inherited',
      fromId: COMIDA,
    })
    expect(resolveCategory(tree, POSTRES).source).toBe('none')
    expect(resolveCategory(tree, id('c', 99)).source).toBe('none')
  })

  it('lo que heredaría sin su propia estación', () => {
    expect(inheritedByCategory(tree, ENSALADAS).stationId).toBe(COCINA)
    expect(inheritedByCategory(tree, COMIDA).source).toBe('none')
    expect(inheritedByItem(tree, itemById(WRAP)).stationId).toBe(COCINA)
  })
})

describe('routingStats', () => {
  const stats = routingStats(tree, STATIONS)

  it('cuenta cuántos productos terminan en cada estación', () => {
    expect(stats.total).toBe(9)
    // Clásica y Muzza a Cocina; Wrap y César a Fríos; Mojito y Espresso a Barra.
    expect(stats.byStation.get(COCINA)).toBe(2)
    expect(stats.byStation.get(FRIOS)).toBe(2)
    expect(stats.byStation.get(BARRA)).toBe(2)
  })

  it('cuenta los que no tienen estación, pausados y sueltos incluidos', () => {
    expect(stats.unrouted).toBe(3)
    expect(stats.routes.get(FLAN)?.problem).toBe('unrouted')
    expect(stats.routes.get(HELADO)?.problem).toBe('unrouted')
    expect(stats.routes.get(AGUA)?.problem).toBe('unrouted')
    expect(stats.routes.get(CLASICA)?.problem).toBeNull()
  })

  it('cada rama junta lo suyo y lo de adentro', () => {
    expect(stats.branches.get(COMIDA)).toMatchObject({ products: 4, unrouted: 0, inactive: 0 })
    expect(stats.branches.get(COMIDA)?.stations.get(COCINA)).toBe(2)
    expect(stats.branches.get(COMIDA)?.stations.get(FRIOS)).toBe(2)
    expect(stats.branches.get(HAMBURGUESAS)?.products).toBe(2)
    expect(stats.branches.get(POSTRES)).toMatchObject({ products: 2, unrouted: 2 })
    expect(stats.branches.get(NO_CATEGORY_ID)).toMatchObject({ products: 1, unrouted: 1 })
    expect(stats.branches.get(VACIA)).toBeUndefined()
    expect(EMPTY_BRANCH.products).toBe(0)
  })

  it('una estación apagada con productos adentro se cuenta aparte', () => {
    const off = STATIONS.map((each) => (each.id === BARRA ? { ...each, active: false } : each))
    const withOff = routingStats(tree, off)
    expect(withOff.inactive).toBe(2)
    expect(withOff.unrouted).toBe(3)
    expect(withOff.routes.get(MOJITO)?.problem).toBe('inactive')
    // Sigue contando para la estación: es lo que tiene adentro.
    expect(withOff.byStation.get(BARRA)).toBe(2)
    expect(withOff.branches.get(BEBIDAS)).toMatchObject({ products: 2, inactive: 2 })
  })

  it('una estación que ya no existe es lo mismo que no tener', () => {
    const gone = routingStats(
      tree,
      STATIONS.filter((each) => each.id !== FRIOS),
    )
    expect(gone.routes.get(CESAR)?.problem).toBe('unrouted')
    expect(gone.byStation.has(FRIOS)).toBe(false)
    expect(gone.unrouted).toBe(5)
  })
})

describe('exceptionsOf y ruleSentence', () => {
  const nameOf = (stationId: string) =>
    STATIONS.find((each) => each.id === stationId)?.name ?? 'otra'

  it('lista lo de adentro que va a otra estación', () => {
    expect(exceptionsOf(tree, COMIDA)).toEqual([
      { node: 'item', id: WRAP, name: 'Wrap frío', stationId: FRIOS },
      { node: 'category', id: ENSALADAS, name: 'Ensaladas', stationId: FRIOS },
    ])
  })

  it('no entra en una subcategoría que ya se aparta', () => {
    const inside = item({
      id: id('e', 60),
      name: 'Tibia',
      categoryId: ENSALADAS,
      stationId: COCINA,
    })
    const deeper = cartaTree(CATEGORIES, [...ITEMS, inside])
    expect(exceptionsOf(deeper, COMIDA).map((each) => each.id)).toEqual([WRAP, ENSALADAS])
    // Para Ensaladas sí es una excepción.
    expect(exceptionsOf(deeper, ENSALADAS).map((each) => each.id)).toEqual([inside.id])
  })

  it('una marca igual a la de arriba no es una excepción', () => {
    const same = CATEGORIES.map((each) =>
      each.id === PIZZA ? { ...each, stationId: COCINA } : each,
    )
    expect(exceptionsOf(cartaTree(same, ITEMS), COMIDA).some((each) => each.id === PIZZA)).toBe(
      false,
    )
  })

  it('sin estación no hay regla de la que apartarse', () => {
    expect(exceptionsOf(tree, POSTRES)).toEqual([])
  })

  it('dice la regla con sus excepciones, las subcategorías primero', () => {
    expect(ruleSentence('Cocina', exceptionsOf(tree, COMIDA), nameOf)).toBe(
      'Todo a Cocina, menos Ensaladas (Fríos) y Wrap frío (Fríos).',
    )
  })

  it('resume cuando son muchas', () => {
    const many = [1, 2, 3, 4].map((n) => ({
      node: 'item' as const,
      id: id('e', 70 + n),
      name: `Plato ${n}`,
      stationId: FRIOS,
    }))
    expect(ruleSentence('Cocina', many, nameOf)).toBe(
      'Todo a Cocina, menos Plato 1 (Fríos), Plato 2 (Fríos) y 2 más.',
    )
  })

  it('una sola excepción, y ninguna', () => {
    const [only] = exceptionsOf(tree, COMIDA)
    expect(ruleSentence('Cocina', only ? [only] : [], nameOf)).toBe(
      'Todo a Cocina, menos Wrap frío (Fríos).',
    )
    expect(ruleSentence('Cocina', [], nameOf)).toBeNull()
  })
})

describe('cambios en bloque', () => {
  it('encuentra las marcas que repiten lo que heredarían', () => {
    const repeated = CATEGORIES.map((each) =>
      each.id === PIZZA || each.id === HAMBURGUESAS ? { ...each, stationId: COCINA } : each,
    )
    const items = ITEMS.map((each) => (each.id === MOJITO ? { ...each, stationId: BARRA } : each))
    expect(redundantMarks(cartaTree(repeated, items))).toEqual([
      { node: 'category', id: HAMBURGUESAS, to: null },
      { node: 'category', id: PIZZA, to: null },
      { node: 'item', id: MOJITO, to: null },
    ])
  })

  it('una marca distinta a la de arriba no sobra, ni la de una categoría de arriba de todo', () => {
    expect(redundantMarks(tree)).toEqual([])
  })

  it('junta todo lo que tiene puesta una estación para pasarlo a otra', () => {
    expect(marksOfStation(tree, FRIOS, COCINA)).toEqual([
      { node: 'category', id: ENSALADAS, to: COCINA },
      { node: 'item', id: WRAP, to: COCINA },
    ])
    expect(marksOfStation(tree, PARRILLA, null)).toEqual([])
  })

  it('cuenta las marcas propias de cada estación', () => {
    const marks = marksByStation(tree)
    expect(marks.get(COCINA)).toBe(1)
    expect(marks.get(FRIOS)).toBe(2)
    expect(marks.get(BARRA)).toBe(1)
    expect(marks.has(PARRILLA)).toBe(false)
  })
})

describe('con una estación apagada en el medio', () => {
  it('la regla no cambia: sigue resolviendo a la apagada', () => {
    const stations = [...STATIONS, station({ id: PARRILLA, name: 'Parrilla', active: false })]
    const grill = CATEGORIES.map((each) =>
      each.id === TRAGOS ? { ...each, stationId: PARRILLA } : each,
    )
    const grillTree = cartaTree(grill, ITEMS)
    expect(resolveCategory(grillTree, TRAGOS).stationId).toBe(PARRILLA)
    const stats = routingStats(grillTree, stations)
    expect(stats.routes.get(MOJITO)?.problem).toBe('inactive')
    expect(stats.routes.get(ESPRESSO)?.problem).toBeNull()
    expect(stats.routes.get(MUZZA)?.resolution.fromId).toBe(COMIDA)
    expect(stats.branches.get(CAFE)?.products).toBe(1)
  })
})

describe('productsLabel', () => {
  it('singular y plural', () => {
    expect(productsLabel(1)).toBe('1 producto')
    expect(productsLabel(0)).toBe('0 productos')
    expect(productsLabel(12)).toBe('12 productos')
  })
})
