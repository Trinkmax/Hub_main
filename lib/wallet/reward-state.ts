import type { LoyaltyTier } from '@/lib/points/tiers'

/**
 * Estado de una recompensa para un cliente concreto (PURO → testeable, sin I/O).
 * Espejo del gate de redeem_reward: el bloqueo por nivel usa los PUNTOS DE CATEGORÍA
 * (nivel actual, puede bajar), no el balance gastable.
 */
export function computeRewardState(
  reward: { cost_points: number; stock: number | null; min_tier_id: string | null },
  ctx: { pointsBalance: number; categoryPoints: number; tiers: readonly LoyaltyTier[] },
): { affordable: boolean; tierLocked: boolean; minTierName: string | null } {
  const inStock = reward.stock === null || reward.stock > 0
  const affordable = inStock && ctx.pointsBalance >= reward.cost_points
  let tierLocked = false
  let minTierName: string | null = null
  if (reward.min_tier_id) {
    const tier = ctx.tiers.find((t) => t.id === reward.min_tier_id)
    if (tier) {
      minTierName = tier.name
      tierLocked = ctx.categoryPoints < tier.min_category_points
    }
  }
  return { affordable, tierLocked, minTierName }
}
