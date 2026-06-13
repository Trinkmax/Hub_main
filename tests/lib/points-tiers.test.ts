import { describe, expect, it } from 'vitest'
import { canRedeemReward, type LoyaltyTier, progressToNext, resolveTier } from '@/lib/points/tiers'

function tier(
  partial: Partial<LoyaltyTier> & { id: string; min_lifetime_points: number },
): LoyaltyTier {
  return {
    name: partial.id,
    color: null,
    badge_icon: null,
    sort: 0,
    benefit_cadence: 'none',
    benefit_reward_id: null,
    perks: null,
    active: true,
    ...partial,
  }
}

const bronce = tier({ id: 'bronce', min_lifetime_points: 0 })
const plata = tier({ id: 'plata', min_lifetime_points: 100 })
const oro = tier({ id: 'oro', min_lifetime_points: 500 })
const TIERS = [bronce, plata, oro]

describe('resolveTier', () => {
  it('sin niveles → null', () => {
    expect(resolveTier(1000, [])).toBeNull()
  })
  it('por debajo del primer umbral → null', () => {
    expect(resolveTier(50, [plata, oro])).toBeNull()
  })
  it('exactamente en el umbral → ese nivel', () => {
    expect(resolveTier(100, TIERS)?.id).toBe('plata')
  })
  it('entre dos umbrales → el inferior', () => {
    expect(resolveTier(300, TIERS)?.id).toBe('plata')
  })
  it('por encima del tope → el tope', () => {
    expect(resolveTier(9999, TIERS)?.id).toBe('oro')
  })
  it('ignora niveles inactivos', () => {
    expect(
      resolveTier(600, [
        bronce,
        plata,
        tier({ id: 'oro', min_lifetime_points: 500, active: false }),
      ])?.id,
    ).toBe('plata')
  })
  it('desempata por sort (mismo umbral)', () => {
    const a = tier({ id: 'a', min_lifetime_points: 100, sort: 1 })
    const b = tier({ id: 'b', min_lifetime_points: 100, sort: 5 })
    expect(resolveTier(150, [a, b])?.id).toBe('b')
  })
})

describe('progressToNext', () => {
  it('sin niveles', () => {
    expect(progressToNext(100, [])).toEqual({
      current: null,
      next: null,
      pointsToNext: null,
      pct: 0,
    })
  })
  it('antes del primer nivel', () => {
    const p = progressToNext(50, [plata, oro])
    expect(p.current).toBeNull()
    expect(p.next?.id).toBe('plata')
    expect(p.pointsToNext).toBe(50)
    expect(p.pct).toBe(50)
  })
  it('entre dos niveles', () => {
    const p = progressToNext(300, TIERS) // banda 100..500 → (300-100)/400 = 50%
    expect(p.current?.id).toBe('plata')
    expect(p.next?.id).toBe('oro')
    expect(p.pointsToNext).toBe(200)
    expect(p.pct).toBe(50)
  })
  it('en el nivel máximo', () => {
    const p = progressToNext(600, TIERS)
    expect(p.current?.id).toBe('oro')
    expect(p.next).toBeNull()
    expect(p.pointsToNext).toBeNull()
    expect(p.pct).toBe(100)
  })
})

describe('canRedeemReward', () => {
  it('sin gating → siempre true', () => {
    expect(canRedeemReward(0, { min_tier_id: null }, TIERS)).toBe(true)
  })
  it('alcanza el nivel requerido → true', () => {
    expect(canRedeemReward(500, { min_tier_id: 'oro' }, TIERS)).toBe(true)
  })
  it('por debajo del nivel requerido → false', () => {
    expect(canRedeemReward(499, { min_tier_id: 'oro' }, TIERS)).toBe(false)
  })
  it('nivel inexistente (borrado) → no bloquea', () => {
    expect(canRedeemReward(0, { min_tier_id: 'fantasma' }, TIERS)).toBe(true)
  })
})
