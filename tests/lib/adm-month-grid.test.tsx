// @vitest-environment node
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  MonthGrid,
  type MonthGridCell,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/month-grid'
import { eachIsoDay } from '@/lib/dates'

/**
 * `MonthGrid`, el almanaque de Ventas: se fija la ESTRUCTURA que leen el
 * teclado y los lectores (una tabla de lunes a domingo, cada casillero con su
 * dato entero, qué se toca y qué no), no las clases.
 */

// La marca de «ya lo toqué» usa `useLinkStatus`, que solo existe dentro de un `<Link>` vivo.
vi.mock('next/link', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useLinkStatus: () => ({ pending: false }),
}))

function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(' ', ' ')
}

function count(markup: string, piece: string): number {
  return markup.split(piece).length - 1
}

const days = eachIsoDay('2026-10-01', '2026-10-31')

function cells(over: (date: string) => Partial<MonthGridCell> = () => ({})): MonthGridCell[] {
  return days.map((date) => ({
    date,
    state: 'future',
    label: `Día ${date}`,
    ...over(date),
  }))
}

describe('MonthGrid: una tabla de lunes a domingo', () => {
  const markup = html(
    <MonthGrid month="2026-10" cells={cells()} caption="Lo vendido cada noche de octubre" />,
  )

  it('es una tabla con su título y siete columnas con nombre', () => {
    expect(markup).toContain('<caption class="sr-only">Lo vendido cada noche de octubre</caption>')
    expect(count(markup, '<th scope="col"')).toBe(7)
    expect(markup).toContain('abbr="lunes"')
    expect(markup).toContain('abbr="domingo"')
    // El lunes va primero.
    expect(markup.indexOf('abbr="lunes"')).toBeLessThan(markup.indexOf('abbr="martes"'))
  })

  it('octubre de 2026 arranca un jueves: cinco semanas y tres huecos adelante', () => {
    expect(count(markup, '<tr')).toBe(1 + 5)
    const firstWeek = markup.slice(
      markup.indexOf('<tbody>'),
      markup.indexOf('</tr>', markup.indexOf('<tbody>')),
    )
    expect(count(firstWeek, 'aria-hidden="true" class="p-0"')).toBe(3)
    // 35 casilleros: 31 días y 4 huecos (3 adelante, 1 atrás).
    expect(count(markup, '<td')).toBe(35)
    expect(count(markup, 'aria-hidden="true" class="p-0"')).toBe(4)
  })
})

