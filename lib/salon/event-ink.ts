/**
 * La tinta del evento: el color del template, domado para que se lea.
 *
 * Los templates del HUB tienen colores de calendario — `#e2ed40`, `#40ed54`,
 * `#85ed40` — elegidos para un puntito sobre blanco, no para dibujar gente.
 * Usados crudos, un amarillo limón sobre el papel crema da 1,2:1 y el muro de
 * mesas de Merienda Libre desaparece. Por eso no se usa el hex: se usa su TONO.
 *
 * Reglas que fija este archivo:
 *
 * - **Se conserva el tono, se recortan luz y croma.** En claro la tinta nunca
 *   pasa de L 0,50 ni de C 0,14; en oscuro nunca baja de L 0,78 ni pasa de
 *   C 0,12. Así cualquier color del calendario queda arriba de 4,5:1 contra
 *   todas las superficies de ficha, en los dos temas (está testeado con los 14
 *   colores reales, no con uno de ejemplo).
 * - **Si el color no entra en sRGB, se baja el croma y nunca la luz.** La luz
 *   es la que da el contraste; el croma es solo el "gusto" del color. Bisección
 *   de 30 pasos sobre C con el tono y la luz ya redondeados, y el croma se
 *   redondea hacia abajo: lo que se escribe en el CSS es exactamente lo que se
 *   verificó que entra.
 * - **Se calcula acá y no en CSS.** `oklch(from var(--x) …)` resolvería lo mismo
 *   en el navegador, pero con una matriz de soporte que no se puede testear. Un
 *   string calculado en JS se prueba con Vitest y se ve igual en todos lados.
 * - **Un hex inválido devuelve `null`**, y la ficha cae a `--primary`: mejor el
 *   verde de la casa que un color inventado.
 *
 * Matrices de OKLab de Björn Ottosson (https://bottosson.github.io/posts/oklab/).
 * Puro: sin DB ni React.
 */

export const INK_LIGHT = { maxL: 0.5, maxC: 0.14 } as const
export const INK_DARK = { minL: 0.78, maxC: 0.12 } as const

type Triple = [number, number, number]

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** sRGB codificado (0–1) → lineal. */
function toLinear(x: number): number {
  const abs = Math.abs(x)
  const v = abs <= 0.04045 ? abs / 12.92 : ((abs + 0.055) / 1.055) ** 2.4
  return Math.sign(x) * v
}

/** Lineal → sRGB codificado. Conserva el signo para poder detectar fuera de gama. */
function fromLinear(x: number): number {
  const abs = Math.abs(x)
  const v = abs <= 0.0031308 ? abs * 12.92 : 1.055 * abs ** (1 / 2.4) - 0.055
  return Math.sign(x) * v
}

function parseHex(hex: string): Triple | null {
  const match = HEX_RE.exec(hex.trim())
  const digits = match?.[1]
  if (!digits) return null
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return [r / 255, g / 255, b / 255]
}

/** `#ed4094` → `[L, C, H]` con H en grados [0, 360). `null` si no es un hex. */
export function hexToOklch(hex: string): Triple | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map(toLinear) as Triple

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const C = Math.hypot(A, B)
  // Un gris no tiene tono: atan2(0, 0) daría 0 igual, pero el ruido de coma
  // flotante en un blanco puro puede dar cualquier ángulo.
  const H = C < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return [L, C, H]
}

/**
 * OKLCH → sRGB codificado, SIN recortar a [0, 1]: un canal fuera de rango es
 * justamente cómo se sabe que el color no entra en la pantalla.
 */
export function oklchToSrgb(l: number, c: number, h: number): Triple {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b

  const L3 = l_ ** 3
  const M3 = m_ ** 3
  const S3 = s_ ** 3

  return [
    fromLinear(4.0767416621 * L3 - 3.3077115913 * M3 + 0.2309699292 * S3),
    fromLinear(-1.2684380046 * L3 + 2.6097574011 * M3 - 0.3413193965 * S3),
    fromLinear(-0.0041960863 * L3 - 0.7034186147 * M3 + 1.707614701 * S3),
  ]
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function relativeLuminance(rgb: Triple): number {
  const [r, g, b] = rgb.map((x) => toLinear(clamp01(x))) as Triple
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contraste WCAG 2 entre dos colores sRGB codificados (0–1). Siempre ≥ 1. */
export function contrastRatio(a: Triple, b: Triple): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** Tolerancia de gama: menos de una décima de nivel de 8 bits. */
const GAMUT_EPS = 0.0004

function inGamut(l: number, c: number, h: number): boolean {
  return oklchToSrgb(l, c, h).every((x) => x >= -GAMUT_EPS && x <= 1 + GAMUT_EPS)
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}

/** Hacia abajo, con un épsilon para que 0.14 no termine en 0.139 por la coma flotante. */
function floor3(x: number): number {
  return Math.floor(x * 1000 + 1e-6) / 1000
}

function inkFor(lRaw: number, cRaw: number, hRaw: number, maxC: number): string {
  const l = round3(lRaw)
  const h = Math.round(hRaw) % 360
  let c = floor3(Math.min(cRaw, maxC))
  if (!inGamut(l, c, h)) {
    let lo = 0
    let hi = c
    for (let i = 0; i < 30; i += 1) {
      const mid = (lo + hi) / 2
      if (inGamut(l, mid, h)) lo = mid
      else hi = mid
    }
    c = floor3(lo)
  }
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h})`
}

/**
 * Las dos tintas de un color de template. `null` cuando no hay color o no es un
 * hex: el CSS cae a `--primary` solo (`.ev-ink` en `app/globals.css`).
 */
export function eventInk(hex: string | null | undefined): { light: string; dark: string } | null {
  if (!hex) return null
  const lch = hexToOklch(hex)
  if (!lch) return null
  const [L, C, H] = lch
  return {
    light: inkFor(Math.min(L, INK_LIGHT.maxL), C, H, INK_LIGHT.maxC),
    dark: inkFor(Math.max(L, INK_DARK.minL), C, H, INK_DARK.maxC),
  }
}
