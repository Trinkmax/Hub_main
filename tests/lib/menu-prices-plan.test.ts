// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  type CurrentPrices,
  chunk,
  planPriceWrites,
  type RequestedChange,
  runLimited,
} from '@/lib/menu/prices/plan'
import { pointKey } from '@/lib/menu/prices/types'

/**
 * Qué escribe el servidor cuando le piden cambiar precios: compara lo pedido con lo que hay
 * AHORA en la base y no pisa lo que otra persona cambió en el medio.
 */

const current = (over: Partial<CurrentPrices> = {}): CurrentPrices => ({
  menu: new Map([
    ['bacon', 1_250_000],
    ['cheese', 1_250_000],
    ['cafe', 380_000],
  ]),
  own: new Map([[pointKey('cerro', 'bacon'), 1_400_000]]),
  ...over,
})

const change = (over: Partial<RequestedChange> & { itemId: string }): RequestedChange => ({
  branchId: null,
  priceCents: 0,
  expectedCents: 0,
  ...over,
})

describe('planPriceWrites: el precio de la carta', () => {
  it('escribe lo que sigue como la persona lo veía', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'bacon', priceCents: 1_390_000, expectedCents: 1_250_000 })],
      current(),
    )
    expect(plan).toEqual({
      menuWrites: [{ expectedCents: 1_250_000, priceCents: 1_390_000, itemIds: ['bacon'] }],
      branchWrites: [],
      failed: [],
    })
  })

  it('junta en una sola escritura los que van del mismo precio al mismo precio', () => {
    const plan = planPriceWrites(
      [
        change({ itemId: 'bacon', priceCents: 1_380_000, expectedCents: 1_250_000 }),
        change({ itemId: 'cafe', priceCents: 420_000, expectedCents: 380_000 }),
        change({ itemId: 'cheese', priceCents: 1_380_000, expectedCents: 1_250_000 }),
      ],
      current(),
    )
    expect(plan.menuWrites).toEqual([
      { expectedCents: 1_250_000, priceCents: 1_380_000, itemIds: ['bacon', 'cheese'] },
      { expectedCents: 380_000, priceCents: 420_000, itemIds: ['cafe'] },
    ])
  })

  it('no pisa un precio que otro cambió en el medio, y dice cuánto vale ahora', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'bacon', priceCents: 1_390_000, expectedCents: 1_200_000 })],
      current(),
    )
    expect(plan.menuWrites).toEqual([])
    expect(plan.failed).toEqual([
      { itemId: 'bacon', branchId: null, reason: 'changed', currentCents: 1_250_000 },
    ])
  })

  it('si ya vale lo pedido no escribe nada ni lo cuenta como error', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'bacon', priceCents: 1_250_000, expectedCents: 1_100_000 })],
      current(),
    )
    expect(plan).toEqual({ menuWrites: [], branchWrites: [], failed: [] })
  })

  it('un producto que no está (o es de otro bar) no se toca', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'de-otro-bar', priceCents: 100, expectedCents: 200 })],
      current(),
    )
    expect(plan.failed).toEqual([{ itemId: 'de-otro-bar', branchId: null, reason: 'missing' }])
    expect(plan.menuWrites).toEqual([])
  })

  it('el precio de la carta nunca se escribe vacío', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'bacon', priceCents: null, expectedCents: 1_250_000 })],
      current(),
    )
    expect(plan.menuWrites).toEqual([])
    expect(plan.failed).toEqual([{ itemId: 'bacon', branchId: null, reason: 'error' }])
  })
})

describe('planPriceWrites: el precio propio de una sucursal', () => {
  it('crea un precio propio donde no había', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'cafe', branchId: 'cerro', priceCents: 450_000, expectedCents: null })],
      current(),
    )
    expect(plan.branchWrites).toEqual([
      { branchId: 'cerro', itemId: 'cafe', priceCents: 450_000, fromCents: null },
    ])
  })

  it('cambia el que había y permite volver al precio de la carta', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'bacon', branchId: 'cerro', priceCents: null, expectedCents: 1_400_000 })],
      current(),
    )
    expect(plan.branchWrites).toEqual([
      { branchId: 'cerro', itemId: 'bacon', priceCents: null, fromCents: 1_400_000 },
    ])
  })

  it('no pisa un precio propio que otro cambió, ni uno que apareció en el medio', () => {
    const plan = planPriceWrites(
      [
        change({
          itemId: 'bacon',
          branchId: 'cerro',
          priceCents: 1_500_000,
          expectedCents: 1_300_000,
        }),
        change({ itemId: 'bacon', branchId: 'cerro', priceCents: 1_500_000, expectedCents: null }),
      ],
      current(),
    )
    expect(plan.branchWrites).toEqual([])
    expect(plan.failed).toEqual([
      { itemId: 'bacon', branchId: 'cerro', reason: 'changed', currentCents: 1_400_000 },
      { itemId: 'bacon', branchId: 'cerro', reason: 'changed', currentCents: 1_400_000 },
    ])
  })

  it('que la carta haya cambiado no frena un precio propio (son precios distintos)', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'cafe', branchId: 'cerro', priceCents: 450_000, expectedCents: null })],
      current({ menu: new Map([['cafe', 999_000]]) }),
    )
    expect(plan.branchWrites).toHaveLength(1)
    expect(plan.failed).toEqual([])
  })

  it('volver a la carta donde ya no hay precio propio no escribe nada', () => {
    const plan = planPriceWrites(
      [change({ itemId: 'cafe', branchId: 'cerro', priceCents: null, expectedCents: 450_000 })],
      current(),
    )
    expect(plan).toEqual({ menuWrites: [], branchWrites: [], failed: [] })
  })
})

describe('chunk y runLimited', () => {
  it('parte en tandas sin perder ni repetir', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })

  it('corre de a pocos y devuelve en el orden de entrada', async () => {
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
  })

  it('sin tareas no hace nada', async () => {
    expect(await runLimited([], 4, async () => 1)).toEqual([])
  })
})
