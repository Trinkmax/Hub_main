// @vitest-environment node
import { createElement as h, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AgingBar,
  type AgingBarBucket,
  agingBucketLabel,
  agingSummaryLabel,
} from '@/components/accounting/aging-bar'
import { agingBuckets } from '@/lib/accounting/aging'

/**
 * `AgingBar` (kit §3.8): la antigüedad de la deuda en cinco tramos contiguos.
 *
 * Lo que se fija:
 * 1. Las etiquetas de los tramos (el texto acompaña siempre al color).
 * 2. La barra es `role="img"` con el resumen en palabras; solo dibuja los
 *    tramos con deuda, en orden y con la paleta `--aging-*`.
 * 3. La leyenda es la tabla: una fila por tramo con muestra, etiqueta, importe
 *    y cantidad; con `hrefFor`, links (solo los tramos con deuda).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    h('a', { href, ...rest }, children),
}))

const NBSP = ' '

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

const textOf = (html: string) => unescapeHtml(html.replace(/<[^>]+>/g, ''))

function elementAt(html: string, start: number): string {
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1]
  if (!tag) throw new Error('sin elemento')
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g')
  re.lastIndex = start
  let depth = 0
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(start, m.index + m[0].length)
  }
  throw new Error(`<${tag}> sin cerrar`)
}

function elementsWith(html: string, attr: string): string[] {
  const out: string[] = []
  const re = /<[a-z0-9]+[^>]*>/g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].includes(attr)) out.push(elementAt(html, m.index))
  }
  return out
}

function attrsOf(element: string): Record<string, string> {
  const open = element.slice(0, element.indexOf('>'))
  return Object.fromEntries(
    [...open.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', unescapeHtml(v ?? '')]),
  )
}

/** Proveedor con $ 860.000 al día y $ 380.000 vencidos hace 1 a 30 días (el ejemplo del kit). */
const SUPPLIER: AgingBarBucket[] = [
  { bucket: 'overdue-1-30', cents: 38000000, count: 1 },
  { bucket: 'current', cents: 86000000, count: 2 },
]

describe('AgingBar · etiquetas de los tramos', () => {
  it('las cinco etiquetas, con «vence pronto» según los días del bar', () => {
    expect(agingBucketLabel('current')).toBe('Al día')
    expect(agingBucketLabel('soon')).toBe('Vence en 7 días')
    expect(agingBucketLabel('soon', 10)).toBe('Vence en 10 días')
    expect(agingBucketLabel('soon', 1)).toBe('Vence mañana')
    expect(agingBucketLabel('overdue-1-30')).toBe('Vencida de 1 a 30 días')
    expect(agingBucketLabel('overdue-31-60')).toBe('Vencida de 31 a 60 días')
    expect(agingBucketLabel('overdue-60-plus')).toBe('Vencida hace más de 60 días')
  })

  it('la leyenda completa: una fila por tramo, en orden, con etiqueta, importe y cantidad', () => {
    const html = renderToStaticMarkup(<AgingBar buckets={SUPPLIER} soonDays={10} />)
    const items = elementsWith(html, 'data-slot="aging-bar-legend-item"')
    expect(items.map((item) => attrsOf(item)['data-bucket'])).toEqual([
      'current',
      'soon',
      'overdue-1-30',
      'overdue-31-60',
      'overdue-60-plus',
    ])
    const texts = items.map(textOf)
    // La cantidad va al costado desde sm y debajo de la etiqueta en el celular (una sola visible).
    expect(texts[0]).toBe(`Al día2 comprobantes$${NBSP}860.000,002 comprobantes`)
    const countClasses = [
      ...(items[0] ?? '').matchAll(/<span class="([^"]*)">2 comprobantes<\/span>/g),
    ].map((m) => m[1])
    expect(countClasses).toHaveLength(2)
    expect(countClasses[0]).toContain('sm:hidden')
    expect(countClasses[1]).toContain('max-sm:hidden')
    expect(texts[1]).toContain('Vence en 10 días')
    expect(texts[1]).toContain(`$${NBSP}0,00`)
    expect(texts[2]).toBe(`Vencida de 1 a 30 días1 comprobante$${NBSP}380.000,001 comprobante`)
    expect(texts[3]).toContain('Vencida de 31 a 60 días')
    expect(texts[4]).toContain('Vencida hace más de 60 días')
    // La muestra de color acompaña y no se lee.
    const swatch = elementsWith(items[0] ?? '', 'aria-hidden="true"')[0] ?? ''
    expect(attrsOf(swatch).class).toContain('bg-aging-current')
  })
})

