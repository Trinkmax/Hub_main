import { describe, expect, it } from 'vitest'
import { hasItemBonus, resolveEarnRate } from '@/lib/points/earn-rate'
import type { PointsRule } from '@/lib/points/types'

function rule(partial: Partial<PointsRule> & Pick<PointsRule, 'type' | 'config'>): PointsRule {
  return {
    id: partial.id ?? crypto.randomUUID(),
    priority: partial.priority ?? 100,
    active: partial.active ?? true,
    type: partial.type,
    config: partial.config,
  }
}

const perAmount = (every_cents: number, points: number, active = true) =>
  rule({ type: 'per_amount', config: { every_cents, points }, active })

describe('resolveEarnRate', () => {
  it('enuncia la tasa cuando hay una sola regla per_amount activa', () => {
    expect(resolveEarnRate([perAmount(100_000, 1)])).toEqual({ points: 1, everyCents: 100_000 })
  })

  it('ignora reglas inactivas', () => {
    const rules = [perAmount(5_000, 1, false), perAmount(100_000, 1, true)]
    expect(resolveEarnRate(rules)).toEqual({ points: 1, everyCents: 100_000 })
  })

  it('no enuncia nada si hay dos per_amount activas (el motor las ACUMULA)', () => {
    // engine.ts aplica todas las reglas activas → "1 pt cada $1.000" sería falso.
    expect(resolveEarnRate([perAmount(100_000, 1), perAmount(50_000, 1)])).toBeNull()
  })

  it('no enuncia nada si no hay reglas por monto', () => {
    expect(resolveEarnRate([])).toBeNull()
    expect(resolveEarnRate([rule({ type: 'per_item', config: { item_id: 'x', points: 5 } })])).toBe(
      null,
    )
  })

  it('descarta configs inválidas (cero o negativas) en vez de mostrar basura', () => {
    expect(resolveEarnRate([perAmount(0, 1)])).toBeNull()
    expect(resolveEarnRate([perAmount(100_000, 0)])).toBeNull()
    // Inválida + válida → queda una sola válida y se puede enunciar.
    expect(resolveEarnRate([perAmount(0, 1), perAmount(100_000, 1)])).toEqual({
      points: 1,
      everyCents: 100_000,
    })
  })
})

describe('hasItemBonus', () => {
  it('detecta reglas por producto activas', () => {
    expect(hasItemBonus([rule({ type: 'per_item', config: { item_id: 'x', points: 5 } })])).toBe(
      true,
    )
    expect(
      hasItemBonus([
        rule({ type: 'per_item', config: { item_id: 'x', points: 5 }, active: false }),
      ]),
    ).toBe(false)
    expect(hasItemBonus([perAmount(100_000, 1)])).toBe(false)
  })
})
