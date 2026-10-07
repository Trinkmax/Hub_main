/**
 * Plata en pantalla, en CSV y en el input, a partir de CENTAVOS enteros.
 *
 * Reglas (kit §2.12 y Sprint 1 E.4/F.15):
 *
 * 1. **Sin coma flotante.** Los centavos se pasan a `BigInt` y los dígitos se
 *    arman con división entera: `c / 100` en float no aparece nunca. Acepta
 *    `number | bigint` porque el IVA del Sprint 1 se calcula en `BigInt` y las
 *    columnas `bigint` de Postgres pueden llegar como número.
 * 2. **Sin `Intl`.** El ICU de Node 25 y el del navegador no dan las mismas
 *    cadenas y rompen la hidratación (ver `decimal.ts`). Todo va a mano.
 * 3. **`−$ 1.234,50`**: menos tipográfico U+2212 adelante y espacio duro U+00A0
 *    después del `$`, así el importe no se corta en dos renglones.
 * 4. **Lo contable no esconde centavos:** 2 decimales por defecto; 0 solo para
 *    KPIs y tableros (`formatCentsShort`).
 * 5. **Faltante no es cero:** `null`/`undefined` (y `NaN`) se muestran como `—`.
 *    Nunca `$ 0`.
 * 6. **CSV aparte** (`formatCentsCsv`): sin `$`, sin miles, coma decimal y guion
 *    ASCII (`-1234,50`), que es lo que Excel en es-AR lee como número.
 */

import { groupThousands, scaledInt } from './decimal'

export const NBSP = ' '
/** Menos tipográfico: mismo ancho que los dígitos tabulares, a diferencia del guion. */
export const MINUS_SIGN = '−'
/** Lo que se muestra cuando no hay dato. */
export const EMPTY_VALUE = '—'

export type MoneyCurrency = 'ARS' | 'USD'
export type MoneySign = 'auto' | 'always' | 'never'
/** Saldo deudor («D») o acreedor («A»), como en el mayor. */
export type BalanceSide = 'D' | 'A'

export type CentsValue = number | bigint | null | undefined

export type FormatMoneyOptions = {
  /** 2 por defecto: lo contable nunca esconde centavos. 0 para KPIs y tableros. */
  decimals?: 2 | 0
  /** `auto` (default): solo el negativo lleva signo · `always`: `+` y `−` · `never`: valor absoluto. */
  sign?: MoneySign
  /**
   * Saldo: valor absoluto + « D» o « A». `auto` decide por el signo (≥ 0 → D).
   * Con `side`, `sign` no se usa: el lado ya dice para dónde va.
   */
  side?: BalanceSide | 'auto'
  /** `ARS` (default) → `$` · `USD` → `US$` · `false`/`null` → sin prefijo (el `$` está en el encabezado). */
  currency?: MoneyCurrency | false | null
  /** Texto para `null`/`undefined`/`NaN`. Default `—`. */
  empty?: string
}

const CURRENCY_PREFIX: Readonly<Record<MoneyCurrency, string>> = { ARS: '$', USD: 'US$' }

/**
 * Centavos como `BigInt`, o `null` si no hay número que mostrar. Un `number`
 * con decimales no debería llegar (los centavos son enteros); si llega, se
 * redondea al centavo lejos del cero, igual para los dos signos (`Math.round`
 * solo redondearía −2,5 a −2).
 */
function toCentsBigInt(cents: CentsValue): bigint | null {
  if (cents === null || cents === undefined) return null
  if (typeof cents === 'bigint') return cents
  if (!Number.isFinite(cents)) return null
  return BigInt(cents < 0 ? -Math.round(-cents) : Math.round(cents))
}

/**
 * Dígitos de un valor YA escalado (centavos con `decimals = 2`, pesos enteros
 * con `decimals = 0`), sin signo.
 */
function digitsOf(scaled: bigint, decimals: 0 | 2, grouping: boolean): string {
  if (decimals === 0) {
    const int = scaled.toString()
    return grouping ? groupThousands(int) : int
  }
  const int = (scaled / 100n).toString()
  const frac = (scaled % 100n).toString().padStart(2, '0')
  return `${grouping ? groupThousands(int) : int},${frac}`
}

/** Pesos enteros desde centavos absolutos, redondeando la mitad hacia arriba (1.234,50 → 1.235). */
function wholePesos(absCents: bigint): bigint {
  return (absCents + 50n) / 100n
}

function prefixOf(currency: FormatMoneyOptions['currency']): string {
  const c = currency === undefined ? 'ARS' : currency
  return c ? `${CURRENCY_PREFIX[c]}${NBSP}` : ''
}

/**
 * `123450` → `'$ 1.234,50'` · `-123450` → `'−$ 1.234,50'` · `null` → `'—'`.
 * Con `{ decimals: 0 }` → `'$ 1.235'`; con `{ side: 'auto', currency: false }` →
 * `'1.234,50 A'` para un saldo acreedor.
 */
