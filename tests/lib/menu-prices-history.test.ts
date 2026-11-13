// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  batchText,
  changeText,
  type HistoryBatch,
  type HistoryChange,
  type HistoryContext,
  type PriceChangeRow,
  priceArrow,
  shapeHistory,
  UNKNOWN_PERSON,
} from '@/lib/menu/prices/history'
import { NBSP } from '@/lib/money'

/**
 * El historial de precios como se lee: «12/11 23:40 · $ 12.500 → $ 13.900 · Juan», en la hora
 * del bar, y con los cambios hechos juntos plegados en un renglón.
 */

const CTX: HistoryContext = {
  itemNames: new Map([
    ['bacon', 'Bacon'],
    ['cafe', 'Café'],
  ]),
  branchNames: new Map([['cerro', 'Cerro']]),
  teamNames: new Map([['u-juan', 'Juan']]),
  selfId: 'u-yo',
  timezone: 'America/Argentina/Cordoba',
  // 13/11/2026 10:00 en Córdoba (UTC−3).
  now: new Date('2026-11-13T13:00:00Z'),
}

let serial = 0
const row = (over: Partial<PriceChangeRow> = {}): PriceChangeRow => {
  serial += 1
  return {
    id: `c${String(serial).padStart(4, '0')}`,
    itemId: 'bacon',
    branchId: null,
    oldCents: 1_250_000,
    newCents: 1_390_000,
    batchId: null,
    changedBy: 'u-juan',
    // 12/11/2026 23:40 en Córdoba.
    createdAt: '2026-11-13T02:40:00Z',
    ...over,
  }
}

const shape = (rows: PriceChangeRow[], collapse = false, limit = 50) =>
  shapeHistory(rows, CTX, { collapse, limit })

/** «$ 12.500 → $ 13.900», con los espacios duros que lleva en pantalla. */
const ARROW = (from: string, to: string) => `$${NBSP}${from}${NBSP}→${NBSP}$${NBSP}${to}`

describe('un cambio', () => {
  it('se lee con la fecha en la hora del bar, de cuánto a cuánto y quién', () => {
    const [entry] = shape([row()])
    expect(entry).toMatchObject({
      kind: 'change',
      itemName: 'Bacon',
      when: '12/11 23:40',
      time: '23:40',
      day: '2026-11-12',
      dayLabel: 'Ayer',
      who: 'Juan',
      branchName: null,
      what: 'menu',
    })
    expect(changeText(entry as HistoryChange)).toBe(ARROW('12.500', '13.900'))
  })

  it('los dos precios van unidos con espacios duros: no se parten en dos renglones', () => {
    expect(priceArrow(1_650_000, 1_690_000)).toBe(ARROW('16.500', '16.900'))
    expect(priceArrow(1_650_000, 1_690_000)).not.toContain(' ')
  })

  it('dice «Hoy», «Ayer» o el día de la semana', () => {
    const labels = shape([
      row({ createdAt: '2026-11-13T12:00:00Z' }),
      row({ createdAt: '2026-11-13T02:59:00Z' }),
      row({ createdAt: '2026-11-10T15:00:00Z' }),
    ]).map((entry) => entry.dayLabel)
    expect(labels).toEqual(['Hoy', 'Ayer', 'Martes 10/11'])
  })

  it('de otro año lleva el año', () => {
    const [entry] = shape([row({ createdAt: '2025-12-30T15:00:00Z' })])
    expect(entry).toMatchObject({ when: '30/12/25 12:00', dayLabel: 'Martes 30/12/25' })
  })

  it('sin nombre cargado dice «alguien del equipo»; si fuiste vos, «vos»', () => {
    const who = shape([
      row({ changedBy: 'u-otro', createdAt: '2026-11-13T12:00:00Z' }),
      row({ changedBy: 'u-yo', createdAt: '2026-11-13T11:00:00Z' }),
      row({ changedBy: null, createdAt: '2026-11-13T10:00:00Z' }),
    ]).map((entry) => entry.who)
    expect(who).toEqual([UNKNOWN_PERSON, 'vos', UNKNOWN_PERSON])
  })

  it('distingue lo que pasó con el precio propio de una sucursal', () => {
    const entries = shape([
      row({
        branchId: 'cerro',
        oldCents: null,
        newCents: 1_400_000,
        createdAt: '2026-11-13T12:03:00Z',
      }),
      row({
        branchId: 'cerro',
        oldCents: 1_400_000,
        newCents: 1_500_000,
        createdAt: '2026-11-13T12:02:00Z',
      }),
      row({
        branchId: 'cerro',
        oldCents: 1_500_000,
        newCents: null,
        createdAt: '2026-11-13T12:01:00Z',
      }),
    ]) as HistoryChange[]
    expect(entries.map((entry) => entry.what)).toEqual(['own-set', 'own-changed', 'own-cleared'])
    expect(entries.every((entry) => entry.branchName === 'Cerro')).toBe(true)
    expect(entries.map(changeText)).toEqual([
      `Precio propio: $${NBSP}14.000`,
      ARROW('14.000', '15.000'),
      `Volvió al precio de la carta (tenía $${NBSP}15.000)`,
    ])
  })

  it('un producto o una sucursal que ya no están no rompen el renglón', () => {
    const [entry] = shape([row({ itemId: 'borrado', branchId: 'cerrada' })])
    expect(entry).toMatchObject({
      itemName: 'Un producto que ya no está',
      branchName: 'una sucursal que ya no está',
    })
  })

  it('ordena de lo más nuevo a lo más viejo aunque lleguen mezclados', () => {
    const entries = shape([
      row({ createdAt: '2026-11-10T15:00:00Z', newCents: 1 }),
      row({ createdAt: '2026-11-12T15:00:00Z', newCents: 3 }),
      row({ createdAt: '2026-11-11T15:00:00Z', newCents: 2 }),
    ]) as HistoryChange[]
    expect(entries.map((entry) => entry.toCents)).toEqual([3, 2, 1])
  })
})

