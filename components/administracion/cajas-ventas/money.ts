import { formatCents } from '@/lib/money'

/**
 * Plata para un botón o un título: sin centavos si es redonda («$ 500.000»),
 * con centavos si no («$ 315.552,60»). Nunca redondea lo que no es redondo.
 */
export function moneyLabel(cents: number): string {
  return formatCents(cents, { decimals: cents % 100 === 0 ? 0 : 2 })
}
