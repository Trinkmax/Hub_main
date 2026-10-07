import { describe, expect, it } from 'vitest'
import {
  composite,
  contrastRatio,
  parseColor,
  relativeLuminance,
  toHex,
  toRgba,
  WCAG_MIN,
} from '@/lib/color/contrast'
import {
  parseTokenRules,
  readGlobalsCss,
  resolveToken,
  rulesFor,
  SCOPE,
  type TokenRule,
} from './globals-css-tokens'

/**
 * Contrastes del kit HUB (§2.7 de la especificación), recalculados desde
 * `app/globals.css` con la misma función que usa el catálogo en vivo.
 *
 * Cada par es un uso real: «texto 2 sobre una fila elegida» es lo que dibuja
 * una celda de tabla seleccionada. Los fondos con alfa (`--selected`,
 * `--hover`) se componen sobre la superficie donde van. Los mínimos son los de
 * WCAG 2.x AA: 4,5:1 para texto y 3:1 para bordes de control, foco, íconos e
 * indicadores de estado. Lo que la especificación prohíbe (el texto de apoyo
 * sobre `--secondary`, un campo sobre `--secondary`, el dorado como texto en
 * claro) no está acá porque no se usa: es una regla de uso, no un par.
 *
 * Solo se miden los scopes nuevos. Lo congelado mantiene los valores de antes
 * del kit a propósito (lo cuida tokens-parity.test.ts).
 */

const rules = parseTokenRules(readGlobalsCss())

function scope(selectorList: string, media: string | null = null): TokenRule {
  const [rule] = rulesFor(rules, selectorList, media).filter((r) => r.tokens.size > 0)
  if (!rule) throw new Error(`globals.css: falta el bloque «${selectorList}»`)
  return rule
}

const light = scope(SCOPE.newLight).tokens
const dark = scope(SCOPE.newDark).tokens

/** `--card` o `--selected sobre --card` (un token con alfa sobre su superficie). */
function paint(tokens: Map<string, string>, layer: string) {
  const [top = '', under] = layer.split(' sobre ')
  const color = resolveToken(tokens, top)
  return under === undefined ? color : composite(color, resolveToken(tokens, under))
}

function ratio(tokens: Map<string, string>, foreground: string, background: string): number {
  return contrastRatio(paint(tokens, foreground), paint(tokens, background))
}

const TEXT = WCAG_MIN.text
const UI = WCAG_MIN.nonText

/** [primer plano, fondo, mínimo, para qué se usa] */
type Pair = readonly [foreground: string, background: string, min: number, use: string]

