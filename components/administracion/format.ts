/**
 * Cómo se dice la plata en Administración (H.1 · H.21), puro y sin React.
 *
 * - **Sin signo menos pelado en los saldos.** El número va siempre en valor
 *   absoluto y el sentido lo dice el texto: «Le debés $ 1.240.000,00»,
 *   «A favor $ 120.000,00», «Le debemos $ 117.800,00».
 * - **Faltante no es cero:** `null`/`undefined`/`NaN` → «—».
 * - Los movimientos de un estado de cuenta sí llevan signo (+ factura, − pago).
 *
 * Convención de los saldos que reciben estas funciones (la arman las queries):
 * - `payable` (proveedores, impuestos, sueldos): positivo = le debemos;
 *   negativo = saldo a favor nuestro.
 * - `receivable` (clientes, tarjetas, plataformas): positivo = nos debe;
 *   negativo = le debemos.
 * - `treasury` (cajas, bancos, billeteras): positivo = plata disponible;
 *   negativo = descubierto. En una tarjeta de la empresa el saldo es la deuda.
 */

import { type CentsValue, formatCents, groupThousands, MINUS_SIGN, NBSP } from '@/lib/money'

export type BalanceKind = 'payable' | 'receivable' | 'treasury'

type BalanceWords = {
  /** El saldo en su sentido normal (deuda, plata disponible). `null`: solo el número. */
  positive: string | null
  /** El saldo contrario. Nunca `null`: es lo que reemplaza al menos. */
  negative: string
  /** Saldo cero. `null`: «$ 0,00». */
  zero: string | null
}

export const BALANCE_WORDS: Readonly<Record<BalanceKind, BalanceWords>> = {
  payable: { positive: 'Le debés', negative: 'A favor', zero: 'Sin deuda' },
  receivable: { positive: 'Te debe', negative: 'Le debemos', zero: 'Sin deuda' },
  treasury: { positive: null, negative: 'Descubierto', zero: null },
}

export type DescribedAmount = {
  /** Lo que va antes del número («Le debés»), o `null`. */
  words: string | null
  /** El número formateado, o `null` si el texto lo dice todo («Sin deuda»). */
  amount: string | null
  state: 'empty' | 'zero' | 'positive' | 'negative'
}

function toNumber(cents: CentsValue): number | null {
  if (cents === null || cents === undefined) return null
  const n = typeof cents === 'bigint' ? Number(cents) : cents
  return Number.isFinite(n) ? n : null
}

/**
 * Un saldo con su sentido en palabras.
 * - `words: 'both'` (default): las palabras van en los dos sentidos
 *   («Le debés $ X» y «A favor $ X»). Para fichas, KPIs y listas.
 * - `words: 'contrary'`: solo el sentido contrario lleva palabras; el normal
 *   va como número pelado. Para la columna «Saldo» de un estado de cuenta,
 *   donde repetir «Le debés» en cada fila no suma nada.
 */
export function describeBalance(
  cents: CentsValue,
  kind: BalanceKind,
  opts: { decimals?: 0 | 2; words?: 'both' | 'contrary'; currency?: boolean } = {},
): DescribedAmount {
  const value = toNumber(cents)
  const decimals = opts.decimals ?? 2
  const currency = opts.currency === false ? false : 'ARS'
  const dict = BALANCE_WORDS[kind]
  if (value === null) return { words: null, amount: null, state: 'empty' }
  const amount = formatCents(Math.abs(value), { decimals, currency })
  // Lo que se muestra como cero es cero: «A favor $ 0» no se lee.
  const shownZero = formatCents(0, { decimals, currency }) === amount
  if (value === 0 || shownZero) {
    return dict.zero
      ? { words: dict.zero, amount: null, state: 'zero' }
      : { words: null, amount, state: 'zero' }
  }
  if (value > 0) {
    const words = (opts.words ?? 'both') === 'both' ? dict.positive : null
    return { words, amount, state: 'positive' }
  }
  return { words: dict.negative, amount, state: 'negative' }
}

/** El saldo entero como texto plano (CSV no; para `aria-label`, títulos y toasts). */
export function balanceText(
  cents: CentsValue,
  kind: BalanceKind,
  opts: { decimals?: 0 | 2; words?: 'both' | 'contrary' } = {},
): string {
  const d = describeBalance(cents, kind, opts)
  if (d.state === 'empty') return '—'
  return [d.words, d.amount].filter(Boolean).join(' ')
}

/**
 * Saldo como en el mayor: absoluto + «D» o «A» (Debe − Haber; ≥ 0 → D).
 * Devuelve las partes para que la letra lleve su texto para lectores.
 */
export function describeSideBalance(
  cents: CentsValue,
  opts: { decimals?: 0 | 2; currency?: boolean } = {},
): { amount: string; side: 'D' | 'A' } | null {
  const value = toNumber(cents)
  if (value === null) return null
  return {
    amount: formatCents(Math.abs(value), {
      decimals: opts.decimals ?? 2,
      currency: opts.currency ? 'ARS' : false,
    }),
    side: value < 0 ? 'A' : 'D',
  }
}

/**
 * Un movimiento con signo explícito: `+$ 1.000,00` o `−$ 1.000,00`. Sirve para
 * las tarjetas del estado de cuenta en el celular (+ factura, − pago).
 */
export function signedMovement(cents: number, increases: boolean, decimals: 0 | 2 = 2): string {
  const body = formatCents(Math.abs(cents), { decimals })
  return `${increases ? '+' : MINUS_SIGN}${body}`
}

/** «1 comprobante» / «3 comprobantes». */
export function plural(n: number, one: string, many: string): string {
  return `${groupThousands(String(Math.trunc(n)))}${NBSP}${n === 1 ? one : many}`
}
