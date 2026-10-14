// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Cómo se movió la plata» en el primer paint (SSR): lo que se lee sin mirar
 * el dibujo (el título que afirma, la oración, qué es cada cosa con palabras,
 * «Ver como tabla»), la caja que pide la URL y el vacío cuando no hubo
 * movimientos. Los dibujos se arman en el servidor (ya no hay recharts): la
 * isla del selector solo muestra el de la caja elegida.
 */

let search = ''
vi.mock('next/navigation', () => ({
  usePathname: () => '/bar-demo/administracion/cajas',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}))

import { CashMovePanel } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/cash-move-panel'
import CajasLoading from '@/app/(manager)/[tenantSlug]/administracion/cajas/loading'
import {
  type CashDailyAccount,
  type CashDailyReport,
  resolveCashChartRange,
} from '@/lib/accounting/cash-daily'

const CAJA = '11111111-1111-4111-8111-111111111111'
const TARJETA = '33333333-3333-4333-8333-333333333333'
const BASE = '/bar-demo/administracion'

function account(over: Partial<CashDailyAccount>): CashDailyAccount {
  return {
    treasuryId: CAJA,
    name: 'Caja del salón',
    kind: 'cash',
    active: true,
    openingCents: 0,
    closingCents: 0,
    days: [],
    ...over,
  }
}

const REPORT: CashDailyReport = {
  from: '2026-10-10',
  to: '2026-10-12',
  total: account({
    treasuryId: null,
    name: '',
    kind: null,
    openingCents: 300_000,
    closingCents: 350_000,
    days: [{ day: '2026-10-11', inCents: 50_000, outCents: 0, balanceCents: 350_000 }],
  }),
  accounts: [
    // Sin movimientos en el período.
    account({ openingCents: 300_000, closingCents: 300_000 }),
    account({
      treasuryId: TARJETA,
      name: 'Visa de la empresa',
      kind: 'credit_card',
      openingCents: -40_000,
      closingCents: -70_000,
      days: [{ day: '2026-10-12', inCents: 0, outCents: 30_000, balanceCents: -70_000 }],
    }),
  ],
}

function render(query = '', over: { booksStartDate?: string | null } = {}): string {
  search = query
  const html = renderToString(
    createElement(CashMovePanel, {
      report: REPORT,
      // Los últimos 30 días hasta el 12/10; el reporte de la prueba trae solo los últimos tres.
      range: {
        ...resolveCashChartRange(null, '2026-10-12'),
        from: REPORT.from,
        label: '10/10 – 12/10/2026',
      },
      today: '2026-10-12',
      base: BASE,
      booksStartDate: over.booksStartDate === undefined ? '2026-09-01' : over.booksStartDate,
      tones: { [CAJA]: { kind: 'cash', step: 1 } },
    }),
  )
  // Los importes llevan espacio duro; React separa los textos con comentarios.
  return html.replaceAll(String.fromCharCode(160), ' ').replaceAll('<!-- -->', '')
}