export function formatCents(cents: CentsValue, opts: FormatMoneyOptions = {}): string {
  const value = toCentsBigInt(cents)
  if (value === null) return opts.empty ?? EMPTY_VALUE
  const decimals = opts.decimals ?? 2
  const negative = value < 0n
  const abs = negative ? -value : value
  const scaled = decimals === 0 ? wholePesos(abs) : abs
  const body = `${prefixOf(opts.currency)}${digitsOf(scaled, decimals, true)}`

  if (opts.side !== undefined) {
    const side = opts.side === 'auto' ? (negative ? 'A' : 'D') : opts.side
    return `${body}${NBSP}${side}`
  }

  // Lo que se muestra como cero no lleva signo: «−$ 0» no es un número que se lea.
  const shownZero = scaled === 0n
  const sign = opts.sign ?? 'auto'
  if (sign === 'never' || shownZero) return body
  if (negative) return `${MINUS_SIGN}${body}`
  return sign === 'always' ? `+${body}` : body
}

/** Sin centavos, para KPIs y tableros: `123450` → `'$ 1.235'` (la mitad redondea hacia arriba). */
export function formatCentsShort(
  cents: CentsValue,
  opts: Omit<FormatMoneyOptions, 'decimals'> = {},
): string {
  return formatCents(cents, { ...opts, decimals: 0 })
}

/**
 * Pesos (no centavos) con el mismo formato que `formatCents`: es para los
 * valores que ya vienen en unidades, como las cuentas de «Cómo nos fue».
 *
 * Un `number` puede traer decimales (`1234.5`): se redondea UNA sola vez, directo
 * a lo que se muestra y sobre su representación decimal (`scaledInt`). Pasar por
 * centavos y después a pesos enteros redondearía dos veces: 1234,495 → 1234,50 →
 * 1235, cuando lo correcto es 1234. Un `bigint` son pesos enteros.
 */
export function formatPesos(
  pesos: number | bigint | null | undefined,
  opts: FormatMoneyOptions = {},
): string {
  if (pesos === null || pesos === undefined) return opts.empty ?? EMPTY_VALUE
  if (typeof pesos === 'bigint') return formatCents(pesos * 100n, opts)
  if (!Number.isFinite(pesos)) return opts.empty ?? EMPTY_VALUE
  const decimals = opts.decimals ?? 2
  const scaled = BigInt(scaledInt(pesos, decimals))
  const absCents = decimals === 0 ? scaled * 100n : scaled
  return formatCents(pesos < 0 ? -absCents : absCents, opts)
}

/**
 * Para CSV: `-123450` → `'-1234,50'`. Sin `$`, sin separador de miles, coma
 * decimal, siempre dos decimales y guion ASCII: así Excel en es-AR lo toma como
 * número. Vacío si no hay dato (una celda vacía no es un cero).
 *
 * La celda NO pasa por `csvFormulaGuard`: un negativo legítimo empieza con `-`.
 */
export function formatCentsCsv(cents: CentsValue): string {
  const value = toCentsBigInt(cents)
  if (value === null) return ''
  const negative = value < 0n
  return `${negative ? '-' : ''}${digitsOf(negative ? -value : value, 2, false)}`
}

/**
 * Cómo queda el input de plata al salir del campo: `123450` → `'1.234,50'`.
 * Con `decimals: 'auto'` va entero si es redondo (`50000000` → `'500.000'`).
 * El negativo lleva guion ASCII: es lo que se tipea y lo que el parser vuelve a
 * leer (`parseMoneyToCents` de este texto da los mismos centavos).
 */
export function centsToPesosInput(
  cents: CentsValue,
  opts: { decimals?: 2 | 'auto'; grouping?: boolean } = {},
): string {
  const value = toCentsBigInt(cents)
  if (value === null) return ''
  const negative = value < 0n
  const abs = negative ? -value : value
  const grouping = opts.grouping ?? true
  const round = abs % 100n === 0n
  const text =
    opts.decimals === 'auto' && round
      ? digitsOf(abs / 100n, 0, grouping)
      : digitsOf(abs, 2, grouping)
  return `${negative ? '-' : ''}${text}`
}

/**
 * El valor canónico del `<input type="hidden">` de un campo de plata:
 * `'cents'` → `'123450'` (lo que leen `centsFromForm` y las acciones nuevas) ·
 * `'pesos'` → `'1234.50'` (acciones viejas que multiplican por 100). Vacío si no
 * hay importe: nunca se manda un `0` que el server leería como dato.
 */
export function centsToSubmitValue(cents: CentsValue, mode: 'cents' | 'pesos' = 'cents'): string {
  const value = toCentsBigInt(cents)
  if (value === null) return ''
  if (mode === 'cents') return value.toString()
  const negative = value < 0n
  const abs = negative ? -value : value
  const frac = (abs % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${(abs / 100n).toString()}.${frac}`
}
