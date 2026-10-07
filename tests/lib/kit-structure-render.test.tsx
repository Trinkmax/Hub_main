// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Fragment, createElement as h, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Amount, amountText } from '@/components/ui/amount'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Kbd } from '@/components/ui/kbd'
import { KbdShortcut } from '@/components/ui/kbd-shortcut'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Section } from '@/components/ui/section'
import { Separator } from '@/components/ui/separator'
import { formatNumber, formatNumberKind } from '@/lib/format/number-kind'

/**
 * Kit HUB §3.5 y §3.6: la estructura de página y los números, en el HTML del
 * server (todo esto es server-safe, salvo `KbdShortcut`).
 *
 * Lo que se fija:
 * 1. `Amount` formatea con `lib/money` (menos U+2212, espacio duro después del
 *    `$`, «D»/«A» con la palabra para el lector) y nunca dibuja `$ 0` por un
 *    faltante.
 * 2. `PageHeader` emite los `data-slot` que el `.wa` de Mensajería apunta, la
 *    línea de contexto va sin mayúsculas, y la descripción va en un `<div>`
 *    (los loaders le pasan `<Skeleton>`).
 * 3. Los KPIs son pares `<dt>`/`<dd>` de un solo `<dl>` (nunca un `<dl>`
 *    adentro de otro) y quedan quietos: el valor final, sin contar.
 * 4. Cada componente pasa `data-tour` a su raíz (los 46 anclajes de los tours).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    h('a', { href, ...rest }, children),
}))

const NBSP = ' '
const MINUS = '−'

/**
 * `data-tour` como lo pasa una página: TypeScript lo acepta en JSX pero no en
 * el objeto literal de `createElement`, así que entra por spread.
 */
const tour = (id: string): object => ({ 'data-tour': id })

const render = (el: ReactElement) => renderToStaticMarkup(el)

const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'wbr'])

/** El texto que le llega al lector: todo, menos lo que está adentro de un `aria-hidden="true"`. */
function readable(html: string): string {
  const out: string[] = []
  const hidden: boolean[] = []
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, tag, attrs, selfClosing, text] = m
    if (text !== undefined) {
      if (!hidden.includes(true)) out.push(text)
    } else if (tag !== undefined) {
      if (closing) hidden.pop()
      else if (!VOID.has(tag) && !selfClosing) hidden.push(/\saria-hidden="true"/.test(attrs ?? ''))
    }
  }
  return out
    .join('')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim()
}

/** Lo que se ve: todo el texto, también lo `aria-hidden`, menos lo `sr-only`. */
function visible(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
}

/** La etiqueta de apertura del primer elemento con ese `data-slot`. */
function openTag(html: string, slot: string): string {
  const match = new RegExp(`<[a-z][\\w-]*[^>]*\\sdata-slot="${slot}"[^>]*>`).exec(html)
  if (!match) throw new Error(`no hay data-slot="${slot}" en:\n${html}`)
  return match[0]
}

const classOf = (tag: string) => /\sclass="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? []
const count = (html: string, needle: string) => html.split(needle).length - 1

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formatNumber y formatNumberKind (lib/format/number-kind)', () => {
  it('escribe a mano en es-AR, con el menos tipográfico', () => {
    expect(formatNumber(1234)).toBe('1.234')
    expect(formatNumber(1234.5, 1)).toBe('1.234,5')
    expect(formatNumber(1.005, 2)).toBe('1,01')
    expect(formatNumber(-8)).toBe(`${MINUS}8`)
    expect(formatNumber(-0.2)).toBe('0')
  })

  it('cada kind da el valor final, sin Intl', () => {
    expect(formatNumberKind(1234567, 'integer')).toBe('1.234.567')
    expect(formatNumberKind(3.25, 'decimal-1')).toBe('3,3')
    expect(formatNumberKind(3.25, 'decimal-2')).toBe('3,25')
    expect(formatNumberKind(123450, 'currency-cents-ars')).toBe(`$${NBSP}1.235`)
    expect(formatNumberKind(-123450, 'currency-cents-ars')).toBe(`${MINUS}$${NBSP}1.235`)
    expect(formatNumberKind(45.4, 'percent-100')).toBe(`45${NBSP}%`)
  })

  it('faltante no es cero', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(Number.NaN)).toBe('—')
    expect(formatNumberKind(undefined, 'integer')).toBe('—')
    expect(formatNumberKind(Number.POSITIVE_INFINITY, 'currency-cents-ars')).toBe('—')
  })
})