describe('CashMovePanel', () => {
  beforeEach(() => {
    search = ''
  })

  it('sin nada en la URL muestra todas las cajas, con el título que afirma y la oración', () => {
    const html = render()
    expect(html).toContain('Hay $ 500 más que hace 3 días')
    expect(html).toContain('Todas las cajas · 10/10 – 12/10/2026')
    expect(html).toContain(
      'Empezó en $ 3.000 y hoy hay $ 3.500. En el período entró $ 500 y salió $ 0.',
    )
    expect(html).toContain('Mover plata de una caja a otra no cuenta como entrada ni como salida.')
  })

  it('dice qué es cada dibujo con palabras, no solo con color', () => {
    const html = render()
    expect(html).toContain('Lo que había al final de cada día')
    expect(html).toContain('Lo que entró y lo que salió cada día')
    // La leyenda de entró y salió, con sus totales.
    expect(html).toMatch(/Entró.*\$ 500/s)
    expect(html).toContain('Salió')
    // Ya no hay recharts: el dibujo viene armado del servidor.
    expect(html).not.toContain('recharts')
    expect(html).not.toContain('barra hacia arriba')
  })

  it('ofrece la tabla y los tres períodos, con el elegido relleno', () => {
    const html = render()
    expect(html).toMatch(/<button[^>]*>(<svg.*?<\/svg>)?Ver como tabla<\/button>/s)
    expect(html).toMatch(/aria-pressed="true"[^>]*>(<span>)?Últimos 30 días/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>(<span>)?Este mes/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>(<span>)?Mes pasado/)
  })

  it('las cajas se eligen con píldoras: una por caja, con «Todas las cajas» apretada', () => {
    const html = render()
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Todas las cajas/s)
    expect(html).toContain('Caja del salón')
    expect(html).toContain('Visa de la empresa')
    // El punto de la Caja lleva el color de su tipo (el del Resumen).
    expect(html).toContain('bg-(--adm-k-cash-1)')
    // Ya no hay un desplegable para elegir entre dos o tres cosas.
    expect(html).not.toContain('role="combobox"')
  })

  it('?grafico= elige la caja; la tarjeta se lee como deuda', () => {
    const html = render(`grafico=${TARJETA}`)
    expect(html).toContain('La deuda de Visa de la empresa subió $ 300')
    expect(html).toContain('Visa de la empresa · 10/10 – 12/10/2026')
    expect(html).toContain('Empezó con una deuda de $ 400 y hoy la deuda es de $ 700.')
    expect(html).toContain('Lo que debías al final de cada día')
    expect(html).toContain('Los pagos y los consumos de cada día')
    expect(html).toContain('Consumos')
    expect(html).toContain('Pagos')
    expect(html).toContain('Es una deuda: sube con los consumos y baja con los pagos.')
    // El título de «todas» no se dibuja: solo el de la caja elegida.
    expect(html).not.toContain('Hay $ 500 más que hace 3 días')
  })

  it('con una caja elegida, cada día de la tabla lleva a lo que pasó ese día en esa caja', () => {
    const html = render(`grafico=${TARJETA}`)
    expect(html).toContain(`href="${BASE}/cajas/${TARJETA}?desde=2026-10-12&amp;hasta=2026-10-12"`)
    // En «todas las cajas» no hay a dónde llevar.
    expect(render()).not.toContain('?desde=2026-10-11')
  })

  it('una caja sin movimientos muestra el vacío con su saldo, sin dibujo ni tabla', () => {
    const html = render(`grafico=${CAJA}`)
    expect(html).toContain('No hubo movimientos en este período')
    expect(html).toContain(
      'Caja del salón · 10/10 – 12/10/2026. Empezó en $ 3.000 y hoy hay $ 3.000.',
    )
    expect(html).not.toContain('Ver como tabla')
    expect(html).not.toContain('Lo que había al final de cada día')
  })

  it('una caja que ya no existe cae en todas las cajas', () => {
    const html = render('grafico=99999999-9999-4999-8999-999999999999')
    expect(html).toContain('Todas las cajas · 10/10 – 12/10/2026')
    expect(html).toContain('Hay $ 500 más que hace 3 días')
  })

  it('si los libros arrancaron adentro del período, no compara contra un cero que no es un dato', () => {
    const html = render('', { booksStartDate: '2026-10-11' })
    expect(html).toContain('Así viene la plata desde que arrancaste')
    expect(html).toContain(
      'Llevás la cuenta desde el 11/10/2026: todavía no hay un mes para comparar.',
    )
    // El día de arranque no cuenta como plata que entró, y se dice.
    expect(html).toContain(
      'No cuenta el día en que arrancaste a llevar la cuenta: lo que había no es plata que entró.',
    )
    expect(html).not.toContain('Hay $ 500 más')
  })
})

describe('Cajas y bancos mientras carga', () => {
  // El lomo de las tarjetas de la billetera y las barras por categoría de «Entró y salió».
  const WALLET = 'absolute inset-x-0 top-0 h-1.5'
  const FLOW = 'h-2.5 w-2/3'

  function loading(query: string): string {
    search = query
    return renderToString(createElement(CajasLoading))
  }

  it('«Lo que hay» carga con la forma de la billetera', () => {
    for (const query of ['', 'periodo=este-mes', 'tab=otra']) {
      const html = loading(query)
      expect(html).toContain(WALLET)
      expect(html).not.toContain(FLOW)
    }
  })

  it('«Entró y salió» (?tab=flujo) carga con SU forma, no con la de la billetera', () => {
    const html = loading('tab=flujo')
    expect(html).toContain(FLOW)
    expect(html).not.toContain(WALLET)
  })
})