describe('los cambios hechos juntos', () => {
  /** Un aumento: `count` productos cambiados por la misma persona en menos de un segundo. */
  const bulk = (count: number, over: Partial<PriceChangeRow> = {}) =>
    Array.from({ length: count }, (_, index) =>
      row({
        itemId: `p${index}`,
        oldCents: (index + 1) * 100_000,
        newCents: (index + 1) * 110_000,
        createdAt: `2026-11-13T12:00:00.${String(index * 10).padStart(3, '0')}Z`,
        ...over,
      }),
    )

  it('se pliegan en un renglón que dice cuántos y cerca de cuánto', () => {
    const entries = shape(bulk(6), true)
    expect(entries).toHaveLength(1)
    const batch = entries[0] as HistoryBatch
    expect(batch).toMatchObject({
      kind: 'batch',
      count: 6,
      direction: 'up',
      aboutPercent: `10${NBSP}%`,
      who: 'Juan',
      dayLabel: 'Hoy',
      branchName: null,
    })
    expect(batch.changes).toHaveLength(6)
    expect(batchText(batch)).toBe(`Subieron 6 productos, cerca de un 10${NBSP}%`)
  })

  it('pocos cambios seguidos no son una tanda: se leen uno por uno', () => {
    const entries = shape(bulk(3), true)
    expect(entries.map((entry) => entry.kind)).toEqual(['change', 'change', 'change'])
  })

  it('sin plegar (el historial de UN producto) siempre van uno por uno', () => {
    expect(shape(bulk(6), false)).toHaveLength(6)
  })

  it('cambios de dos personas, o separados en el tiempo, no se mezclan', () => {
    const mixed = [
      ...bulk(5),
      ...bulk(5, { changedBy: 'u-otro' }),
      row({ itemId: 'cafe', createdAt: '2026-11-13T11:00:00Z' }),
    ]
    const entries = shape(mixed, true)
    expect(entries.map((entry) => entry.kind).sort()).toEqual(['batch', 'batch', 'change'])
  })

  it('si la base anotó la tanda, manda eso aunque pasen unos segundos entre filas', () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      row({
        itemId: `p${index}`,
        batchId: 'tanda-a',
        createdAt: `2026-11-13T12:00:${String(index * 5).padStart(2, '0')}Z`,
      }),
    )
    expect(shape(rows, true)).toHaveLength(1)
    // Y dos tandas distintas en el mismo segundo no se juntan.
    const two = [
      ...Array.from({ length: 4 }, (_, index) => row({ itemId: `a${index}`, batchId: 'a' })),
      ...Array.from({ length: 4 }, (_, index) => row({ itemId: `b${index}`, batchId: 'b' })),
    ]
    expect(shape(two, true)).toHaveLength(2)
  })

  it('una baja se dice baja; si no se movieron parecido, no inventa un porcentaje', () => {
    const down = shape(
      bulk(5).map((entry) => ({ ...entry, newCents: (entry.oldCents ?? 0) * 0.8 })),
      true,
    )
    expect(batchText(down[0] as HistoryBatch)).toBe(`Bajaron 5 productos, cerca de un 20${NBSP}%`)

    const uneven = bulk(5).map((entry, index) => ({
      ...entry,
      newCents: Math.round((entry.oldCents ?? 0) * (1 + (index + 1) * 0.1)),
    }))
    expect(batchText(shape(uneven, true)[0] as HistoryBatch)).toBe('Subieron 5 productos')

    const mixed = bulk(4).map((entry, index) => ({
      ...entry,
      newCents: (entry.oldCents ?? 0) + (index % 2 === 0 ? 100 : -100),
    }))
    expect(batchText(shape(mixed, true)[0] as HistoryBatch)).toBe('Cambiaron 4 productos')
  })

  it('una tanda entera de una sucursal dice de cuál', () => {
    const [batch] = shape(bulk(4, { branchId: 'cerro' }), true)
    expect(batch).toMatchObject({ kind: 'batch', branchName: 'Cerro' })
  })

  it('el tope cuenta renglones, no filas: una tanda grande no tapa lo demás', () => {
    const rows = [
      ...bulk(40),
      row({ itemId: 'cafe', createdAt: '2026-11-12T15:00:00Z' }),
      row({ itemId: 'bacon', createdAt: '2026-11-11T15:00:00Z' }),
    ]
    const entries = shape(rows, true, 2)
    expect(entries.map((entry) => entry.kind)).toEqual(['batch', 'change'])
  })
})
