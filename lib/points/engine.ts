import type {
  PerAmountConfig,
  PerItemByCategoryConfig,
  PerItemByIdConfig,
  PointsBreakdownEntry,
  PointsCalculation,
  PointsRule,
  VisitForEngine,
} from './types'

/**
 * Reglas de aplicación (mantener en paridad con `calculate_visit_points` en SQL):
 *
 * 1. Filtrar reglas inactivas y reglas con config inválida.
 * 2. Ordenar por `priority desc, id asc` (estable).
 * 3. Aplicar cada regla y producir una entry de breakdown si arroja puntos.
 * 4. Item overrides son aditivos al final.
 * 5. `delta = max(0, sum(entries))` — los descuentos sólo provienen de redenciones.
 */
export function calculatePoints(
  visit: VisitForEngine,
  rules: ReadonlyArray<PointsRule>,
): PointsCalculation {
  const total = Math.max(0, visit.total_amount_cents | 0)
  const breakdown: PointsBreakdownEntry[] = []
  let delta = 0

  const sortedRules = [...rules]
    .filter((r) => r.active && isValidConfig(r))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

  for (const rule of sortedRules) {
    if (rule.type === 'per_amount') {
      const cfg = rule.config as PerAmountConfig
      if (cfg.every_cents > 0 && cfg.points !== 0 && total > 0) {
        const multiplier = Math.floor(total / cfg.every_cents)
        if (multiplier > 0) {
          const pts = multiplier * cfg.points
          if (pts !== 0) {
            breakdown.push({
              rule_id: rule.id,
              source: 'per_amount',
              description: `Cada $${(cfg.every_cents / 100).toLocaleString(
                'es-AR',
              )} gastados → ${cfg.points} pts (×${multiplier})`,
              points: pts,
            })
            delta += pts
          }
        }
      }
    } else if (rule.type === 'per_item') {
      const cfg = rule.config
      if ('item_id' in cfg) {
        const c = cfg as PerItemByIdConfig
        const qty = sumQty(visit.items, (i) => i.menu_item_id === c.item_id)
        if (qty > 0 && c.points !== 0) {
          const pts = qty * c.points
          breakdown.push({
            rule_id: rule.id,
            source: 'per_item_id',
            description: `Ítem específico × ${qty} → ${pts} pts`,
            points: pts,
          })
          delta += pts
        }
      } else if ('category_id' in cfg) {
        const c = cfg as PerItemByCategoryConfig
        const qty = sumQty(visit.items, (i) => i.category_id === c.category_id)
        if (qty > 0 && c.points !== 0) {
          const pts = qty * c.points
          breakdown.push({
            rule_id: rule.id,
            source: 'per_item_category',
            description: `Categoría × ${qty} → ${pts} pts`,
            points: pts,
          })
          delta += pts
        }
      }
    }
  }

  // Item overrides aditivos
  let overridePts = 0
  for (const item of visit.items) {
    if (item.points_override !== null && item.points_override !== 0) {
      overridePts += item.quantity * item.points_override
    }
  }
  if (overridePts !== 0) {
    breakdown.push({
      rule_id: null,
      source: 'item_override',
      description: `Bonus por ítems con puntos extra: ${overridePts} pts`,
      points: overridePts,
    })
    delta += overridePts
  }

  if (delta < 0) delta = 0

  return { delta, breakdown }
}

function sumQty(
  items: VisitForEngine['items'],
  pred: (i: VisitForEngine['items'][number]) => boolean,
): number {
  let total = 0
  for (const i of items) if (pred(i)) total += i.quantity
  return total
}

function isValidConfig(rule: PointsRule): boolean {
  if (rule.type === 'per_amount') {
    const c = rule.config as Partial<PerAmountConfig>
    return typeof c.every_cents === 'number' && typeof c.points === 'number'
  }
  if (rule.type === 'per_item') {
    const c = rule.config as Record<string, unknown>
    if (typeof c.points !== 'number') return false
    return typeof c.item_id === 'string' || typeof c.category_id === 'string'
  }
  return false
}

// ──────────────────────────────────────────────────────────
// Validación de canje (lado TS, espejo del check de la RPC)
// ──────────────────────────────────────────────────────────

export type RedeemValidationError = 'insufficient_balance' | 'reward_inactive' | 'out_of_stock'

export type RedeemValidationInput = {
  balance: number
  reward: { cost_points: number; active: boolean; stock: number | null }
}

export function validateRedeem(
  input: RedeemValidationInput,
): { ok: true } | { ok: false; error: RedeemValidationError } {
  if (!input.reward.active) return { ok: false, error: 'reward_inactive' }
  if (input.reward.stock !== null && input.reward.stock <= 0) {
    return { ok: false, error: 'out_of_stock' }
  }
  if (input.balance < input.reward.cost_points) {
    return { ok: false, error: 'insufficient_balance' }
  }
  return { ok: true }
}
