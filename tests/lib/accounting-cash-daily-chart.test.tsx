// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Cómo se movió la plata» en el primer paint (SSR): lo que se lee sin ver el
 * gráfico (el resumen, la leyenda con palabras, «Ver como tabla»), la caja que
 * pide la URL y el vacío cuando no hubo movimientos. El gráfico en sí lo
 * dibuja recharts en el navegador, cuando sabe cuánto mide.
 */

let search = ''
vi.mock('next/navigation', () => ({
  usePathname: () => '/bar-demo/administracion/cajas',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}))

import { CashDailyChart } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/cash-daily-chart'
import {
  buildCashDailyViews,
  CASH_CHART_RANGE_OPTIONS,
  type CashDailyAccount,
  type CashDailyReport,
} from '@/lib/accounting/cash-daily'

const CAJA = '11111111-1111-4111-8111-111111111111'
const TARJETA = '33333333-3333-4333-8333-333333333333'

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

function render(query = ''): string {
  search = query
  const html = renderToString(
    createElement(CashDailyChart, {
      views: buildCashDailyViews(REPORT, { today: '2026-10-12' }),
      ranges: CASH_CHART_RANGE_OPTIONS,
      rangeKey: 'ultimos-30-dias',
      rangeLabel: '10/10 – 12/10/2026',
    }),
  )
  // Los importes llevan espacio duro; React separa los textos con comentarios.
  return html.replaceAll(' ', ' ').replaceAll('<!-- -->', '')
}

describe('CashDailyChart', () => {
  beforeEach(() => {
    search = ''
  })

  it('sin nada en la URL muestra todas las cajas, con el resumen en palabras arriba', () => {
    const html = render()
    expect(html).toContain('Todas las cajas · 10/10 – 12/10/2026')
    expect(html).toContain(
      'Empezó en $ 3.000 y hoy hay $ 3.500. En el período entró $ 500 y salió $ 0.',
    )
    expect(html).toContain('Mover plata de una caja a otra no cuenta como entrada ni como salida.')
  })

  it('la leyenda dice qué es cada cosa con palabras, no solo con color', () => {
    const html = render()
    expect(html).toContain('Saldo al final de cada día')
    expect(html).toContain('Entró (barra hacia arriba)')
    expect(html).toContain('Salió (barra hacia abajo)')
  })

  it('ofrece la tabla y los tres períodos, con el elegido marcado', () => {
    const html = render()
    expect(html).toMatch(/<button[^>]*>(<svg.*?<\/svg>)?Ver como tabla<\/button>/s)
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Últimos 30 días/)
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>Este mes/)
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>Mes pasado/)
  })

  it('?grafico= elige la caja; la tarjeta se lee como deuda', () => {
    const html = render(`grafico=${TARJETA}`)
    expect(html).toContain('Visa de la empresa · 10/10 – 12/10/2026')
    expect(html).toContain('Empezó con una deuda de $ 400 y hoy la deuda es de $ 700.')
    expect(html).toContain('Deuda al final de cada día')
    expect(html).toContain('Consumos (barra hacia arriba)')
    expect(html).toContain('Pagos (barra hacia abajo)')
    expect(html).toContain('Es una deuda: sube con los consumos y baja con los pagos.')
  })

  it('una caja sin movimientos muestra el vacío con su saldo, sin gráfico ni tabla', () => {
    const html = render(`grafico=${CAJA}`)
    expect(html).toContain('No hubo movimientos en este período')
    expect(html).toContain(
      'Caja del salón · 10/10 – 12/10/2026. Empezó en $ 3.000 y hoy hay $ 3.000.',
    )
    expect(html).not.toContain('Ver como tabla')
    expect(html).not.toContain('barra hacia arriba')
  })

  it('una caja que ya no existe cae en todas las cajas', () => {
    const html = render('grafico=99999999-9999-4999-8999-999999999999')
    expect(html).toContain('Todas las cajas · 10/10 – 12/10/2026')
  })
})
