import { describe, expect, it } from 'vitest'
import {
  type CommissionInput,
  calculateCommission,
  pickRateTier,
  type RateTier,
} from '@/lib/commissions/calculate'

// Tarifas HUB (en cents):
//   desayuno/almuerzo/merienda: 14000/16000/18000/22000 por persona en tiers [1-7][8-15][16-30][31+]
//   cena: 9000/12000/13000/14000 en mismos tiers
//   bonus full event: 20000 por persona

const HUB_TIERS: RateTier[] = [
  // dinner
  { meal_type: 'dinner', min_guests: 1, max_guests: 7, rate_per_guest_cents: 9000, active: true },
  { meal_type: 'dinner', min_guests: 8, max_guests: 15, rate_per_guest_cents: 12000, active: true },
  {
    meal_type: 'dinner',
    min_guests: 16,
    max_guests: 30,
    rate_per_guest_cents: 13000,
    active: true,
  },
  {
    meal_type: 'dinner',
    min_guests: 31,
    max_guests: null,
    rate_per_guest_cents: 14000,
    active: true,
  },
  // lunch
  { meal_type: 'lunch', min_guests: 1, max_guests: 7, rate_per_guest_cents: 14000, active: true },
  { meal_type: 'lunch', min_guests: 8, max_guests: 15, rate_per_guest_cents: 16000, active: true },
  { meal_type: 'lunch', min_guests: 16, max_guests: 30, rate_per_guest_cents: 18000, active: true },
  {
    meal_type: 'lunch',
    min_guests: 31,
    max_guests: null,
    rate_per_guest_cents: 22000,
    active: true,
  },
  // breakfast
  {
    meal_type: 'breakfast',
    min_guests: 1,
    max_guests: 7,
    rate_per_guest_cents: 14000,
    active: true,
  },
  {
    meal_type: 'breakfast',
    min_guests: 8,
    max_guests: 15,
    rate_per_guest_cents: 16000,
    active: true,
  },
  {
    meal_type: 'breakfast',
    min_guests: 16,
    max_guests: 30,
    rate_per_guest_cents: 18000,
    active: true,
  },
  {
    meal_type: 'breakfast',
    min_guests: 31,
    max_guests: null,
    rate_per_guest_cents: 22000,
    active: true,
  },
  // tea_time
  {
    meal_type: 'tea_time',
    min_guests: 1,
    max_guests: 7,
    rate_per_guest_cents: 14000,
    active: true,
  },
  {
    meal_type: 'tea_time',
    min_guests: 8,
    max_guests: 15,
    rate_per_guest_cents: 16000,
    active: true,
  },
  {
    meal_type: 'tea_time',
    min_guests: 16,
    max_guests: 30,
    rate_per_guest_cents: 18000,
    active: true,
  },
  {
    meal_type: 'tea_time',
    min_guests: 31,
    max_guests: null,
    rate_per_guest_cents: 22000,
    active: true,
  },
]

const BONUS_FULL = 20000

const input = (over: Partial<CommissionInput>): CommissionInput => ({
  guests: 5,
  meal_type: 'dinner',
  primary: { id: 'luz', eligible: true },
  assistant: null,
  scheduledEvent: null,
  status: 'closed',
  ...over,
})

// ──────────────────────────────────────────────────────────
// pickRateTier
// ──────────────────────────────────────────────────────────

