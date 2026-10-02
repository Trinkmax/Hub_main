// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MoneyShareDonut } from '@/app/(manager)/[tenantSlug]/estadisticas/como-nos-fue/_components/money-share-donut'
import { buildMoneyShare, type MoneyTotals } from '@/lib/salon/money-share'

/**
 * El primer paint (SSR) de la dona «Cómo se repartió el ingreso» (02/10/2026).
 * Lo que se prueba es lo que andaba mal antes de hidratar y para el lector:
 *
 * 1. Con recharts el HTML del server traía solo el riel gris (recharts 3 mide
 *    el gráfico en un efecto y no dibuja nada hasta hidratar): hasta entonces
 *    toda dona se veía como el aro vacío de «quedó abajo».
 * 2. El centro (el ingreso, que en «Por evento» no está escrito en ningún otro
 *    lado) estaba adentro de un `aria-hidden`: el lector nunca lo oía.
 */

const NBSP = ' '

function totals(over: Partial<MoneyTotals>): MoneyTotals {
  return {
    revenueArs: 0,
    costArs: 0,
    adSpendArs: 0,
    resultArs: 0,
    dates: 3,
    organicDates: 0,
    ...over,
  }
}

// 2x1 Burger Martes con los datos reales del 02/10: 24,1 / 51,7 / 24,2 %.
const REPARTO = buildMoneyShare(
  totals({ revenueArs: 1_971_000, costArs: 1_019_700, adSpendArs: 474_406, resultArs: 476_894 }),
  { base: 'En las 3 fechas con la cuenta cerrada' },
)
// Solo el 01/09: la cuenta quedó abajo.
const ABAJO = buildMoneyShare(
  totals({ revenueArs: 350_000, costArs: 196_000, adSpendArs: 227_600, resultArs: -73_600 }),
  { base: 'En la única fecha con la cuenta cerrada' },
)

const render = (data: typeof REPARTO) => renderToString(createElement(MoneyShareDonut, { data }))

/** Los `<circle>` del HTML, con sus atributos. */
function circles(html: string): Array<Record<string, string>> {
  return [...html.matchAll(/<circle([^>]*)>/g)].map(([, attrs]) =>
    Object.fromEntries(
      [...(attrs ?? '').matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', v ?? '']),
    ),
  )
}

const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'wbr'])

/** El texto que le llega al lector: todo, menos lo que está adentro de un `aria-hidden="true"`. */
function readable(html: string): string {
  const out: string[] = []
  const hidden: boolean[] = []
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    const [, closing, tag, attrs, text] = m
    if (text !== undefined) {
      if (!hidden.includes(true)) out.push(text)
    } else if (tag !== undefined) {
      if (closing) hidden.pop()
      else if (!VOID.has(tag)) hidden.push(/\saria-hidden="true"/.test(attrs ?? ''))
    }
  }
  // Solo los espacios comunes: `\s` también se comería el espacio duro de los montos.
  return out.join(' ').replace(/[ \t\r\n]+/g, ' ')
}

describe('la dona sale entera en el HTML del server', () => {
  it('reparto: las tres porciones, en orden, sin el riel gris y sin recharts', () => {
    const html = render(REPARTO)
    const rings = circles(html)
    expect(rings.map((c) => c.stroke)).toEqual([
      'var(--viz-pauta)',
      'var(--viz-costo)',
      'var(--viz-resultado)',
    ])
    expect(html).not.toContain('var(--muted)')
    expect(html).not.toContain('recharts')
  })

  it('cada porción mide su parte de la vuelta, menos los 2 px de hueco', () => {
    const turn = 2 * Math.PI * 62
    const dashes = circles(render(REPARTO)).map((c) =>
      (c['stroke-dasharray'] ?? '').split(' ').map(Number),
    )
    const total = 474_406 + 1_019_700 + 476_894
    const expected = [474_406, 1_019_700, 476_894].map((v) => (v / total) * turn - 2)
    dashes.forEach(([dash, rest], i) => {
      expect(dash).toBeCloseTo(expected[i] ?? 0, 2)
      // Cada patrón es exactamente una vuelta: no se repite.
      expect((dash ?? 0) + (rest ?? 0)).toBeCloseTo(turn, 2)
    })
  })

  it('cuenta abajo: solo el riel, sin porciones', () => {
    const rings = circles(render(ABAJO))
    expect(rings.map((c) => c.stroke)).toEqual(['var(--muted)'])
  })

  it('una sola porción: el aro entero, sin hueco', () => {
    const solo = buildMoneyShare(
      totals({ revenueArs: 100_000, costArs: 100_000, adSpendArs: 0, resultArs: 0 }),
      { base: 'x' },
    )
    const rings = circles(render(solo))
    expect(rings).toHaveLength(1)
    expect(rings[0]?.stroke).toBe('var(--viz-costo)')
    expect(rings[0]?.['stroke-dasharray']).toBeUndefined()
  })
})

describe('el lector', () => {
  it('no oye el dibujo: el svg va aria-hidden', () => {
    expect(render(REPARTO)).toMatch(/<svg aria-hidden="true"/)
  })

  it('oye el centro (el ingreso), la leyenda y la oración', () => {
    const text = readable(render(REPARTO))
    expect(text).toContain(`$${NBSP}1.971.000 de ingreso`)
    expect(text).toContain(`Pauta 24,1${NBSP}% $${NBSP}474.406`)
    expect(text).toContain(REPARTO.sentence)
  })

  it('con la cuenta abajo oye cuánto faltó', () => {
    expect(readable(render(ABAJO))).toContain(`$${NBSP}73.600 abajo`)
  })
})
