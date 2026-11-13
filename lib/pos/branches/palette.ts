/**
 * El color de una sucursal — PURO y testeado (`tests/lib/pos-branches-palette.test.ts`).
 *
 * Es el color con el que se la reconoce arriba en el salón y en la tele: va de FONDO con el
 * nombre escrito encima en letra clara. Por eso no hay un selector libre: se elige de una
 * paleta corta en la que todos los colores aguantan esa letra con contraste AA (4,5:1).
 *
 * La regla del servidor es la de fondo, no la lista: acepta cualquier `#rrggbb` que se lea con
 * letra clara (así «Deshacer» puede devolver un color viejo que no está en la paleta), y la
 * pantalla solo ofrece los de la paleta.
 */

import { relativeLuminance } from '@/lib/floor-plan/branches'

export type PaletteColor = {
  hex: string
  /** Cómo se llama, para quien no ve el color. */
  name: string
}

/**
 * La paleta, en el orden de la rueda (así dos vecinos nunca se confunden de lejos). El primero
 * es el color con el que nace toda sucursal (el valor por defecto de `branches.color`).
 */
export const BRANCH_PALETTE: ReadonlyArray<PaletteColor> = [
  { hex: '#2f5d50', name: 'Bosque' },
  { hex: '#1f5c6b', name: 'Petróleo' },
  { hex: '#2c4a7c', name: 'Azul noche' },
  { hex: '#55407a', name: 'Violeta' },
  { hex: '#7a2e3a', name: 'Vino' },
  { hex: '#a8452d', name: 'Terracota' },
  { hex: '#8a6116', name: 'Ocre' },
  { hex: '#5c6b2a', name: 'Oliva' },
]

export const DEFAULT_BRANCH_COLOR = '#2f5d50'

/** La letra clara que el salón escribe sobre el color (`--pos-on-dark`, en sRGB). */
export const LIGHT_INK = '#fdfcf7'

/** El piso de contraste para texto: WCAG AA. */
export const AA_TEXT = 4.5

const HEX = /^#[0-9a-f]{6}$/i

/** `#2F5D50` → `#2f5d50`. `null` si no es un color `#rrggbb`. */
export function normalizeHex(value: string): string | null {
  const clean = value.trim()
  return HEX.test(clean) ? clean.toLowerCase() : null
}

/** Contraste WCAG entre dos colores `#rrggbb` (de 1 a 21). `null` si alguno no es válido. */
export function contrastRatio(a: string, b: string): number | null {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  if (first === null || second === null) return null
  const high = Math.max(first, second)
  const low = Math.min(first, second)
  return (high + 0.05) / (low + 0.05)
}

/** ¿El nombre de la sucursal se lee, en letra clara, sobre este color? */
export function readsWithLightInk(hex: string): boolean {
  const ratio = contrastRatio(hex, LIGHT_INK)
  return ratio !== null && ratio >= AA_TEXT
}

/** El color de la paleta, si es uno de ellos. */
export function paletteColor(hex: string): PaletteColor | null {
  const wanted = normalizeHex(hex)
  if (!wanted) return null
  return BRANCH_PALETTE.find((color) => color.hex === wanted) ?? null
}

/** «Terracota», o «Otro color» si la sucursal tiene uno que no es de la paleta. */
export function colorName(hex: string): string {
  return paletteColor(hex)?.name ?? 'Otro color'
}

/**
 * El color para una sucursal nueva: el primero de la paleta que no usa ninguna otra. Si ya
 * están todos en uso, el que menos sucursales tienen.
 */
export function nextFreeColor(used: ReadonlyArray<string>): string {
  const counts = new Map<string, number>()
  for (const hex of used) {
    const clean = normalizeHex(hex)
    if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1)
  }
  let best = BRANCH_PALETTE[0]?.hex ?? DEFAULT_BRANCH_COLOR
  let bestCount = Number.POSITIVE_INFINITY
  for (const color of BRANCH_PALETTE) {
    const count = counts.get(color.hex) ?? 0
    if (count < bestCount) {
      best = color.hex
      bestCount = count
    }
  }
  return best
}

/**
 * Lo que se le ofrece a una sucursal: la paleta y, si hoy tiene un color que no es de ahí,
 * ese color primero (para que no desaparezca al abrir la paleta).
 */
export function colorChoices(currentHex: string): PaletteColor[] {
  const current = normalizeHex(currentHex)
  if (!current || paletteColor(current)) return [...BRANCH_PALETTE]
  return [{ hex: current, name: 'El de ahora' }, ...BRANCH_PALETTE]
}
