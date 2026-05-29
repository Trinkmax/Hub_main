/**
 * Helpers puros para redención de puntos como descuento al cobrar.
 *
 * MANTENER EN PARIDAD con la lógica de validación de la RPC
 * `public.mark_session_paid(uuid, jsonb)`.
 *
 * El helper se usa en la UI del cobro para:
 *   - calcular cuántos puntos se pueden aplicar como máximo
 *   - mostrar el descuento en vivo mientras el mozo tipea
 *   - validar antes de enviar al RPC (evitar roundtrips fallidos)
 */

export type PointsRedemptionConfig = {
  enabled: boolean
  ratePointsToCents: number // centavos por punto
  maxPct: number // 0-100
}

export type RedemptionInput = {
  pointsToRedeem: number
  balance: number
  shareCents: number
  config: PointsRedemptionConfig
}

export type RedemptionResult =
  | { ok: true; redeemCents: number; pointsUsed: number; remainingShareCents: number }
  | {
      ok: false
      reason: 'disabled' | 'invalid' | 'insufficient_balance' | 'exceeds_cap' | 'exceeds_share'
    }

export function computeRedemption(input: RedemptionInput): RedemptionResult {
  const { pointsToRedeem, balance, shareCents, config } = input

  if (!config.enabled) return { ok: false, reason: 'disabled' }

  if (
    !Number.isFinite(pointsToRedeem) ||
    !Number.isInteger(pointsToRedeem) ||
    pointsToRedeem <= 0
  ) {
    return { ok: false, reason: 'invalid' }
  }

  if (pointsToRedeem > balance) return { ok: false, reason: 'insufficient_balance' }

  const redeemCents = pointsToRedeem * config.ratePointsToCents

  const capCents = Math.floor((shareCents * config.maxPct) / 100)
  if (redeemCents > capCents) return { ok: false, reason: 'exceeds_cap' }
  if (redeemCents > shareCents) return { ok: false, reason: 'exceeds_share' }

  return {
    ok: true,
    redeemCents,
    pointsUsed: pointsToRedeem,
    remainingShareCents: shareCents - redeemCents,
  }
}

/**
 * Cuántos puntos puede aplicar como máximo el cliente, dado su balance y su
 * share en la sesión. Útil para el max del input en la UI.
 *
 * Devuelve 0 si la redención está deshabilitada o no aplica.
 */
export function maxRedeemablePoints(
  balance: number,
  shareCents: number,
  config: PointsRedemptionConfig,
): number {
  if (!config.enabled) return 0
  if (shareCents <= 0) return 0
  const capCents = Math.floor((shareCents * config.maxPct) / 100)
  const capByCents = Math.min(capCents, shareCents)
  const capByRate = Math.floor(capByCents / config.ratePointsToCents)
  return Math.max(0, Math.min(balance, capByRate))
}