describe('Amount', () => {
  it('centavos → «$ 1.234,50» en cifras tabulares', () => {
    const html = render(h(Amount, { cents: 123450 }))
    expect(classOf(openTag(html, 'amount'))).toContain('type-amount')
    expect(visible(html)).toBe(`$${NBSP}1.234,50`)
    expect(render(h(Amount, { cents: 123450n }))).toBe(html)
  })

  it('el negativo lleva U+2212 y, con tone="auto", el tono negativo', () => {
    const html = render(h(Amount, { cents: -123450, tone: 'auto' }))
    expect(visible(html)).toBe(`${MINUS}$${NBSP}1.234,50`)
    const tag = openTag(html, 'amount')
    expect(tag).toContain('data-negative=""')
    expect(classOf(tag)).toContain('text-destructive-text')
    // Positivo con tone="auto": hereda el color.
    expect(classOf(openTag(render(h(Amount, { cents: 5, tone: 'auto' })), 'amount'))).not.toContain(
      'text-destructive-text',
    )
  })

  it('lo que redondea a cero no lleva signo ni se pinta de rojo', () => {
    const html = render(h(Amount, { cents: -40, decimals: 0, tone: 'auto' }))
    expect(visible(html)).toBe(`$${NBSP}0`)
    expect(html).not.toContain('data-negative')
    expect(html).not.toContain('text-destructive-text')
  })

  it('decimales, signo y moneda', () => {
    expect(visible(render(h(Amount, { cents: 123450, decimals: 0 })))).toBe(`$${NBSP}1.235`)
    expect(visible(render(h(Amount, { cents: 123450, sign: 'always' })))).toBe(`+$${NBSP}1.234,50`)
    expect(visible(render(h(Amount, { cents: -123450, sign: 'never' })))).toBe(`$${NBSP}1.234,50`)
    expect(visible(render(h(Amount, { cents: 17526, currency: 'USD' })))).toBe(`US$${NBSP}175,26`)
    expect(visible(render(h(Amount, { cents: -123450, currency: false })))).toBe(`${MINUS}1.234,50`)
  })

  it('saldo con D/A: la letra es un abbr oculto y el lector oye la palabra', () => {
    const deudor = render(h(Amount, { cents: 124_000_000, side: 'auto', currency: false }))
    expect(visible(deudor)).toBe(`1.240.000,00${NBSP}D`)
    expect(deudor).toContain('<abbr title="saldo deudor" aria-hidden="true">D</abbr>')
    expect(readable(deudor)).toBe(`1.240.000,00${NBSP} deudor`)
    expect(openTag(deudor, 'amount')).toContain('data-side="D"')

    const acreedor = render(h(Amount, { cents: -124_000_000, side: 'auto', currency: false }))
    // El lado ya dice para dónde va: sin menos.
    expect(visible(acreedor)).toBe(`1.240.000,00${NBSP}A`)
    expect(readable(acreedor)).toContain('acreedor')
    expect(acreedor).toContain('title="saldo acreedor"')

    // Lado forzado.
    expect(visible(render(h(Amount, { cents: 500, side: 'A' })))).toBe(`$${NBSP}5,00${NBSP}A`)
  })

  it('el faltante es «—» a la vista y «sin dato» para el lector, nunca $ 0', () => {
    const html = render(h(Amount, { cents: null }))
    expect(visible(html)).toBe('—')
    expect(readable(html)).toBe('sin dato')
    expect(openTag(html, 'amount')).toContain('data-empty=""')
    expect(html).not.toContain('$')
    expect(visible(render(h(Amount, { cents: Number.NaN })))).toBe('—')

    const custom = render(h(Amount, { cents: undefined, emptyText: 'Sin cargar' }))
    expect(readable(custom)).toBe('Sin cargar')
    expect(custom).not.toContain('sr-only')
  })

  it('as="data" lleva los centavos en value; data-tour llega a la raíz', () => {
    const html = render(h(Amount, { cents: 123450, as: 'data', ...tour('saldo') }))
    expect(html.startsWith('<data value="123450"')).toBe(true)
    expect(openTag(html, 'amount')).toContain('data-tour="saldo"')
    // Sin dato no hay value que dar: vuelve a span.
    expect(render(h(Amount, { cents: null, as: 'data' })).startsWith('<span')).toBe(true)
  })

  it('amountText da lo mismo que se ve', () => {
    expect(amountText({ cents: -123450 })).toBe(`${MINUS}$${NBSP}1.234,50`)
    expect(amountText({ cents: -5000, side: 'auto', currency: false })).toBe(`50,00${NBSP}A`)
    expect(amountText({ cents: null })).toBe('—')
  })
})

