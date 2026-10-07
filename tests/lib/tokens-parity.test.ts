import { describe, expect, it } from 'vitest'
import {
  parseThemeTokens,
  parseTokenRules,
  readGlobalsCss,
  rulesFor,
  SCOPE,
  type TokenRule,
} from './globals-css-tokens'

/**
 * Paridad de tokens del kit HUB (§2.1 y §7.a de la especificación).
 *
 * Un token que falta en un scope no se nota en el scope que lo tiene: se nota
 * en el otro, que hereda el valor del `<html>`. Así, un `.theme-dark` del
 * catálogo sin `--selected` pinta el seleccionado claro, y un envoltorio
 * `.force-light` sin `--chart-1` dibuja los gráficos de la carta en oscuro.
 * Por eso cada token del claro nuevo tiene que estar declarado, tal cual, en
 * los otros tres bloques; y los valores congelados, que son los de antes del
 * kit, no se tocan hasta el rediseño del salón y lo público.
 */

const css = readGlobalsCss()
const rules = parseTokenRules(css)

function onlyRule(selectorList: string, media: string | null = null): TokenRule {
  const found = rulesFor(rules, selectorList, media).filter((rule) => rule.tokens.size > 0)
  const [rule, ...rest] = found
  if (!rule || rest.length > 0) {
    throw new Error(
      `«${selectorList}» tiene que tener un solo bloque de tokens (hay ${found.length})`,
    )
  }
  return rule
}

const newLight = onlyRule(SCOPE.newLight)
const newDark = onlyRule(SCOPE.newDark)
const frozenLight = onlyRule(SCOPE.frozenLight)
const frozenDark = onlyRule(SCOPE.frozenDark)
const invariant = onlyRule(SCOPE.invariant)

/**
 * El claro de antes del kit, como lo leía el salón: el bloque `.force-light`
 * más lo que solo estaba en `:root` (radio, plano y gráficos). Sacado del
 * globals.css anterior al kit; el chrome del salón (`--salon-*`) pasó a los
 * invariantes con el mismo valor.
 */
const FROZEN_LIGHT_VALUES: Record<string, string> = {
  '--background': 'oklch(0.965 0.022 88)',
  '--foreground': 'oklch(0.205 0.035 165)',
  '--surface': 'oklch(0.952 0.026 88)',
  '--surface-foreground': 'oklch(0.205 0.035 165)',
  '--card': 'oklch(0.985 0.014 88)',
  '--card-foreground': 'oklch(0.205 0.035 165)',
  '--popover': 'oklch(0.99 0.008 88)',
  '--popover-foreground': 'oklch(0.205 0.035 165)',
  '--primary': 'oklch(0.355 0.058 165)',
  '--primary-foreground': 'oklch(0.965 0.022 88)',
  '--secondary': 'oklch(0.92 0.022 88)',
  '--secondary-foreground': 'oklch(0.245 0.035 165)',
  '--muted': 'oklch(0.92 0.018 88)',
  '--muted-foreground': 'oklch(0.45 0.022 165)',
  '--accent': 'oklch(0.91 0.04 165)',
  '--accent-foreground': 'oklch(0.245 0.05 165)',
  '--destructive': 'oklch(0.555 0.155 35)',
  '--destructive-foreground': 'oklch(0.985 0.012 88)',
  '--success': 'oklch(0.5 0.12 155)',
  '--success-foreground': 'oklch(0.985 0.012 88)',
  '--warning': 'oklch(0.71 0.135 70)',
  '--warning-foreground': 'oklch(0.225 0.05 70)',
  '--warning-text': 'oklch(0.46 0.12 62)',
  '--info': 'oklch(0.55 0.075 215)',
  '--info-foreground': 'oklch(0.985 0.012 88)',
  '--border': 'oklch(0.86 0.018 88)',
  '--input': 'oklch(0.88 0.018 88)',
  '--ring': 'oklch(0.355 0.058 165 / 55%)',
  '--viz-pauta': 'oklch(0.61 0.15 55)',
  '--viz-costo': 'oklch(0.46 0.13 250)',
  '--viz-resultado': 'oklch(0.64 0.11 180)',
  '--tenant-accent': 'var(--primary)',
  '--tenant-accent-foreground': 'var(--primary-foreground)',
  '--cream-tint': 'oklch(0.965 0.022 88 / 65%)',
  '--forest-glow': 'oklch(0.355 0.058 165 / 18%)',
  '--brand-rose': 'var(--destructive)',
  '--brand-amber': 'var(--warning)',
  '--brand-teal': 'var(--info)',
  '--brand-accent': 'var(--primary)',
  '--brand-accent-foreground': 'var(--primary-foreground)',
  '--radius': '0.625rem',
  '--wall': 'oklch(0.32 0.02 165)',
  '--wall-foreground': 'oklch(0.96 0.012 88)',
  '--wall-border': 'oklch(0.24 0.025 165)',
  '--seat': 'oklch(0.83 0.016 88)',
  '--seat-border': 'oklch(0.7 0.022 165)',
  '--chart-1': 'oklch(0.355 0.058 165)',
  '--chart-2': 'oklch(0.555 0.155 35)',
  '--chart-3': 'oklch(0.71 0.135 70)',
  '--chart-4': 'oklch(0.5 0.075 240)',
  '--chart-5': 'oklch(0.62 0.08 25)',
}

