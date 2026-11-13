// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hexToLch, lchToHex, stationInk } from '@/lib/menu/kitchen/color'
import { STATION_COLORS } from '@/lib/menu/kitchen/suggest'

/**
 * El color de una estación en el panel: el mismo tono que eligió el bar, con la luz corrida
 * hasta que se distingue del fondo crema (de día) y del verde casi negro (de noche).
 */

/** Contraste WCAG entre dos colores. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channel = (start: number) => {
      const c = Number.parseInt(hex.slice(start, start + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const CREAM = '#faf3e3'
const DARK_CARD = '#0e1d17'

describe('hexToLch y lchToHex', () => {
  it('ida y vuelta devuelve el mismo color', () => {
    for (const hex of ['#b45309', '#0e7490', '#6d28d9', '#ffffff', '#000000', '#02a05e']) {
      const lch = hexToLch(hex)
      expect(lch, hex).not.toBeNull()
      if (lch) expect(lchToHex(lch)).toBe(hex)
    }
  })

  it('lo que no es un color no se convierte', () => {
    expect(hexToLch('rojo')).toBeNull()
    expect(hexToLch('#fff')).toBeNull()
    expect(hexToLch('')).toBeNull()
  })

  it('la luz va de 0 (negro) a 1 (blanco)', () => {
    expect(hexToLch('#000000')?.l).toBeCloseTo(0, 5)
    expect(hexToLch('#ffffff')?.l).toBeCloseTo(1, 3)
    expect(hexToLch('#808080')?.c).toBeCloseTo(0, 3)
  })

  it('un color que no entra en la pantalla pierde saturación, no tono', () => {
    const vivid = lchToHex({ l: 0.6, c: 0.4, h: 2.5 })
    expect(vivid).toMatch(/^#[0-9a-f]{6}$/)
    const back = hexToLch(vivid)
    expect(back?.h).toBeCloseTo(2.5, 1)
    expect(back?.c ?? 1).toBeLessThan(0.4)
  })
})

describe('stationInk', () => {
  it('de día, los colores que se ofrecen van tal cual se eligieron', () => {
    for (const color of STATION_COLORS) expect(stationInk(color.hex).light).toBe(color.hex)
  })

  it('de noche se aclaran: el mismo tono, legible sobre el fondo oscuro', () => {
    expect(stationInk('#b45309').dark).toBe('#c86526')
    expect(stationInk('#0e7490').dark).toBe('#2d88a4')
    expect(stationInk('#6d28d9').dark).toBe('#8045f2')
  })

  it('cada color que se ofrece se distingue del fondo, de día y de noche (3:1)', () => {
    for (const color of STATION_COLORS) {
      const ink = stationInk(color.hex)
      expect(contrast(ink.light, CREAM), `${color.name} claro`).toBeGreaterThanOrEqual(3)
      expect(contrast(ink.dark, DARK_CARD), `${color.name} oscuro`).toBeGreaterThanOrEqual(3)
    }
  })

  it('un color demasiado claro o demasiado oscuro cargado por otro lado también se ve', () => {
    const yellow = stationInk('#fff176')
    expect(yellow.light).not.toBe('#fff176')
    expect(contrast(yellow.light, CREAM)).toBeGreaterThan(2)
    const black = stationInk('#000000')
    expect(contrast(black.dark, DARK_CARD)).toBeGreaterThanOrEqual(3)
    const white = stationInk('#ffffff')
    expect(contrast(white.light, CREAM)).toBeGreaterThan(2)
  })

  it('pasa las mayúsculas a minúsculas y aguanta lo que no es un color', () => {
    expect(stationInk('#B45309').light).toBe('#b45309')
    expect(stationInk('nada')).toEqual(stationInk('#b45309'))
  })
})
