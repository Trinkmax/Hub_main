// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BalanceArea } from '@/components/administracion/charts/balance-area'
import {
  MonthStrip,
  type MonthStripMonth,
  type MonthStripProps,
} from '@/components/administracion/charts/month-strip'
import {
  DUE_SWATCHES,
  INVOICED_SWATCH,
  NOT_INVOICED_SWATCH,
  SERIES_SWATCHES,
  UNDEFINED_SWATCH,
} from '@/components/administracion/charts/palette'

/**
 * `MonthStrip`: el año como fila de pestañas (Libros, Fin de mes y Ajustes › Ejercicio). Lo que
 * no puede romperse: cada estado se dice con su palabra (nunca solo con color), el mes elegido
 * lleva `aria-current`, un mes que no empezó no es un link, y un aviso se lee.
 *
 * De paso, los dos agregados chicos de la misma tanda en `charts/`: el día que se toca en
 * `BalanceArea` y las constantes de color que comparten cinco áreas.
 */

const BASE = '/hub/administracion/libros'

/** Un ejercicio a mitad de camino: tres cerrados, uno que toca, el de hoy y lo que viene. */
const YEAR: MonthStripMonth[] = [
  {
    key: '2026-06',
    label: 'Jun',
    state: 'closed',
    href: `${BASE}?mes=2026-06`,
    title: 'Cerrado el 04/07/2026 por Franco',
  },
  { key: '2026-07', label: 'Jul', state: 'closed', href: `${BASE}?mes=2026-07` },
  { key: '2026-08', label: 'Ago', state: 'closed', href: `${BASE}?mes=2026-08`, alert: true },
  { key: '2026-09', label: 'Sep', state: 'to_close', href: `${BASE}?mes=2026-09`, selected: true },
  { key: '2026-10', label: 'Oct', state: 'current', href: `${BASE}?mes=2026-10` },
  { key: '2026-11', label: 'Nov', state: 'future', href: `${BASE}?mes=2026-11` },
  { key: '2026-12', label: 'Dic', state: 'future' },
]

function render(props: MonthStripProps): string {
  return renderToString(createElement(MonthStrip, props))
}

/** Los `<li>…</li>` de la fila, en orden (uno por mes). */
function cells(html: string): string[] {
  return html.match(/<li\b[\s\S]*?<\/li>/g) ?? []
}

