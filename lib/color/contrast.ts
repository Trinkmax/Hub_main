/**
 * Contraste WCAG 2.x entre colores CSS. Puro: sin DOM ni dependencias.
 *
 * Es la misma cuenta en los dos lugares que miden los tokens del kit: el test
 * que recalcula los pares de `app/globals.css` (tests/lib/tokens-contrast.test.ts)
 * y la tabla de contraste en vivo del catálogo de componentes, que lee
 * `getComputedStyle`. Si alguien toca un token, los dos dan lo mismo.
 *
 * Reglas que fija este archivo:
 *
 * - **Entiende lo que escribimos y lo que devuelve el navegador:** `#rgb[a]`,
 *   `#rrggbb[aa]`, `rgb()`/`rgba()` (con comas o con espacios), `color(srgb …)`
 *   y `color(srgb-linear …)`, `oklch()`, `oklab()`, `transparent`, `white` y
 *   `black`. `getComputedStyle` devuelve el color en la sintaxis en que se
 *   escribió (`oklch(…)`, con alfa si lo tiene) y un CSS minificado lo escribe
 *   como `oklch(15.5% .022 165)`: las dos formas valen.
 * - **OKLCH → sRGB con recorte por canal**, no con mapeo de gama. Es la cuenta
 *   con la que se midió la tabla de contrastes del kit (§2.7); un token fuera
 *   de gama daría distinto acá que en la tabla si se mapeara.
 * - **El alfa se compone sobre el fondo en sRGB codificado**, como lo pinta el
 *   navegador. «Seleccionado» y «hover» son tinta con alfa: se miden sobre la
 *   superficie donde van.
 * - Un color que no se entiende es un error (`toRgba` tira): un contraste
 *   calculado con un color inventado diría que todo anda.
 *
 * Matrices de OKLab de Björn Ottosson (https://bottosson.github.io/posts/oklab/).
 */

/** sRGB codificado (con gamma): canales y alfa entre 0 y 1. */
export type Rgba = {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly alpha: number
}

export type ColorInput = string | Rgba

/** Mínimos de WCAG 2.x para AA. */
export const WCAG_MIN = {
  /** Texto de menos de 18,66 px en negrita o 24 px normal. */
  text: 4.5,
  /** Texto grande. */
  largeText: 3,
  /** Bordes de control, foco, íconos e indicadores de estado (1.4.11). */
  nonText: 3,
} as const

const WHITE: Rgba = { r: 1, g: 1, b: 1, alpha: 1 }
const BLACK: Rgba = { r: 0, g: 0, b: 0, alpha: 1 }
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, alpha: 0 }

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/
const HUE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/
const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/
const FUNCTION_RE = /^([a-z-]+)\((.*)\)$/

/** Porcentaje de croma de OKLCH / OKLab: 100 % = 0,4 (CSS Color 4). */
const OK_CHROMA_PERCENT = 0.4

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** sRGB lineal → codificado. Recorta a [0, 1] antes: lo fuera de gama se clava al borde. */
function encode(linear: number): number {
  const x = clamp01(linear)
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
}

/** sRGB codificado → lineal, con el umbral de WCAG 2.x. */
function decode(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
}

function oklabToRgba(lightness: number, a: number, b: number, alpha: number): Rgba {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha: clamp01(alpha),
  }
}

/** Un número o un porcentaje (`percentOf` es lo que vale el 100 %). `none` es 0. */
function parseComponent(token: string | undefined, percentOf: number): number | null {
  if (token === undefined) return null
  if (token === 'none') return 0
  if (token.endsWith('%')) {
    const value = token.slice(0, -1)
    return NUMBER_RE.test(value) ? (Number(value) / 100) * percentOf : null
  }
  return NUMBER_RE.test(token) ? Number(token) : null
}

/** Un ángulo en grados (sin unidad, `deg`, `rad`, `grad` o `turn`). */
function parseHue(token: string | undefined): number | null {
  if (token === undefined) return null
  if (token === 'none') return 0
  const match = HUE_RE.exec(token)
  const value = match?.[1]
  if (value === undefined) return null
  const n = Number(value)
  switch (match?.[2]) {
    case 'rad':
      return (n * 180) / Math.PI
    case 'grad':
      return n * 0.9
    case 'turn':
      return n * 360
    default:
      return n
  }
}

function parseHex(text: string): Rgba | null {
  const digits = HEX_RE.exec(text)?.[1]
  if (digits === undefined) return null
  const full =
    digits.length <= 4
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits
  const byte = (at: number) => Number.parseInt(full.slice(at, at + 2), 16) / 255
  return { r: byte(0), g: byte(2), b: byte(4), alpha: full.length === 8 ? byte(6) : 1 }
}

/**
 * Separa los argumentos de una función de color: la sintaxis con comas
 * (`rgba(255, 0, 0, 0.5)`) o la moderna con espacios y `/ alfa`.
 */