describe('PageHeader', () => {
  it('emite los data-slot del kit con un solo h1 en type-title', () => {
    const html = render(
      h(PageHeader, {
        title: 'Proveedores',
        description: 'Lo que le debés a cada uno.',
        actions: h('button', { type: 'button' }, 'Nuevo proveedor'),
        ...tour('proveedores-header'),
        className: 'extra',
      }),
    )
    const root = openTag(html, 'page-header')
    expect(root).toContain('data-tour="proveedores-header"')
    expect(classOf(root)).toContain('extra')
    expect(count(html, '<h1')).toBe(1)
    expect(openTag(html, 'page-title').startsWith('<h1')).toBe(true)
    expect(classOf(openTag(html, 'page-title'))).toContain('type-title')
    expect(openTag(html, 'page-description').startsWith('<div')).toBe(true)
    expect(openTag(html, 'page-actions')).toBeTruthy()
    expect(html).not.toContain('data-slot="page-context"')
    // El título viejo era Fraunces a 34 px a mano: ahora lo pone type-title.
    expect(html).not.toContain('text-[34px]')
  })

  it('la línea de contexto va sin mayúsculas ni tracking (el .wa la esconde por su slot)', () => {
    const html = render(h(PageHeader, { context: 'Buenas tardes, HUB', title: 'Resumen' }))
    const context = openTag(html, 'page-context')
    expect(classOf(context)).toContain('type-small')
    // El slot de antes: el `.wa` de Mensajería lo esconde por ese nombre.
    expect(openTag(html, 'page-eyebrow')).toBeTruthy()
    expect(readable(html)).toBe('Buenas tardes, HUBResumen')
    expect(html).not.toMatch(/\buppercase\b/)
    expect(html).not.toMatch(/tracking-\[/)
  })

  it('description y context aceptan un <div> (los loaders pasan Skeleton)', () => {
    const skeleton = h('div', { 'data-slot': 'skeleton', className: 'h-3 w-24' })
    const html = render(
      h(PageHeader, { context: skeleton, title: 'Cargando', description: skeleton }),
    )
    expect(html).not.toContain('<p')
    expect(count(html, 'data-slot="skeleton"')).toBe(2)
  })

  it('back: link con el nombre de adonde se vuelve y la flecha oculta', () => {
    const html = render(
      h(PageHeader, {
        back: { href: '/hub/proveedores', label: 'Proveedores' },
        title: 'Coca-Cola',
      }),
    )
    const back = openTag(html, 'page-back')
    expect(back).toContain('href="/hub/proveedores"')
    expect(readable(html)).toBe('ProveedoresCoca-Cola')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
  })

  it('migas con aria-current en la última; en el celular, si hay back, solo back', () => {
    const html = render(
      h(PageHeader, {
        back: { href: '/hub/proveedores', label: 'Proveedores' },
        breadcrumbs: [
          { label: 'Administración', href: '/hub/administracion' },
          { label: 'Proveedores', href: '/hub/proveedores' },
          { label: 'Coca-Cola' },
        ],
        title: 'Coca-Cola',
      }),
    )
    const nav = openTag(html, 'breadcrumb')
    expect(nav).toContain('aria-label="Migas de pan"')
    expect(classOf(nav)).toContain('max-sm:hidden')
    expect(classOf(openTag(html, 'page-back'))).toContain('sm:hidden')
    expect(html).toContain('<span aria-current="page" class="text-foreground">Coca-Cola</span>')
    expect(count(html, 'aria-current="page"')).toBe(1)
  })

  it('meta: un array se separa con «·» ocultos para el lector', () => {
    const html = render(
      h(PageHeader, {
        title: 'Coca-Cola',
        meta: ['CUIT 30-00000000-0', 'Responsable inscripto', 'Paga a 21 días'],
      }),
    )
    expect(classOf(openTag(html, 'page-meta'))).toContain('type-small')
    expect(count(html, '<span aria-hidden="true">·</span>')).toBe(2)
    expect(readable(html)).toBe('Coca-ColaCUIT 30-00000000-0Responsable inscriptoPaga a 21 días')
    const single = render(h(PageHeader, { title: 'X', meta: 'Una sola cosa' }))
    expect(single).not.toContain('·')
  })

  it('tabs va abajo en su slot; children sigue funcionando', () => {
    const html = render(
      h(
        PageHeader,
        { title: 'Ficha', tabs: h('nav', { 'aria-label': 'Secciones' }, 'pestañas') },
        h('p', null, 'hijo'),
      ),
    )
    expect(openTag(html, 'page-tabs')).toBeTruthy()
    expect(html.indexOf('data-slot="page-tabs"')).toBeLessThan(html.indexOf('<p>hijo</p>'))
  })

  it('las acciones abarcan las filas de la izquierda en escritorio', () => {
    const solo = render(h(PageHeader, { title: 'T', actions: 'A' }))
    expect(classOf(openTag(solo, 'page-actions'))).toContain('sm:row-span-1')
    const full = render(h(PageHeader, { title: 'T', actions: 'A', description: 'D', meta: ['m'] }))
    expect(classOf(openTag(full, 'page-actions'))).toContain('sm:row-span-3')
  })
})

describe('KPI y KPIGroup', () => {
  it('el grupo es UN dl con un par dt/dd por KPI (nunca un dl adentro de otro)', () => {
    const html = render(
      h(
        KPIGroup,
        { ...tour('mis-numeros-kpis') },
        h(KPI, { label: 'Saldo', value: `$${NBSP}1.240.000` }),
        h(KPI, { label: 'Vencido', value: `$${NBSP}380.000` }),
        h(KPI, { label: 'Vence en 7 días', value: `$${NBSP}860.000` }),
      ),
    )
    expect(count(html, '<dl')).toBe(1)
    const group = openTag(html, 'kpi-group')
    expect(group.startsWith('<dl')).toBe(true)
    expect(group).toContain('data-tour="mis-numeros-kpis"')
    expect(group).toContain('data-columns="3"')
    expect(classOf(group)).toEqual(expect.arrayContaining(['rounded-xl', 'border', 'bg-card']))
    expect(count(html, 'data-slot="kpi"')).toBe(3)
    expect(count(html, '<dt')).toBe(3)
    expect(count(html, '<dd')).toBe(3)
    expect(classOf(openTag(html, 'kpi'))).toEqual(expect.arrayContaining(['p-4', 'sm:p-6']))
  })

  it('también agrupa KPIs dentro de fragmentos y de un map', () => {
    const items = ['A', 'B']
    const html = render(
      h(
        KPIGroup,
        null,
        h(
          Fragment,
          null,
          items.map((label) => h(KPI, { key: label, label, value: '1' })),
        ),
        false,
        h(KPI, { label: 'C', value: '2' }),
      ),
    )
    expect(count(html, '<dl')).toBe(1)
    expect(count(html, 'data-slot="kpi"')).toBe(3)
  })

  it('columnas por defecto según la cantidad', () => {
    const cols = (n: number) =>
      openTag(
        render(
          h(
            KPIGroup,
            null,
            Array.from({ length: n }, (_, i) => h(KPI, { key: i, label: `K${i}`, value: i })),
          ),
        ),
        'kpi-group',
      ).match(/data-columns="(\d)"/)?.[1]
    expect(cols(1)).toBe('1')
    expect(cols(2)).toBe('2')
    expect(cols(4)).toBe('4')
    expect(cols(6)).toBe('3')
    const explicit = render(
      h(KPIGroup, { columns: 2, framed: false }, h(KPI, { label: 'x', value: 1 })),
    )
    expect(openTag(explicit, 'kpi-group')).toContain('data-columns="2"')
    expect(classOf(openTag(explicit, 'kpi-group'))).not.toContain('bg-card')
  })

  it('un KPI suelto abre su propio dl', () => {
    const html = render(h(KPI, { label: 'Clientes', value: '1.234', ...tour('kpi-suelto') }))
    const root = openTag(html, 'kpi')
    expect(root.startsWith('<dl')).toBe(true)
    expect(root).toContain('data-tour="kpi-suelto"')
    expect(readable(html)).toBe('Clientes1.234')
  })

  it('la variación dice para dónde fue (ícono oculto + palabra para el lector)', () => {
    const html = render(
      h(KPI, {
        label: 'Facturación',
        value: `$${NBSP}1.000`,
        delta: { value: '+12 %', direction: 'up', tone: 'positive', label: 'vs. mes anterior' },
      }),
    )
    const delta = openTag(html, 'kpi-delta')
    expect(classOf(delta)).toEqual(expect.arrayContaining(['type-caption', 'text-success-text']))
    expect(readable(html)).toContain('subió +12 %vs. mes anterior')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    // Sin tono: neutro (subir no siempre es bueno).
    const neutral = render(
      h(KPI, { label: 'Costos', value: '1', delta: { value: '+3 %', direction: 'up' } }),
    )
    expect(classOf(openTag(neutral, 'kpi-delta'))).toContain('text-muted-foreground')
  })

  it('con href el link se estira a todo el KPI y se nombra con la etiqueta', () => {
    const html = render(
      h(KPI, { label: 'Vencido', value: `$${NBSP}380.000`, href: '/hub/vencidos' }),
    )
    const link = /<a [^>]*>/.exec(html)?.[0] ?? ''
    expect(link).toContain('href="/hub/vencidos"')
    expect(classOf(link)).toEqual(expect.arrayContaining(['after:absolute', 'after:inset-0']))
    const [labelId, valueId] = /aria-labelledby="([^"]+)"/.exec(link)?.[1]?.split(' ') ?? []
    expect(html).toContain(`<dt id="${labelId}"`)
    expect(link).toContain(`id="${valueId}"`)
    const root = classOf(openTag(html, 'kpi'))
    expect(root).toEqual(
      expect.arrayContaining([
        'relative',
        'has-[a:active]:bg-active',
        'has-[a:focus-visible]:outline-2',
      ]),
    )
    // Sin escala: es ancho (§2.10).
    expect(root.some((c) => c.startsWith('active:scale') || c === 'press')).toBe(false)
  })

  it('la cifra se mide para achicarse si no entra, sin animar', () => {
    const html = render(h(KPI, { label: 'Facturación', value: `$${NBSP}45.678.901` }))
    const em = Number(/--kpi-em:([\d.]+)/.exec(html)?.[1])
    // ~6 em de Fraunces para «$ 45.678.901» (con margen).
    expect(em).toBeGreaterThan(5.5)
    expect(em).toBeLessThan(6.6)
    expect(html).toContain('[font-size:min(1em,calc(100cqi/var(--kpi-em)))]')
    expect(classOf(openTag(html, 'kpi'))).toContain('@container')
    // Un <Amount> también se mide; un nodo cualquiera no.
    expect(render(h(KPI, { label: 'x', value: h(Amount, { cents: 100, decimals: 0 }) }))).toContain(
      '--kpi-em',
    )
    expect(render(h(KPI, { label: 'x', value: h('strong', null, '1') }))).not.toContain('--kpi-em')
  })

  it('loading: esqueleto, aria-busy y «Cargando…» para el lector', () => {
    const html = render(h(KPI, { label: 'Clientes', value: '1', loading: true }))
    expect(openTag(html, 'kpi')).toContain('aria-busy="true"')
    expect(html).toContain('data-slot="skeleton"')
    expect(readable(html)).toBe('ClientesCargando…')
  })
})

