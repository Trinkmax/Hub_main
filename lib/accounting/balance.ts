/**
 * ¿Cuadra el asiento? Sumas de Debe y Haber en `BigInt` (kit §3.8: lo usan
 * `EntryPreview` y `EntryEditor`; el motor y las acciones vuelven a sumar
 * acá antes de mandar nada a la base, que igual rechaza lo que no cuadre).
 *
 * Acepta las dos formas de línea que circulan:
 * - la del motor (`DocLine`): `{ side, amountCents }`;
 * - la de la UI (`EntryLine` del kit): `{ debitCents?, creditCents? }`.
 *
 * Puro y tolerante: un importe faltante (`null`, `undefined`, `NaN`) cuenta
 * como cero, así un formulario a medio cargar no rompe el render.
 */

import type { Side } from './types'

type CentsLike = number | bigint | null | undefined

export type SidedLine = { side: Side; amountCents: CentsLike }
export type ColumnsLine = { debitCents?: CentsLike; creditCents?: CentsLike }
export type BalanceLine = SidedLine | ColumnsLine

export type SideSums = {
  debit: bigint
  credit: bigint
  /** Debe − Haber: 0 cuando cuadra; positivo si sobra Debe (falta Haber). */
  diff: bigint
}

/**
 * Centavos como `BigInt`. Un `number` con decimales no debería llegar; si
 * llega, se redondea al centavo lejos del cero (igual que `formatCents`), para
 * no romper una vista previa por un dato a medio tipear.
 */
function toBig(value: CentsLike): bigint {
  if (value === null || value === undefined) return 0n
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(value < 0 ? -Math.round(-value) : Math.round(value))
}

function isSided(line: BalanceLine): line is SidedLine {
  return 'side' in line
}

export function sumSides(lines: readonly BalanceLine[]): SideSums {
  let debit = 0n
  let credit = 0n
  for (const line of lines) {
    if (isSided(line)) {
      if (line.side === 'debit') debit += toBig(line.amountCents)
      else credit += toBig(line.amountCents)
    } else {
      debit += toBig(line.debitCents)
      credit += toBig(line.creditCents)
    }
  }
  return { debit, credit, diff: debit - credit }
}

/** Σ Debe = Σ Haber. Una lista vacía cuadra en sentido estricto: para la UI ver `balanceStatus`. */
export function isBalanced(lines: readonly BalanceLine[]): boolean {
  return sumSides(lines).diff === 0n
}

export type BalanceStatus = 'empty' | 'balanced' | 'unbalanced'

/** Estado para el sello de `EntryPreview`: «Sin importes», «Cuadra» o «No cuadra». */
export function balanceStatus(lines: readonly BalanceLine[]): BalanceStatus {
  const { debit, credit, diff } = sumSides(lines)
  if (debit === 0n && credit === 0n) return 'empty'
  return diff === 0n ? 'balanced' : 'unbalanced'
}

/**
 * Qué lado le falta al asiento y cuánto, para «El asiento no cuadra: faltan
 * $ 12,40 en el Haber». `null` si cuadra.
 */
export function balanceGap(lines: readonly BalanceLine[]): { side: Side; cents: bigint } | null {
  const { diff } = sumSides(lines)
  if (diff === 0n) return null
  return diff > 0n ? { side: 'credit', cents: diff } : { side: 'debit', cents: -diff }
}
