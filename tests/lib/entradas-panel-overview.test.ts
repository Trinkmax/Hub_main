import { describe, expect, it } from 'vitest'
import {
  carteleraSummary,
  carteleraSummaryParts,
  latestPrices,
  occupancyPercent,
  seatsText,
} from '@/app/(manager)/[tenantSlug]/entradas/_lib/overview'
import type { FunctionState } from '@/lib/ticketing/types'

const fn = (state: FunctionState) => ({ state })

describe('carteleraSummary', () => {
  it('cuenta solo las funciones de las películas publicadas', () => {
    const summary = carteleraSummary([
      { published: true, functions: [fn('available'), fn('last'), fn('sold_out')] },
      { published: true, functions: [fn('sold_out')] },
      { published: false, functions: [fn('available'), fn('available')] },
    ])
    expect(summary).toEqual({ published: 2, drafts: 1, onSale: 2, soldOut: 2 })
  })

  it('sin películas: todo en cero', () => {
    expect(carteleraSummary([])).toEqual({ published: 0, drafts: 0, onSale: 0, soldOut: 0 })
  })
})

describe('carteleraSummaryParts', () => {
  const text = (parts: ReturnType<typeof carteleraSummaryParts>) =>
    parts.map((p) => `${p.value} ${p.label}`).join(' · ')

  it('«N películas publicadas · M funciones a la venta · K agotadas»', () => {
    expect(text(carteleraSummaryParts({ published: 2, drafts: 0, onSale: 5, soldOut: 3 }))).toBe(
      '2 películas publicadas · 5 funciones a la venta · 3 agotadas',
    )
  })

  it('en singular, y sin «agotadas» si no hay ninguna', () => {
    expect(text(carteleraSummaryParts({ published: 1, drafts: 2, onSale: 1, soldOut: 0 }))).toBe(
      '1 película publicada · 1 función a la venta',
    )
    expect(text(carteleraSummaryParts({ published: 1, drafts: 0, onSale: 0, soldOut: 1 }))).toBe(
      '1 película publicada · Ninguna función a la venta · 1 agotada',
    )
  })

  it('nada publicado: una sola frase', () => {
    expect(text(carteleraSummaryParts({ published: 0, drafts: 3, onSale: 0, soldOut: 0 }))).toBe(
      'Ninguna película publicada',
    )
  })
})

describe('latestPrices', () => {
  it('los de la última película que se tocó, en pesos', () => {
    expect(
      latestPrices([
        { updatedAt: '2026-10-20T10:00:00Z', priceCents: 3_000_000, depositCents: 400_000 },
        { updatedAt: '2026-10-25T10:00:00Z', priceCents: 3_500_000, depositCents: 500_000 },
        { updatedAt: '2026-10-22T10:00:00Z', priceCents: 2_000_000, depositCents: 0 },
      ]),
    ).toEqual({ price: 35000, deposit: 5000 })
  })

  it('sin películas: null (el diálogo muestra ejemplos, no valores)', () => {
    expect(latestPrices([])).toBeNull()
  })
})

describe('occupancyPercent', () => {
  it('lo vendido sobre el cupo', () => {
    expect(occupancyPercent({ left: 10, capacity: 40 })).toBe(75)
    expect(occupancyPercent({ left: 40, capacity: 40 })).toBe(0)
    expect(occupancyPercent({ left: 0, capacity: 40 })).toBe(100)
  })

  it('valores raros no se salen de la barra', () => {
    expect(occupancyPercent({ left: -3, capacity: 40 })).toBe(100)
    expect(occupancyPercent({ left: 50, capacity: 40 })).toBe(0)
    expect(occupancyPercent({ left: 0, capacity: 0 })).toBe(100)
  })
})

describe('seatsText', () => {
  it('con lugar de sobra dice cuántos quedan; si no, lo mismo que la cartelera', () => {
    expect(seatsText({ left: 32, capacity: 40, state: 'available' })).toBe('Quedan 32 de 40')
    expect(seatsText({ left: 4, capacity: 40, state: 'last' })).toBe('Últimos 4')
    expect(seatsText({ left: 1, capacity: 40, state: 'last' })).toBe('Último lugar')
    expect(seatsText({ left: 0, capacity: 40, state: 'sold_out' })).toBe('Agotado')
  })
})
