/**
 * El cuadre de un asiento tal como lo muestran las piezas contables (kit §3.8):
 * el sello «Cuadra / No cuadra» de `EntryPreview` y el pie del `EntryEditor`.
 *
 * Puro y sin React: las sumas son las de `lib/accounting/balance.ts` (en
 * `BigInt`, igual que el motor y la acción del server) y la plata sale de
 * `lib/money`. Liviano a propósito (lo carga el sello en cada formulario): lo
 * que frena el envío, con el catálogo de errores, vive en `entry-editor-model.ts`.
 */

import {
  type BalanceLine,
  type BalanceStatus,
  balanceGap,
  balanceStatus,
  sumSides,
} from '@/lib/accounting/balance'
import type { Side } from '@/lib/accounting/types'
import { formatCents } from '@/lib/money/format'

export type { BalanceStatus } from '@/lib/accounting/balance'

export type EntryBalance = {
  /** `empty` (sin importes) · `balanced` · `unbalanced`. */
  status: BalanceStatus
  debit: bigint
  credit: bigint
  /** Debe − Haber: 0 cuando cuadra; positivo si sobra Debe (falta Haber). */
  diff: bigint
  /** Qué lado falta y cuánto; `null` si cuadra (o si no hay importes). */
  gap: { side: Side; cents: bigint } | null
}

/** Sumas, estado y faltante de un asiento (en cualquiera de las dos formas de línea). */
export function entryBalance(lines: readonly BalanceLine[]): EntryBalance {
  const { debit, credit, diff } = sumSides(lines)
  return {
    status: balanceStatus(lines),
    debit,
    credit,
    diff,
    gap: balanceGap(lines),
  }
}

/** Los textos del sello: lo único que entra en la región `role="status"`. */
export const BALANCE_STATUS_LABEL: Readonly<Record<BalanceStatus, string>> = {
  empty: 'Sin importes',
  balanced: 'Cuadra',
  unbalanced: 'No cuadra',
}

/** El nombre del lado como lo escribe el libro: «Debe» o «Haber». */
export const SIDE_LABEL: Readonly<Record<Side, string>> = { debit: 'Debe', credit: 'Haber' }

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

/** «diferencia $ 12,40» (siempre en positivo y con centavos: lo contable no los esconde). */
export function balanceDiffText(diff: bigint): string {
  return `diferencia ${formatCents(absolute(diff))}`
}

/** «Falta $ 12,40 en el Haber»: el pie del asiento mientras no cuadra. */
export function balanceGapText(gap: { side: Side; cents: bigint }): string {
  return `Falta ${formatCents(gap.cents)} en el ${SIDE_LABEL[gap.side]}`
}

/** ¿Hay un importe distinto de cero? `null`, `undefined`, `NaN` y `0` son «sin importe». */
export function hasAmount(value: number | bigint | null | undefined): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'bigint') return value !== 0n
  return Number.isFinite(value) && value !== 0
}
