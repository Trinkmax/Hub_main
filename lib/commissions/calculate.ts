/**
 * Motor TS de cálculo de comisiones.
 *
 * MANTENER EN PARIDAD con la RPC `public.recalc_reservation_commission`
 * en supabase/migrations/20260520020000_salon_reservations_rpcs.sql.
 *
 * Reglas (rioplatense):
 *   1) Si hay actual_guests cargado, se factura por ese número. Si no, por estimated_guests.
 *   2) Tarifa base: lookup en commission_rate_tiers por meal_type + rango de personas.
 *      Si no hay tier que matchee → rate = 0 (no se rompe, queda 0 a pagar).
 *   3) Bonus full event: si la reserva está atada a un scheduled_event con
 *      full_bonus_active=true Y total_used >= capacity → aplicar bonus_per_guest.
 *   4) Split:
 *        - ambos elegibles → 50/50. Si payable es impar, el primario se lleva el peso extra.
 *        - solo primario   → 100% primario.
 *        - solo asistente  → 100% asistente.
 *        - ninguno         → 0 entries.
 *
 * Aritmética entera (cents). Sin floats.
 */

import type { MealType } from '@/lib/salon/types'

export type RateTier = {
  meal_type: MealType
  min_guests: number
  max_guests: number | null
  rate_per_guest_cents: number
  active: boolean
}

export type CommissionInput = {
  guests: number
  meal_type: MealType
  primary: { id: string; eligible: boolean }
  assistant: { id: string; eligible: boolean } | null
  scheduledEvent: {
    capacity: number
    total_used: number
    full_bonus_active: boolean
  } | null
  status: 'pending' | 'arrived' | 'seated' | 'closed' | 'no_show' | 'cancelled'
}

export type CommissionEntry = {
  manager_id: string
  base_rate_per_guest_cents: number
  base_total_cents: number
  bonus_per_guest_cents: number
  bonus_total_cents: number
  split_numerator: number
  split_denominator: number
  payable_cents: number
}

export function pickRateTier(
  tiers: ReadonlyArray<RateTier>,
  meal: MealType,
  guests: number,
): RateTier | null {
  const candidates = tiers
    .filter(
      (t) =>
        t.active &&
        t.meal_type === meal &&
        guests >= t.min_guests &&
        (t.max_guests === null || guests <= t.max_guests),
    )
    .sort((a, b) => b.min_guests - a.min_guests) // el más estrecho gana
  return candidates[0] ?? null
}

export function calculateCommission(
  input: CommissionInput,
  tiers: ReadonlyArray<RateTier>,
  bonusFullPerGuestCents: number,
): CommissionEntry[] {
  // Status sin servicio efectivo → nada.
  if (input.status === 'cancelled' || input.status === 'no_show') return []
  if (input.guests <= 0) return []

  const tier = pickRateTier(tiers, input.meal_type, input.guests)
  const rate = tier?.rate_per_guest_cents ?? 0

  let bonusPerGuest = 0
  if (
    input.scheduledEvent?.full_bonus_active &&
    input.scheduledEvent.total_used >= input.scheduledEvent.capacity
  ) {
    bonusPerGuest = Math.max(0, bonusFullPerGuestCents | 0)
  }

  const base = rate * input.guests
  const bonusTotal = bonusPerGuest * input.guests
  const payable = base + bonusTotal

  const primaryEligible = !!input.primary.eligible
  const assistantEligible = !!input.assistant?.eligible

  const baseEntry = {
    base_rate_per_guest_cents: rate,
    base_total_cents: base,
    bonus_per_guest_cents: bonusPerGuest,
    bonus_total_cents: bonusTotal,
  }

  // Split 50/50 con redondeo: primario recibe ceil(payable/2),
  // asistente recibe floor(payable/2). Suma garantizada = payable.
  if (primaryEligible && assistantEligible && input.assistant) {
    const primaryShare = Math.floor((payable + 1) / 2)
    const assistantShare = Math.floor(payable / 2)
    return [
      {
        manager_id: input.primary.id,
        ...baseEntry,
        split_numerator: 1,
        split_denominator: 2,
        payable_cents: primaryShare,
      },
      {
        manager_id: input.assistant.id,
        ...baseEntry,
        split_numerator: 1,
        split_denominator: 2,
        payable_cents: assistantShare,
      },
    ]
  }

  if (primaryEligible) {
    return [
      {
        manager_id: input.primary.id,
        ...baseEntry,
        split_numerator: 1,
        split_denominator: 1,
        payable_cents: payable,
      },
    ]
  }

  if (assistantEligible && input.assistant) {
    return [
      {
        manager_id: input.assistant.id,
        ...baseEntry,
        split_numerator: 1,
        split_denominator: 1,
        payable_cents: payable,
      },
    ]
  }

  return []
}

// ──────────────────────────────────────────────────────────
// Utilidades de formato (display sólo)
// ──────────────────────────────────────────────────────────

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

export function formatARS(cents: number): string {
  return ARS.format(Math.round(cents / 100))
}
