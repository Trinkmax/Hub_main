// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  type CurrentRoutes,
  chunk,
  planPatch,
  planRouteWrites,
  type RequestedRoute,
  runLimited,
} from '@/lib/menu/kitchen/plan'
import {
  BARRA,
  CLASICA,
  COCINA,
  COMIDA,
  FRIOS,
  HAMBURGUESAS,
  id,
  MUZZA,
  PIZZA,
  WRAP,
} from './menu-kitchen-fixtures'

/**
 * Qué se escribe y qué no. La regla de oro: nunca se pisa lo que cambió otra persona después de
 * que esta pantalla lo leyera.
 */

const current: CurrentRoutes = {
  categories: new Map<string, string | null>([
    [COMIDA, COCINA],
    [HAMBURGUESAS, null],
    [PIZZA, null],
  ]),
  items: new Map<string, string | null>([
    [CLASICA, null],
    [WRAP, FRIOS],
    [MUZZA, null],
  ]),
  stations: new Set([COCINA, FRIOS, BARRA]),
}

const route = (over: Partial<RequestedRoute> & { id: string }): RequestedRoute => ({
  node: 'category',
  to: COCINA,
  expected: null,
  ...over,
})

describe('planRouteWrites', () => {
  it('escribe lo que sigue como la persona lo veía', () => {
    const plan = planRouteWrites([route({ id: PIZZA, to: FRIOS })], current)
    expect(plan).toEqual({
      writes: [{ node: 'category', expected: null, to: FRIOS, ids: [PIZZA] }],
      failed: [],
    })
  })

  it('junta en una sola escritura lo que va «de la misma a la misma»', () => {
    const plan = planRouteWrites(
      [
        route({ id: HAMBURGUESAS, to: BARRA }),
        route({ id: PIZZA, to: BARRA }),
        route({ node: 'item', id: CLASICA, to: BARRA }),
        route({ node: 'item', id: MUZZA, to: BARRA }),
        route({ node: 'item', id: WRAP, to: null, expected: FRIOS }),
      ],
      current,
    )
    expect(plan.failed).toEqual([])
    expect(plan.writes).toEqual([
      { node: 'category', expected: null, to: BARRA, ids: [HAMBURGUESAS, PIZZA] },
      { node: 'item', expected: null, to: BARRA, ids: [CLASICA, MUZZA] },
      { node: 'item', expected: FRIOS, to: null, ids: [WRAP] },
    ])
  })

  it('lo que ya está como se pidió no se escribe (aunque se lo viera distinto)', () => {
    const plan = planRouteWrites([route({ id: COMIDA, to: COCINA, expected: BARRA })], current)
    expect(plan).toEqual({ writes: [], failed: [] })
  })

  it('no pisa lo que cambió otra persona, y dice cómo quedó', () => {
    // La pantalla creía que Comida no tenía estación; alguien le puso Cocina.
    const plan = planRouteWrites([route({ id: COMIDA, to: BARRA, expected: null })], current)
    expect(plan.writes).toEqual([])
    expect(plan.failed).toEqual([
      { node: 'category', id: COMIDA, reason: 'changed', current: COCINA },
    ])
  })

  it('lo que ya no existe (o es de otro bar) no se toca', () => {
    const plan = planRouteWrites([route({ id: id('c', 99) })], current)
    expect(plan.failed).toEqual([{ node: 'category', id: id('c', 99), reason: 'missing' }])
  })

  it('una categoría no vale como producto ni al revés', () => {
    const plan = planRouteWrites([route({ node: 'item', id: PIZZA })], current)
    expect(plan.failed[0]?.reason).toBe('missing')
  })

  it('no manda nada a una estación que ya no existe', () => {
    const plan = planRouteWrites([route({ id: PIZZA, to: id('a', 99) })], current)
    expect(plan.failed).toEqual([{ node: 'category', id: PIZZA, reason: 'station_gone' }])
    expect(plan.writes).toEqual([])
  })

  it('sacar la marca no necesita que exista ninguna estación', () => {
    const plan = planRouteWrites([route({ node: 'item', id: WRAP, to: null, expected: FRIOS })], {
      ...current,
      stations: new Set(),
    })
    expect(plan.failed).toEqual([])
    expect(plan.writes).toHaveLength(1)
  })

  it('cada cosa se decide por separado', () => {
    const plan = planRouteWrites(
      [
        route({ id: PIZZA, to: FRIOS }),
        route({ id: COMIDA, to: BARRA, expected: FRIOS }),
        route({ id: id('c', 99) }),
      ],
      current,
    )
    expect(plan.writes).toHaveLength(1)
    expect(plan.failed.map((each) => each.reason)).toEqual(['changed', 'missing'])
  })
})

describe('planPatch', () => {
  const row = { name: 'Cocina', color: '#b45309', active: true }

  it('escribe lo que cambia, y pide que siga valiendo lo que se veía', () => {
    expect(planPatch(row, { name: { from: 'Cocina', to: 'Plancha' } })).toEqual({
      kind: 'write',
      set: { name: 'Plancha' },
      expect: { name: 'Cocina' },
    })
  })

  it('varios campos a la vez', () => {
    expect(
      planPatch(row, {
        name: { from: 'Cocina', to: 'Plancha' },
        active: { from: true, to: false },
      }),
    ).toEqual({
      kind: 'write',
      set: { name: 'Plancha', active: false },
      expect: { name: 'Cocina', active: true },
    })
  })

  it('si ya estaba así, no hay nada que escribir', () => {
    expect(planPatch(row, { name: { from: 'Otra', to: 'Cocina' } })).toEqual({ kind: 'noop' })
    expect(planPatch(row, {})).toEqual({ kind: 'noop' })
  })

  it('si otro cambió un campo, no se escribe ninguno', () => {
    expect(
      planPatch(row, {
        name: { from: 'Fuegos', to: 'Plancha' },
        active: { from: true, to: false },
      }),
    ).toEqual({ kind: 'changed', fields: ['name'] })
  })

  it('escribe solo lo que falta cuando una parte ya está', () => {
    expect(
      planPatch(row, {
        name: { from: 'Vieja', to: 'Cocina' },
        color: { from: '#b45309', to: '#0e7490' },
      }),
    ).toEqual({ kind: 'write', set: { color: '#0e7490' }, expect: { color: '#b45309' } })
  })
})

describe('chunk y runLimited', () => {
  it('parte en tandas', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })

  it('devuelve los resultados en el orden de entrada y no pasa del tope a la vez', async () => {
    let running = 0
    let peak = 0
    const results = await runLimited([30, 5, 20, 1, 10], 2, async (ms) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, ms))
      running -= 1
      return ms * 2
    })
    expect(results).toEqual([60, 10, 40, 2, 20])
    expect(peak).toBe(2)
    expect(await runLimited([], 3, async () => 1)).toEqual([])
  })
})
