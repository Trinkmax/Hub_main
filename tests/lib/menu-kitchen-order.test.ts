// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { moveBy, moveTo, orderIsCurrent, positionWrites, sameOrder } from '@/lib/menu/kitchen/order'

/** Ordenar estaciones, grupos y opciones: arrastrando o con los botones de subir y bajar. */

describe('moveTo', () => {
  it('lleva un elemento a otro lugar y corre a los demás', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTo(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('fuera de rango o al mismo lugar, deja la lista como estaba (en una copia)', () => {
    const list = ['a', 'b']
    expect(moveTo(list, 0, 0)).toEqual(list)
    expect(moveTo(list, 0, 2)).toEqual(list)
    expect(moveTo(list, -1, 1)).toEqual(list)
    expect(moveTo(list, 0, 0)).not.toBe(list)
  })
})

describe('moveBy', () => {
  it('sube y baja un lugar', () => {
    expect(moveBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveBy(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('en el borde no hace nada, y con algo que no está tampoco', () => {
    expect(moveBy(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveBy(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moveBy(['a', 'b', 'c'], 'z', 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('positionWrites', () => {
  const rows = [
    { id: 'a', position: 0 },
    { id: 'b', position: 1 },
    { id: 'c', position: 2 },
  ]

  it('escribe solo las filas que cambian de lugar', () => {
    expect(positionWrites(rows, ['a', 'c', 'b'])).toEqual([
      { id: 'c', position: 1 },
      { id: 'b', position: 2 },
    ])
    expect(positionWrites(rows, ['a', 'b', 'c'])).toEqual([])
  })

  it('empareja posiciones repetidas o con huecos', () => {
    const messy = [
      { id: 'a', position: 4 },
      { id: 'b', position: 4 },
      { id: 'c', position: 9 },
    ]
    expect(positionWrites(messy, ['a', 'b', 'c'])).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
    ])
  })

  it('saltea lo que ya no está, sin dejar hueco', () => {
    expect(positionWrites(rows, ['c', 'x', 'a', 'b'])).toEqual([
      { id: 'c', position: 0 },
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
    ])
  })
})

describe('sameOrder y orderIsCurrent', () => {
  it('mismo contenido, mismo orden', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false)
    expect(sameOrder([], [])).toBe(true)
  })

  it('si otra persona sumó, sacó o reordenó, la lista que se miraba ya no vale', () => {
    expect(orderIsCurrent(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true)
    expect(orderIsCurrent(['a', 'b', 'c', 'd'], ['a', 'b', 'c'])).toBe(false)
    expect(orderIsCurrent(['b', 'a', 'c'], ['a', 'b', 'c'])).toBe(false)
  })
})