function splitArguments(inner: string): { channels: string[]; alpha: string | undefined } | null {
  if (inner.includes(',')) {
    const parts = inner.split(',').map((part) => part.trim())
    if (parts.length !== 3 && parts.length !== 4) return null
    return { channels: parts.slice(0, 3), alpha: parts[3] }
  }
  const [channels, alpha, ...rest] = inner.split('/')
  if (channels === undefined || rest.length > 0) return null
  return { channels: channels.trim().split(/\s+/).filter(Boolean), alpha: alpha?.trim() }
}

/** El color en sRGB codificado, o `null` si no se entiende. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase()
  if (text === 'transparent') return TRANSPARENT
  if (text === 'white') return WHITE
  if (text === 'black') return BLACK
  if (text.startsWith('#')) return parseHex(text)

  const fn = FUNCTION_RE.exec(text)
  const name = fn?.[1]
  const inner = fn?.[2]
  if (name === undefined || inner === undefined) return null
  const args = splitArguments(inner)
  if (!args) return null
  const alpha = args.alpha === undefined ? 1 : parseComponent(args.alpha, 1)
  if (alpha === null) return null
  const { channels } = args

  switch (name) {
    case 'rgb':
    case 'rgba': {
      if (channels.length !== 3) return null
      const [r, g, b] = channels.map((c) => parseComponent(c, 255))
      if (r == null || g == null || b == null) return null
      return {
        r: clamp01(r / 255),
        g: clamp01(g / 255),
        b: clamp01(b / 255),
        alpha: clamp01(alpha),
      }
    }
    case 'oklch': {
      if (channels.length !== 3) return null
      const lightness = parseComponent(channels[0], 1)
      const chroma = parseComponent(channels[1], OK_CHROMA_PERCENT)
      const hue = parseHue(channels[2])
      if (lightness === null || chroma === null || hue === null) return null
      const rad = (hue * Math.PI) / 180
      return oklabToRgba(lightness, chroma * Math.cos(rad), chroma * Math.sin(rad), alpha)
    }
    case 'oklab': {
      if (channels.length !== 3) return null
      const lightness = parseComponent(channels[0], 1)
      const a = parseComponent(channels[1], OK_CHROMA_PERCENT)
      const b = parseComponent(channels[2], OK_CHROMA_PERCENT)
      if (lightness === null || a === null || b === null) return null
      return oklabToRgba(lightness, a, b, alpha)
    }
    case 'color': {
      const [space, ...rest] = channels
      if (rest.length !== 3) return null
      const [r, g, b] = rest.map((c) => parseComponent(c, 1))
      if (r == null || g == null || b == null) return null
      if (space === 'srgb')
        return { r: clamp01(r), g: clamp01(g), b: clamp01(b), alpha: clamp01(alpha) }
      if (space === 'srgb-linear')
        return { r: encode(r), g: encode(g), b: encode(b), alpha: clamp01(alpha) }
      return null
    }
    default:
      return null
  }
}

/** Como `parseColor`, pero un color que no se entiende es un error. */
export function toRgba(color: ColorInput): Rgba {
  if (typeof color !== 'string') return color
  const parsed = parseColor(color)
  if (!parsed) throw new Error(`No se entiende el color: ${color}`)
  return parsed
}

/** `top` pintado encima de `bottom` (composición «over», en sRGB codificado). */
export function composite(top: ColorInput, bottom: ColorInput): Rgba {
  const t = toRgba(top)
  const b = toRgba(bottom)
  const alpha = t.alpha + b.alpha * (1 - t.alpha)
  if (alpha === 0) return TRANSPARENT
  const mix = (front: number, back: number) =>
    (front * t.alpha + back * b.alpha * (1 - t.alpha)) / alpha
  return { r: mix(t.r, b.r), g: mix(t.g, b.g), b: mix(t.b, b.b), alpha }
}

/** El color ya opaco: si tiene alfa, compuesto sobre `backdrop` (y este, sobre blanco). */
function flatten(color: Rgba, backdrop: Rgba): Rgba {
  if (color.alpha >= 1) return color
  return composite(color, backdrop.alpha >= 1 ? backdrop : composite(backdrop, WHITE))
}

/** Luminancia relativa de WCAG 2.x (0 negro, 1 blanco). Con alfa, sobre blanco. */
export function relativeLuminance(color: ColorInput): number {
  const c = flatten(toRgba(color), WHITE)
  return 0.2126 * decode(c.r) + 0.7152 * decode(c.g) + 0.0722 * decode(c.b)
}

/**
 * Ratio WCAG 2.x (de 1 a 21) entre un texto, borde o ícono y su fondo. El alfa
 * del primero se compone sobre el fondo; el del fondo, sobre `backdrop`
 * (blanco si no se dice).
 */
export function contrastRatio(
  foreground: ColorInput,
  background: ColorInput,
  backdrop: ColorInput = WHITE,
): number {
  const bg = flatten(toRgba(background), toRgba(backdrop))
  const fg = flatten(toRgba(foreground), bg)
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** `#rrggbb` (con `aa` si el color tiene alfa). */
export function toHex(color: ColorInput): string {
  const c = toRgba(color)
  const byte = (x: number) =>
    Math.round(clamp01(x) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${c.alpha < 1 ? byte(c.alpha) : ''}`
}
