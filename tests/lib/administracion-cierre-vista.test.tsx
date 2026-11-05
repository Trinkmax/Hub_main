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
  closeTaxView,
  controlCheck,
  describeCloseMethod,
  groupCloseMethods,
  invoiceSplit,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-view'
import { buildSalesClose, summarizeSalesClose } from '@/lib/accounting/posting/sales-close'
import { DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import { E8, prepare } from './accounting-fixtures'

/**
 * Lo que el cierre del día MUESTRA: los medios, a dónde va la plata de cada uno,
 * el reparto con factura / sin factura, lo que se calcula solo y el ticket de un
 * cierre guardado. Lo que se MANDA lo fija `administracion-cierre.test.ts` (el
 * golden E8) y no cambió.
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
    expect(view.entersTo).toBe('Caja')
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
    expect(view.entersTo).toBe('Mercado Pago')
    expect(`${view.destination} ${view.entersTo}`).not.toMatch(/acreditar/i)
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
    expect(view.entersTo).toBe('Tarjetas de crédito (Posnet)')
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
    expect(sameDay.destination).toBe('Llega el mié 07/10')
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
    expect(advance.entersTo).toBe('Señas')
    expect(account.entersTo).toBe('Cuenta del cliente')
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

describe('cierre del día: el total del sistema de caja', () => {
  it('sin cargarlo no controla nada; igual a lo cargado, coincide', () => {
    expect(controlCheck(null, 219_705_050)).toEqual({ kind: 'none' })
    expect(controlCheck(219_705_050, 219_705_050)).toEqual({ kind: 'match' })
    // Un total en cero contra nada cargado también coincide: no es «sin cargar».
    expect(controlCheck(0, 0)).toEqual({ kind: 'match' })
  })

  it('si no coincide dice para qué lado y por cuánto, al centavo', () => {
    // El sistema dice más que lo cargado: falta cargar la diferencia.
    expect(controlCheck(225_000_000, 219_705_050)).toEqual({ kind: 'short', cents: 5_294_950 })
    // Se cargó de más.
    expect(controlCheck(219_705_000, 219_705_050)).toEqual({ kind: 'over', cents: 50 })
  })
})

describe('cierre del día: lo que se calcula solo', () => {
  const invoiced = [{ totalCents: 145_000_000, vatRateBp: 2100 as const, creditNote: false }]
  /** Lo facturado sin IVA, igual que en el prototipo: 1.450.000 / 1,21. */
  const NET = 119_834_711

  it('IVA, Ingresos Brutos y Comercio e Industria, con su porcentaje', () => {
    const view = closeTaxView({
      invoiced,
      invoicedNetCents: NET,
      uninvoicedCents: 91_500_000,
      settings: DEFAULT_TAX_SETTINGS,
    })
    expect(view.vat).toEqual([{ key: 'vat-2100', label: 'IVA 21 %', cents: 25_165_289 }])
    expect(view.accrued).toEqual([
      { key: 'iibb', label: 'Ingresos Brutos 3 %', cents: 3_595_041 },
      { key: 'municipal', label: 'Comercio e Industria 0,7 %', cents: 838_843 },
    ])
    expect(view.base).toBe('invoiced_net')
  })

  it('sobre todo lo vendido, si así lo eligieron en Ajustes', () => {
    const view = closeTaxView({
      invoiced,
      invoicedNetCents: NET,
      uninvoicedCents: 80_165_289,
      settings: { ...DEFAULT_TAX_SETTINGS, base: 'all_sales' },
    })
    expect(view.accrued[0]?.cents).toBe(6_000_000)
    expect(view.base).toBe('all_sales')
  })

  it('una nota de crédito resta IVA; cada alícuota, su renglón', () => {
    const view = closeTaxView({
      invoiced: [
        { totalCents: 121_000, vatRateBp: 2100, creditNote: false },
        { totalCents: 12_100, vatRateBp: 2100, creditNote: true },
        { totalCents: 110_500, vatRateBp: 1050, creditNote: false },
        { totalCents: 50_000, vatRateBp: 0, creditNote: false },
      ],
      invoicedNetCents: 0,
      uninvoicedCents: 0,
      settings: DEFAULT_TAX_SETTINGS,
    })
    expect(view.vat).toEqual([
      { key: 'vat-2100', label: 'IVA 21 %', cents: 18_900 },
      { key: 'vat-1050', label: 'IVA 10,5 %', cents: 10_500 },
    ])
  })

  it('sin nada facturado se ve la alícuota general en cero, y nada se calcula', () => {
    const view = closeTaxView({
      invoiced: [],
      invoicedNetCents: 0,
      uninvoicedCents: 91_500_000,
      settings: DEFAULT_TAX_SETTINGS,
    })
    expect(view.vat).toEqual([{ key: 'vat-2100', label: 'IVA 21 %', cents: 0 }])
    expect(view.accrued.map((line) => line.cents)).toEqual([0, 0])
  })

  it('con los impuestos apagados, o sin dato, solo queda el IVA', () => {
    for (const settings of [{ ...DEFAULT_TAX_SETTINGS, auto: false }, null, undefined]) {
      const view = closeTaxView({
        invoiced,
        invoicedNetCents: NET,
        uninvoicedCents: 0,
        settings,
      })
      expect(view.accrued).toEqual([])
      expect(view.base).toBeNull()
      expect(view.vat).toHaveLength(1)
    }
  })

  it('son los mismos números que van al asiento', () => {
    const { r, ctx, meta } = prepare(E8)
    const close = E8.input(r)
    const built = buildSalesClose(close, ctx, meta)
    const summary = summarizeSalesClose(close, ctx)
    if (!built.ok) throw new Error('el asiento no se armó')
    const lines = built.bundle.documents[0]?.lines ?? []
    const vatOfEntry = lines
      .filter((line) => line.role === 'vat')
      .reduce(
        (sum, line) => sum + (line.side === 'credit' ? line.amountCents : -line.amountCents),
        0,
      )
    const view = closeTaxView({
      invoiced: close.invoiced.map((row) => ({
        totalCents: row.totalCents ?? 0,
        vatRateBp: row.vatRateBp,
        creditNote: row.voucherType.startsWith('nota_credito'),
      })),
      invoicedNetCents: summary.channels.reduce((sum, c) => sum + c.invoicedNetCents, 0),
      uninvoicedCents: summary.channels.reduce((sum, c) => sum + c.uninvoicedCents, 0),
      settings: ctx.settings.taxSettings,
    })
    expect(view.vat.reduce((sum, line) => sum + line.cents, 0)).toBe(vatOfEntry)
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
        invoiceAsked: false,
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
    expect(html).not.toContain('Efectivo contado')
    expect(html).not.toContain('adm-stamp-in')
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
        invoiceAsked: true,
        cash: { expectedCents: 35_000_000, countedCents: 34_950_000, diffCents: 50_000 },
        arrivals: [
          { key: 'now:caja', label: 'Entra a Caja', cents: 34_950_000 },
          { key: 'due:2026-10-08', label: 'Llega el jue 08/10', cents: 135_000_000 },
        ],
        target: { targetCents: 200_000_000, percent: 85 },
      }),
    )
    expect(html).toContain('miércoles 07/10 · noche')
    expect(html).toContain('82 % con factura')
    expect(html).toContain('$ 1.700.000')
    expect(html).toContain('$ 1.391.500')
    expect(html).toContain('$ 308.500')
    // Vendido − contado = 500: falta plata, dicho en palabras y sin signo.
    expect(html).toContain('Efectivo contado')
    expect(html).toContain('$ 349.500')
    expect(html).toContain('Faltan $ 500')
    // Lo que debería haber ya es el renglón «Efectivo» de arriba: no se repite.
    expect(html).not.toContain('Debería haber')
    expect(html).toContain('Cuándo entra')
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
      invoiceAsked: true,
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

  it('antes de «¿Qué facturaste?» no sella nada ni afirma «con factura $ 0»', () => {
    const html = renderText(
      createElement(CloseTicket, {
        dayTitle: 'miércoles 07/10',
        shift: null,
        lines: [{ id: 'efectivo', name: 'Efectivo', cents: 1_000_00 }],
        soldCents: 1_000_00,
        channelsText: null,
        split: invoiceSplit(1_000_00, [{ invoicedTotalCents: 0 }]),
        // El bar tiene puntos de venta y la persona todavía no anotó ninguna factura.
        invoiceAsked: false,
        cash: null,
        arrivals: [],
        target: null,
      }),
    )
    expect(html).not.toContain('adm-stamp-in')
    expect(html).not.toContain('$ 0')
    expect(html).toContain('Con factura')
    // Lo que quedaría sin factura si se guarda así sí se dice, con su importe.
    expect(html).toContain('Sin factura')
    expect(html).toContain('$ 1.000')
  })

  it('si un importe tiene centavos, todos los llevan: las comas quedan alineadas', () => {
    const lines = [
      { id: 'efectivo', name: 'Efectivo', cents: 48_630_000 },
      { id: 'credito', name: 'Crédito', cents: 41_820_050 },
    ]
    const sold = 90_450_050
    const withCents = renderText(
      createElement(CloseTicket, {
        dayTitle: 'miércoles 07/10',
        shift: null,
        lines,
        soldCents: sold,
        channelsText: null,
        split: invoiceSplit(sold, [{ invoicedTotalCents: 0 }]),
        invoiceAsked: true,
        cash: null,
        arrivals: [{ key: 'now:caja', label: 'Entra a Caja', cents: 48_630_000 }],
        target: null,
      }),
    )
    expect(withCents).toContain('$ 486.300,00')
    expect(withCents).toContain('$ 418.200,50')
    expect(withCents).not.toMatch(/\$ 486\.300(?!,)/)

    const round = renderText(
      createElement(CloseTicket, {
        dayTitle: 'miércoles 07/10',
        shift: null,
        lines: [lines[0] ?? { id: 'x', name: 'x', cents: 0 }],
        soldCents: 48_630_000,
        channelsText: null,
        split: invoiceSplit(48_630_000, [{ invoicedTotalCents: 0 }]),
        invoiceAsked: true,
        cash: null,
        arrivals: [],
        target: null,
      }),
    )
    expect(round).toContain('$ 486.300')
    expect(round).not.toContain(',00')
  })

  it('pegado en la compu trae «Cuándo entra» también plegado, para una pantalla baja', () => {
    const props = {
      dayTitle: 'miércoles 07/10',
      shift: null,
      lines: [{ id: 'efectivo', name: 'Efectivo', cents: 1_000_00 }],
      soldCents: 1_000_00,
      channelsText: null,
      split: invoiceSplit(1_000_00, [{ invoicedTotalCents: 0 }]),
      invoiceAsked: true,
      cash: null,
      arrivals: [{ key: 'now:caja', label: 'Entra a Caja', cents: 1_000_00 }],
      target: null,
    }
    const sheet = renderText(createElement(CloseTicket, props))
    expect(sheet).not.toContain('<details')
    const sticky = renderText(createElement(CloseTicket, { ...props, compact: true }))
    expect(sticky).toContain('<details')
    // Las dos versiones dicen lo mismo: solo cambia cuál se ve según el alto.
    expect(sticky.split('Entra a Caja').length - 1).toBe(2)
  })

  describe('de un cierre ya guardado (`still` y `footer`)', () => {
    const saved = {
      dayTitle: 'miércoles 07/10',
      shift: 'noche',
      lines: [
        { id: 'efectivo', name: 'Efectivo', cents: 35_000_000 },
        { id: 'debito', name: 'Débito', cents: 135_000_000 },
      ],
      soldCents: 170_000_000,
      channelsText: null,
      split: invoiceSplit(170_000_000, [{ invoicedTotalCents: 139_150_000 }]),
      invoiceAsked: true,
      cash: { expectedCents: 35_000_000, countedCents: 34_950_000, diffCents: 50_000 },
      arrivals: [],
      target: null,
    }

    it('va quieto: el mismo sello sin sellazo y el mismo total sin número que cuenta', () => {
      const loading = renderText(createElement(CloseTicket, saved))
      const still = renderText(createElement(CloseTicket, { ...saved, still: true }))
      // Mientras se carga, como siempre: el sello entra y el total cuenta.
      expect(loading).toContain('adm-stamp-in')
      expect(loading).toContain('data-slot="money-ticker"')
      // Guardado, el papel solo se mira.
      expect(still).not.toContain('adm-stamp-in')
      expect(still).not.toContain('data-slot="money-ticker"')
      // Y dice exactamente lo mismo.
      for (const text of [
        'miércoles 07/10 · noche',
        '82 % con factura',
        'Total vendido',
        '$ 1.700.000',
        '$ 1.391.500',
        '$ 308.500',
        'Efectivo contado',
        'Faltan $ 500',
        'todo queda registrado en los libros',
      ]) {
        expect(loading).toContain(text)
        expect(still).toContain(text)
      }
    })

    it('el pie va dentro del papel, después de la letra chica', () => {
      const footer = createElement('p', { 'data-pie': 'cargo' }, 'Cargó Sofi el 08/10 a las 02:14')
      const html = renderText(createElement(CloseTicket, { ...saved, still: true, footer }))
      const note = html.indexOf('todo queda registrado en los libros')
      const foot = html.indexOf('Cargó Sofi el 08/10 a las 02:14')
      expect(note).toBeGreaterThan(-1)
      expect(foot).toBeGreaterThan(note)
      // Adentro del `article` del ticket, no después.
      expect(foot).toBeLessThan(html.indexOf('</article>'))
      // Sin pie, nada de más: el papel termina en la letra chica.
      const bare = renderText(createElement(CloseTicket, { ...saved, still: true }))
      expect(bare).not.toContain('data-pie')
      expect(bare.slice(bare.indexOf('todo queda registrado en los libros'))).toMatch(
        /^todo queda registrado en los libros\.<\/p><\/article>/,
      )
    })

    it('facturado de más y ya guardado: lo dice, sin prometer una pregunta «al guardar»', () => {
      const over = {
        ...saved,
        cash: null,
        lines: [{ id: 'efectivo', name: 'Efectivo', cents: 1_000_00 }],
        soldCents: 1_000_00,
        split: invoiceSplit(1_000_00, [{ invoicedTotalCents: 1_415_00 }]),
      }
      const loading = renderText(createElement(CloseTicket, over))
      const still = renderText(createElement(CloseTicket, { ...over, still: true }))
      expect(loading).toContain('Al guardar te preguntamos por qué.')
      expect(still).toContain('Facturado de más')
      expect(still).toContain('$ 415')
      expect(still).not.toContain('Al guardar')
    })
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
        entersTo: view.entersTo,
        destination: view.destination,
        isCash,
        group: view.group,
        payer: view.payer,
        mercadoPago: false,
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
        ...overrides,
      }),
    )

  it('la planilla: Medio, Entró a e Importe, con el total y la doble raya', () => {
    const html = render()
    for (const column of ['Medio', 'Entró a', 'Importe', 'Total vendido']) {
      expect(html).toContain(column)
    }
    expect(html).toContain('adm-double-rule')
    // Un renglón por medio, con su campo.
    for (const m of methods.filter((x) => x.kind !== 'customer_account')) {
      expect(html).toContain(m.name)
      expect(html).toContain(`>${m.entersTo}`)
    }
    // «Entró a» viene del medio de cobro: en un cierre no se elige.
    expect(html).not.toContain('Cuenta de Efectivo')
    expect(html).not.toContain('<select')
  })

  it('sin el ticket vivo ni los pasos en tarjetas', () => {
    const html = render()
    expect(html).not.toContain('adm-ticket')
    expect(html).not.toContain('paso-1')
    expect(html).not.toContain('Ver ticket')
    expect(html).not.toContain('Revisá y guardá')
  })

  it('el pegado de la columna de Thinkeon es una acción de arriba', () => {
    const html = render()
    expect(html).toContain('Pegar la columna de Thinkeon')
    expect(html.indexOf('Pegar la columna de Thinkeon')).toBeLessThan(html.indexOf('Entró a'))
  })

  it('debajo: Con factura, Sin factura y Efectivo contado', () => {
    const html = render()
    for (const label of ['Con factura', 'Sin factura', 'Efectivo contado']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('¿Contaste el efectivo?')
  })

  it('el «Sin factura» es un número más: nada oculta ventas de los libros', () => {
    const html = render()
    expect(html).not.toMatch(/oculta|no registrar|no contabilizar|en negro|en blanco/i)
    expect(html).not.toMatch(/afuera de los libros|fuera de los libros/i)
    expect(html).not.toContain('type="checkbox"')
  })

  it('vacía no muestra ceros y el botón no invita', () => {
    const html = render()
    expect(html).not.toContain('$ 0')
    expect(html).toContain('Cargar cierre')
    expect(html).not.toContain('Cargar cierre ·')
    expect(html).toContain('Después sigue el del jueves 08/10.')
    // Sin importes, el botón de guardar no invita (sigue siendo el mismo submit).
    expect(html).toMatch(/<button(?=[^>]*type="submit")[^>]*\bbg-secondary\b/)
  })

  it('«Ver el asiento» va plegado: no muestra jerga de contadora ni un «Sin importes»', () => {
    const html = render()
    expect(html).toContain('Ver el asiento')
    expect(html).not.toContain('Cuadra')
    expect(html).not.toContain('Sin importes')
  })

  it('a la derecha, lo que se calcula solo, con su porcentaje y el link a Ajustes', () => {
    const html = render({
      ctx: { ...ctx, settings: { ...ctx.settings, taxSettings: DEFAULT_TAX_SETTINGS } },
    })
    expect(html).toContain('Se calcula solo')
    expect(html).toContain('IVA 21 %')
    expect(html).toContain('Ingresos Brutos 3 %')
    expect(html).toContain('Comercio e Industria 0,7 %')
    expect(html).toContain('Sobre lo facturado, sin IVA.')
    expect(html).toContain('/bar/administracion/ajustes?tab=impuestos')
  })

  it('con los impuestos automáticos apagados lo dice, y deja el IVA', () => {
    const html = render({
      ctx: {
        ...ctx,
        settings: { ...ctx.settings, taxSettings: { ...DEFAULT_TAX_SETTINGS, auto: false } },
      },
    })
    expect(html).toContain('IVA 21 %')
    expect(html).not.toContain('Ingresos Brutos 3 %')
    expect(html).toContain('Ingresos Brutos y Comercio e Industria no se están calculando.')
  })

  it('lo menos usado va plegado, y lo que se pliega no se dibuja', () => {
    const html = render({
      mercadoPago: {
        qrMethodId: null,
        transferMethodId: null,
        cutoffHour: 0,
        sasCuit: null,
        settingsHref: '/bar/administracion/importar/mercado-pago',
      },
    })
    expect(html).toContain('Completar con el reporte de Mercado Pago')
    expect(html).toContain('Control con tu sistema de caja')
    // Plegados: no se ve lo de adentro, y Enter no se traba en un campo que no se ve.
    expect(html).not.toContain('Total que dice tu sistema de caja')
    expect(html).not.toContain('Importar › Mercado Pago')
    expect(html.split('aria-expanded="false"').length - 1).toBeGreaterThanOrEqual(3)
  })

  it('sin Mercado Pago conectado no se ofrece el reporte', () => {
    expect(render()).not.toContain('Completar con el reporte de Mercado Pago')
  })

  it('sin puntos de venta explica que todo queda sin factura y a dónde ir a cargarlos', () => {
    const html = render()
    expect(html).toContain('Sin puntos de venta, todo el día queda como venta sin factura.')
    expect(html).toContain('Queda registrado igual.')
    expect(html).toContain('/bar/administracion/ajustes?tab=puntos-de-venta')
    // Sin puntos de venta no hay rangos que anotar.
    expect(html).not.toContain('¿Qué facturaste?')
    // A esta altura ya están cargados los importes: el link no saca de la pantalla.
    expect(html).toMatch(
      /<a(?=[^>]*href="\/bar\/administracion\/ajustes\?tab=puntos-de-venta")(?=[^>]*target="_blank")[^>]*>/,
    )
    // Un solo libro: nada sugiere que algo queda afuera.
    expect(html).not.toMatch(/en negro|en blanco|afuera de los libros/i)
  })

  it('con varios puntos de venta, los rangos vienen abiertos: desde, hasta y total; lo fijo, plegado', () => {
    const html = render({
      salesPoints: [
        { number: 3, label: 'Salón', defaultChannel: 'salon' },
        { number: 4, label: 'Mostrador', defaultChannel: 'delivery' },
      ],
      rangeDefaults: [
        { voucherType: 'factura_b', pointOfSale: 3, channel: 'salon', lastNumberTo: 19_022 },
        { voucherType: 'factura_b', pointOfSale: 4, channel: 'delivery', lastNumberTo: 88 },
      ],
    })
    expect(html).toContain('¿Qué facturaste?')
    // El título dice todo lo fijo con palabras de dueño: el nombre del punto de venta y el IVA.
    expect(html).toContain('Factura B')
    expect(html).toContain('0003 · Salón · IVA 21 %')
    expect(html).not.toContain('PV 0003')
    expect(html).not.toContain('Alícuota')
    // A la vista, lo de todos los días; el «desde» ya viene puesto.
    for (const label of ['Desde', 'Hasta', 'Total (con IVA)']) expect(html).toContain(label)
    expect(html).toContain('value="19023"')
    // La fila que nadie tocó lo dice con palabras.
    expect(html).toContain('Sin usar · no se guarda')
    // Comprobante, punto de venta, IVA y canal van detrás de «Cambiar»: plegados no se
    // dibujan (su valor vive en el estado de la fila), así Enter no se traba en ellos.
    expect(html).toContain('Cambiar')
    expect(html).toMatch(/<div[^>]*id="[^"]*-fixed"[^>]*hidden=""/)
    for (const label of ['>Comprobante<', '>Punto de venta<', '>Canal<']) {
      expect(html).not.toContain(label)
    }
    // Con varias filas, «Con factura» es la suma: no se escribe.
    expect(html).not.toMatch(/<label[^>]*>Con factura/)
  })

  it('con un solo punto de venta, «Con factura» se escribe y los rangos quedan plegados', () => {
    const html = render({
      salesPoints: [{ number: 3, label: 'Salón', defaultChannel: 'salon' }],
    })
    expect(html).toMatch(/<label[^>]*>Con factura/)
    expect(html).toContain('¿Qué facturaste?')
    expect(html).not.toContain('Total (con IVA)')
  })

  it('con el día ya cargado muestra el cierre y recién después deja cargar otro turno', () => {
    const html = render({ existing: [{ id: 'doc-1', title: 'Cierre', totalCents: 75_647_280 }] })
    expect(html).toContain('Ya está cargado')
    expect(html).toContain('756.472,80')
    expect(html).toContain('Cargar otro turno')
    expect(html).toContain('/bar/administracion/comprobantes/doc-1')
    // Lo que sigue es la acción principal: el próximo día que falta.
    expect(html).toContain('Cargar el del jueves 08/10')
    expect(html).toContain('href="/bar/administracion/ventas"')
    // Cómo se corrige: anular y cargar de nuevo.
    expect(html).toContain('Abrí el cierre y anulalo')
    // El formulario no se abre solo.
    expect(html).not.toContain('¿Cuánto se vendió y cómo te pagaron?')
  })

  it('con el día ya cargado y ningún otro pendiente, lo que sigue es ver las ventas del mes', () => {
    const html = render({
      existing: [{ id: 'doc-1', title: 'Cierre', totalCents: 75_647_280 }],
      afterSaveLabel: null,
    })
    expect(html).toContain('Ver las ventas del mes')
    expect(html).not.toContain('Cargar el del')
  })

  it('sin medios de cobro enseña el paso que falta en vez del formulario', () => {
    const html = render({ methods: [] })
    expect(html).toContain('Primero decime cómo cobrás')
    expect(html).toContain('/bar/administracion/ajustes?tab=medios')
    expect(html).not.toContain('Se calcula solo')
  })
})
