// @vitest-environment node
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ComponentCatalog } from '@/app/(manager)/[tenantSlug]/docs/componentes/_components/catalog/component-catalog'
import {
  DARK_PAIRS,
  LIGHT_PAIRS,
  layersOf,
  tokensOf,
} from '@/app/(manager)/[tenantSlug]/docs/componentes/_components/catalog/contrast-pairs'
import {
  CATALOG_FAMILIES,
  catalogProbes,
  tourId,
} from '@/app/(manager)/[tenantSlug]/docs/componentes/_components/catalog/registry'
import { composite, contrastRatio } from '@/lib/color/contrast'
import {
  parseTokenRules,
  readGlobalsCss,
  resolveToken,
  rulesFor,
  SCOPE,
} from './globals-css-tokens'

/**
 * El catálogo de componentes (kit HUB §6), renderizado entero en el server:
 *
 * - **§3.0, el test de render del catálogo:** con `eager` (todos los ejemplos
 *   montados de entrada), cada componente se monta con
 *   `data-tour="catalogo-…"` y el atributo tiene que llegar al DOM, en los dos
 *   paneles (claro y oscuro). Los 46 anclajes de los tours dependen de eso.
 * - Cada familia y cada bloque del índice se dibuja con su ancla, y cada
 *   bloque tiene sus dos paneles de tema (`.theme-light` y `.theme-dark`).
 * - El primer HTML sale sin avisos de React ni del kit en la consola (claves
 *   repetidas, botones de ícono sin nombre…).
 * - Los pares de la tabla de contraste en vivo existen en `globals.css` y
 *   llegan a su mínimo (la misma cuenta que tokens-contrast.test.ts).
 */

// Afuera de Next no hay router: el pathname es el del catálogo y la query, vacía.
const nav = vi.hoisted(() => ({ pathname: '/bar-de-ejemplo/docs/componentes' }))
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return {
    ...actual,
    usePathname: () => nav.pathname,
    useSearchParams: () =>
      new URLSearchParams() as unknown as ReturnType<typeof actual.useSearchParams>,
  }
})

const TODAY = '2026-10-07'

let markup = ''
const consoleCalls: string[] = []

