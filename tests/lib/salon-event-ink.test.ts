import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  eventInk,
  hexToOklch,
  INK_DARK,
  INK_LIGHT,
  oklchToSrgb,
} from '@/lib/salon/event-ink'

type Triple = [number, number, number]

/**
 * Los 14 colores de template que están vivos en el HUB (15/09/2026). Los
 * verdes y amarillos neón son justamente los que se perdían sobre el papel.
 */
const LIVE_TEMPLATE_COLORS: ReadonlyArray<[string, string]> = [
  ['2x1 Burger Martes', '#85ed40'],
  ['Bingo Hub', '#7c3aed'],
  ['Comida Coreana', '#7c3aed'],
  ['Fernet Libre + Lomo', '#407aed'],
  ['Merienda Libre', '#e2ed40'],
  ['Merienda y Arte', '#ea40ed'],
  ['Noche Astral', '#ed4094'],
  ['Noche de tacos', '#d0ed40'],
  ['Pizza libre', '#e32400'],
  ['Ramen', '#7c3aed'],
  ['Ratatuille', '#40edc2'],
  ['Sushi en pasos', '#67c17d'],
  ['Sushi libre', '#40ed54'],
  ['Tapeo  y Malbec', '#7c3aed'],
]

const srgb = (l: number, c: number, h: number): Triple =>
  oklchToSrgb(l, c, h).map((x) => Math.min(1, Math.max(0, x))) as Triple

/** Composición alfa como la hace el navegador: en sRGB codificado. */
function over(fg: Triple, alpha: number, bg: Triple): Triple {
  return fg.map((x, i) => x * alpha + (bg[i] ?? 0) * (1 - alpha)) as Triple
}

function parseInk(css: string): Triple {
  const m = /^oklch\((\d\.\d{3}) (\d\.\d{3}) (\d{1,3})\)$/.exec(css)
  if (!m) throw new Error(`tinta mal formada: ${css}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * Las superficies donde se dibuja la tinta, con los valores de `app/globals.css`.
 * La ficha del evento es `bg-primary/5` y la de "Sin evento" `bg-card/60`, las
 * dos sobre `--background`.
 */
function surfaces(theme: {
  background: Triple
  card: Triple
  primary: Triple
}): Record<string, Triple> {
  const background = srgb(...theme.background)
  const card = srgb(...theme.card)
  const primary = srgb(...theme.primary)
  return {
    '--background': background,
    '--card': card,
    'ficha del evento (primary/5)': over(primary, 0.05, background),
    'ficha sin evento (card/60)': over(card, 0.6, background),
  }
}

const LIGHT = surfaces({
  background: [0.965, 0.022, 88],
  card: [0.985, 0.014, 88],
  primary: [0.355, 0.058, 165],
})
const DARK = surfaces({
  background: [0.155, 0.022, 165],
  card: [0.215, 0.025, 165],
  primary: [0.78, 0.105, 88],
})

describe('eventInk', () => {
  it('Noche Astral: rosa profundo en claro, rosa claro en oscuro', () => {
    expect(eventInk('#ed4094')).toEqual({
      light: 'oklch(0.500 0.140 356)',
      dark: 'oklch(0.780 0.120 356)',
    })
  })

  it('un color que no es hex devuelve null (la ficha cae a --primary)', () => {
    expect(eventInk(null)).toBeNull()
    expect(eventInk(undefined)).toBeNull()
    expect(eventInk('')).toBeNull()
    expect(eventInk('rosa')).toBeNull()
    expect(eventInk('#12345')).toBeNull()
    expect(eventInk('#gggggg')).toBeNull()
  })

  it('acepta el hex corto', () => {
    expect(eventInk('#f00')).toEqual(eventInk('#ff0000'))
  })

  describe.each(LIVE_TEMPLATE_COLORS)('%s (%s)', (_name, hex) => {
    const ink = eventInk(hex)
    const light = parseInk(ink?.light ?? '')
    const dark = parseInk(ink?.dark ?? '')

    it('respeta los recortes de luz y croma de cada tema', () => {
      expect(light[0]).toBeLessThanOrEqual(INK_LIGHT.maxL)
      expect(light[1]).toBeLessThanOrEqual(INK_LIGHT.maxC)
      expect(dark[0]).toBeGreaterThanOrEqual(INK_DARK.minL)
      expect(dark[1]).toBeLessThanOrEqual(INK_DARK.maxC)
    })

    it('lo que se escribe en el CSS entra en sRGB', () => {
      for (const [l, c, h] of [light, dark]) {
        for (const ch of oklchToSrgb(l, c, h)) {
          expect(ch).toBeGreaterThanOrEqual(-0.001)
          expect(ch).toBeLessThanOrEqual(1.001)
        }
      }
    })

    it('se lee (≥ 4,5:1) sobre todas las superficies de ficha, en claro', () => {
      const ink = srgb(...light)
      for (const [surface, bg] of Object.entries(LIGHT)) {
        expect(contrastRatio(ink, bg), `${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('se lee (≥ 4,5:1) sobre todas las superficies de ficha, en oscuro', () => {
      const ink = srgb(...dark)
      for (const [surface, bg] of Object.entries(DARK)) {
        expect(contrastRatio(ink, bg), `${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  })

  it('la tinta de respaldo (--primary, la de la leyenda) también se lee', () => {
    const lightPrimary = srgb(0.355, 0.058, 165)
    const darkPrimary = srgb(0.78, 0.105, 88)
    for (const bg of Object.values(LIGHT)) {
      expect(contrastRatio(lightPrimary, bg)).toBeGreaterThanOrEqual(4.5)
    }
    for (const bg of Object.values(DARK)) {
      expect(contrastRatio(darkPrimary, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('conversiones', () => {
  it('hex → OKLCH → sRGB vuelve al mismo color', () => {
    for (const [, hex] of LIVE_TEMPLATE_COLORS) {
      const lch = hexToOklch(hex)
      expect(lch).not.toBeNull()
      const [l, c, h] = lch as Triple
      // `Math.max(0, …)` también normaliza el -0 de un canal que da -0,0001.
      const back = oklchToSrgb(l, c, h).map((x) => Math.max(0, Math.round(x * 255)))
      const expected = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
      expect(back).toEqual(expected)
    }
  })

  it('el blanco es L 1 sin croma', () => {
    const [l, c] = hexToOklch('#ffffff') as Triple
    expect(l).toBeCloseTo(1, 4)
    expect(c).toBeCloseTo(0, 4)
  })

  it('contraste: blanco contra negro es 21:1 y es simétrico', () => {
    expect(contrastRatio([1, 1, 1], [0, 0, 0])).toBeCloseTo(21, 5)
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 5)
    expect(contrastRatio([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toBe(1)
  })
})
