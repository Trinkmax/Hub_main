// Lógica PURA de niveles de fidelización. Espejo de set_customer_tier (SQL) y del
// gate de redeem_reward. Sin I/O — testeable y usable en la wallet/club UI.

export type TierBenefitCadence = 'none' | 'birthday' | 'monthly'

export type LoyaltyTier = {
  id: string
  name: string
  color: string | null
  badge_icon: string | null
  min_lifetime_points: number
  sort: number
  benefit_cadence: TierBenefitCadence
  benefit_reward_id: string | null
  perks: string | null
  active: boolean
}

/** Sólo niveles activos, ordenados por umbral asc (desempate por sort asc). */
export function sortedActiveTiers(tiers: readonly LoyaltyTier[]): LoyaltyTier[] {
  return tiers
    .filter((t) => t.active)
    .slice()
    .sort((a, b) => a.min_lifetime_points - b.min_lifetime_points || a.sort - b.sort)
}

/**
 * Nivel actual: el de mayor umbral cuyo min_lifetime_points <= lifetime.
 * Espejo exacto de set_customer_tier (order by min_lifetime_points desc, sort desc).
 */
export function resolveTier(lifetime: number, tiers: readonly LoyaltyTier[]): LoyaltyTier | null {
  let best: LoyaltyTier | null = null
  for (const t of tiers) {
    if (!t.active || t.min_lifetime_points > lifetime) continue
    if (
      best === null ||
      t.min_lifetime_points > best.min_lifetime_points ||
      (t.min_lifetime_points === best.min_lifetime_points && t.sort > best.sort)
    ) {
      best = t
    }
  }
  return best
}

export type TierProgress = {
  current: LoyaltyTier | null
  next: LoyaltyTier | null
  /** Puntos que faltan para el próximo nivel (null si ya está en el máximo). */
  pointsToNext: number | null
  /** Progreso dentro de la banda actual, 0–100 (100 si maxeó). */
  pct: number
}

export function progressToNext(lifetime: number, tiers: readonly LoyaltyTier[]): TierProgress {
  const sorted = sortedActiveTiers(tiers)
  const current = resolveTier(lifetime, sorted)
  const next = sorted.find((t) => t.min_lifetime_points > lifetime) ?? null

  if (!next) {
    // Sin próximo nivel: maxeado (o no hay niveles configurados).
    return { current, next: null, pointsToNext: null, pct: current ? 100 : 0 }
  }

  const floor = current?.min_lifetime_points ?? 0
  const span = next.min_lifetime_points - floor
  const pct =
    span <= 0 ? 0 : Math.max(0, Math.min(100, Math.round(((lifetime - floor) / span) * 100)))
  return { current, next, pointsToNext: Math.max(0, next.min_lifetime_points - lifetime), pct }
}

/**
 * ¿Puede canjear una recompensa con gating por nivel? Espejo del check de redeem_reward:
 * usa lifetime (nunca baja), no el balance gastable.
 */
export function canRedeemReward(
  lifetime: number,
  reward: { min_tier_id: string | null },
  tiers: readonly LoyaltyTier[],
): boolean {
  if (!reward.min_tier_id) return true
  const required = tiers.find((t) => t.id === reward.min_tier_id)
  if (!required) return true // nivel borrado → no bloquea
  return lifetime >= required.min_lifetime_points
}
