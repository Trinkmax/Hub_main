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

/**
 * Pesos tipeados por el staff → centavos para la DB. Devuelve null si no es válido.
 *
 * Solo son centavos el último punto o coma seguido de 1 o 2 dígitos ("4500,50").
 * Cualquier otro separa miles: "12.500", "129,000" y "1.234.567" son pesos
 * enteros. Antes la coma era siempre decimal y "129,000" se cargaba como $129.
 */
export function pesosToCents(raw: string): number | null {
  const compact = raw.replace(/\s/g, '')
  if (!compact) return null
  const decimal = compact.match(/^(\d[\d.,]*)[.,](\d{1,2})$/)
  const whole = (decimal?.[1] ?? compact).replace(/[.,]/g, '')
  if (!/^\d+$/.test(whole)) return null
  const fraction = decimal?.[2] ? Number(decimal[2].padEnd(2, '0')) : 0
  const cents = Number(whole) * 100 + fraction
  if (!Number.isSafeInteger(cents) || cents <= 0) return null
  return cents
}

/**
 * Una cuenta de bar por debajo de $1.000 es casi siempre un monto sin los ceros:
 * en la caja de HUB se cargaron «129» por $129.000 y «84» por $84.000, y como
 * no llegaban a $1.000 sumaban 0 puntos sin que nadie se diera cuenta.
 */
export const MISSING_ZEROS_BELOW_CENTS = 100_000

/**
 * El monto que probablemente quisieron poner (×1.000), o null si lo tipeado es
 * plausible. Con centavos no propone nada: "12,50" no es un monto en miles.
 */
export function suggestThousands(cents: number | null): number | null {
  if (cents === null || cents <= 0 || cents >= MISSING_ZEROS_BELOW_CENTS) return null
  if (cents % 100 !== 0) return null
  return cents * 1000
}

/** Centavos → lo que se escribe en el campo de monto: "129.000". */
export function centsToPesosInput(cents: number): string {
  return Math.round(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })
}
