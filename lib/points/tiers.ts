// Lógica PURA de niveles de fidelización. Espejo de recompute_customer_loyalty (SQL)
// y del gate de redeem_reward. Sin I/O — testeable y usable en la wallet/club UI.
//
// El nivel se determina por PUNTOS DE CATEGORÍA (suma móvil de los últimos N meses),
// no por lifetime. Ver lib/points/category.ts para la ventana/vencimiento.

export type LoyaltyTier = {
  id: string
  name: string
  color: string | null
  badge_icon: string | null
  min_category_points: number
  sort: number
  perks: string | null
  active: boolean
}

/** Sólo niveles activos, ordenados por umbral asc (desempate por sort asc). */
export function sortedActiveTiers(tiers: readonly LoyaltyTier[]): LoyaltyTier[] {
  return tiers
    .filter((t) => t.active)
    .slice()
    .sort((a, b) => a.min_category_points - b.min_category_points || a.sort - b.sort)
}

/**
 * Nivel actual: el de mayor umbral cuyo min_category_points <= puntos de categoría.
 * Espejo exacto de recompute_customer_loyalty (order by min_category_points desc, sort desc).
 */
export function resolveTier(
  categoryPoints: number,
  tiers: readonly LoyaltyTier[],
): LoyaltyTier | null {
  let best: LoyaltyTier | null = null
  for (const t of tiers) {
    if (!t.active || t.min_category_points > categoryPoints) continue
    if (
      best === null ||
      t.min_category_points > best.min_category_points ||
      (t.min_category_points === best.min_category_points && t.sort > best.sort)
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

export function progressToNext(
  categoryPoints: number,
  tiers: readonly LoyaltyTier[],
): TierProgress {
  const sorted = sortedActiveTiers(tiers)
  const current = resolveTier(categoryPoints, sorted)
  const next = sorted.find((t) => t.min_category_points > categoryPoints) ?? null

  if (!next) {
    // Sin próximo nivel: maxeado (o no hay niveles configurados).
    return { current, next: null, pointsToNext: null, pct: current ? 100 : 0 }
  }

  const floor = current?.min_category_points ?? 0
  const span = next.min_category_points - floor
  const pct =
    span <= 0 ? 0 : Math.max(0, Math.min(100, Math.round(((categoryPoints - floor) / span) * 100)))
  return {
    current,
    next,
    pointsToNext: Math.max(0, next.min_category_points - categoryPoints),
    pct,
  }
}

/**
 * ¿Puede canjear una recompensa con gating por nivel? Espejo del check de redeem_reward:
 * usa los puntos de categoría (nivel ACTUAL), no el balance gastable ni lifetime.
 */
export function canRedeemReward(
  categoryPoints: number,
  reward: { min_tier_id: string | null },
  tiers: readonly LoyaltyTier[],
): boolean {
  if (!reward.min_tier_id) return true
  const required = tiers.find((t) => t.id === reward.min_tier_id)
  if (!required) return true // nivel borrado → no bloquea
  return categoryPoints >= required.min_category_points
}
