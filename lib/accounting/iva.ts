/**
 * Matemática del IVA y redondeo (Sprint 1, E.4).
 *
 * Todo es entero en centavos. Adentro se usa `BigInt` porque base × tasa
 * supera 2^53 con importes grandes (1e15 × 2700 ≈ 2,7e18). Nunca hay
 * `parseFloat` de plata ni `Math.round` sobre un producto con decimales.
 *
 * Redondeo: siempre «la mitad hacia arriba» sobre valores ≥ 0. Las notas de
 * crédito llevan importes positivos con el lado invertido, así que nunca se
 * redondea un negativo (`Math.round(-2.5) = -2` en JS y `round(-2.5) = -3` en
 * SQL: esa trampa no existe acá). La SQL valida con la misma fórmula entera
 * (`(base * bp + 5000) / 10000` con bigint ≥ 0) y las mismas tolerancias:
 * pantalla, base y CSV usan el mismo número.
 */

import type { Cents, VatRateBp } from './types'
import { VAT_RATE_VALUES } from './types'

/** Alícuotas admitidas, en puntos básicos (2100 = 21 %). */
export const VAT_RATES_BP = VAT_RATE_VALUES

/** Id de alícuota de AFIP (Libro IVA Digital): 0 % → 3, 2,5 % → 9, 5 % → 8, 10,5 % → 4, 21 % → 5, 27 % → 6. */
export const AFIP_ALIQUOT_ID: Readonly<Record<VatRateBp, number>> = {
  0: 3,
  250: 9,
  500: 8,
  1050: 4,
  2100: 5,
  2700: 6,
}

/** Tope del rango de tiques: la tolerancia de un rango de N tiques es N centavos, hasta 50. */
export const RANGE_VAT_TOLERANCE_CAP = 50

const BP_DENOMINATOR = 10_000n

export function isVatRateBp(value: unknown): value is VatRateBp {
  return typeof value === 'number' && (VAT_RATES_BP as readonly number[]).includes(value)
}

/** `2100` → `'21 %'` · `1050` → `'10,5 %'` · `250` → `'2,5 %'` (con espacio duro, como el resto de la UI). */
export function vatRateLabel(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100)
  const frac = rateBp % 100
  const text =
    frac === 0 ? String(whole) : `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')}`
  return `${text} %`
}

