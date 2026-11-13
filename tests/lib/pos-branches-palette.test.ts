// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { inkOn } from '@/lib/floor-plan/branches'
import {
  AA_TEXT,
  BRANCH_PALETTE,
  colorChoices,
  colorName,
  contrastRatio,
  DEFAULT_BRANCH_COLOR,
  LIGHT_INK,
  nextFreeColor,
  normalizeHex,
  paletteColor,
  readsWithLightInk,
} from '@/lib/pos/branches/palette'

/**
 * El color de una sucursal va de FONDO en la barra del salón y en la tele, con el nombre en
 * letra clara encima. Toda la paleta tiene que aguantar esa letra con contraste AA.
 */

describe('la paleta', () => {
  it('es corta y no repite colores ni nombres', () => {
    expect(BRANCH_PALETTE.length).toBeGreaterThanOrEqual(6)
    expect(BRANCH_PALETTE.length).toBeLessThanOrEqual(10)
    expect(new Set(BRANCH_PALETTE.map((color) => color.hex)).size).toBe(BRANCH_PALETTE.length)
    expect(new Set(BRANCH_PALETTE.map((color) => color.name)).size).toBe(BRANCH_PALETTE.length)
  })

  it('todos los colores se leen con letra clara encima (AA, 4,5:1)', () => {
    for (const color of BRANCH_PALETTE) {
      const ratio = contrastRatio(color.hex, LIGHT_INK)
      expect(ratio, color.name).not.toBeNull()
      expect(ratio ?? 0, color.name).toBeGreaterThanOrEqual(AA_TEXT)
      expect(readsWithLightInk(color.hex), color.name).toBe(true)
    }
  })

  it('el editor del plano también les pone letra clara (misma regla que la franja del salón)', () => {
    for (const color of BRANCH_PALETTE) expect(inkOn(color.hex), color.name).toBe('light')
  })

  it('arranca con el color con el que nace toda sucursal en la base', () => {
    expect(BRANCH_PALETTE[0]?.hex).toBe(DEFAULT_BRANCH_COLOR)
    expect(DEFAULT_BRANCH_COLOR).toBe('#2f5d50')
  })

  it('están escritos en minúsculas, como los compara la pantalla', () => {
    for (const color of BRANCH_PALETTE) expect(color.hex).toBe(color.hex.toLowerCase())
  })
})

describe('contrastRatio', () => {
  it('blanco contra negro es 21 y un color contra sí mismo es 1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#2f5d50', '#2f5d50')).toBeCloseTo(1, 5)
  })

  it('no depende del orden', () => {
    expect(contrastRatio('#a8452d', LIGHT_INK)).toBe(contrastRatio(LIGHT_INK, '#a8452d'))
  })

  it('con algo que no es un color no hay número', () => {
    expect(contrastRatio('rojo', LIGHT_INK)).toBeNull()
    expect(contrastRatio('#fff', LIGHT_INK)).toBeNull()
  })
})

describe('readsWithLightInk', () => {
  it('un amarillo o un celeste no aguantan letra clara', () => {
    expect(readsWithLightInk('#f2c94c')).toBe(false)
    expect(readsWithLightInk('#8ecae6')).toBe(false)
    expect(readsWithLightInk('#ffffff')).toBe(false)
  })

  it('un color oscuro sí', () => {
    expect(readsWithLightInk('#1c1c1c')).toBe(true)
    expect(readsWithLightInk('#A8452D')).toBe(true)
  })

  it('lo que no es un color no se lee', () => {
    expect(readsWithLightInk('')).toBe(false)
    expect(readsWithLightInk('#12345')).toBe(false)
  })
})

describe('normalizeHex', () => {
  it('pasa a minúsculas y saca los espacios', () => {
    expect(normalizeHex(' #A8452D ')).toBe('#a8452d')
  })

  it('rechaza lo que no es #rrggbb', () => {
    expect(normalizeHex('#abc')).toBeNull()
    expect(normalizeHex('a8452d')).toBeNull()
    expect(normalizeHex('#a8452dff')).toBeNull()
    expect(normalizeHex('#gggggg')).toBeNull()
  })
})

describe('paletteColor y colorName', () => {
  it('reconoce un color de la paleta sin importar las mayúsculas', () => {
    expect(paletteColor('#A8452D')?.name).toBe('Terracota')
    expect(colorName('#2f5d50')).toBe('Bosque')
  })

  it('un color de afuera no tiene nombre propio', () => {
    expect(paletteColor('#123456')).toBeNull()
    expect(colorName('#123456')).toBe('Otro color')
  })
})

describe('nextFreeColor', () => {
  it('sin sucursales, el primero de la paleta', () => {
    expect(nextFreeColor([])).toBe(DEFAULT_BRANCH_COLOR)
  })

  it('saltea los que ya usa otra sucursal', () => {
    expect(nextFreeColor(['#2f5d50'])).toBe(BRANCH_PALETTE[1]?.hex)
    expect(nextFreeColor(['#2F5D50', BRANCH_PALETTE[1]?.hex ?? ''])).toBe(BRANCH_PALETTE[2]?.hex)
  })

  it('un color de afuera de la paleta no le saca el lugar a ninguno', () => {
    expect(nextFreeColor(['#123456'])).toBe(DEFAULT_BRANCH_COLOR)
  })

  it('con todos en uso, el que menos sucursales tienen', () => {
    const all = BRANCH_PALETTE.map((color) => color.hex)
    const third = BRANCH_PALETTE[2]?.hex ?? ''
    // Todos dos veces, menos el tercero.
    const used = [...all, ...all.filter((hex) => hex !== third)]
    expect(nextFreeColor(used)).toBe(third)
  })
})

describe('colorChoices', () => {
  it('con un color de la paleta ofrece la paleta tal cual', () => {
    expect(colorChoices('#a8452d')).toEqual(BRANCH_PALETTE)
  })

  it('un color viejo que no es de la paleta va primero, para que no desaparezca', () => {
    const choices = colorChoices('#123456')
    expect(choices[0]).toEqual({ hex: '#123456', name: 'El de ahora' })
    expect(choices.slice(1)).toEqual(BRANCH_PALETTE)
  })
})