const LIGHT_PAIRS: readonly Pair[] = [
  ['--foreground', '--card', TEXT, 'texto principal'],
  ['--foreground', '--background', TEXT, 'texto principal'],
  ['--foreground', '--muted', TEXT, 'encabezado de tabla'],
  ['--foreground', '--secondary', TEXT, 'chip'],
  ['--foreground', '--selected sobre --background', TEXT, 'ítem activo del menú'],
  ['--foreground', '--hover sobre --background', TEXT, 'hover'],
  ['--muted-foreground', '--card', TEXT, 'texto secundario'],
  ['--muted-foreground', '--background', TEXT, 'texto secundario'],
  ['--muted-foreground', '--muted', TEXT, 'texto secundario'],
  ['--muted-foreground', '--secondary', TEXT, 'etiqueta neutra'],
  ['--muted-foreground', '--selected sobre --background', TEXT, 'menú'],
  ['--muted-foreground', '--selected sobre --card', TEXT, 'fila elegida'],
  ['--muted-foreground', '--hover sobre --background', TEXT, 'menú en hover'],
  ['--muted-foreground', '--accent', TEXT, 'listbox'],
  ['--muted-foreground', '--success-soft', TEXT, 'cuerpo de Callout'],
  ['--muted-foreground', '--warning-soft', TEXT, 'cuerpo de Callout'],
  ['--muted-foreground', '--destructive-soft', TEXT, 'cuerpo de Callout'],
  ['--muted-foreground', '--info-soft', TEXT, 'cuerpo de Callout'],
  ['--subtle-foreground', '--card', TEXT, 'apoyo de 12 px y placeholder'],
  ['--subtle-foreground', '--background', TEXT, 'apoyo de 12 px'],
  ['--subtle-foreground', '--muted', TEXT, 'apoyo de 12 px'],
  ['--subtle-foreground', '--accent', TEXT, 'apoyo en listbox'],
  ['--subtle-foreground', '--hover sobre --card', TEXT, 'celda de tabla en hover'],
  ['--subtle-foreground', '--selected sobre --card', TEXT, 'celda de fila elegida (margen mínimo)'],
  ['--primary', '--card', TEXT, 'link e ícono activo'],
  ['--primary', '--background', TEXT, 'link e ícono activo'],
  ['--primary', '--secondary', TEXT, 'contorno del segmentado elegido'],
  ['--primary', '--accent', TEXT, 'ícono en opción resaltada'],
  ['--primary-foreground', '--primary', TEXT, 'botón principal, día y página elegidos'],
  ['--primary-foreground', '--primary-hover', TEXT, 'botón principal en hover'],
  ['--destructive-foreground', '--destructive', TEXT, 'botón de peligro'],
  ['--destructive-foreground', '--destructive-hover', TEXT, 'botón de peligro en hover'],
  ['--success-text', '--card', TEXT, 'texto de éxito'],
  ['--success-text', '--background', TEXT, 'texto de éxito'],
  ['--success-text', '--success-soft', TEXT, 'etiqueta de éxito'],
  ['--warning-text', '--card', TEXT, 'texto de aviso'],
  ['--warning-text', '--background', TEXT, 'texto de aviso'],
  ['--warning-text', '--warning-soft', TEXT, 'etiqueta de aviso'],
  ['--destructive-text', '--card', TEXT, 'texto de peligro'],
  ['--destructive-text', '--background', TEXT, 'texto de peligro'],
  ['--destructive-text', '--destructive-soft', TEXT, 'etiqueta de peligro'],
  ['--destructive-text', '--accent', TEXT, 'ítem de menú de peligro resaltado'],
  ['--info-text', '--card', TEXT, 'texto informativo'],
  ['--info-text', '--background', TEXT, 'texto informativo'],
  ['--info-text', '--info-soft', TEXT, 'etiqueta informativa'],
  ['--brand-text', '--brand-soft', TEXT, 'etiqueta de marca'],
  ['--warning-foreground', '--warning', TEXT, 'chip ámbar relleno'],
  ['--gold-foreground', '--gold', TEXT, 'sello dorado'],
  ['--gold-text', '--gold-soft', TEXT, 'etiqueta del club'],
  ['--background', '--foreground', TEXT, 'tooltip'],
  ['--input', '--card', UI, 'borde de campo, pista del switch, paso por venir'],
  ['--input', '--background', UI, 'borde de campo'],
  ['--input', '--muted', UI, 'borde de campo'],
  ['--card', '--input', UI, 'perilla del switch sobre la pista'],
  ['--ring', '--background', UI, 'foco'],
  ['--ring', '--card', UI, 'foco'],
  ['--ring', '--selected sobre --background', UI, 'foco y barra del ítem activo'],
  ['--warning', '--card', UI, 'punto o ícono de aviso'],
  ['--warning', '--background', UI, 'punto o ícono de aviso'],
  ['--warning', '--warning-soft', UI, 'ícono de aviso en su fondo'],
  ['--chart-1', '--card', UI, 'gráfico'],
  ['--chart-2', '--card', UI, 'gráfico'],
  ['--chart-3', '--card', UI, 'gráfico'],
  ['--chart-4', '--card', UI, 'gráfico'],
  ['--chart-5', '--card', UI, 'gráfico'],
]