/** El oscuro de antes del kit (bloque `.dark`, más el radio que venía de `:root`). */
const FROZEN_DARK_VALUES: Record<string, string> = {
  '--background': 'oklch(0.155 0.022 165)',
  '--foreground': 'oklch(0.945 0.015 88)',
  '--surface': 'oklch(0.18 0.022 165)',
  '--surface-foreground': 'oklch(0.945 0.015 88)',
  '--card': 'oklch(0.215 0.025 165)',
  '--card-foreground': 'oklch(0.945 0.015 88)',
  '--popover': 'oklch(0.225 0.025 165)',
  '--popover-foreground': 'oklch(0.945 0.015 88)',
  '--primary': 'oklch(0.78 0.105 88)',
  '--primary-foreground': 'oklch(0.18 0.04 165)',
  '--secondary': 'oklch(0.27 0.025 165)',
  '--secondary-foreground': 'oklch(0.945 0.015 88)',
  '--muted': 'oklch(0.255 0.022 165)',
  '--muted-foreground': 'oklch(0.66 0.015 88)',
  '--wall': 'oklch(0.42 0.018 165)',
  '--wall-foreground': 'oklch(0.97 0.01 88)',
  '--wall-border': 'oklch(0.52 0.02 165)',
  '--seat': 'oklch(0.56 0.02 165)',
  '--seat-border': 'oklch(0.68 0.022 165)',
  '--accent': 'oklch(0.32 0.05 165)',
  '--accent-foreground': 'oklch(0.92 0.04 88)',
  '--destructive': 'oklch(0.66 0.165 35)',
  '--destructive-foreground': 'oklch(0.155 0.035 35)',
  '--success': 'oklch(0.7 0.135 155)',
  '--success-foreground': 'oklch(0.16 0.04 155)',
  '--warning': 'oklch(0.78 0.13 70)',
  '--warning-foreground': 'oklch(0.165 0.05 70)',
  '--warning-text': 'oklch(0.86 0.11 82)',
  '--info': 'oklch(0.7 0.085 215)',
  '--info-foreground': 'oklch(0.16 0.04 215)',
  '--border': 'oklch(1 0 0 / 9%)',
  '--input': 'oklch(1 0 0 / 13%)',
  '--ring': 'oklch(0.78 0.105 88 / 55%)',
  '--chart-1': 'oklch(0.78 0.105 88)',
  '--chart-2': 'oklch(0.66 0.165 35)',
  '--chart-3': 'oklch(0.78 0.13 70)',
  '--chart-4': 'oklch(0.65 0.075 240)',
  '--chart-5': 'oklch(0.72 0.08 25)',
  '--viz-pauta': 'oklch(0.62 0.15 55)',
  '--viz-costo': 'oklch(0.53 0.13 250)',
  '--viz-resultado': 'oklch(0.62 0.11 180)',
  '--tenant-accent': 'var(--primary)',
  '--tenant-accent-foreground': 'var(--primary-foreground)',
  '--cream-tint': 'oklch(0.215 0.025 165 / 65%)',
  '--forest-glow': 'oklch(0.78 0.105 88 / 18%)',
  '--brand-rose': 'var(--destructive)',
  '--brand-amber': 'var(--warning)',
  '--brand-teal': 'var(--info)',
  '--brand-accent': 'var(--primary)',
  '--brand-accent-foreground': 'var(--primary-foreground)',
  '--radius': '0.625rem',
}