function assertNonNegativeInt(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} tiene que ser un entero ≥ 0 en centavos (vino ${value})`)
  }
}

/** IVA = round_half_up(base × tasa). Igual a la SQL `(base * bp + 5000) / 10000` con bigint ≥ 0. */
export function vatFromNet(baseCents: Cents, rateBp: VatRateBp): Cents {
  assertNonNegativeInt(baseCents, 'La base')
  return Number((BigInt(baseCents) * BigInt(rateBp) + 5000n) / BP_DENOMINATOR)
}

/**
 * Neto desde un total con IVA incluido (una alícuota):
 * round_half_up(total × 10000 / (10000 + tasa)); el IVA es total − neto.
 * Por construcción `|vatFromNet(neto) − (total − neto)| ≤ 1` (propiedad testeada).
 */
export function netFromGross(grossCents: Cents, rateBp: VatRateBp): Cents {
  assertNonNegativeInt(grossCents, 'El total')
  const den = BP_DENOMINATOR + BigInt(rateBp)
  return Number((BigInt(grossCents) * 20_000n + den) / (2n * den))
}

/** Neto e IVA desde un total con IVA incluido: `{ net, vat }` con `net + vat = total` exacto. */
export function splitGross(grossCents: Cents, rateBp: VatRateBp): { net: Cents; vat: Cents } {
  const net = netFromGross(grossCents, rateBp)
  return { net, vat: grossCents - net }
}

export type VatCheck = 'ok' | 'warn' | 'error'

/**
 * Margen hasta el que un IVA distinto del calculado se acepta con confirmación
 * (`vat_diff`): max($ 1,00; ⌈1 % del calculado⌉). Más allá es error
 * (`vat_out_of_tolerance`). Igual que C.3.3 paso 7.
 */
export function vatWarnLimit(computedCents: Cents): Cents {
  assertNonNegativeInt(computedCents, 'El IVA calculado')
  const onePercentCeil = Number((BigInt(computedCents) + 99n) / 100n)
  return Math.max(100, onePercentCeil)
}

/**
 * IVA impreso contra el calculado. `tolerance` = `vat_tolerance_cents` (1 por
 * defecto) o N (≤ 50) en un rango de N tiques (`rangeVatTolerance`).
 * - diferencia ≤ tolerancia → `ok` (pasa sin aviso);
 * - ≤ max($ 1; 1 %) → `warn` (pide `vat_diff`);
 * - más → `error`.
 */
export function checkVat(
  baseCents: Cents,
  rateBp: VatRateBp,
  givenVat: Cents,
  tolerance = 1,
): VatCheck {
  assertNonNegativeInt(givenVat, 'El IVA')
  const computed = vatFromNet(baseCents, rateBp)
  const diff = Math.abs(givenVat - computed)
  if (diff <= tolerance) return 'ok'
  return diff <= vatWarnLimit(computed) ? 'warn' : 'error'
}

/**
 * Tolerancia de un rango de tiques del cierre del día: cada tique redondea su
 * propio IVA, así que el total del rango puede diferir hasta N centavos
 * (N = hasta − desde + 1), con tope de 50.
 */
export function rangeVatTolerance(numberFrom: number, numberTo: number): number {
  if (
    !Number.isSafeInteger(numberFrom) ||
    !Number.isSafeInteger(numberTo) ||
    numberTo < numberFrom
  ) {
    throw new RangeError(`Rango de comprobantes inválido: ${numberFrom}–${numberTo}`)
  }
  return Math.min(numberTo - numberFrom + 1, RANGE_VAT_TOLERANCE_CAP)
}

/**
 * Reparte `total` según `weights` por resto mayor (método de Hamilton):
 * primero el piso de cada parte y después un centavo a cada una de las de
 * mayor resto; empate → orden de entrada. Σ partes = total exacto.
 *
 * Si todos los pesos son cero, reparte en partes iguales (con el mismo
 * desempate): así nunca se pierde un centavo. Pesos y total, enteros ≥ 0.
 */
export function distributeProportionally(total: Cents, weights: readonly Cents[]): Cents[] {
  assertNonNegativeInt(total, 'El total a repartir')
  if (weights.length === 0) {
    if (total === 0) return []
    throw new RangeError('No hay entre quiénes repartir el total')
  }
  for (const w of weights) assertNonNegativeInt(w, 'Cada peso')

  const sum = weights.reduce((acc, w) => acc + BigInt(w), 0n)
  const effective = sum === 0n ? weights.map(() => 1n) : weights.map((w) => BigInt(w))
  const den = sum === 0n ? BigInt(weights.length) : sum
  const totalBig = BigInt(total)

  const floors = effective.map((w) => (totalBig * w) / den)
  const remainders = effective.map((w, i) => ({ i, rem: (totalBig * w) % den }))
  let left = totalBig - floors.reduce((acc, f) => acc + f, 0n)

  // Mayor resto primero; a igual resto, el que vino antes.
  remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))
  const parts = floors.slice()
  for (const { i } of remainders) {
    if (left === 0n) break
    parts[i] = (parts[i] ?? 0n) + 1n
    left -= 1n
  }
  return parts.map((p) => Number(p))
}

/**
 * Porcentaje en puntos básicos: round_half_up(monto × bp / 10000). Precargas
 * de comisiones, retenciones y la parte computable de la Ley 25.413.
 */
export function percentOf(amountCents: Cents, bp: number): Cents {
  assertNonNegativeInt(amountCents, 'El importe')
  if (!Number.isSafeInteger(bp) || bp < 0) {
    throw new RangeError(`Los puntos básicos tienen que ser un entero ≥ 0 (vino ${bp})`)
  }
  return Number((BigInt(amountCents) * BigInt(bp) + 5000n) / BP_DENOMINATOR)
}

/** Columnas de `acc_fiscal_vouchers` de cada alícuota (0 % no tiene IVA). */
export const ALIQUOT_COLUMNS: Readonly<
  Record<
    VatRateBp,
    {
      net:
        | 'net_0_cents'
        | 'net_25_cents'
        | 'net_5_cents'
        | 'net_105_cents'
        | 'net_21_cents'
        | 'net_27_cents'
      vat: 'vat_25_cents' | 'vat_5_cents' | 'vat_105_cents' | 'vat_21_cents' | 'vat_27_cents' | null
    }
  >
> = {
  0: { net: 'net_0_cents', vat: null },
  250: { net: 'net_25_cents', vat: 'vat_25_cents' },
  500: { net: 'net_5_cents', vat: 'vat_5_cents' },
  1050: { net: 'net_105_cents', vat: 'vat_105_cents' },
  2100: { net: 'net_21_cents', vat: 'vat_21_cents' },
  2700: { net: 'net_27_cents', vat: 'vat_27_cents' },
}
