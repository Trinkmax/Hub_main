import { describe, expect, it } from 'vitest'
import {
  computeCategoryPoints,
  computeExpiry,
  type EarnTx,
  wouldDropTier,
} from '@/lib/points/category'
import type { LoyaltyTier } from '@/lib/points/tiers'

// "Ahora" fijo para toda la suite. Ventana estándar del rediseño: 4 meses.
const NOW = new Date('2026-07-01T12:00:00Z')
const WINDOW = 4
// Derivados (verificados con date-fns):
//   cutoff  = 2026-03-01T12:00:00Z   (subMonths(NOW, 4))
//   soonEnd = 2026-03-31T12:00:00Z   (addDays(cutoff, 30))

function tier(
  partial: Partial<LoyaltyTier> & { id: string; min_category_points: number },
): LoyaltyTier {
  return {
    name: partial.id,
    color: null,
    badge_icon: null,
    sort: 0,
    perks: null,
    active: true,
    ...partial,
  }
}

const bronce = tier({ id: 'bronce', min_category_points: 0 })
const plata = tier({ id: 'plata', min_category_points: 100 })
const oro = tier({ id: 'oro', min_category_points: 500 })
const TIERS = [bronce, plata, oro]

describe('computeCategoryPoints', () => {
  it('sin transacciones → 0', () => {
    expect(computeCategoryPoints([], NOW, WINDOW)).toBe(0)
  })

  it('suma los positivos dentro de la ventana, excluye los de afuera', () => {
    const txs: EarnTx[] = [
      { delta: 50, created_at: '2026-06-01T12:00:00Z' }, // dentro
      { delta: 30, created_at: '2026-03-01T12:00:00Z' }, // exactamente en cutoff → dentro
      { delta: 100, created_at: '2026-02-01T12:00:00Z' }, // antes del cutoff → fuera
    ]
    expect(computeCategoryPoints(txs, NOW, WINDOW)).toBe(80)
  })

  it('ignora deltas <= 0 (gastos y ceros)', () => {
    const txs: EarnTx[] = [
      { delta: 40, created_at: '2026-06-10T12:00:00Z' },
      { delta: -25, created_at: '2026-06-11T12:00:00Z' }, // canje → ignorado
      { delta: 0, created_at: '2026-06-12T12:00:00Z' }, // cero → ignorado
    ]
    expect(computeCategoryPoints(txs, NOW, WINDOW)).toBe(40)
  })

  it('el borde del cutoff es inclusivo; un instante antes queda afuera', () => {
    const txs: EarnTx[] = [
      { delta: 10, created_at: '2026-03-01T12:00:00Z' }, // == cutoff → dentro
      { delta: 10, created_at: '2026-03-01T11:59:59Z' }, // < cutoff → fuera
    ]
    expect(computeCategoryPoints(txs, NOW, WINDOW)).toBe(10)
  })

  it('una ventana más larga incluye transacciones más viejas', () => {
    const txs: EarnTx[] = [
      { delta: 50, created_at: '2026-06-01T12:00:00Z' },
      { delta: 30, created_at: '2026-03-01T12:00:00Z' },
      { delta: 100, created_at: '2026-02-01T12:00:00Z' }, // dentro con ventana de 6 meses
    ]
    // cutoff con ventana 6 = 2026-01-01T12:00:00Z
    expect(computeCategoryPoints(txs, NOW, 6)).toBe(180)
  })
})

describe('computeExpiry', () => {
  it('sin transacciones → null', () => {
    expect(computeExpiry([], NOW, WINDOW)).toBeNull()
  })

  it('devuelve los puntos y la fecha del lote que vence en <= 30 días', () => {
    const txs: EarnTx[] = [
      { delta: 40, created_at: '2026-03-05T12:00:00Z' }, // vence pronto (lote más viejo)
      { delta: 25, created_at: '2026-03-20T12:00:00Z' }, // vence pronto
      { delta: 50, created_at: '2026-06-01T12:00:00Z' }, // en ventana pero NO vence pronto
      { delta: 100, created_at: '2026-02-01T12:00:00Z' }, // ya fuera de ventana
      { delta: -10, created_at: '2026-03-10T12:00:00Z' }, // canje → ignorado
    ]
    const exp = computeExpiry(txs, NOW, WINDOW)
    expect(exp).not.toBeNull()
    expect(exp?.points).toBe(65)
    // expiresAt = created_at del lote más viejo + ventana = 2026-03-05 + 4m
    expect(exp?.expiresAt.getTime()).toBe(new Date('2026-07-05T12:00:00Z').getTime())
  })

  it('null si no hay nada por vencer en la ventana próxima', () => {
    const txs: EarnTx[] = [
      { delta: 50, created_at: '2026-06-01T12:00:00Z' }, // en ventana pero después de soonEnd
    ]
    expect(computeExpiry(txs, NOW, WINDOW)).toBeNull()
  })

  it('el borde soonEnd es exclusivo (no cuenta lo que vence justo después)', () => {
    const txs: EarnTx[] = [
      { delta: 15, created_at: '2026-03-31T12:00:00Z' }, // == soonEnd → excluido
    ]
    expect(computeExpiry(txs, NOW, WINDOW)).toBeNull()
  })

  it('ignora deltas <= 0 en la ventana de vencimiento', () => {
    const txs: EarnTx[] = [
      { delta: -30, created_at: '2026-03-10T12:00:00Z' },
      { delta: 0, created_at: '2026-03-12T12:00:00Z' },
    ]
    expect(computeExpiry(txs, NOW, WINDOW)).toBeNull()
  })
})

describe('wouldDropTier', () => {
  it('drops=true si al restar los que vencen baja de banda', () => {
    // Oro (550) que pierde 100 → 450 → Plata.
    const r = wouldDropTier(550, 100, TIERS)
    expect(r.drops).toBe(true)
    expect(r.toTierName).toBe('plata')
  })

  it('drops=false si sigue en la misma banda', () => {
    // Oro (550) que pierde 10 → 540 → sigue Oro.
    const r = wouldDropTier(550, 10, TIERS)
    expect(r.drops).toBe(false)
    expect(r.toTierName).toBe('oro')
  })

  it('clampea a 0 cuando vencen más puntos que los que tiene', () => {
    // Plata (120) que pierde 200 → max(0, -80) = 0 → Bronce.
    const r = wouldDropTier(120, 200, TIERS)
    expect(r.drops).toBe(true)
    expect(r.toTierName).toBe('bronce')
  })

  it('sin nivel actual (por debajo del primer umbral) no puede bajar', () => {
    // Tiers cuyo umbral mínimo es 100: con 50 puntos no hay nivel.
    const r = wouldDropTier(50, 20, [plata, oro])
    expect(r.drops).toBe(false)
    expect(r.toTierName).toBeNull()
  })
})
