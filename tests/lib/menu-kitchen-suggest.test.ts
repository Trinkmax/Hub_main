// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cartaTree } from '@/lib/menu/kitchen/routing'
import {
  CLASSIC_STATIONS,
  kindOfName,
  nextStationColor,
  proposeRouting,
  STATION_COLORS,
  stationsByKind,
} from '@/lib/menu/kitchen/suggest'
import { BARRA, COCINA, category, FRIOS, id, STATIONS, station } from './menu-kitchen-fixtures'

/**
 * Arrancar sin escribir: las tres estaciones de siempre y una propuesta de a dónde va cada
 * categoría según cómo se llama. Los nombres de prueba son los de la carta de HUB.
 */

describe('las tres de siempre y los colores', () => {
  it('son Cocina, Fríos y Barra, con colores válidos y distintos', () => {
    expect(CLASSIC_STATIONS.map((each) => each.name)).toEqual(['Cocina', 'Fríos', 'Barra'])
    const colors = CLASSIC_STATIONS.map((each) => each.color)
    expect(new Set(colors).size).toBe(3)
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('cada color para elegir es válido y no se repite', () => {
    const hexes = STATION_COLORS.map((each) => each.hex)
    expect(new Set(hexes).size).toBe(hexes.length)
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    for (const classic of CLASSIC_STATIONS) expect(hexes).toContain(classic.color)
  })

  it('una estación nueva toma el primer color libre', () => {
    expect(nextStationColor([])).toBe('#b45309')
    expect(nextStationColor(STATIONS)).toBe('#9f0c54')
    expect(nextStationColor([{ color: '#B45309' }])).toBe('#0e7490')
    // Con todos usados, vuelve a empezar.
    expect(nextStationColor(STATION_COLORS.map((each) => ({ color: each.hex })))).toBe('#b45309')
  })
})

describe('kindOfName', () => {
  it('reconoce la barra', () => {
    for (const name of ['Bebidas', 'Tragos HUB!', 'Vinos tintos', 'Bebidas Calientes', 'Barra']) {
      expect(kindOfName(name), name).toBe('bar')
    }
  })

  it('entre barra y fríos gana la barra', () => {
    expect(kindOfName('Té y bebidas frias')).toBe('bar')
  })

  it('reconoce la cocina', () => {
    for (const name of ['Comida', 'Hamburguesas', 'Pizza', 'Lomitos y tostados', 'Cocina']) {
      expect(kindOfName(name), name).toBe('kitchen')
    }
  })

  it('reconoce los fríos', () => {
    for (const name of ['Postres', 'Pasteleria y Clásicos', 'Ensaladas', 'Fríos']) {
      expect(kindOfName(name), name).toBe('cold')
    }
  })

  it('no adivina cuando hay de la barra y de la cocina a la vez, ni cuando no dice nada', () => {
    expect(kindOfName('Brunch & Café')).toBeNull()
    expect(kindOfName('Sin TACC')).toBeNull()
    expect(kindOfName('Platos Especiales')).toBe('kitchen')
    expect(kindOfName('')).toBeNull()
  })
})

describe('stationsByKind', () => {
  it('encuentra cuál es la cocina, los fríos y la barra por el nombre', () => {
    expect(stationsByKind(STATIONS)).toEqual({ kitchen: COCINA, cold: FRIOS, bar: BARRA })
  })

  it('las apagadas no cuentan, y la primera de cada clase gana', () => {
    const stations = [
      station({ id: id('a', 10), name: 'Barra de arriba', active: false }),
      station({ id: id('a', 11), name: 'Barra de abajo' }),
      station({ id: id('a', 12), name: 'Bar del fondo' }),
      station({ id: id('a', 13), name: 'Horno de barro' }),
    ]
    expect(stationsByKind(stations)).toEqual({ bar: id('a', 11) })
  })
})

describe('proposeRouting', () => {
  // La carta de HUB, sin ninguna estación puesta.
  const COMIDA = id('c', 1)
  const HAMB = id('c', 2)
  const ENSALADAS = id('c', 3)
  const BEBIDAS = id('c', 4)
  const BRUNCH = id('c', 5)
  const DESAYUNOS = id('c', 6)
  const CALIENTES = id('c', 7)
  const PASTELERIA = id('c', 8)
  const POSTRES = id('c', 9)
  const TACC = id('c', 10)
  const carta = [
    category({ id: COMIDA, name: 'Comida', position: 1 }),
    category({ id: HAMB, name: 'Hamburguesas', parentId: COMIDA, position: 1 }),
    category({ id: ENSALADAS, name: 'Ensaladas', parentId: COMIDA, position: 2 }),
    category({ id: BEBIDAS, name: 'Bebidas', position: 2 }),
    category({ id: BRUNCH, name: 'Brunch & Café', position: 3 }),
    category({ id: DESAYUNOS, name: 'Brunch y Desayunos', parentId: BRUNCH, position: 1 }),
    category({ id: CALIENTES, name: 'Bebidas Calientes', parentId: BRUNCH, position: 2 }),
    category({ id: PASTELERIA, name: 'Pasteleria y Clásicos', parentId: BRUNCH, position: 3 }),
    category({ id: POSTRES, name: 'Postres', position: 4 }),
    category({ id: TACC, name: 'Sin TACC', position: 5 }),
  ]

  it('marca las de arriba de todo y, adentro, solo lo que se aparta', () => {
    const proposal = proposeRouting(cartaTree(carta, []), STATIONS)
    expect(proposal.map((each) => [each.categoryName, each.stationId])).toEqual([
      ['Comida', COCINA],
      ['Comida › Ensaladas', FRIOS],
      ['Bebidas', BARRA],
      ['Brunch & Café › Brunch y Desayunos', COCINA],
      ['Brunch & Café › Bebidas Calientes', BARRA],
      ['Brunch & Café › Pasteleria y Clásicos', FRIOS],
      ['Postres', FRIOS],
    ])
    // Hamburguesas no se marca: sigue a Comida. «Sin TACC» queda para marcar a mano.
    expect(proposal.every((each) => each.change.node === 'category')).toBe(true)
    expect(proposal.some((each) => each.change.id === HAMB || each.change.id === TACC)).toBe(false)
  })

  it('no toca lo que ya tiene estación, ni lo que cuelga de eso', () => {
    const marked = carta.map((each) => (each.id === COMIDA ? { ...each, stationId: BARRA } : each))
    const proposal = proposeRouting(cartaTree(marked, []), STATIONS)
    expect(proposal.some((each) => each.change.id === COMIDA || each.change.id === HAMB)).toBe(
      false,
    )
    // Ensaladas hereda Barra de Comida: ya tiene, se respeta.
    expect(proposal.some((each) => each.change.id === ENSALADAS)).toBe(false)
    expect(proposal.some((each) => each.change.id === BEBIDAS)).toBe(true)
  })

  it('sin una estación de esa clase, no propone nada para esas categorías', () => {
    const onlyKitchen = STATIONS.filter((each) => each.id === COCINA)
    const proposal = proposeRouting(cartaTree(carta, []), onlyKitchen)
    expect(proposal.map((each) => each.categoryName)).toEqual([
      'Comida',
      'Brunch & Café › Brunch y Desayunos',
    ])
  })

  it('con todo marcado no hay nada que proponer', () => {
    const all = carta.map((each) => ({ ...each, stationId: COCINA }))
    expect(proposeRouting(cartaTree(all, []), STATIONS)).toEqual([])
    expect(proposeRouting(cartaTree([], []), STATIONS)).toEqual([])
  })
})
