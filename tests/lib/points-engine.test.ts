import { describe, expect, it } from 'vitest'
import { calculatePoints, validateRedeem } from '@/lib/points/engine'
import type { PointsRule, VisitForEngine } from '@/lib/points/types'

const item = (over: Partial<VisitForEngine['items'][number]> = {}) => ({
  menu_item_id: 'item-1',
  category_id: 'cat-1',
  quantity: 1,
  unit_price_cents: 50000,
  line_total_cents: 50000,
  points_override: null,
  ...over,
})

const rule = (over: Partial<PointsRule>): PointsRule => ({
  id: 'r1',
  type: 'per_amount',
  config: { every_cents: 100000, points: 10 },
  priority: 0,
  active: true,
  ...over,
})

describe('calculatePoints — sin reglas', () => {
  it('total 0, sin reglas → 0', () => {
    const r = calculatePoints({ total_amount_cents: 0, items: [] }, [])
    expect(r.delta).toBe(0)
    expect(r.breakdown).toEqual([])
  })

  it('total positivo sin reglas → 0', () => {
    const r = calculatePoints({ total_amount_cents: 50000, items: [item()] }, [])
    expect(r.delta).toBe(0)
  })
})

describe('calculatePoints — per_amount', () => {
  it('monto exacto a 1× umbral → 10 pts', () => {
    const r = calculatePoints({ total_amount_cents: 100000, items: [item()] }, [
      rule({ config: { every_cents: 100000, points: 10 } }),
    ])
    expect(r.delta).toBe(10)
    expect(r.breakdown).toHaveLength(1)
    expect(r.breakdown[0]?.source).toBe('per_amount')
  })

  it('monto sub-umbral → 0 (sin entry)', () => {
    const r = calculatePoints({ total_amount_cents: 50000, items: [item()] }, [
      rule({ config: { every_cents: 100000, points: 10 } }),
    ])
    expect(r.delta).toBe(0)
    expect(r.breakdown).toEqual([])
  })

  it('2.5× umbral redondea hacia abajo', () => {
    const r = calculatePoints({ total_amount_cents: 250000, items: [item()] }, [
      rule({ config: { every_cents: 100000, points: 10 } }),
    ])
    expect(r.delta).toBe(20)
  })

  it('every_cents = 0 saltea regla (no divide por cero)', () => {
    const r = calculatePoints({ total_amount_cents: 100000, items: [item()] }, [
      rule({ config: { every_cents: 0, points: 10 } }),
    ])
    expect(r.delta).toBe(0)
    expect(r.breakdown).toEqual([])
  })

  it('every_cents negativo saltea regla', () => {
    const r = calculatePoints({ total_amount_cents: 100000, items: [item()] }, [
      rule({ config: { every_cents: -1, points: 10 } }),
    ])
    expect(r.delta).toBe(0)
  })

  it('dos per_amount activas suman', () => {
    const r = calculatePoints({ total_amount_cents: 500000, items: [item()] }, [
      rule({ id: 'a', config: { every_cents: 100000, points: 10 } }),
      rule({ id: 'b', config: { every_cents: 500000, points: 50 } }),
    ])
    expect(r.delta).toBe(50 + 50) // 5×10 + 1×50
    expect(r.breakdown).toHaveLength(2)
  })
})

describe('calculatePoints — per_item por id', () => {
  it('item presente suma puntos × cantidad', () => {
    const r = calculatePoints(
      {
        total_amount_cents: 50000,
        items: [item({ menu_item_id: 'aged-rum', quantity: 3 })],
      },
      [
        rule({
          type: 'per_item',
          config: { item_id: 'aged-rum', points: 7 },
        }),
      ],
    )
    expect(r.delta).toBe(21)
    expect(r.breakdown[0]?.source).toBe('per_item_id')
  })

  it('item ausente → no entry', () => {
    const r = calculatePoints(
      { total_amount_cents: 50000, items: [item({ menu_item_id: 'ipa' })] },
      [
        rule({
          type: 'per_item',
          config: { item_id: 'aged-rum', points: 7 },
        }),
      ],
    )
    expect(r.delta).toBe(0)
    expect(r.breakdown).toEqual([])
  })

  it('múltiples ítems con mismo id se consolidan', () => {
    const r = calculatePoints(
      {
        total_amount_cents: 100000,
        items: [
          item({ menu_item_id: 'ipa', quantity: 2 }),
          item({ menu_item_id: 'ipa', quantity: 1 }),
        ],
      },
      [rule({ type: 'per_item', config: { item_id: 'ipa', points: 5 } })],
    )
    expect(r.delta).toBe(15) // (2+1) × 5
  })
})

describe('calculatePoints — per_item por categoría', () => {
  it('todos los ítems de la cat suman', () => {
    const r = calculatePoints(
      {
        total_amount_cents: 100000,
        items: [
          item({ menu_item_id: 'a', category_id: 'tragos', quantity: 2 }),
          item({ menu_item_id: 'b', category_id: 'tragos', quantity: 1 }),
          item({ menu_item_id: 'c', category_id: 'comida', quantity: 5 }),
        ],
      },
      [
        rule({
          type: 'per_item',
          config: { category_id: 'tragos', points: 3 },
        }),
      ],
    )
    expect(r.delta).toBe(9) // (2+1) × 3, comida no aplica
    expect(r.breakdown[0]?.source).toBe('per_item_category')
  })
})

