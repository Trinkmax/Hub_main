// Cómo SUMÁS puntos, dicho en una línea. Lo consume la wallet del socio
// ("Cómo funciona") para no tener que hardcodear "1 punto cada $1.000": la tasa
// sale de la config real del tenant.
//
// Ojo: el motor (engine.ts) aplica TODAS las reglas activas, no la de mayor
// prioridad. Con dos reglas per_amount de distinto `every_cents` la tasa no se
// puede enunciar como una sola frase honesta → devolvemos null y la UI cae a un
// texto genérico. Preferimos no decir nada antes que decir algo falso.

import type { PerAmountConfig, PointsRule } from './types'

export type EarnRate = {
  /** Puntos que suma cada `everyCents` de consumo. */
  points: number
  everyCents: number
}

function perAmountConfig(rule: PointsRule): EarnRate | null {
  const c = rule.config as Partial<PerAmountConfig>
  if (typeof c.points !== 'number' || typeof c.every_cents !== 'number') return null
  if (c.points <= 0 || c.every_cents <= 0) return null
  return { points: c.points, everyCents: c.every_cents }
}

/**
 * La tasa por monto vigente, si se puede enunciar sin mentir: exige EXACTAMENTE
 * una regla `per_amount` activa y válida. 0 reglas → null; 2+ → null (se acumulan
 * entre sí y la frase única sería falsa).
 */
export function resolveEarnRate(rules: readonly PointsRule[]): EarnRate | null {
  const perAmount = rules
    .filter((r) => r.active && r.type === 'per_amount')
    .map(perAmountConfig)
    .filter((r): r is EarnRate => r !== null)
  return perAmount.length === 1 ? (perAmount[0] ?? null) : null
}

/** ¿Hay reglas por producto activas? → "algunos productos suman extra". */
export function hasItemBonus(rules: readonly PointsRule[]): boolean {
  return rules.some((r) => r.active && r.type === 'per_item')
}
