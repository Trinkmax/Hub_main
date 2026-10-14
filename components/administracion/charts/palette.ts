import type { TreasuryTone, TreasuryToneKind } from '@/lib/accounting/home'

/**
 * Los colores de serie de Administración, como clases `bg-*` listas para pasar
 * en `swatch` (los tokens `--adm-s1…s6` viven en `app/globals.css`).
 *
 * Están escritas enteras a propósito: Tailwind solo genera las clases que
 * encuentra como texto en el código. Un `bg-adm-s${n}` armado al vuelo no
 * existe en el CSS y la barra sale transparente, sin error.
 *
 * El orden es fijo y nunca se cicla: la séptima serie no repite el bosque, va a
 * «Otros». Y el color sigue a la cosa, no a su posición: si un filtro saca una
 * caja, las demás conservan el suyo (por eso `seriesSwatch` recibe el índice de
 * la cosa en su lista estable, no en la lista filtrada).
 */

export const SERIES_SWATCHES = [
  'bg-adm-s1', // bosque
  'bg-adm-s2', // dorado: poco contraste contra la tarjeta, siempre con etiqueta al lado
  'bg-adm-s3', // ciruela
  'bg-adm-s4', // azul noche
  'bg-adm-s5', // terracota
  'bg-adm-s6', // petróleo
] as const

/** «Otros»: todo lo que pasa de la sexta serie. */
export const OTHERS_SWATCH = 'bg-adm-neutral'

/** Entró y salió. Nunca solos: siempre con dirección, signo o etiqueta. */
export const IN_SWATCH = 'bg-adm-in'
export const OUT_SWATCH = 'bg-adm-out'

/**
 * Con factura / sin factura: los dos colores que ya usan el Resumen, el cierre
 * del día y la guía, con nombre para que ninguna pantalla los elija de nuevo.
 * Son colores de SERIE (bosque y azul noche), no de estado: «sin factura» no es
 * una alarma, queda registrado igual. `UNDEFINED_SWATCH` es lo que todavía no
 * se sabe (un proveedor sin papel definido, un gasto fijo sin pagar).
 *
 * Cuándo NO: para pintar el texto (va en tinta, con el punto al lado) ni para
 * otra partición de dos (entró / salió tiene los suyos).
 */
export const INVOICED_SWATCH = 'bg-adm-s1'
export const NOT_INVOICED_SWATCH = 'bg-adm-s4'
export const UNDEFINED_SWATCH = 'bg-adm-neutral'

/**
 * Lo que se debe (o lo que te deben), por urgencia: vencido · vence esta
 * semana · más adelante. Acá el color SÍ es un estado, por eso van los de
 * estado y no los de serie; siempre con su palabra al lado. Las claves son las
 * de `PayableTrancheKey` (`lib/accounting/home.ts`).
 *
 * Cuándo NO: para el espejo de Ventas «Llega esta semana» (eso es plata que
 * entra: `bg-adm-s1`), ni para series que no son un vencimiento.
 */
export const DUE_SWATCHES = {
  overdue: 'bg-destructive',
  week: 'bg-warning',
  later: 'bg-adm-neutral',
} as const

/**
 * El color de una CAJA: sale de su tipo (banco bosque, efectivo dorado,
 * billetera celeste) y, entre dos del mismo tipo, del escalón. Es el mapa del
 * héroe del Resumen (`_resumen/hero-block.tsx`), con nombre para que la
 * tarjeta de una caja, sus píldoras, el punto de un movimiento y la barra
 * «Disponible» pinten igual. Los tokens (`--adm-k-*`, al final de
 * `app/globals.css`) cambian con la superficie: adentro del héroe verde y en
 * oscuro el banco va en crema; sobre una tarjeta clara, en bosque.
 *
 * Las clases van escritas enteras (Tailwind no ve `bg-(--adm-k-${kind}-${n})`
 * armado al vuelo) y con paréntesis: los tokens no están en `@theme`.
 */
const TREASURY_TONE_SWATCHES: Readonly<
  Record<TreasuryToneKind, readonly [string, string, string]>
> = {
  bank: ['bg-(--adm-k-bank-1)', 'bg-(--adm-k-bank-2)', 'bg-(--adm-k-bank-3)'],
  cash: ['bg-(--adm-k-cash-1)', 'bg-(--adm-k-cash-2)', 'bg-(--adm-k-cash-3)'],
  wallet: ['bg-(--adm-k-wallet-1)', 'bg-(--adm-k-wallet-2)', 'bg-(--adm-k-wallet-3)'],
}

/**
 * La clase `bg-*` del color de una caja, lista para un `swatch`. `tone` es lo
 * que devuelve `treasuryTones()` de `lib/accounting/home.ts` para esa caja
 * (calculado sobre TODAS las cajas, en el orden de Ajustes: la misma lista que
 * usa el Resumen). `null` o `undefined` (la tarjeta de la empresa, un tipo
 * «otra», la cuarta del mismo tipo) va en neutro.
 *
 *   const tones = treasuryTones(treasuries)
 *   <LedgerRail icon={ArrowDownLeft} swatch={treasuryToneSwatch(tones[t.id])} />
 *
 * Cuándo NO: para series que no son cajas (categorías, medios de cobro: eso es
 * `seriesSwatch`), ni para pintar texto (el nombre va en tinta, al lado).
 */
export function treasuryToneSwatch(tone: TreasuryTone | null | undefined): string {
  return (tone ? TREASURY_TONE_SWATCHES[tone.kind][tone.step - 1] : undefined) ?? OTHERS_SWATCH
}

/** El color de la serie número `index` (desde 0); de la séptima en adelante, «Otros». */
export function seriesSwatch(index: number): string {
  if (!Number.isInteger(index) || index < 0) return OTHERS_SWATCH
  return SERIES_SWATCHES[index] ?? OTHERS_SWATCH
}