describe('MonthGrid: qué se toca y qué dice cada casillero', () => {
  it('un casillero con link lleva el dato entero y no dispara 31 pedidos', () => {
    const markup = html(
      <MonthGrid
        month="2026-10"
        caption="Octubre"
        cells={cells((date) =>
          date === '2026-10-07'
            ? {
                state: 'loaded',
                value: '$ 1.138.029',
                valueShort: '1,1 M',
                fill: 0.57,
                marker: 0.62,
                badge: { text: '92 %', tone: 'warn', glyph: 'down' },
                note: 'Noche de tacos',
                dot: true,
                href: '/hub/administracion/ventas?dia=2026-10-07',
                selected: true,
                label: 'Miércoles 7 de octubre: $ 1.138.029. 92 % del objetivo. Noche de tacos.',
              }
            : {},
        )}
      />,
    )
    expect(markup).toContain('href="/hub/administracion/ventas?dia=2026-10-07"')
    expect(markup).toContain(
      'aria-label="Miércoles 7 de octubre: $ 1.138.029. 92 % del objetivo. Noche de tacos."',
    )
    // El día elegido se anuncia, y solo él.
    expect(count(markup, 'aria-current="date"')).toBe(1)
    // El importe entero va con su «$» chico adelante; el corto, con la unidad chica al lado.
    expect(markup).toContain('data-tip-value="$ 1.138.029"')
    expect(markup).toMatch(/>\$<\/span>1\.138\.029<\/span>/)
    expect(markup).toMatch(/1,1<span[^>]*>M<\/span>/)
    expect(markup).toContain('92 %')
    expect(markup).toContain('Noche de tacos')
    // El relleno (el lavado y su columna) y la marca del objetivo van con su altura.
    expect(count(markup, 'height:57%')).toBe(2)
    expect(count(markup, 'bottom:62%')).toBe(1)
    // El globito trae el día y el dato.
    expect(markup).toContain('data-tip-title="Mié 07/10"')
  })

  it('un día que falta dice «falta»; sin link no se puede tocar pero se puede leer', () => {
    const missing = (href?: string) =>
      html(
        <MonthGrid
          month="2026-10"
          caption="Octubre"
          cells={cells((date) =>
            date === '2026-10-08'
              ? {
                  state: 'missing',
                  value: 'falta',
                  valueShort: 'falta',
                  href,
                  label: 'Jueves 8 de octubre: falta el cierre.',
                }
              : {},
          )}
        />,
      )
    const linked = missing('/hub/administracion/ventas/cierre?fecha=2026-10-08')
    expect(linked).toContain('href="/hub/administracion/ventas/cierre?fecha=2026-10-08"')
    expect(linked).toContain('falta')
    const plain = missing(undefined)
    expect(plain).not.toContain('href=')
    expect(plain).toContain('role="img"')
    expect(plain).toContain('aria-label="Jueves 8 de octubre: falta el cierre."')
  })

  it('lo anterior al arranque y lo que no lleva a ningún lado no son paradas de Tab', () => {
    const markup = html(
      <MonthGrid
        month="2026-10"
        caption="Octubre"
        size="compact"
        cells={cells((date) => (date < '2026-10-12' ? { state: 'before' } : {}))}
      />,
    )
    expect(markup).not.toContain('href=')
    expect(markup).not.toContain('tabindex')
    // Los 31 números de día siguen escritos.
    for (const day of ['1', '11', '12', '31']) expect(markup).toContain(`>${day}</span>`)
  })

  it('un día sin dato no dibuja relleno ni raya', () => {
    const markup = html(
      <MonthGrid
        month="2026-10"
        caption="Octubre"
        cells={cells(() => ({ state: 'missing', value: 'falta', fill: null, marker: null }))}
      />,
    )
    expect(markup).not.toContain('height:')
    expect(markup).not.toContain('bottom:')
  })

  it('el relleno nunca pasa del casillero aunque llegue un valor de más', () => {
    const markup = html(
      <MonthGrid
        month="2026-10"
        caption="Octubre"
        cells={cells((date) =>
          date === '2026-10-02' ? { state: 'loaded', fill: 3, marker: 9 } : {},
        )}
      />,
    )
    expect(markup).toContain('height:100%')
    expect(markup).toContain('bottom:100%')
  })

  it('un importe de nueve cifras y un evento de sesenta caracteres no rompen el marcado', () => {
    const long = 'Cumpleaños de la Asociación de Bares del Centro de Córdoba 2026'
    const markup = html(
      <MonthGrid
        month="2026-10"
        caption="Octubre"
        cells={cells((date) =>
          date === '2026-10-03'
            ? { state: 'loaded', value: '$ 123,5 M', valueShort: '123,5 M', note: long, fill: 1 }
            : {},
        )}
      />,
    )
    expect(markup).toMatch(/>\$<\/span>123,5 M<\/span>/)
    expect(markup).toMatch(/123,5<span[^>]*>M<\/span>/)
    // El nombre largo va cortado con «…» por CSS, entero en el marcado.
    expect(markup).toContain(long)
    expect(markup).toContain('truncate')
  })
})

describe('MonthGrid: el importe corto del casillero angosto', () => {
  it('parte el número de la unidad («806» + «mil») y una palabra va entera', () => {
    const markup = html(
      <MonthGrid
        month="2026-10"
        caption="Octubre"
        size="compact"
        cells={cells((date) =>
          date === '2026-10-05'
            ? { state: 'loaded', value: '$ 806.000', valueShort: '806 mil', fill: 0.4 }
            : date === '2026-10-06'
              ? { state: 'today', value: 'hoy', valueShort: 'hoy' }
              : {},
        )}
      />,
    )
    expect(markup).toMatch(/806<span[^>]*>mil<\/span>/)
    expect(markup).toContain('>hoy</span>')
    // El almanaque chico no escribe el importe entero.
    expect(markup).not.toContain('806.000</span>')
  })
})

describe('MonthGrid: sin días', () => {
  it('no dibuja una tabla vacía: dice que todavía no hay días', () => {
    const markup = html(<MonthGrid month="2026-10" cells={[]} caption="Octubre" />)
    expect(markup).not.toContain('<table')
    expect(markup).toContain('Todavía no hay días para mostrar')
  })
})
