import type { EarnRate } from './earn-rate'

/**
 * Cuántos puntos va a sumar un consumo, ANTES de confirmarlo.
 *
 * Espeja `award_points_by_amount` (migración 20260511000100), que toma UNA sola
 * regla `per_amount` —la de mayor prioridad— y hace `floor(monto / cada) × pts`.
 * Por eso el preview solo se muestra cuando `resolveEarnRate` devuelve una tasa
 * enunciable: con 0 reglas no hay nada que prometer y con 2+ el motor y la RPC
 * no coinciden, así que preferimos no decir un número antes que decir uno falso.
 *
 * Puro: sin I/O, testeado en tests/lib/points-preview.test.ts.
 */
export function previewPoints(amountCents: number, rate: EarnRate | null): number | null {
  if (!rate) return null
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0
  if (rate.everyCents <= 0) return null
  return Math.floor(amountCents / rate.everyCents) * rate.points
}

/** "1 punto cada $1.000" — la tasa dicha en una línea, para el mostrador. */
export function describeEarnRate(rate: EarnRate | null): string | null {
  if (!rate) return null
  const pesos = (rate.everyCents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })
  const pts = rate.points === 1 ? '1 punto' : `${rate.points.toLocaleString('es-AR')} puntos`
  return `${pts} cada $${pesos}`
}

/** Pesos tipeados por el staff → centavos para la DB. Devuelve null si no es válido. */
export function pesosToCents(raw: string): number | null {
  const normalized = raw.replace(/\./g, '').replace(',', '.').trim()
  if (!normalized) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}