describe('calculatePoints — item overrides', () => {
  it('override sin reglas suma sólo override', () => {
    const r = calculatePoints(
      {
        total_amount_cents: 50000,
        items: [item({ points_override: 20, quantity: 2 })],
      },
      [],
    )
    expect(r.delta).toBe(40)
    expect(r.breakdown[0]?.source).toBe('item_override')
    expect(r.breakdown[0]?.rule_id).toBeNull()
  })

  it('override = 0 no genera entry', () => {
    const r = calculatePoints(
      {
        total_amount_cents: 50000,
        items: [item({ points_override: 0, quantity: 5 })],
      },
      [],
    )
    expect(r.delta).toBe(0)
    expect(r.breakdown).toEqual([])
  })

  it('override + per_amount se aditivan', () => {
    const r = calculatePoints(
      {
        total_amount_cents: 100000,
        items: [item({ points_override: 5, quantity: 2 })],
      },
      [rule({ config: { every_cents: 100000, points: 10 } })],
    )
    expect(r.delta).toBe(20) // 10 + (2×5)
    expect(r.breakdown).toHaveLength(2)
  })

  it('override negativo descuenta del agregado pero delta no baja de 0', () => {
    const r = calculatePoints(
      {
        total_amount_cents: 100000,
        items: [item({ points_override: -100 })],
      },
      [rule({ config: { every_cents: 100000, points: 10 } })],
    )
    expect(r.delta).toBe(0) // 10 + (-100) = -90 → max(0, -90)
  })
})

describe('calculatePoints — reglas inactivas', () => {
  it('regla inactiva no aparece', () => {
    const r = calculatePoints({ total_amount_cents: 100000, items: [item()] }, [
      rule({ active: false, config: { every_cents: 100000, points: 10 } }),
    ])
    expect(r.delta).toBe(0)
    expect(r.breakdown).toEqual([])
  })
})

describe('calculatePoints — config inválida', () => {
  it('per_amount sin points o sin every_cents se saltea', () => {
    const r = calculatePoints({ total_amount_cents: 100000, items: [item()] }, [
      // @ts-expect-error config malformada deliberada
      rule({ config: { every_cents: 100000 } }),
      // @ts-expect-error config malformada deliberada
      rule({ id: 'r2', config: { points: 10 } }),
    ])
    expect(r.delta).toBe(0)
  })

  it('per_item sin item_id ni category_id se saltea', () => {
    const r = calculatePoints({ total_amount_cents: 100000, items: [item()] }, [
      // @ts-expect-error config malformada deliberada
      rule({ type: 'per_item', config: { points: 10 } }),
    ])
    expect(r.delta).toBe(0)
  })
})

describe('calculatePoints — orden por priority', () => {
  it('priority desc, id asc determina el orden del breakdown', () => {
    const r = calculatePoints({ total_amount_cents: 100000, items: [item()] }, [
      rule({
        id: 'low',
        priority: 1,
        config: { every_cents: 100000, points: 1 },
      }),
      rule({
        id: 'high',
        priority: 10,
        config: { every_cents: 100000, points: 5 },
      }),
      rule({
        id: 'mid-a',
        priority: 5,
        config: { every_cents: 100000, points: 2 },
      }),
      rule({
        id: 'mid-b',
        priority: 5,
        config: { every_cents: 100000, points: 3 },
      }),
    ])
    expect(r.breakdown.map((b) => b.rule_id)).toEqual(['high', 'mid-a', 'mid-b', 'low'])
    expect(r.delta).toBe(5 + 2 + 3 + 1)
  })
})

describe('validateRedeem', () => {
  const reward = { cost_points: 100, active: true, stock: null as number | null }

  it('balance suficiente y reward ok → ok', () => {
    expect(validateRedeem({ balance: 100, reward }).ok).toBe(true)
    expect(validateRedeem({ balance: 200, reward }).ok).toBe(true)
  })

  it('balance insuficiente → insufficient_balance', () => {
    const r = validateRedeem({ balance: 99, reward })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('insufficient_balance')
  })

  it('reward inactiva → reward_inactive', () => {
    const r = validateRedeem({ balance: 100, reward: { ...reward, active: false } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('reward_inactive')
  })

  it('stock 0 → out_of_stock', () => {
    const r = validateRedeem({ balance: 100, reward: { ...reward, stock: 0 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('out_of_stock')
  })

  it('stock null (ilimitado) → ok', () => {
    expect(validateRedeem({ balance: 100, reward: { ...reward, stock: null } }).ok).toBe(true)
  })

  it('stock positivo → ok', () => {
    expect(validateRedeem({ balance: 100, reward: { ...reward, stock: 5 } }).ok).toBe(true)
  })

  it('inactiva tiene precedencia sobre balance bajo', () => {
    const r = validateRedeem({ balance: 0, reward: { ...reward, active: false } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('reward_inactive')
  })
})