describe('Card, Section y PageShell', () => {
  it('Card: cartulina sin sombra, relleno pisable con className', () => {
    const html = render(
      h(
        Card,
        { ...tour('tarjeta') },
        h(CardHeader, null, h(CardTitle, null, 'Título')),
        h(CardContent, null, 'cuerpo'),
      ),
    )
    const root = classOf(openTag(html, 'card'))
    expect(root).toEqual(
      expect.arrayContaining(['rounded-xl', 'border', 'border-border', 'bg-card']),
    )
    expect(root.some((c) => c.startsWith('shadow'))).toBe(false)
    expect(root).toContain('p-(--card-pad)')
    expect(openTag(html, 'card')).toContain('data-tour="tarjeta"')
    expect(classOf(openTag(html, 'card-title'))).toEqual(
      expect.arrayContaining(['type-subtitle', 'font-semibold']),
    )
    expect(classOf(openTag(html, 'card-content'))).not.toContain('px-5')

    const flush = classOf(openTag(render(h(Card, { className: 'p-0' })), 'card'))
    expect(flush).toContain('p-0')
    expect(flush).not.toContain('p-(--card-pad)')
  })

  it('Card interactive con asChild: dibuja el link con hover, foco y presionado del kit', () => {
    const html = render(h(Card, { asChild: true, interactive: true }, h('a', { href: '/x' }, 'Ir')))
    const tag = openTag(html, 'card')
    expect(tag.startsWith('<a')).toBe(true)
    expect(tag).toContain('href="/x"')
    expect(classOf(tag)).toEqual(
      expect.arrayContaining([
        'hover:border-border-strong',
        'active:bg-active',
        'focus-visible:outline-2',
      ]),
    )
    expect(classOf(tag).some((c) => c.includes('translate') || c.includes('scale'))).toBe(false)
  })

  it('Section: título en Inter con aria-labelledby; nivel 3 y divisor', () => {
    const html = render(
      <Section title="Pide atención" description="Lo urgente" id="atencion">
        x
      </Section>,
    )
    const root = openTag(html, 'section')
    expect(root.startsWith('<section')).toBe(true)
    expect(root).toContain('aria-labelledby="atencion-titulo"')
    expect(html).toContain('<h2 id="atencion-titulo"')
    expect(classOf(openTag(html, 'section-title'))).toContain('type-section')
    expect(classOf(openTag(html, 'section-description'))).toContain('type-small')

    const nested = render(
      <Section title="Sub" headingLevel={3} divider>
        x
      </Section>,
    )
    expect(nested).toContain('<h3')
    expect(classOf(openTag(nested, 'section'))).toEqual(
      expect.arrayContaining(['border-t', 'pt-6']),
    )
    const auto = render(<Section title="Sin id">x</Section>)
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(auto)?.[1]
    expect(auto).toContain(`id="${labelledBy}"`)
    const asDiv = render(
      <Section title="Div" as="div">
        x
      </Section>,
    )
    expect(asDiv).not.toContain('aria-labelledby')
    expect(render(h(Section, null, 'solo'))).toBe(
      '<section data-slot="section" class="flex flex-col gap-4">solo</section>',
    )
  })

  it('PageShell: anchos de siempre, gap de 32 px y nunca <main>', () => {
    const html = render(
      <PageShell width="compact" data-tour="pagina">
        x
      </PageShell>,
    )
    const root = openTag(html, 'page-shell')
    expect(root.startsWith('<div')).toBe(true)
    expect(classOf(root)).toEqual(
      expect.arrayContaining(['max-w-3xl', 'flex', 'flex-col', 'gap-8', 'px-4']),
    )
    expect(root).toContain('data-tour="pagina"')
    expect(html).not.toContain('<main')
    const flush = classOf(
      openTag(
        render(
          <PageShell flush width="wide">
            x
          </PageShell>,
        ),
        'page-shell',
      ),
    )
    expect(flush).toContain('max-w-screen-2xl')
    expect(flush).not.toContain('px-4')
    expect(render(<PageShell as="section">x</PageShell>).startsWith('<section')).toBe(true)
  })
})

