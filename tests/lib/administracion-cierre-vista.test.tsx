// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CloseTicket } from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_components/close-ticket'
import {
  type CloseMethod,
  SalesCloseForm,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_components/sales-close-form'
import {
  closeArrivals,
  describeCloseMethod,
  groupCloseMethods,
  invoiceSplit,
  targetProgress,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-view'
import { E8, prepare } from './accounting-fixtures'

/**
 * Lo que el cierre del día MUESTRA desde el rediseño de octubre 2026: los medios
 * agrupados, a dónde va la plata de cada uno, «Cuándo entra», el reparto con
 * factura / sin factura y el ticket. Lo que se MANDA lo fija
 * `administracion-cierre.test.ts` (el golden E8) y no cambió.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/bar/administracion/ventas/cierre',
  useSearchParams: () => new URLSearchParams(),
}))
// Las acciones de servidor no corren acá: alcanza con que existan.
vi.mock('@/lib/accounting/actions/documents', () => ({
  postSalesClose: vi.fn(),
  undoDocument: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/parties', () => ({ createParty: vi.fn(), saveParty: vi.fn() }))
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => ({
    tenantSlug: 'bar',
    today: '2026-10-07',
    access: { read: true, write: true, admin: true },
    readOnly: false,
    openAction: () => {},
    closeAction: () => {},
  }),
  useAccountingOptional: () => null,
}))

/**
 * El HTML listo para comparar contra texto escrito a mano: con espacios comunes
 * (la plata lleva un espacio duro entre el «$» y el número, `formatCents`) y sin
 * las marcas que React pone entre dos textos seguidos.
 */
function renderText(node: Parameters<typeof renderToString>[0]): string {
  return renderToString(node).replaceAll('\u00a0', ' ').replaceAll('<!-- -->', '')
}

const DAY = '2026-10-07'
const CAJA = { id: 't-caja', name: 'Caja', kind: 'cash' as const }
const MP = { id: 'p-mp', name: 'Mercado Pago' }

describe('cierre del día: cada medio, en palabras', () => {
  it('el efectivo entra a la caja en el momento', () => {
    const view = describeCloseMethod(
      { kind: 'treasury', channel: 'salon', settlementDays: 0 },
      DAY,
      {
        treasury: CAJA,
        party: null,
        isCash: true,
        mercadoPago: false,
      },
    )
    expect(view.group).toBe('cash')
    expect(view.destination).toBe('Entra a Caja')
    expect(view.payer).toBeNull()
    expect(view.arrival).toMatchObject({ key: 'now:t-caja', label: 'Entra a Caja' })
  })

  it('lo que se acredita en el acto queda «en camino» (no «a acreditar»)', () => {
    const view = describeCloseMethod(
      { kind: 'settled_now', channel: 'salon', settlementDays: 0 },
      DAY,
      { treasury: null, party: MP, isCash: false, mercadoPago: true },
    )
    expect(view.group).toBe('wallet')
    expect(view.destination).toBe('Queda en camino')
    expect(view.payer).toBe('Mercado Pago')
    expect(view.arrival.label).toBe('En camino a Mercado Pago')
    expect(`${view.destination} ${view.arrival.label}`).not.toMatch(/acreditar/i)
  })

  it('la tarjeta dice qué día llega: el día del cierre más los días del medio', () => {
    const view = describeCloseMethod(
      { kind: 'receivable', channel: 'salon', settlementDays: 10 },
      DAY,
      {
        treasury: null,
        party: { id: 'p-credito', name: 'Tarjetas de crédito (Posnet)' },
        isCash: false,
        mercadoPago: false,
      },
    )
    expect(view.group).toBe('cards')
    expect(view.destination).toBe('Llega el sáb 17/10')
    expect(view.payer).toBe('Tarjetas de crédito (Posnet)')
    expect(view.arrival).toMatchObject({ key: 'due:2026-10-17', label: 'Llega el sáb 17/10' })
  })

  it('una app de delivery va con las apps, también si paga a los 0 días o con días negativos', () => {
    const lookup = {
      treasury: null,
      party: { id: 'p-rappi', name: 'Rappi' },
      isCash: false,
      mercadoPago: false,
    }
    const app = describeCloseMethod(
      { kind: 'receivable', channel: 'delivery', settlementDays: 14 },
      DAY,
      lookup,
    )
    expect(app.group).toBe('delivery')
    expect(app.destination).toBe('Llega el mié 21/10')
    const sameDay = describeCloseMethod(
      { kind: 'receivable', channel: 'delivery', settlementDays: -3 },
      DAY,
      lookup,
    )
    expect(sameDay.arrival.key).toBe('due:2026-10-07')
  })

  it('una transferencia directo al banco va con las billeteras; cuenta corriente y señas, aparte', () => {
    const bank = describeCloseMethod(
      { kind: 'treasury', channel: 'salon', settlementDays: 0 },
      DAY,
      {
        treasury: { id: 't-banco', name: 'Banco Macro', kind: 'bank' },
        party: null,
        isCash: false,
        mercadoPago: false,
      },
    )
    expect(bank.group).toBe('wallet')
    expect(bank.destination).toBe('Entra a Banco Macro')

    const none = { treasury: null, party: null, isCash: false, mercadoPago: false }
    const account = describeCloseMethod(
      { kind: 'customer_account', channel: 'salon', settlementDays: 0 },
      DAY,
      none,
    )
    expect(account.group).toBe('account')
    expect(account.destination).toBe('Queda en la cuenta de cada cliente')
    const advance = describeCloseMethod(
      { kind: 'advance', channel: 'salon', settlementDays: 0 },
      DAY,
      none,
    )
    expect(advance.group).toBe('advance')
    expect(advance.arrival.label).toBe('Ya cobrado como seña')
  })
})

describe('cierre del día: los grupos no cambian el orden de Ajustes', () => {
  it('los grupos van por primera aparición y adentro se respeta el orden', () => {
    const blocks = groupCloseMethods([
      { id: 'efectivo', group: 'cash' as const },
      { id: 'transferencia', group: 'wallet' as const },
      { id: 'qr', group: 'wallet' as const },
      { id: 'debito', group: 'cards' as const },
      { id: 'credito', group: 'cards' as const },
      { id: 'rappi', group: 'delivery' as const },
    ])
    expect(blocks.map((b) => b.group)).toEqual(['cash', 'wallet', 'cards', 'delivery'])
    // Con los medios de un grupo juntos, la pantalla queda en el mismo orden que la lista.
    expect(blocks.flatMap((b) => b.methods.map((m) => m.id))).toEqual([
      'efectivo',
      'transferencia',
      'qr',
      'debito',
      'credito',
      'rappi',
    ])
  })

  it('un medio suelto de un grupo que ya apareció se suma a ese grupo', () => {
    const blocks = groupCloseMethods([
      { id: 'debito', group: 'cards' as const },
      { id: 'qr', group: 'wallet' as const },
      { id: 'credito', group: 'cards' as const },
    ])
    expect(blocks.map((b) => [b.group, b.methods.map((m) => m.id)])).toEqual([
      ['cards', ['debito', 'credito']],
      ['wallet', ['qr']],
    ])
  })
})

describe('cierre del día: «Cuándo entra»', () => {
  const methods = [
    { id: 'efectivo', arrival: { key: 'now:caja', order: '0', label: 'Entra a Caja' } },
    { id: 'qr', arrival: { key: 'pending:mp', order: '1', label: 'En camino a Mercado Pago' } },
    {
      id: 'transfer',
      arrival: { key: 'pending:mp', order: '1', label: 'En camino a Mercado Pago' },
    },
    {
      id: 'credito',
      arrival: { key: 'due:2026-10-17', order: '2:2026-10-17', label: 'Llega el sáb 17/10' },
    },
    {
      id: 'debito',
      arrival: { key: 'due:2026-10-08', order: '2:2026-10-08', label: 'Llega el jue 08/10' },
    },
    {
      id: 'rappi',
      arrival: { key: 'due:2026-10-21', order: '2:2026-10-21', label: 'Llega el mié 21/10' },
    },
    {
      id: 'pedidosya',
      arrival: { key: 'due:2026-10-21', order: '2:2026-10-21', label: 'Llega el mié 21/10' },
    },
  ]
  const amounts: Record<string, number> = {
    efectivo: 35_000_000,
    qr: 22_000_000,
    transfer: 18_000_000,
    credito: 33_000_000,
    debito: 41_000_000,
    rappi: 6_000_000,
    pedidosya: 15_000_000,
  }
  const amountOf = (id: string) => amounts[id] ?? 0

  it('suma por lugar y fecha, y ordena: lo que ya está, lo que está en camino y lo que llega', () => {
    const lines = closeArrivals(methods, amountOf, { methodId: 'efectivo', countedCents: null })
    expect(lines).toEqual([
      { key: 'now:caja', label: 'Entra a Caja', cents: 35_000_000 },
      { key: 'pending:mp', label: 'En camino a Mercado Pago', cents: 40_000_000 },
      { key: 'due:2026-10-08', label: 'Llega el jue 08/10', cents: 41_000_000 },
      { key: 'due:2026-10-17', label: 'Llega el sáb 17/10', cents: 33_000_000 },
      { key: 'due:2026-10-21', label: 'Llega el mié 21/10', cents: 21_000_000 },
    ])
    // Nada se pierde ni se inventa: suma lo mismo que lo cargado.
    const total = Object.values(amounts).reduce((sum, v) => sum + v, 0)
    expect(lines.reduce((sum, l) => sum + l.cents, 0)).toBe(total)
  })

  it('si se contó el efectivo, a la caja entra lo contado (lo que registra el asiento)', () => {
    const lines = closeArrivals(methods, amountOf, {
      methodId: 'efectivo',
      countedCents: 34_950_000,
    })
    expect(lines[0]).toEqual({ key: 'now:caja', label: 'Entra a Caja', cents: 34_950_000 })
  })

  it('lo que no tiene importe no figura', () => {
    const lines = closeArrivals(methods, (id) => (id === 'qr' ? 100 : 0), {
      methodId: 'efectivo',
      countedCents: null,
    })
    expect(lines).toEqual([{ key: 'pending:mp', label: 'En camino a Mercado Pago', cents: 100 }])
  })
})

describe('cierre del día: con factura y sin factura', () => {
  it('sin nada cargado no hay reparto (no es «$ 0 sin factura»)', () => {
    expect(invoiceSplit(0, [{ invoicedTotalCents: 0 }]).kind).toBe('empty')
  })

  it('sin facturar nada, todo lo vendido queda sin factura', () => {
    expect(invoiceSplit(170_000_000, [{ invoicedTotalCents: 0 }])).toMatchObject({
      kind: 'none',
      invoicedCents: 0,
      uninvoicedCents: 170_000_000,
      invoicedPercent: 0,
    })
  })

  it('con una parte facturada: vendido − facturado, sumando los canales', () => {
    const split = invoiceSplit(170_000_000, [
      { invoicedTotalCents: 121_000_000 },
      { invoicedTotalCents: 18_150_000 },
    ])
    expect(split).toMatchObject({
      kind: 'mixed',
      invoicedCents: 139_150_000,
      uninvoicedCents: 30_850_000,
      overCents: 0,
      invoicedPercent: 82,
    })
  })

  it('con las dos partes nunca dice 0 % ni 100 %', () => {
    expect(invoiceSplit(100_000_00, [{ invoicedTotalCents: 1 }]).invoicedPercent).toBe(1)
    expect(invoiceSplit(100_000_00, [{ invoicedTotalCents: 100_000_00 - 1 }]).invoicedPercent).toBe(
      99,
    )
  })

  it('todo facturado, y facturado de más (nunca un «sin factura» negativo)', () => {
    expect(invoiceSplit(1_000_00, [{ invoicedTotalCents: 1_000_00 }])).toMatchObject({
      kind: 'all',
      uninvoicedCents: 0,
      invoicedPercent: 100,
    })
    expect(invoiceSplit(1_000_00, [{ invoicedTotalCents: 1_415_00 }])).toMatchObject({
      kind: 'over',
      uninvoicedCents: 0,
      overCents: 415_00,
    })
  })
})

describe('cierre del día: el objetivo', () => {
  it('sin objetivo (o en cero) no se muestra', () => {
    expect(targetProgress(null, 1_000_00)).toBeNull()
    expect(targetProgress(0, 1_000_00)).toBeNull()
  })

  it('el avance es lo vendido ese día contra el objetivo', () => {
    expect(targetProgress(200_000_000, 170_000_000)).toEqual({
      targetCents: 200_000_000,
      percent: 85,
    })
    expect(targetProgress(100_000_00, 0)?.percent).toBe(0)
  })
})

describe('cierre del día: el ticket', () => {
  const emptySplit = invoiceSplit(0, [])

  it('vacío enseña lo que va a aparecer y nunca muestra «$ 0»', () => {
    const html = renderText(
      createElement(CloseTicket, {
        dayTitle: 'miércoles 07/10',
        shift: null,
        lines: [],
        soldCents: 0,
        channelsText: null,
        split: emptySplit,
        cash: { expectedCents: 0, countedCents: null, diffCents: 0 },
        arrivals: [],
        target: null,
      }),
    )
    expect(html).toContain('Cargá los importes y el ticket se arma solo.')
    expect(html).toContain('Total vendido')
    expect(html).toContain('Con factura')
    expect(html).toContain('Sin factura')
    expect(html).not.toContain('$ 0')
    // Sin ventas en efectivo y sin conteo, el arqueo todavía no figura.
    expect(html).not.toContain('Debería haber')
  })

  it('lleno: medios, total, reparto, arqueo en palabras, cuándo entra y objetivo', () => {
    const split = invoiceSplit(170_000_000, [{ invoicedTotalCents: 139_150_000 }])
    const html = renderText(
      createElement(CloseTicket, {
        dayTitle: 'miércoles 07/10',
        shift: 'noche',
        lines: [
          { id: 'efectivo', name: 'Efectivo', cents: 35_000_000 },
          { id: 'debito', name: 'Débito', cents: 135_000_000 },
        ],
        soldCents: 170_000_000,
        channelsText: null,
        split,
        cash: { expectedCents: 35_000_000, countedCents: 34_950_000, diffCents: 50_000 },
        arrivals: [
          { key: 'now:caja', label: 'Entra a Caja', cents: 34_950_000 },
          { key: 'due:2026-10-08', label: 'Llega el jue 08/10', cents: 135_000_000 },
        ],
        target: targetProgress(200_000_000, 170_000_000),
      }),
    )
    expect(html).toContain('miércoles 07/10 · noche')
    expect(html).toContain('82 % con factura')
    expect(html).toContain('$ 1.700.000')
    expect(html).toContain('$ 1.391.500')
    expect(html).toContain('$ 308.500')
    // Vendido − contado = 500: falta plata, dicho en palabras y sin signo.
    expect(html).toContain('Faltan $ 500')
    expect(html).toContain('Llega el jue 08/10')
    expect(html).toContain('Objetivo del día')
    expect(html).toContain('85 %')
    expect(html).toContain('todo queda registrado en los libros')
  })

  it('sin nada facturado lleva el sello «Sin factura»; facturado de más, un aviso y sin sello', () => {
    const base = {
      dayTitle: 'miércoles 07/10',
      shift: null,
      lines: [{ id: 'efectivo', name: 'Efectivo', cents: 1_000_00 }],
      soldCents: 1_000_00,
      channelsText: null,
      cash: null,
      arrivals: [],
      target: null,
    }
    const none = renderText(
      createElement(CloseTicket, {
        ...base,
        split: invoiceSplit(1_000_00, [{ invoicedTotalCents: 0 }]),
      }),
    )
    expect(none).toContain('adm-stamp-in')
    const over = renderText(
      createElement(CloseTicket, {
        ...base,
        split: invoiceSplit(1_000_00, [{ invoicedTotalCents: 1_415_00 }]),
      }),
    )
    expect(over).toContain('Facturado de más')
    expect(over).toContain('$ 415')
    expect(over).not.toContain('adm-stamp-in')
  })
})

describe('cierre del día: la pantalla al entrar', () => {
  const { ctx } = prepare(E8)
  const methods: CloseMethod[] = [...ctx.methods.values()]
    .sort((a, b) => a.sort - b.sort)
    .map((m) => {
      const treasury = m.treasuryAccountId
        ? (ctx.treasuries.get(m.treasuryAccountId) ?? null)
        : null
      const party = m.partyId ? (ctx.parties.get(m.partyId) ?? null) : null
      const isCash = m.kind === 'treasury' && treasury?.kind === 'cash'
      const view = describeCloseMethod(m, DAY, {
        treasury,
        party: party ? { id: party.id, name: party.tradeName ?? party.name } : null,
        isCash,
        mercadoPago: false,
      })
      return {
        id: m.id,
        name: m.name,
        kind: m.kind,
        channel: m.channel,
        destination: view.destination,
        isCash,
        group: view.group,
        payer: view.payer,
        mercadoPago: false,
        arrival: view.arrival,
      }
    })

  const render = (overrides: Partial<Parameters<typeof SalesCloseForm>[0]> = {}) =>
    renderText(
      createElement(SalesCloseForm, {
        tenantSlug: 'bar',
        date: DAY,
        dayLabel: 'miércoles 07/10',
        ctx,
        firstOpenDate: null,
        methods,
        salesPoints: [],
        rangeDefaults: [],
        customers: [],
        existing: [],
        afterSaveHref: '/bar/administracion/ventas',
        afterSaveLabel: 'jueves 08/10',
        mercadoPago: null,
        targetCents: null,
        ...overrides,
      }),
    )

  it('los pasos están todos a la vista, numerados, y el efectivo contado no hay que buscarlo', () => {
    const html = render()
    expect(methods.some((m) => m.isCash)).toBe(true)
    for (const title of [
      '¿Cuánto se vendió y cómo te pagaron?',
      '¿Contaste el efectivo?',
      '¿Qué facturaste?',
      'Revisá y guardá',
    ]) {
      expect(html).toContain(title)
    }
    for (const anchor of ['paso-1', 'paso-2', 'paso-3', 'paso-4']) {
      expect(html).toContain(`id="${anchor}"`)
    }
    expect(html).toContain('Efectivo contado')
    expect(html).toContain('Saltear')
    // Un renglón por medio, con su campo.
    for (const m of methods.filter((x) => x.kind !== 'customer_account')) {
      expect(html).toContain(m.name)
    }
  })

  it('vacía no muestra ceros: el total es «—» y el ticket dice cómo se arma', () => {
    const html = render()
    expect(html).not.toContain('$ 0')
    expect(html).toContain('Cargá los importes y el ticket se arma solo.')
    expect(html).toContain('Guardar cierre del miércoles 07/10')
    expect(html).toContain('Después sigue el del jueves 08/10.')
    expect(html).toContain('Ver cómo queda en los libros')
  })

  it('sin puntos de venta explica que todo queda sin factura y a dónde ir a cargarlos', () => {
    const html = render()
    expect(html).toContain('Sin puntos de venta, todo el día queda como venta sin factura.')
    expect(html).toContain('/bar/administracion/ajustes?tab=puntos-de-venta')
    // «Con factura / sin factura» está siempre, también sin datos.
    expect(html).toContain('Con factura y sin factura')
    // Un solo libro: nada sugiere que algo queda afuera.
    expect(html).not.toMatch(/en negro|en blanco|afuera de los libros/i)
  })

  it('con el día ya cargado muestra el cierre y recién después deja cargar otro turno', () => {
    const html = render({ existing: [{ id: 'doc-1', title: 'Cierre', totalCents: 75_647_280 }] })
    expect(html).toContain('Ya está cargado')
    expect(html).toContain('756.472,80')
    expect(html).toContain('Cargar otro turno')
    expect(html).toContain('/bar/administracion/comprobantes/doc-1')
    // El formulario no se abre solo.
    expect(html).not.toContain('¿Cuánto se vendió y cómo te pagaron?')
  })

  it('sin medios de cobro enseña el paso que falta en vez del formulario', () => {
    const html = render({ methods: [] })
    expect(html).toContain('Primero decime cómo cobrás')
    expect(html).toContain('/bar/administracion/ajustes?tab=medios')
    expect(html).not.toContain('Revisá y guardá')
  })
})