describe('pickRateTier — bordes de cada tier', () => {
  it('cena con 1 → tier 1-7 ($90)', () => {
    expect(pickRateTier(HUB_TIERS, 'dinner', 1)?.rate_per_guest_cents).toBe(9000)
  })
  it('cena con 7 → tier 1-7 ($90)', () => {
    expect(pickRateTier(HUB_TIERS, 'dinner', 7)?.rate_per_guest_cents).toBe(9000)
  })
  it('cena con 8 → tier 8-15 ($120)', () => {
    expect(pickRateTier(HUB_TIERS, 'dinner', 8)?.rate_per_guest_cents).toBe(12000)
  })
  it('cena con 15 → tier 8-15 ($120)', () => {
    expect(pickRateTier(HUB_TIERS, 'dinner', 15)?.rate_per_guest_cents).toBe(12000)
  })
  it('cena con 16 → tier 16-30 ($130)', () => {
    expect(pickRateTier(HUB_TIERS, 'dinner', 16)?.rate_per_guest_cents).toBe(13000)
  })
  it('cena con 30 → tier 16-30 ($130)', () => {
    expect(pickRateTier(HUB_TIERS, 'dinner', 30)?.rate_per_guest_cents).toBe(13000)
  })
  it('cena con 31 → tier 31+ ($140)', () => {
    expect(pickRateTier(HUB_TIERS, 'dinner', 31)?.rate_per_guest_cents).toBe(14000)
  })
  it('cena con 100 → tier 31+ ($140)', () => {
    expect(pickRateTier(HUB_TIERS, 'dinner', 100)?.rate_per_guest_cents).toBe(14000)
  })
  it('almuerzo con 30 → $180', () => {
    expect(pickRateTier(HUB_TIERS, 'lunch', 30)?.rate_per_guest_cents).toBe(18000)
  })
  it('desayuno con 31 → $220', () => {
    expect(pickRateTier(HUB_TIERS, 'breakfast', 31)?.rate_per_guest_cents).toBe(22000)
  })
  it('merienda con 7 → $140', () => {
    expect(pickRateTier(HUB_TIERS, 'tea_time', 7)?.rate_per_guest_cents).toBe(14000)
  })
  it('sin tarifa por meal_type → null', () => {
    expect(pickRateTier([], 'dinner', 5)).toBeNull()
  })
  it('inactive tier no se elige aunque matchee', () => {
    const onlyInactive: RateTier[] = [
      {
        meal_type: 'dinner',
        min_guests: 1,
        max_guests: 100,
        rate_per_guest_cents: 9000,
        active: false,
      },
    ]
    expect(pickRateTier(onlyInactive, 'dinner', 5)).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────
// calculateCommission — tarifa base sola
// ──────────────────────────────────────────────────────────

describe('calculateCommission — tarifa base', () => {
  it('cena 5 personas, solo Luz eligible → 1 entry de 5×9000 = 45000', () => {
    const r = calculateCommission(input({ guests: 5 }), HUB_TIERS, BONUS_FULL)
    expect(r).toHaveLength(1)
    expect(r[0]?.manager_id).toBe('luz')
    expect(r[0]?.base_total_cents).toBe(45000)
    expect(r[0]?.bonus_total_cents).toBe(0)
    expect(r[0]?.payable_cents).toBe(45000)
  })

  it('almuerzo 20 personas → 20×18000 = 360000', () => {
    const r = calculateCommission(input({ guests: 20, meal_type: 'lunch' }), HUB_TIERS, BONUS_FULL)
    expect(r[0]?.payable_cents).toBe(360000)
  })

  it('cena 31 personas → 31×14000 = 434000', () => {
    const r = calculateCommission(input({ guests: 31 }), HUB_TIERS, BONUS_FULL)
    expect(r[0]?.payable_cents).toBe(434000)
  })
})

// ──────────────────────────────────────────────────────────
// Split entre primario y asistente
// ──────────────────────────────────────────────────────────

describe('calculateCommission — split de gestores', () => {
  it('ambos eligibles → 50/50 (payable par)', () => {
    const r = calculateCommission(
      input({
        guests: 10,
        meal_type: 'dinner',
        primary: { id: 'luz', eligible: true },
        assistant: { id: 'joaquin', eligible: true },
      }),
      HUB_TIERS,
      BONUS_FULL,
    )
    // 10×12000 = 120000 → 60000 c/u
    expect(r).toHaveLength(2)
    expect(r[0]?.payable_cents).toBe(60000)
    expect(r[1]?.payable_cents).toBe(60000)
    expect(r.reduce((acc, e) => acc + e.payable_cents, 0)).toBe(120000)
  })

  it('ambos eligibles + payable impar → primario recibe el cent extra', () => {
    // Forzamos un payable impar: usamos un tier custom 1 cent.
    const oddTiers: RateTier[] = [
      {
        meal_type: 'dinner',
        min_guests: 1,
        max_guests: null,
        rate_per_guest_cents: 1,
        active: true,
      },
    ]
    const r = calculateCommission(
      input({
        guests: 3,
        primary: { id: 'a', eligible: true },
        assistant: { id: 'b', eligible: true },
      }),
      oddTiers,
      0,
    )
    // payable = 3 cents → primario 2, asistente 1.
    expect(r[0]?.manager_id).toBe('a')
    expect(r[0]?.payable_cents).toBe(2)
    expect(r[1]?.payable_cents).toBe(1)
    expect((r[0]?.payable_cents ?? 0) + (r[1]?.payable_cents ?? 0)).toBe(3)
  })

  it('solo asistente eligible → 100% al asistente', () => {
    const r = calculateCommission(
      input({
        guests: 5,
        primary: { id: 'piojo', eligible: false },
        assistant: { id: 'luz', eligible: true },
      }),
      HUB_TIERS,
      BONUS_FULL,
    )
    expect(r).toHaveLength(1)
    expect(r[0]?.manager_id).toBe('luz')
    expect(r[0]?.payable_cents).toBe(45000)
  })

  it('ninguno eligible → 0 entries', () => {
    const r = calculateCommission(
      input({
        guests: 5,
        primary: { id: 'piojo', eligible: false },
        assistant: { id: 'porte', eligible: false },
      }),
      HUB_TIERS,
      BONUS_FULL,
    )
    expect(r).toHaveLength(0)
  })

  it('asistente null → solo entry del primario', () => {
    const r = calculateCommission(input({ guests: 5, assistant: null }), HUB_TIERS, BONUS_FULL)
    expect(r).toHaveLength(1)
    expect(r[0]?.manager_id).toBe('luz')
  })
})

// ──────────────────────────────────────────────────────────
// Bonus por evento full
// ──────────────────────────────────────────────────────────

describe('calculateCommission — bonus por evento full', () => {
  it('evento al 99% → sin bonus', () => {
    const r = calculateCommission(
      input({
        guests: 5,
        scheduledEvent: { capacity: 40, total_used: 39, full_bonus_active: true },
      }),
      HUB_TIERS,
      BONUS_FULL,
    )
    expect(r[0]?.bonus_total_cents).toBe(0)
    expect(r[0]?.payable_cents).toBe(45000)
  })

  it('evento al 100% → bonus aplicado (5×20000 = 100000) + base', () => {
    const r = calculateCommission(
      input({
        guests: 5,
        scheduledEvent: { capacity: 40, total_used: 40, full_bonus_active: true },
      }),
      HUB_TIERS,
      BONUS_FULL,
    )
    expect(r[0]?.bonus_per_guest_cents).toBe(20000)
    expect(r[0]?.bonus_total_cents).toBe(100000)
    expect(r[0]?.payable_cents).toBe(145000)
  })

  it('evento al 105% (overbooking) → bonus igual', () => {
    const r = calculateCommission(
      input({
        guests: 5,
        scheduledEvent: { capacity: 40, total_used: 42, full_bonus_active: true },
      }),
      HUB_TIERS,
      BONUS_FULL,
    )
    expect(r[0]?.bonus_total_cents).toBe(100000)
  })

  it('full_bonus_active=false → sin bonus aunque esté lleno', () => {
    const r = calculateCommission(
      input({
        guests: 5,
        scheduledEvent: { capacity: 40, total_used: 40, full_bonus_active: false },
      }),
      HUB_TIERS,
      BONUS_FULL,
    )
    expect(r[0]?.bonus_total_cents).toBe(0)
  })

  it('bonus con split 50/50 — ej. 30 personas en sushi lleno', () => {
    // Caso real del cliente: Luz consigue 30 personas en sushi (capacity 30)
    // → cena 30 personas tier 16-30 = 13000 → base 390000
    // Bonus 30×20000 = 600000 → payable 990000 (con Luz sola)
    // Pero si va con asistente eligible: 495000 c/u.
    const r = calculateCommission(
      input({
        guests: 30,
        primary: { id: 'luz', eligible: true },
        assistant: { id: 'joaquin', eligible: true },
        scheduledEvent: { capacity: 30, total_used: 30, full_bonus_active: true },
      }),
      HUB_TIERS,
      BONUS_FULL,
    )
    expect(r[0]?.base_total_cents).toBe(390000)
    expect(r[0]?.bonus_total_cents).toBe(600000)
    expect(r[0]?.payable_cents).toBe(495000)
    expect(r[1]?.payable_cents).toBe(495000)
  })
})

// ──────────────────────────────────────────────────────────
// Edge cases
// ──────────────────────────────────────────────────────────

describe('calculateCommission — edge cases', () => {
  it('status cancelled → 0 entries', () => {
    const r = calculateCommission(input({ status: 'cancelled' }), HUB_TIERS, BONUS_FULL)
    expect(r).toHaveLength(0)
  })

  it('status no_show → 0 entries', () => {
    const r = calculateCommission(input({ status: 'no_show' }), HUB_TIERS, BONUS_FULL)
    expect(r).toHaveLength(0)
  })

  it('guests 0 → 0 entries', () => {
    const r = calculateCommission(input({ guests: 0 }), HUB_TIERS, BONUS_FULL)
    expect(r).toHaveLength(0)
  })

  it('sin tier matching → rate 0, payable 0 pero entry presente si primary eligible', () => {
    const r = calculateCommission(input({ guests: 5 }), [], BONUS_FULL)
    expect(r).toHaveLength(1)
    expect(r[0]?.payable_cents).toBe(0)
  })

  it('formato ARS — 45000 cents = $450', () => {
    // Verifica que formatARS no rompe y respeta locale.
    // (Se hace import lazy para no obligar al motor a tener Intl en todos los runtimes.)
    return import('@/lib/commissions/calculate').then(({ formatARS }) => {
      // 45000 cents = 450 pesos
      expect(formatARS(45000)).toContain('450')
    })
  })
})