describe('Breadcrumb, Separator, Kbd y Avatar', () => {
  it('Breadcrumb: lista ordenada, separadores ocultos y nada si no hay niveles', () => {
    const html = render(
      h(Breadcrumb, {
        items: [{ label: 'Clientes', href: '/hub/clientes' }, { label: 'Ana' }],
        ...tour('migas'),
      }),
    )
    expect(openTag(html, 'breadcrumb')).toContain('data-tour="migas"')
    expect(html).toContain('<ol')
    expect(html).toContain('href="/hub/clientes"')
    expect(count(html, '<svg')).toBe(1)
    expect(readable(html)).toBe('ClientesAna')
    expect(render(h(Breadcrumb, { items: [] }))).toBe('')
  })

  it('Separator: decorativo no se anuncia; el semántico sí, con su orientación', () => {
    expect(openTag(render(h(Separator)), 'separator')).toContain('role="none"')
    const vertical = openTag(
      render(h(Separator, { decorative: false, orientation: 'vertical' })),
      'separator',
    )
    expect(vertical).toContain('role="separator"')
    expect(vertical).toContain('aria-orientation="vertical"')
    const horizontal = openTag(render(h(Separator, { decorative: false })), 'separator')
    expect(horizontal).not.toContain('aria-orientation')
    expect(classOf(horizontal)).toContain('bg-border')
  })

  it('Kbd: 12 px en Inter (no mono) con pelo fuerte', () => {
    const tag = openTag(render(h(Kbd, { ...tour('tecla') }, 'Esc')), 'kbd')
    expect(classOf(tag)).toEqual(
      expect.arrayContaining([
        'type-caption',
        'font-sans',
        'border-border-strong',
        'h-5',
        'min-w-5',
      ]),
    )
    expect(classOf(tag).some((c) => /^text-\[\d+px\]$/.test(c) || c === 'font-mono')).toBe(false)
    expect(tag).toContain('data-tour="tecla"')
  })

  it('KbdShortcut: en el server dibuja «Ctrl» (⌘ se resuelve al montar) y ↵ es un ícono', () => {
    const html = render(h(KbdShortcut, { keys: ['mod', 'k'] }))
    expect(readable(html)).toBe('CtrlK')
    const enter = render(h(KbdShortcut, { keys: ['enter'] }))
    expect(enter).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(readable(enter)).toBe('Enter')
  })

  it('Avatar: 32 px por defecto, tamaños del kit y el className sigue ganando', () => {
    const html = render(h(Avatar, { ...tour('yo') }, h(AvatarFallback, null, 'AB')))
    const root = classOf(openTag(html, 'avatar'))
    expect(root).toContain('size-8')
    expect(openTag(html, 'avatar')).toContain('data-tour="yo"')
    expect(classOf(openTag(html, 'avatar-fallback'))).toEqual(
      expect.arrayContaining(['bg-secondary', 'text-muted-foreground']),
    )
    expect(classOf(openTag(render(h(Avatar, { size: 'lg' })), 'avatar'))).toContain('size-14')
    const custom = classOf(openTag(render(h(Avatar, { className: 'size-9' })), 'avatar'))
    expect(custom).toContain('size-9')
    expect(custom).not.toContain('size-8')
  })
})

describe('reglas del kit en estos archivos (§2.13)', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url))
  const FILES = [
    'amount',
    'avatar',
    'breadcrumb',
    'card',
    'kbd',
    'kbd-shortcut',
    'kpi',
    'page-header',
    'page-shell',
    'scroll-area',
    'section',
    'separator',
    'disclosure',
    'reload-link',
  ].map((name) => `components/ui/${name}.tsx`)

  it.each(FILES)('%s: sin -[--x], dark:, ring de foco, menos de 12 px ni float', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    expect(source).not.toMatch(/-\[--[a-z]/)
    expect(source).not.toMatch(/\bdark:/)
    expect(source).not.toMatch(/focus(?:-visible)?:ring/)
    expect(source).not.toMatch(/text-\[(?:9|10|11)px\]/)
    expect(source).not.toMatch(/hover:-translate|hover:shadow/)
    expect(source).not.toMatch(/\bshadow-(?:xs|sm|md|lg|2xs)\b/)
    expect(source).not.toMatch(/from 'motion/)
  })
})
