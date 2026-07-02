import type { CSSProperties } from 'react'

// Helpers compartidos para el color de nivel (tier) en la wallet. Los tiers
// guardan un hex #rrggbb en loyalty_tiers.color; si falta o es inválido, se cae
// al acento de marca. Se expone como `--acc` inline para derivar tints con
// color-mix en las clases (bordes, halos, fondos suaves) sin duplicar lógica.

/** ¿Es un color hex #rrggbb válido? */
export function isHexColor(color: string | null | undefined): color is string {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)
}

/** `--acc` = color del tier (o el acento de marca como fallback). */
export function tierAccent(color: string | null | undefined): CSSProperties {
  return {
    '--acc': isHexColor(color) ? color : 'var(--brand-accent, var(--primary))',
  } as CSSProperties
}

/** Luminancia relativa (WCAG) de un hex #rrggbb. */
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const lin = [0, 2, 4].map((i) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0)
}

// Paleta de tinta para la tarjeta de socio a todo color: crema sobre tiers
// oscuros (Black/Signature), forest sobre tiers claros (Gold/Select/Classic).
const INK_LIGHT = 'oklch(0.97 0.015 90)' // crema
const INK_DARK = 'oklch(0.24 0.045 165)' // forest profundo

/** ¿La tarjeta de ese color pide TEXTO CLARO? (elige el que más contrasta). */
export function needsLightInk(color: string | null | undefined): boolean {
  if (!isHexColor(color)) return true // fallback forest oscuro → texto claro
  const L = relativeLuminance(color)
  const whiteContrast = 1.05 / (L + 0.05)
  const blackContrast = (L + 0.05) / 0.05
  return whiteContrast >= blackContrast
}

export type CardInk = {
  /** Color del texto/logo sobre la tarjeta (AA garantizado). */
  ink: string
  /** ¿Texto claro (tarjeta oscura)? */
  light: boolean
  /** Filtro CSS para pintar el logo (verde) monocromo en la tinta. */
  logoFilter: string
}

/** Tinta + filtro de logo para la tarjeta a todo color de un tier. */
export function cardInk(color: string | null | undefined): CardInk {
  const light = needsLightInk(color)
  return {
    light,
    ink: light ? INK_LIGHT : INK_DARK,
    // brightness(0) → negro; + invert(1) → blanco. Da un logo "foil" monocromo.
    logoFilter: light ? 'brightness(0) invert(1)' : 'brightness(0)',
  }
}