const DARK_PAIRS: readonly Pair[] = [
  ['--foreground', '--card', TEXT, 'texto principal'],
  ['--foreground', '--background', TEXT, 'texto principal'],
  ['--foreground', '--muted', TEXT, 'encabezado de tabla'],
  ['--foreground', '--popover', TEXT, 'menú'],
  ['--foreground', '--secondary', TEXT, 'chip'],
  ['--foreground', '--accent', TEXT, 'opción resaltada'],
  ['--muted-foreground', '--card', TEXT, 'texto secundario'],
  ['--muted-foreground', '--background', TEXT, 'texto secundario'],
  ['--muted-foreground', '--muted', TEXT, 'texto secundario'],
  ['--muted-foreground', '--popover', TEXT, 'texto secundario en menú'],
  ['--muted-foreground', '--secondary', TEXT, 'etiqueta neutra'],
  ['--muted-foreground', '--accent', TEXT, 'listbox'],
  ['--muted-foreground', '--selected sobre --card', TEXT, 'fila elegida'],
  ['--muted-foreground', '--success-soft', TEXT, 'cuerpo de Callout'],
  ['--muted-foreground', '--warning-soft', TEXT, 'cuerpo de Callout'],
  ['--muted-foreground', '--destructive-soft', TEXT, 'cuerpo de Callout'],
  ['--muted-foreground', '--info-soft', TEXT, 'cuerpo de Callout'],
  ['--subtle-foreground', '--card', TEXT, 'apoyo de 12 px y placeholder'],
  ['--subtle-foreground', '--background', TEXT, 'apoyo de 12 px'],
  ['--subtle-foreground', '--muted', TEXT, 'apoyo de 12 px'],
  ['--subtle-foreground', '--popover', TEXT, 'apoyo en menú'],
  ['--subtle-foreground', '--secondary', TEXT, 'apoyo en chip'],
  ['--subtle-foreground', '--accent', TEXT, 'apoyo en listbox'],
  ['--subtle-foreground', '--selected sobre --background', TEXT, 'apoyo en ítem activo'],
  ['--subtle-foreground', '--selected sobre --card', TEXT, 'celda de fila elegida'],
  ['--primary', '--card', TEXT, 'link, foco y contorno de lo elegido'],
  ['--primary', '--background', TEXT, 'link, foco y contorno de lo elegido'],
  ['--primary', '--popover', TEXT, 'check de la opción elegida'],
  ['--primary', '--secondary', TEXT, 'contorno del segmentado elegido'],
  ['--primary', '--selected sobre --background', TEXT, 'ícono y barra del ítem activo'],
  ['--primary-foreground', '--primary', TEXT, 'botón principal'],
  ['--primary-foreground', '--primary-hover', TEXT, 'botón principal en hover'],
  ['--destructive-foreground', '--destructive', TEXT, 'botón de peligro'],
  ['--destructive-foreground', '--destructive-hover', TEXT, 'botón de peligro en hover'],
  ['--success-text', '--card', TEXT, 'texto de éxito'],
  ['--success-text', '--success-soft', TEXT, 'etiqueta de éxito'],
  ['--warning-text', '--card', TEXT, 'texto de aviso'],
  ['--warning-text', '--warning-soft', TEXT, 'etiqueta de aviso'],
  ['--destructive-text', '--card', TEXT, 'texto de peligro'],
  ['--destructive-text', '--destructive-soft', TEXT, 'etiqueta de peligro'],
  ['--info-text', '--card', TEXT, 'texto informativo'],
  ['--info-text', '--info-soft', TEXT, 'etiqueta informativa'],
  ['--gold-text', '--gold-soft', TEXT, 'etiqueta del club'],
  ['--brand-text', '--brand-soft', TEXT, 'etiqueta de marca'],
  ['--background', '--foreground', TEXT, 'tooltip'],
  ['--input', '--card', UI, 'borde de campo y pista del switch'],
  ['--input', '--background', UI, 'borde de campo'],
  ['--input', '--muted', UI, 'borde de campo'],
  ['--input', '--popover', UI, 'borde de campo en un menú'],
  ['--card', '--input', UI, 'perilla del switch sobre la pista'],
  ['--ring', '--card', UI, 'foco'],
  ['--ring', '--background', UI, 'foco'],
  ['--success', '--card', UI, 'punto de estado'],
  ['--warning', '--card', UI, 'punto de estado'],
  ['--destructive', '--card', UI, 'punto de estado'],
  ['--info', '--card', UI, 'punto de estado'],
  ['--chart-1', '--card', UI, 'gráfico'],
  ['--chart-2', '--card', UI, 'gráfico'],
  ['--chart-3', '--card', UI, 'gráfico'],
  ['--chart-4', '--card', UI, 'gráfico'],
  ['--chart-5', '--card', UI, 'gráfico'],
]

