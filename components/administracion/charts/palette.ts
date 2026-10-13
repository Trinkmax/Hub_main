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

/** El color de la serie número `index` (desde 0); de la séptima en adelante, «Otros». */
export function seriesSwatch(index: number): string {
  if (!Number.isInteger(index) || index < 0) return OTHERS_SWATCH
  return SERIES_SWATCHES[index] ?? OTHERS_SWATCH
}