/**
 * La mecánica de antes (los `--radius-*` y `--shadow-2xs/xs` del `@theme`
 * viejo), que ahora vive en variables de runtime: igual en claro y en oscuro.
 */
const FROZEN_MECHANICS: Record<string, string> = {
  '--r-sm': 'calc(var(--radius) - 4px)',
  '--r-md': 'calc(var(--radius) - 2px)',
  '--r-lg': 'var(--radius)',
  '--r-xl': 'calc(var(--radius) + 4px)',
  '--r-2xl': 'calc(var(--radius) + 8px)',
  '--sh-2xs': '0 1px 0 0 color-mix(in oklch, var(--foreground) 6%, transparent)',
  '--sh-xs': '0 1px 2px 0 color-mix(in oklch, var(--foreground) 8%, transparent)',
}

/** Las que pone next/font en el `<html>` (app/layout.tsx), no los scopes. */
const SET_BY_NEXT_FONT = new Set(['--font-inter', '--font-fraunces'])

const missing = (from: TokenRule, into: TokenRule) =>
  [...from.tokens.keys()].filter((name) => !into.tokens.has(name))

describe('globals.css: scopes de tokens', () => {
  it.each([
    ['oscuro nuevo', newDark],
    ['claro congelado', frozenLight],
    ['oscuro congelado', frozenDark],
  ] as const)('todo token del claro nuevo está declarado en el %s', (_name, scope) => {
    expect(missing(newLight, scope)).toEqual([])
  })

  it('los invariantes llevan los seis selectores, también en el ajuste táctil', () => {
    const coarse = onlyRule(SCOPE.invariant, '@media (pointer: coarse)')
    expect([...coarse.tokens.keys()].filter((name) => !invariant.tokens.has(name))).toEqual([])
    for (const name of ['--topbar-h', '--control-md', '--duration-menu', '--hit-min']) {
      expect(invariant.tokens.has(name), name).toBe(true)
    }
  })

  it.each([
    ['claro nuevo', newLight],
    ['oscuro nuevo', newDark],
    ['claro congelado', frozenLight],
    ['oscuro congelado', frozenDark],
  ] as const)('el %s no redeclara un invariante', (_name, scope) => {
    expect([...scope.tokens.keys()].filter((name) => invariant.tokens.has(name))).toEqual([])
  })

  it('lo que se registra en @theme existe en los scopes', () => {
    const declared = new Set([...newLight.tokens.keys(), ...invariant.tokens.keys()])
    const referenced = [...parseThemeTokens(css).values()].flatMap((value) =>
      [...value.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1] ?? ''),
    )
    expect(referenced.filter((name) => !declared.has(name) && !SET_BY_NEXT_FONT.has(name))).toEqual(
      [],
    )
  })

  it('el orden de los bloques deja a lo congelado ganando en su <html>', () => {
    // :root y .force-light empatan (0,1,0) en el <html> del salón, y .dark con
    // .legacy-theme en el de lo público: gana el último. El oscuro congelado
    // gana por especificidad, pero también va al final.
    const contrast = rules.filter((rule) => rule.media === '@media (prefers-contrast: more)')
    expect(contrast.map((rule) => rule.selectors.join(', '))).toEqual([
      SCOPE.newLight,
      SCOPE.newDark,
    ])
    const order = [invariant, newLight, newDark, ...contrast, frozenLight, frozenDark].map(
      (rule) => rule.index,
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})

describe('globals.css: lo congelado no cambia', () => {
  it.each([
    ['claro', frozenLight, FROZEN_LIGHT_VALUES],
    ['oscuro', frozenDark, FROZEN_DARK_VALUES],
  ] as const)('el %s congelado conserva los valores de antes del kit', (_name, scope, values) => {
    const actual = Object.fromEntries(
      Object.keys(values).map((name) => [name, scope.tokens.get(name)]),
    )
    expect(actual).toEqual(values)
  })

  it.each([
    ['claro', frozenLight],
    ['oscuro', frozenDark],
  ] as const)('el %s congelado conserva los radios 6/8/10/14/18 y las sombras quietas', (_name, scope) => {
    const actual = Object.fromEntries(
      Object.keys(FROZEN_MECHANICS).map((name) => [name, scope.tokens.get(name)]),
    )
    expect(actual).toEqual(FROZEN_MECHANICS)
  })
})