describe('contraste de los tokens nuevos (WCAG 2.x AA)', () => {
  it.each(LIGHT_PAIRS)('claro: %s sobre %s ≥ %d:1 (%s)', (foreground, background, min) => {
    expect(ratio(light, foreground, background)).toBeGreaterThanOrEqual(min)
  })

  it.each(DARK_PAIRS)('oscuro: %s sobre %s ≥ %d:1 (%s)', (foreground, background, min) => {
    expect(ratio(dark, foreground, background)).toBeGreaterThanOrEqual(min)
  })

  /**
   * La barra de antigüedad tiene cinco tramos contiguos y en cada modo uno
   * queda debajo de 3:1 contra la tarjeta («vence pronto» en claro, «1 a 30
   * días» en oscuro). Es una excepción medida: por eso la leyenda con montos
   * es obligatoria y los tramos van separados. Lo que no puede pasar es que
   * baje de 2:1 o que otro tramo se sume a la excepción.
   */
  it.each([
    ['claro', light, '--aging-soon'],
    ['oscuro', dark, '--aging-1-30'],
  ] as const)('antigüedad de deuda en %s: un solo tramo debajo de 3:1, y nunca debajo de 2:1', (_mode, tokens, exception) => {
    const segments = [
      '--aging-current',
      '--aging-soon',
      '--aging-1-30',
      '--aging-31-60',
      '--aging-60-plus',
    ]
    for (const segment of segments) {
      const min = segment === exception ? 2 : UI
      expect(ratio(tokens, segment, '--card'), segment).toBeGreaterThanOrEqual(min)
    }
  })

  it('con prefers-contrast: more el borde de campo pasa de 3:1 a texto (4,5:1)', () => {
    const media = '@media (prefers-contrast: more)'
    const lightInput = resolveToken(scope(SCOPE.newLight, media).tokens, '--input')
    const darkInput = resolveToken(scope(SCOPE.newDark, media).tokens, '--input')
    expect(contrastRatio(lightInput, resolveToken(light, '--card'))).toBeGreaterThanOrEqual(TEXT)
    expect(contrastRatio(lightInput, resolveToken(light, '--background'))).toBeGreaterThanOrEqual(
      TEXT,
    )
    expect(contrastRatio(darkInput, resolveToken(dark, '--card'))).toBeGreaterThanOrEqual(TEXT)
  })
})

