import { describe, expect, it } from 'vitest'
import type { LoyaltyTier } from '@/lib/points/tiers'
import { computeRewardState } from '@/lib/wallet/reward-state'

const oro: LoyaltyTier = {
  id: 'oro',
  name: 'Oro',
  color: null,
  badge_icon: null,
  min_category_points: 500,
  sort: 0,
  perks: null,
  active: true,
}

describe('computeRewardState', () => {
  it('sin gating + saldo suficiente + stock libre → canjeable', () => {
    const s = computeRewardState(
      { cost_points: 100, stock: null, min_tier_id: null },
      { pointsBalance: 100, categoryPoints: 100, tiers: [] },
    )
    expect(s).toEqual({ affordable: true, tierLocked: false, minTierName: null })
  })

  it('saldo insuficiente → no canjeable', () => {
    const s = computeRewardState(
      { cost_points: 200, stock: null, min_tier_id: null },
      { pointsBalance: 199, categoryPoints: 999, tiers: [] },
    )
    expect(s.affordable).toBe(false)
  })

  it('stock 0 → no canjeable aunque alcance el saldo', () => {
    const s = computeRewardState(
      { cost_points: 10, stock: 0, min_tier_id: null },
      { pointsBalance: 1000, categoryPoints: 1000, tiers: [] },
    )
    expect(s.affordable).toBe(false)
  })

  it('tier-locked: por debajo del nivel bloquea y expone el nombre', () => {
    const s = computeRewardState(
      { cost_points: 10, stock: null, min_tier_id: 'oro' },
      { pointsBalance: 1000, categoryPoints: 499, tiers: [oro] },
    )
    expect(s.tierLocked).toBe(true)
    expect(s.minTierName).toBe('Oro')
  })

  it('tier alcanzado → no bloquea', () => {
    const s = computeRewardState(
      { cost_points: 10, stock: null, min_tier_id: 'oro' },
      { pointsBalance: 1000, categoryPoints: 500, tiers: [oro] },
    )
    expect(s.tierLocked).toBe(false)
    expect(s.minTierName).toBe('Oro')
  })

  it('nivel inexistente (borrado) → no bloquea', () => {
    const s = computeRewardState(
      { cost_points: 10, stock: null, min_tier_id: 'fantasma' },
      { pointsBalance: 1000, categoryPoints: 0, tiers: [oro] },
    )
    expect(s.tierLocked).toBe(false)
    expect(s.minTierName).toBeNull()
  })
})
