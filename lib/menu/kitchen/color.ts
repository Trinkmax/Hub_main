/**
 * El color de una estación en pantalla, puro.
 *
 * La base guarda un solo `#rrggbb` por estación (el que usa la cocina sobre su tablero). Acá se
 * calcula cómo se dibuja en el panel, que tiene fondo crema de día y verde casi negro de noche:
 * el mismo tono, con la luz corrida hasta que se distingue del fondo. Los colores que se ofrecen
 * para elegir (`STATION_COLORS`) pasan enteros en claro; un color cualquiera cargado por otro
 * lado también queda legible.
 *
 * Las cuentas son las de OKLCH (Björn Ottosson): se corre solo la luz, y si el color no entra
 * en la pantalla se le baja la saturación, nunca el tono.
 */

type Lch = { l: number; c: number; h: number }

const HEX = /^#[0-9a-fA-F]{6}$/

function channelToLinear(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToChannel(value: number): number {
  const c = Math.min(1, Math.max(0, value))
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
}

/** `#rrggbb` → luz (0–1), saturación y tono (en radianes). `null` si no es un color. */
export function hexToLch(hex: string): Lch | null {
  if (!HEX.test(hex)) return null
  const r = channelToLinear(Number.parseInt(hex.slice(1, 3), 16))
  const g = channelToLinear(Number.parseInt(hex.slice(3, 5), 16))
  const b = channelToLinear(Number.parseInt(hex.slice(5, 7), 16))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: lightness, c: Math.hypot(a, bb), h: Math.atan2(bb, a) }
}

function lchToLinear({ l, c, h }: Lch): [number, number, number] {
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const inGamut = (rgb: readonly number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005)

/** Luz, saturación y tono → `#rrggbb`. Si no entra en la pantalla, baja la saturación. */
export function lchToHex(color: Lch): string {
  let c = color.c
  let rgb = lchToLinear({ ...color, c })
  for (let step = 0; step < 40 && !inGamut(rgb); step++) {
    c *= 0.94
    rgb = lchToLinear({ ...color, c })
  }
  return `#${rgb.map((v) => linearToChannel(v).toString(16).padStart(2, '0')).join('')}`
}

/** La banda de luz en la que un color se distingue del fondo crema: ni tan claro que se pierda. */
const LIGHT_MAX = 0.7
const LIGHT_MIN = 0.34
/**
 * Sobre el fondo oscuro la luz se corre para arriba y se junta un poco (`0,8 · L + 0,17`), y
 * queda entre estos dos topes. Los números salen de validar los seis colores de
 * `STATION_COLORS` con la skill dataviz contra la tarjeta oscura: los seis se distinguen entre
 * sí y del fondo (3:1), también con daltonismo (ΔE 7,7 en el peor par: por eso el color nunca
 * va sin el nombre de la estación al lado).
 */
const DARK_SCALE = 0.8
const DARK_SHIFT = 0.17
const DARK_MIN = 0.53
const DARK_MAX = 0.67

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export type StationInk = {
  /** Para el fondo claro. */
  light: string
  /** Para el fondo oscuro. */
  dark: string
}

/** El color por defecto de la base: lo que se muestra si llegara algo que no es un color. */
const FALLBACK = '#b45309'

/** Cómo se dibuja el color de una estación en el panel, de día y de noche. */
export function stationInk(hex: string): StationInk {
  const lch = hexToLch(hex) ?? (hexToLch(FALLBACK) as Lch)
  const source = HEX.test(hex) ? hex.toLowerCase() : FALLBACK
  const lightL = clamp(lch.l, LIGHT_MIN, LIGHT_MAX)
  return {
    // Dentro de la banda, el color va tal cual se eligió.
    light: lightL === lch.l ? source : lchToHex({ ...lch, l: lightL }),
    dark: lchToHex({ ...lch, l: clamp(DARK_SCALE * lch.l + DARK_SHIFT, DARK_MIN, DARK_MAX) }),
  }
}