describe('AgingBar · la barra', () => {
  const html = renderToStaticMarkup(<AgingBar buckets={SUPPLIER} data-tour="antiguedad" />)
  const track = elementsWith(html, 'data-slot="aging-bar-track"')[0] ?? ''

  it('role="img" con el resumen en palabras (solo los tramos con deuda)', () => {
    expect(attrsOf(track).role).toBe('img')
    expect(attrsOf(track)['aria-label']).toBe(
      `Deuda total $${NBSP}1.240.000,00: al día $${NBSP}860.000,00; vencida de 1 a 30 días $${NBSP}380.000,00`,
    )
  })

  it('sin centavos al lado de KPIs redondeados', () => {
    expect(agingSummaryLabel(SUPPLIER, { decimals: 0 })).toBe(
      `Deuda total $${NBSP}1.240.000: al día $${NBSP}860.000; vencida de 1 a 30 días $${NBSP}380.000`,
    )
  })

  it('dibuja solo los tramos con deuda, en orden, proporcionales y con mínimo de 4 px', () => {
    const segments = elementsWith(track, 'data-slot="aging-bar-segment"').map(attrsOf)
    expect(segments.map((s) => s['data-bucket'])).toEqual(['current', 'overdue-1-30'])
    expect(segments[0]?.class).toContain('bg-aging-current')
    expect(segments[1]?.class).toContain('bg-aging-1-30')
    for (const segment of segments) expect(segment.class).toContain('min-w-1')
    const grow = segments.map((s) => Number(/flex:\s*([\d.]+)/.exec(s.style ?? '')?.[1]))
    expect(grow[0]).toBeCloseTo(860 / 1240, 6)
    expect(grow[1]).toBeCloseTo(380 / 1240, 6)
  })

  it('rounded-full, 2 px de separación y 12 px de alto (8 px en sm)', () => {
    const cls = attrsOf(track).class ?? ''
    expect(cls).toContain('rounded-full')
    expect(cls).toContain('gap-0.5')
    expect(cls).toContain('h-3')
    const small = renderToStaticMarkup(<AgingBar buckets={SUPPLIER} size="sm" legend="none" />)
    expect(attrsOf(elementsWith(small, 'data-slot="aging-bar-track"')[0] ?? '').class).toContain(
      'h-2',
    )
  })

  it('pasa data-tour a la raíz', () => {
    expect(attrsOf(elementsWith(html, 'data-slot="aging-bar"')[0] ?? '')['data-tour']).toBe(
      'antiguedad',
    )
  })
})

describe('AgingBar · leyendas y links', () => {
  it('con hrefFor, solo los tramos con deuda son links que filtran la lista', () => {
    const html = renderToStaticMarkup(
      <AgingBar
        buckets={SUPPLIER}
        hrefFor={(bucket) => `/hub/administracion/compras?tramo=${bucket}`}
      />,
    )
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])
    expect(links).toEqual([
      '/hub/administracion/compras?tramo=current',
      '/hub/administracion/compras?tramo=overdue-1-30',
    ])
  })

  it('compacta: solo los tramos con deuda, sin cantidades', () => {
    const html = renderToStaticMarkup(<AgingBar buckets={SUPPLIER} legend="compact" />)
    const items = elementsWith(html, 'data-slot="aging-bar-legend-item"').map(textOf)
    expect(items).toEqual([`Al día$${NBSP}860.000,00`, `Vencida de 1 a 30 días$${NBSP}380.000,00`])
    expect(html).not.toContain('comprobante')
  })

  it('sin leyenda (con una tabla al lado), la barra sola', () => {
    const html = renderToStaticMarkup(<AgingBar buckets={SUPPLIER} legend="none" />)
    expect(html).not.toContain('data-slot="aging-bar-legend"')
    expect(html).toContain('role="img"')
  })

  it('sin deuda: pista apagada, ningún tramo y «Sin deuda» para el lector', () => {
    const html = renderToStaticMarkup(<AgingBar buckets={[]} legend="none" />)
    const track = attrsOf(elementsWith(html, 'data-slot="aging-bar-track"')[0] ?? '')
    expect(track['aria-label']).toBe('Sin deuda')
    expect(track.class).toContain('bg-muted')
    expect(html).not.toContain('data-slot="aging-bar-segment"')
  })

  it('con un total mayor (partidas sin vencimiento), el resumen lo dice', () => {
    expect(agingSummaryLabel(SUPPLIER, { totalCents: 130000000, totalLabel: 'Le debés' })).toBe(
      `Le debés $${NBSP}1.300.000,00: al día $${NBSP}860.000,00; vencida de 1 a 30 días $${NBSP}380.000,00; sin vencimiento $${NBSP}60.000,00`,
    )
  })

  it('toma lo que arma agingBuckets del motor', () => {
    const buckets = agingBuckets(
      [
        { dueDate: '2026-10-20', openCents: 50000 },
        { dueDate: '2026-10-09', openCents: 20000 },
        { dueDate: '2026-09-20', openCents: 10000 },
        { dueDate: '2026-07-01', openCents: 5000 },
      ],
      '2026-10-07',
    )
    const html = renderToStaticMarkup(<AgingBar buckets={buckets} legend="none" />)
    const segments = elementsWith(html, 'data-slot="aging-bar-segment"').map(
      (s) => attrsOf(s)['data-bucket'],
    )
    expect(segments).toEqual(['current', 'soon', 'overdue-1-30', 'overdue-60-plus'])
  })
})
