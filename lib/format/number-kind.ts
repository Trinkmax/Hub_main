/**
 * Números que no son plata en centavos, escritos a mano para el kit (§3.5):
 * los «kinds» serializables que `StatCard` y `NumberTicker` aceptaban para
 * animar, ahora formateados una sola vez y quietos.
 *
 * Por qué a mano y no `Intl.NumberFormat`: el ICU de Node 25 y el del navegador
 * no dan las mismas cadenas (espacios duros, `%` pegado o separado) y la misma
 * cifra dibujada en el server y en el cliente rompía la hidratación. El
 * redondeo es el de `lib/money/decimal.ts` (sobre la representación decimal,
 * no sobre el binario), así 1,005 da 1,01 como en cualquier planilla.
 *
 * El negativo lleva el menos tipográfico (U+2212): mide lo mismo que un dígito
 * tabular y es el signo del resto del kit (§1.1, «los números mandan»).
 */

import { decimalEsAr } from '@/lib/money/decimal'
import { EMPTY_VALUE, formatCentsShort, MINUS_SIGN, NBSP } from '@/lib/money/format'

/**
 * Formatos serializables: se pueden pasar desde un Server Component (una
 * función no cruza la frontera RSC). Los nombres quedan como estaban porque
 * los usan las páginas que todavía dibujan `StatCard`.
 */
export type NumberFormatKind =
  | 'integer'
  | 'decimal-1'
  | 'decimal-2'
  | 'currency-cents-ars'
  | 'percent-100'

/** `decimalEsAr` con el menos tipográfico en lugar del guion ASCII. */
function withTypographicMinus(text: string): string {
  return text.startsWith('-') ? `${MINUS_SIGN}${text.slice(1)}` : text
}

/**
 * `1234.5` con `decimals = 1` → `'1.234,5'`; `-8` → `'−8'`. Faltante o no
 * finito → `'—'` (faltante no es cero). Los decimales se clavan entre 0 y 6:
 * más que eso no es una cifra que alguien lea.
 */
export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EMPTY_VALUE
  const digits = Math.min(6, Math.max(0, Math.trunc(decimals)))
  return withTypographicMinus(decimalEsAr(n, digits, true))
}

/**
 * El valor final de un kind, sin animar:
 *
 * - `integer` → `'1.234'`
 * - `decimal-1` / `decimal-2` → `'1.234,5'` / `'1.234,50'`
 * - `currency-cents-ars` → `'$ 1.235'` (centavos, sin centavos a la vista: es
 *   un KPI; mismo formato que `formatCentsShort`, con espacio duro después
 *   del `$`)
 * - `percent-100` → `'45 %'` (el número ya viene de 0 a 100; espacio duro
 *   antes del `%`, como `formatPercent`)
 */
export function formatNumberKind(n: number | null | undefined, kind: NumberFormatKind): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EMPTY_VALUE
  switch (kind) {
    case 'integer':
      return formatNumber(n, 0)
    case 'decimal-1':
      return formatNumber(n, 1)
    case 'decimal-2':
      return formatNumber(n, 2)
    case 'currency-cents-ars':
      return formatCentsShort(n)
    case 'percent-100':
      return `${formatNumber(n, 0)}${NBSP}%`
  }
}