/** El texto que se ve, sin etiquetas ni los comentarios que deja React entre textos. */
function text(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('MonthStrip: cada estado con su palabra y su forma', () => {
  const html = render({ months: YEAR })
  const [jun, , , sep, oct, nov] = cells(html)

  it('una pestaña por mes, en una lista ordenada y con el nombre corto a la vista', () => {
    expect(html).toContain('<ol')
    expect(cells(html)).toHaveLength(YEAR.length)
    cells(html).forEach((cell, i) => {
      expect(text(cell)).toContain(YEAR[i]?.label)
    })
  })

  it('cerrado: relleno suave, candado y «Cerrado»', () => {
    expect(text(jun ?? '')).toContain('Cerrado')
    expect(jun).toContain('bg-success/10')
    expect(jun).toContain('lucide-lock')
    // El candado es el cerrado, no el abierto.
    expect(jun).not.toContain('lucide-lock-open')
  })

  it('falta cerrar: contorno punteado ámbar y «Falta cerrar» en el ámbar de texto', () => {
    expect(text(sep ?? '')).toContain('Falta cerrar')
    // Septiembre es además el elegido: su borde pasa a tinta y lleno (la marca del elegido).
    expect(sep).toContain('border-foreground')
    expect(sep).toContain('inset-ring-1')
    expect(sep).toContain('text-warning-text')
    expect(sep).toContain('lucide-lock-open')
  })

  it('en curso: «En curso» con borde en tinta suave, sin el anillo del elegido', () => {
    expect(text(oct ?? '')).toContain('En curso')
    expect(oct).toContain('border-foreground/40')
    expect(oct).not.toContain('inset-ring-1')
  })

  it('abierto: hueco y «Abierto» (el período de ajustes de Ajustes › Ejercicio)', () => {
    const [cell] = cells(
      render({ months: [{ key: 'ajustes-2026', label: 'Ajustes', state: 'open' }] }),
    )
    expect(text(cell ?? '')).toContain('Abierto')
    expect(cell).toContain('bg-card')
    expect(cell).not.toContain('bg-success/10')
    expect(cell).not.toContain('border-dashed')
  })

  it('no empezó: atenuada, con su palabra', () => {
    expect(text(nov ?? '')).toContain('No empezó')
    expect(nov).toContain('text-muted-foreground')
  })

  it('nunca color solo: toda pestaña trae un ícono y una de las cinco palabras', () => {
    const words = ['Cerrado', 'Falta cerrar', 'En curso', 'Abierto', 'No empezó']
    for (const cell of cells(html)) {
      expect(words.some((word) => text(cell).includes(word))).toBe(true)
      expect(cell).toContain('<svg')
      expect(cell).toContain('aria-hidden="true"')
    }
  })
})

describe('MonthStrip: como navegación', () => {
  const html = render({ months: YEAR })
  const [jun, jul, ago, sep, oct, nov, dic] = cells(html)

  it('cada mes con `href` es un link a ese mes, con foco visible y sin prefetch de doce pantallas', () => {
    for (const [cell, month] of [
      [jun, '2026-06'],
      [jul, '2026-07'],
      [oct, '2026-10'],
    ] as const) {
      expect(cell).toContain(`<a `)
      expect(cell).toContain(`href="${BASE}?mes=${month}"`)
      expect(cell).toContain('focus-visible:ring-2')
      expect(cell).toContain('focus-visible:ring-ring')
    }
  })

  it('el elegido: píldora rellena en tinta y `aria-current`; los demás, no', () => {
    expect(sep).toContain('aria-current="page"')
    expect(sep).toContain('bg-foreground')
    expect(sep).toContain('text-background')
    expect(html.match(/aria-current=/g) ?? []).toHaveLength(1)
    for (const cell of [jun, jul, ago, oct]) {
      expect(cell).not.toContain('aria-current')
      expect(cell).not.toMatch(/class="[^"]*\bbg-foreground\b[^"]*text-background/)
    }
  })

  it('un mes que no empezó no es un link, lo traiga o no', () => {
    for (const cell of [nov, dic]) {
      expect(cell).not.toContain('<a ')
      expect(cell).not.toContain('href=')
      expect(cell).not.toContain('tabindex')
    }
    // Igual se lee entero: el lector de pantalla oye la misma oración que en las demás.
    expect(nov).toContain('<span class="sr-only">Noviembre 2026: no empezó</span>')
  })

  it('el nombre accesible dice el mes entero, el estado y el detalle; y contiene lo que se ve', () => {
    expect(jun).toContain('aria-label="Junio 2026: cerrado. Cerrado el 04/07/2026 por Franco"')
    expect(sep).toContain('aria-label="Septiembre 2026: falta cerrar"')
    expect(oct).toContain('aria-label="Octubre 2026: en curso"')
    // El globito (`ChartTip`) lee estos tres: el mes, el estado y el detalle.
    expect(jun).toContain('data-tip-title="Junio 2026"')
    expect(jun).toContain('data-tip-value="Cerrado"')
    expect(jun).toContain('data-tip-sub="Cerrado el 04/07/2026 por Franco"')
    expect(jul).not.toContain('data-tip-sub')
  })

  it('con aviso: un punto y la palabra «Aviso», y también en el nombre accesible', () => {
    expect(text(ago ?? '')).toContain('Aviso')
    expect(ago).toContain('bg-destructive')
    expect(ago).toContain('aria-label="Agosto 2026: cerrado, con un aviso"')
    expect(ago).toContain('data-tip-value="Cerrado · con aviso"')
    // Sigue diciendo su estado: el aviso se suma, no lo reemplaza.
    expect(text(ago ?? '')).toContain('Cerrado')
    for (const cell of [jun, jul, sep, oct]) expect(text(cell ?? '')).not.toContain('Aviso')
  })

  it('sin link pero con detalle: se enfoca para leerlo; sin nada, es texto', () => {
    const [detail, plain] = cells(
      render({
        months: [
          { key: '2026-06', label: 'Jun', state: 'closed', title: 'Cerrado el 04/07/2026' },
          { key: '2026-07', label: 'Jul', state: 'closed', selected: true },
        ],
      }),
    )
    expect(detail).not.toContain('<a ')
    expect(detail).toContain('tabindex="0"')
    expect(detail).toContain('aria-label="Junio 2026: cerrado. Cerrado el 04/07/2026"')
    expect(detail).toContain('focus-visible:ring-2')
    expect(plain).not.toContain('tabindex')
    expect(plain).not.toContain('data-tip-title')
    expect(plain).toContain('aria-current="true"')
  })

  it('una clave que no es un mes (el período de ajustes) usa su nombre corto, sin inventar fecha', () => {
    const html = render({
      months: [{ key: '3f6c1f0e', label: 'Ajustes', state: 'open', href: `${BASE}/cierres` }],
    })
    expect(html).toContain('aria-label="Ajustes: abierto"')
    expect(html).toContain('data-tip-title="Ajustes"')
  })
})

describe('MonthStrip: el resumen, la leyenda y el vacío', () => {
  it('dice la conclusión para lectores de pantalla; `ariaLabel` la reemplaza', () => {
    const html = render({ months: YEAR })
    expect(html).toContain(
      '<p class="sr-only">3 meses cerrados. Falta cerrar Septiembre 2026. En curso: Octubre 2026. Con aviso: Agosto 2026.</p>',
    )
    expect(render({ months: YEAR, ariaLabel: 'Ejercicio 2026: 3 de 7 meses cerrados.' })).toContain(
      '<p class="sr-only">Ejercicio 2026: 3 de 7 meses cerrados.</p>',
    )
    expect(render({ months: [{ key: '2026-10', label: 'Oct', state: 'current' }] })).toContain(
      'Ningún mes cerrado todavía. En curso: Octubre 2026.',
    )
  })

  it('la leyenda no va por defecto (cada pestaña ya dice su estado); con `showLegend`, cuenta los meses', () => {
    expect(render({ months: YEAR })).not.toContain('<table')
    const html = render({ months: YEAR, showLegend: true })
    expect(html).toContain('<table')
    const legend = text(html.slice(html.indexOf('<table')))
    expect(legend).toContain('Cerrados')
    expect(legend).toContain('3 meses')
    // Uno solo se nombra.
    expect(legend).toContain('Falta cerrar')
    expect(legend).toContain('Septiembre 2026')
    expect(legend).toContain('No empezaron')
    expect(legend).toContain('2 meses')
    expect(legend).toContain('Con aviso')
    // Un estado que no hay no ocupa renglón.
    expect(legend).not.toContain('Abiertos')
  })

  it('sin meses no dibuja pestañas: enseña qué va a aparecer', () => {
    const html = render({
      months: [],
      emptyHint: 'Se arman solos con la fecha de arranque de los libros.',
    })
    expect(html).not.toContain('<ol')
    expect(html).toContain('Todavía no hay meses para mostrar')
    expect(html).toContain('Se arman solos con la fecha de arranque de los libros.')
  })

  it('angosto: grilla de cuatro; con lugar, una sola fila', () => {
    const html = render({ months: YEAR })
    expect(html).toContain('grid-cols-4')
    expect(html).toContain('@min-[34rem]/strip:flex')
    expect(html).toContain('@container/strip')
  })

  it('un solo libro: ninguna palabra de la pieza habla de ganancia ni de «en negro»', () => {
    const shown = text(render({ months: YEAR, showLegend: true })).toLowerCase()
    for (const banned of ['ganancia', 'ganaste', 'en negro', 'en blanco', 'fuera de los libros']) {
      expect(shown).not.toContain(banned)
    }
  })
})

describe('BalanceArea: el día que se toca (`href`, opcional)', () => {
  const points = [
    { date: '2026-10-10', cents: 100_000_00 },
    { date: '2026-10-11', cents: 120_000_00 },
    { date: '2026-10-12', cents: 90_000_00 },
  ]

  it('sin `href` no cambia: ninguna marca es un link', () => {
    const html = renderToString(createElement(BalanceArea, { points }))
    expect(html).not.toContain('<a ')
    expect(html.match(/data-tip-title=/g) ?? []).toHaveLength(points.length)
    expect(html).not.toContain('Tocá para ver ese día')
  })

  it('con `href`, ese día es un link a sus movimientos y lo dice', () => {
    const href = '/hub/administracion/cajas?desde=2026-10-11&hasta=2026-10-11'
    const html = renderToString(
      createElement(BalanceArea, {
        points: points.map((p, i) => (i === 1 ? { ...p, href } : p)),
      }),
    )
    const links = html.match(/<a\b[^>]*>/g) ?? []
    expect(links).toHaveLength(1)
    expect(links[0]).toContain(
      'href="/hub/administracion/cajas?desde=2026-10-11&amp;hasta=2026-10-11"',
    )
    expect(links[0]).toMatch(/aria-label="[^"]*11\/10[^"]*Abre lo que pasó ese día"/)
    expect(links[0]).toContain('Tocá para ver ese día')
    expect(links[0]).toContain('focus-visible:ring-2')
  })

  it('en `compact` no hay marcas: el `href` no dibuja nada que tocar', () => {
    const html = renderToString(
      createElement(BalanceArea, {
        compact: true,
        points: points.map((p) => ({ ...p, href: '/x' })),
      }),
    )
    expect(html).not.toContain('<a ')
  })
})

describe('palette: las dos convenciones de color que comparten las áreas', () => {
  it('con factura = bosque, sin factura = azul noche, sin definir = neutro (los del Resumen y el cierre)', () => {
    expect(INVOICED_SWATCH).toBe('bg-adm-s1')
    expect(NOT_INVOICED_SWATCH).toBe('bg-adm-s4')
    expect(UNDEFINED_SWATCH).toBe('bg-adm-neutral')
    // Son colores de serie, no de estado: «sin factura» no es una alarma.
    expect(SERIES_SWATCHES).toContain(INVOICED_SWATCH)
    expect(SERIES_SWATCHES).toContain(NOT_INVOICED_SWATCH)
    expect(NOT_INVOICED_SWATCH).not.toMatch(/destructive|warning/)
  })

  it('lo que vence: vencido, esta semana y más adelante, con colores de estado', () => {
    expect(DUE_SWATCHES).toEqual({
      overdue: 'bg-destructive',
      week: 'bg-warning',
      later: 'bg-adm-neutral',
    })
  })
})
