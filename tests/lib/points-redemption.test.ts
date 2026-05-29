import { describe, expect, it } from 'vitest'
import {
  computeRedemption,
  maxRedeemablePoints,
  type PointsRedemptionConfig,
} from '@/lib/points/redemption'

const baseConfig: PointsRedemptionConfig = {
  enabled: true,
  ratePointsToCents: 100, // 1 pt = $1
  maxPct: 50,
}

describe('computeRedemption', () => {
  it('disabled → reason disabled', () => {
    const r = computeRedemption({
      pointsToRedeem: 10,
      balance: 100,
      shareCents: 10000,
      config: { ...baseConfig, enabled: false },
    })
    expect(r).toEqual({ ok: false, reason: 'disabled' })
  })

  it('puntos inválidos → reason invalid', () => {
    expect(
      computeRedemption({
        pointsToRedeem: 0,
        balance: 100,
        shareCents: 10000,
        config: baseConfig,
      }),
    ).toEqual({ ok: false, reason: 'invalid' })
    expect(
      computeRedemption({
        pointsToRedeem: -5,
        balance: 100,
        shareCents: 10000,
        config: baseConfig,
      }),
    ).toEqual({ ok: false, reason: 'invalid' })
    expect(
      computeRedemption({
        pointsToRedeem: 2.5,
        balance: 100,
        shareCents: 10000,
        config: baseConfig,
      }),
    ).toEqual({ ok: false, reason: 'invalid' })
  })

  it('saldo insuficiente', () => {
    const r = computeRedemption({
      pointsToRedeem: 200,
      balance: 100,
      shareCents: 50000,
      config: baseConfig,
    })
    expect(r).toEqual({ ok: false, reason: 'insufficient_balance' })
  })

  it('redención exitosa dentro del cap', () => {
    // share 10000, cap 50% = 5000. Redime 30 pts = 3000. OK.
    const r = computeRedemption({
      pointsToRedeem: 30,
      balance: 100,
      shareCents: 10000,
      config: baseConfig,
    })
    expect(r).toEqual({
      ok: true,
      pointsUsed: 30,
      redeemCents: 3000,
      remainingShareCents: 7000,
    })
  })

  it('excede el cap por porcentaje', () => {
    // share 10000, cap 50% = 5000. Redime 60 pts = 6000 > cap.
    const r = computeRedemption({
      pointsToRedeem: 60,
      balance: 100,
      shareCents: 10000,
      config: baseConfig,
    })
    expect(r).toEqual({ ok: false, reason: 'exceeds_cap' })
  })

  it('cap exacto (redime exactamente el cap)', () => {
    // share 10000, cap 50% = 5000. Redime 50 pts = 5000. OK.
    const r = computeRedemption({
      pointsToRedeem: 50,
      balance: 100,
      shareCents: 10000,
      config: baseConfig,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.redeemCents).toBe(5000)
  })

  it('cap 100% → puede cubrir todo el share', () => {
    const r = computeRedemption({
      pointsToRedeem: 100,
      balance: 100,
      shareCents: 10000,
      config: { ...baseConfig, maxPct: 100 },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.remainingShareCents).toBe(0)
  })

  it('cap 0% → cualquier redención excede', () => {
    const r = computeRedemption({
      pointsToRedeem: 1,
      balance: 100,
      shareCents: 10000,
      config: { ...baseConfig, maxPct: 0 },
    })
    expect(r).toEqual({ ok: false, reason: 'exceeds_cap' })
  })

  it('tasa distinta (1 pt = $0.50)', () => {
    // rate 50, 100 pts = 5000 cents
    const r = computeRedemption({
      pointsToRedeem: 100,
      balance: 200,
      shareCents: 10000,
      config: { ...baseConfig, ratePointsToCents: 50 },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.redeemCents).toBe(5000)
  })

  it('share 0 → cualquier redención falla por exceeds_cap', () => {
    const r = computeRedemption({
      pointsToRedeem: 1,
      balance: 100,
      shareCents: 0,
      config: baseConfig,
    })
    expect(r).toEqual({ ok: false, reason: 'exceeds_cap' })
  })
})

describe('maxRedeemablePoints', () => {
  it('disabled → 0', () => {
    expect(maxRedeemablePoints(100, 10000, { ...baseConfig, enabled: false })).toBe(0)
  })

  it('share 0 → 0', () => {
    expect(maxRedeemablePoints(100, 0, baseConfig)).toBe(0)
  })

  it('cap 50% sobre share 10000 = 5000 cents = 50 pts (rate 100)', () => {
    expect(maxRedeemablePoints(100, 10000, baseConfig)).toBe(50)
  })

  it('balance es el límite cuando el cap es más alto', () => {
    expect(maxRedeemablePoints(30, 10000, baseConfig)).toBe(30)
  })

  it('cap 100% sobre share 10000 = todo el share = 100 pts', () => {
    expect(maxRedeemablePoints(150, 10000, { ...baseConfig, maxPct: 100 })).toBe(100)
  })

  it('truncamiento por rate alto (rate 250 → 1 pt = $2.50)', () => {
    // share 10000, cap 50% = 5000. Por rate, max pts = floor(5000/250) = 20.
    expect(maxRedeemablePoints(100, 10000, { ...baseConfig, ratePointsToCents: 250 })).toBe(20)
  })
})