beforeAll(() => {
  const record =
    (kind: string) =>
    (...args: unknown[]) => {
      consoleCalls.push(`${kind}: ${args.map(String).join(' ')}`)
    }
  const error = vi.spyOn(console, 'error').mockImplementation(record('error'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(record('warn'))
  try {
    markup = renderToString(<ComponentCatalog tenantSlug="bar-de-ejemplo" today={TODAY} eager />)
  } finally {
    error.mockRestore()
    warn.mockRestore()
  }
})

afterAll(() => {
  markup = ''
})

function count(text: string, needle: string): number {
  let n = 0
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    n += 1
  }
  return n
}

describe('el registro del catálogo', () => {
  it('ids de familias y bloques únicos (son anclas de la misma página)', () => {
    const ids = CATALOG_FAMILIES.flatMap((family) => [
      family.id,
      ...family.blocks.map((block) => block.id),
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sondas únicas: cada data-tour nombra un solo componente', () => {
    const probes = catalogProbes()
    expect(new Set(probes).size).toBe(probes.length)
    expect(tourId('button')).toBe('catalogo-button')
  })
})

describe('el catálogo renderizado en el server', () => {
  it('dibuja sin avisos de React ni del kit en la consola', () => {
    expect(consoleCalls).toEqual([])
  })

  it('dibuja cada familia y cada bloque del índice con su ancla', () => {
    for (const family of CATALOG_FAMILIES) {
      expect(markup, family.id).toContain(`id="${family.id}"`)
      for (const block of family.blocks) {
        expect(markup, block.id).toContain(`id="${block.id}"`)
        // El índice tiene un link a cada bloque.
        expect(markup, block.id).toContain(`href="#${block.id}"`)
      }
    }
  })

  it('cada bloque tiene su panel claro y su panel oscuro', () => {
    const blocks = CATALOG_FAMILIES.reduce((n, family) => n + family.blocks.length, 0)
    expect(count(markup, 'data-slot="catalog-panel"')).toBe(blocks * 2)
    expect(count(markup, 'data-theme="light"')).toBe(blocks)
    expect(count(markup, 'data-theme="dark"')).toBe(blocks)
    expect(count(markup, 'aria-label="Ejemplo en claro"')).toBe(blocks)
    expect(count(markup, 'aria-label="Ejemplo en oscuro"')).toBe(blocks)
  })

  it('cada componente deja llegar data-tour al DOM, en los dos temas (§3.0)', () => {
    for (const probe of catalogProbes()) {
      expect(count(markup, `data-tour="${tourId(probe)}"`), probe).toBeGreaterThanOrEqual(2)
    }
  })

  it('marca los datos de ejemplo y no dibuja el claro congelado', () => {
    expect(markup).toContain('Datos de ejemplo')
    expect(markup).not.toContain('force-light')
    expect(markup).not.toContain('legacy-theme')
  })

  it('el encabezado: un PageHeader «Componentes» con la vista y la densidad', () => {
    expect(markup).toContain('Componentes</h1>')
    expect(markup).toContain('aria-label="Temas a la vista"')
    expect(markup).toContain('Densidad compacta')
  })
})

describe('el catálogo sin `eager` (la página)', () => {
  it('manda el índice, los encabezados y las notas, con los ejemplos por montar', () => {
    const lazy = renderToString(<ComponentCatalog tenantSlug="bar-de-ejemplo" today={TODAY} />)
    const blocks = CATALOG_FAMILIES.reduce((n, family) => n + family.blocks.length, 0)
    expect(count(lazy, 'data-slot="catalog-panel-placeholder"')).toBe(blocks * 2)
    expect(count(lazy, 'aria-busy="true"')).toBeGreaterThanOrEqual(blocks * 2)
    for (const family of CATALOG_FAMILIES) {
      for (const block of family.blocks) expect(lazy, block.id).toContain(`id="${block.id}"`)
    }
    // Ningún ejemplo montado todavía: el primer HTML es una fracción del completo.
    expect(lazy).not.toContain(`data-tour="${tourId('button')}"`)
    expect(lazy.length).toBeLessThan(markup.length / 3)
  })
})

describe('los pares de la tabla de contraste en vivo (§6.4)', () => {
  const rules = parseTokenRules(readGlobalsCss())
  const scope = (selectors: string) => {
    const [rule] = rulesFor(rules, selectors, null).filter((r) => r.tokens.size > 0)
    if (!rule) throw new Error(`globals.css: falta el bloque «${selectors}»`)
    return rule.tokens
  }
  const light = scope(SCOPE.newLight)
  const dark = scope(SCOPE.newDark)

  const paint = (tokens: Map<string, string>, layer: string) => {
    const [top, under] = layersOf(layer)
    const color = resolveToken(tokens, top)
    return under === undefined ? color : composite(color, resolveToken(tokens, under))
  }

  it.each([
    ['claro', LIGHT_PAIRS, light],
    ['oscuro', DARK_PAIRS, dark],
  ] as const)('en %s, cada token existe y cada par llega a su mínimo', (_mode, pairs, tokens) => {
    for (const token of tokensOf(pairs)) expect(() => resolveToken(tokens, token)).not.toThrow()
    for (const pair of pairs) {
      const ratio = contrastRatio(paint(tokens, pair.fg), paint(tokens, pair.bg))
      expect(ratio, `${pair.fg} sobre ${pair.bg}`).toBeGreaterThanOrEqual(pair.min)
    }
  })

  it('separa las capas de «token sobre token»', () => {
    expect(layersOf('--selected sobre --card')).toEqual(['--selected', '--card'])
    expect(layersOf('--card')).toEqual(['--card'])
    expect(tokensOf([{ fg: '--a', bg: '--b sobre --c', min: 3, use: '' }])).toEqual([
      '--a',
      '--b',
      '--c',
    ])
  })
})
