// Lógica PURA de "Puntos de Categoría": ventana móvil + vencimiento.
// Espejo de recompute_customer_loyalty y del bloque `expiring` de get_loyalty_state (SQL).
// Sin I/O — testeable y usable en la wallet.

import { addDays, addMonths, subMonths } from 'date-fns'
import type { LoyaltyTier } from './tiers'
import { resolveTier } from './tiers'

export type EarnTx = {
  /** Delta del ledger. Sólo los positivos suman a categoría. */
  delta: number
  /** ISO timestamp (points_transactions.created_at). */
  created_at: string
}

/**
 * Suma móvil de puntos de categoría: deltas POSITIVOS dentro de la ventana.
 * Mirror: sum(greatest(delta,0)) where created_at >= now() - N months.
 */
export function computeCategoryPoints(
  txs: readonly EarnTx[],
  now: Date,
  windowMonths: number,
): number {
  const cutoff = subMonths(now, windowMonths)
  let sum = 0
  for (const t of txs) {
    if (t.delta > 0 && new Date(t.created_at) >= cutoff) sum += t.delta
  }
  return sum
}

export type Expiry = {
  /** Puntos que salen de la ventana dentro de `soonDays`. */
  points: number
  /** Fecha en la que vence el lote más próximo (created_at + ventana). */
  expiresAt: Date
}

/**
 * Próximo vencimiento: puntos positivos cuyo created_at cae en [cutoff, cutoff+soonDays),
 * es decir, los que dejan la ventana en los próximos `soonDays` días. `expiresAt` es el
 * lote más antiguo (created_at más viejo) + ventana. Mirror del bloque `expiring` en SQL.
 */
export function computeExpiry(
  txs: readonly EarnTx[],
  now: Date,
  windowMonths: number,
  soonDays = 30,
): Expiry | null {
  const cutoff = subMonths(now, windowMonths)
  const soonEnd = addDays(cutoff, soonDays)
  let points = 0
  let firstAt: Date | null = null
  for (const t of txs) {
    if (t.delta <= 0) continue
    const d = new Date(t.created_at)
    if (d >= cutoff && d < soonEnd) {
      points += t.delta
      if (firstAt === null || d < firstAt) firstAt = d
    }
  }
  if (points <= 0 || firstAt === null) return null
  return { points, expiresAt: addMonths(firstAt, windowMonths) }
}

/**
 * ¿El cliente bajaría de nivel si vencen `expiringPoints`? Sirve para el aviso
 * "volvé antes para no bajar de nivel" del wallet.
 */
export function wouldDropTier(
  categoryPoints: number,
  expiringPoints: number,
  tiers: readonly LoyaltyTier[],
): { drops: boolean; toTierName: string | null } {
  const current = resolveTier(categoryPoints, tiers)
  const after = resolveTier(Math.max(0, categoryPoints - expiringPoints), tiers)
  const drops =
    current !== null && (after === null || after.min_category_points < current.min_category_points)
  return { drops, toTierName: after?.name ?? null }
}