describe('lib/color/contrast', () => {
  it('blanco contra negro da 21 y un color contra sí mismo da 1, en cualquier orden', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#194534', '#194534')).toBeCloseTo(1, 5)
    expect(relativeLuminance('white')).toBeCloseTo(1, 5)
    expect(relativeLuminance('black')).toBe(0)
  })

  it('convierte OKLCH a sRGB como la tabla del kit (tinta, papel, cartulina, verde)', () => {
    expect(toHex('oklch(0.204 0.035 165)')).toBe('#051c13')
    expect(toHex('oklch(0.956 0.021 88.7)')).toBe('#f6f0e1')
    expect(toHex('oklch(0.994 0.006 84.6)')).toBe('#fffdf9')
    expect(toHex('oklch(0.354 0.057 165)')).toBe('#194534')
    expect(toHex('oklch(0.16 0.021 165.2)')).toBe('#05100b')
    expect(contrastRatio('oklch(0.204 0.035 165)', 'oklch(0.994 0.006 84.6)')).toBeCloseTo(17.48, 2)
    expect(contrastRatio('oklch(0.621 0.015 88.7)', 'oklch(0.956 0.021 88.7)')).toBeCloseTo(3.19, 2)
  })

  it('entiende la escritura minificada y las variantes de OKLCH', () => {
    // Lo que deja un CSS minificado y lo que devuelve getComputedStyle.
    expect(toHex('oklch(15.5% .022 165)')).toBe(toHex('oklch(0.155 0.022 165)'))
    expect(toHex('oklch(0.5 0.1 180deg)')).toBe(toHex('oklch(0.5 0.1 180)'))
    expect(toHex('oklch(0.5 0.1 0.5turn)')).toBe(toHex('oklch(0.5 0.1 180)'))
    expect(toHex('oklch(0.5 25% 180)')).toBe(toHex('oklch(0.5 0.1 180)'))
    expect(toHex('oklch(0.5 none none)')).toBe(toHex('oklch(0.5 0 0)'))
    expect(toHex('OKLCH(0.5 0.1 180)')).toBe(toHex('oklch(0.5 0.1 180)'))
    expect(parseColor('oklab(0.5 0 0)')).toEqual(parseColor('oklch(0.5 0 0)'))
  })

  it('entiende hex, rgb() y color(srgb …), con y sin alfa', () => {
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, alpha: 1 })
    expect(toHex('#0a693c')).toBe('#0a693c')
    expect(parseColor('#00000080')?.alpha).toBeCloseTo(128 / 255, 5)
    expect(parseColor('#0008')?.alpha).toBeCloseTo(136 / 255, 5)
    expect(toHex('rgb(25, 69, 52)')).toBe('#194534')
    expect(toHex('rgb(25 69 52)')).toBe('#194534')
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 1, g: 0, b: 0, alpha: 0.5 })
    expect(parseColor('rgb(100% 0% 0% / 50%)')).toEqual({ r: 1, g: 0, b: 0, alpha: 0.5 })
    expect(parseColor('color(srgb 1 0 0 / 0.25)')).toEqual({ r: 1, g: 0, b: 0, alpha: 0.25 })
    expect(toHex('color(srgb-linear 1 1 1)')).toBe('#ffffff')
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, alpha: 0 })
  })

  it('compone el alfa sobre el fondo como el navegador', () => {
    // «Hover» y «seleccionado» del papel: los hex de la tabla de la especificación.
    expect(toHex(composite('oklch(0.204 0.035 165 / 5%)', 'oklch(0.956 0.021 88.7)'))).toBe(
      '#eae5d7',
    )
    expect(toHex(composite('oklch(0.354 0.057 165 / 10%)', 'oklch(0.956 0.021 88.7)'))).toBe(
      '#e0dfd0',
    )
    // contrastRatio compone solo: tinta al 50 % sobre blanco.
    expect(contrastRatio('rgb(0 0 0 / 50%)', '#fff')).toBeCloseTo(
      contrastRatio('#808080', '#fff'),
      1,
    )
    // Un fondo con alfa se compone sobre el respaldo (blanco si no se dice).
    expect(contrastRatio('#000', 'rgb(0 0 0 / 0%)')).toBeCloseTo(21, 5)
    expect(contrastRatio('#fff', 'rgb(0 0 0 / 0%)', '#000')).toBeCloseTo(21, 5)
  })

  it('un color que no se entiende no se inventa', () => {
    for (const bad of [
      '',
      'verde',
      '#12345',
      '#ggg',
      'oklch(0.5 0.1)',
      'rgb(1 2)',
      'hsl(0 0% 0%)',
      'color(display-p3 1 0 0)',
    ]) {
      expect(parseColor(bad), bad).toBeNull()
    }
    expect(() => toRgba('verde')).toThrow('No se entiende el color: verde')
    expect(() => contrastRatio('verde', '#fff')).toThrow()
  })
})
