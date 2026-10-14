// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CloseTicket } from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_components/close-ticket'
import {
  closeTicketProps,
  type SavedClose,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-ticket-props'
import { invoiceSplit } from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-view'
import {
  buildSalesClose,
  type SalesCloseBuildInput,
  summarizeSalesClose,
} from '@/lib/accounting/posting/sales-close'
import type { DocumentDetail } from '@/lib/accounting/queries/documents'
import type { PostingContext, SalesMethodRef } from '@/lib/accounting/types'
import { fixedUuid } from './accounting-core-context'
import { E8, E8B, E8B_OVERRIDE, prepare, salesCloseInput } from './accounting-fixtures'

/**
 * El ticket de un cierre YA guardado (`closeTicketProps`) tiene que decir, al
 * centavo, lo mismo que decía el ticket mientras se cargaba. Acá se cierra el
 * día con el motor de verdad (`buildSalesClose`), se arma el comprobante como
 * lo devuelve la lectura (los renglones con sus nombres) y se compara contra
 * las cuentas que hace la pantalla en vivo (`summarizeSalesClose` +
 * `invoiceSplit`).
 */

const TODAY = '2026-10-13'
/** Un medio que el bar de prueba no trae: plata que entra directo al banco. */
const BANK_METHOD_ID = fixedUuid(880_001)
const OPTS = { today: TODAY, arrivals: false } as const

type Collected = Readonly<Record<string, number>>

/**
 * El cierre como queda guardado: los renglones del motor con los nombres que
 * les pone `getDocument`, y el asiento con lo que falta cobrar de cada partida
 * (`collected`: lo ya cobrado, por nombre del medio).
 */
function save(
  input: SalesCloseBuildInput,
  ctx: PostingContext,
  meta: ReturnType<typeof prepare>['meta'],
  collected: Collected = {},
): { doc: SavedClose; totalCents: number } {
  const result = buildSalesClose(input, ctx, meta)
  if (!result.ok) throw new Error(`El motor no cerró el día: ${JSON.stringify(result.errors)}`)
  const proposed = result.bundle.documents[0]
  if (!proposed) throw new Error('Falta el cierre')
  const lines = proposed.lines.map((line) => {
    const partyId = line.partyRef && 'id' in line.partyRef ? line.partyRef.id : null
    return {
      id: `renglon-${proposed.shift ?? 'unico'}-${line.lineNo}`,
      lineNo: line.lineNo,
      role: line.role,
      side: line.side,
      amountCents: line.amountCents,
      partyId,
      partyName: partyId ? (ctx.parties.get(partyId)?.name ?? null) : null,
      dueDate: line.dueDate,
      treasuryAccountId: line.treasuryAccountId,
      treasuryName: line.treasuryAccountId
        ? (ctx.treasuries.get(line.treasuryAccountId)?.name ?? null)
        : null,
      salesMethodId: line.salesMethodId,
      salesMethodName: line.salesMethodId
        ? (ctx.methods.get(line.salesMethodId)?.name ?? null)
        : null,
      memo: line.memo,
    }
  })
  return {
    totalCents: proposed.totalCents,
    doc: {
      kind: proposed.kind,
      accountingDate: proposed.accountingDate,
      shift: proposed.shift,
      lines,
      entry: {
        lines: lines.map((line) => ({
          lineNo: line.lineNo,
          dueDate: line.partyId ? line.dueDate : null,
          openCents: line.partyId
            ? Math.max(0, line.amountCents - (collected[line.salesMethodName ?? ''] ?? 0))
            : null,
        })),
      },
    },
  }
}

/** Lo que el formulario le pasa al ticket mientras se carga ese mismo cierre. */
function live(input: SalesCloseBuildInput, ctx: PostingContext) {
  const summary = summarizeSalesClose(input, ctx)
  const lines = input.methods
    .map((m) => ({ method: ctx.methods.get(m.salesMethodId), cents: m.amountCents }))
    .filter((m) => m.method !== undefined && m.cents > 0)
    .sort((a, b) => (a.method?.sort ?? 0) - (b.method?.sort ?? 0))
    .map((m) => ({ id: m.method?.id ?? '', name: m.method?.name ?? '', cents: m.cents }))
  return {
    soldCents: summary.soldCents,
    lines,
    split: invoiceSplit(summary.soldCents, summary.channels),
  }
}

/** Σ con signo de un rol (Haber suma, Debe resta), sobre lo guardado. */
function creditOf(doc: SavedClose, roles: readonly string[]): number {
  return doc.lines
    .filter((line) => roles.includes(line.role))
    .reduce((sum, line) => sum + (line.side === 'credit' ? line.amountCents : -line.amountCents), 0)
}

/** Con espacios comunes: la plata lleva un espacio duro entre el «$» y el número. */
function plain(text: string): string {
  return text.replaceAll('\u00a0', ' ')
}

function renderText(props: ReturnType<typeof closeTicketProps>): string {
  return plain(renderToString(createElement(CloseTicket, props))).replaceAll('<!-- -->', '')
}

type Arrival = ReturnType<typeof closeTicketProps>['arrivals'][number]

/** Un renglón de «Cuándo entra» como se lee: a quién nombra y, si lo dice, qué pasó con esa plata. */
function said(arrival: Arrival): string {
  return plain(arrival.hint ? `${arrival.label} · ${arrival.hint}` : arrival.label)
}

/** Los renglones de «Cuándo entra», listos para comparar contra texto escrito a mano. */
function arrivalLabels(props: ReturnType<typeof closeTicketProps>): string[] {
  return props.arrivals.map(said)
}

describe('el ticket de un cierre guardado · los mismos números que al cargarlo', () => {
  it('E8, con diferencia de caja: medios, total, reparto y arqueo, al centavo', () => {
    const { r, ctx, meta } = prepare(E8)
    const input = E8.input(r)
    const { doc, totalCents } = save(input, ctx, meta)
    const props = closeTicketProps([doc], OPTS)
    const screen = live(input, ctx)

    expect(props.soldCents).toBe(170_000_000)
    expect(props.soldCents).toBe(totalCents)
    expect(props.soldCents).toBe(screen.soldCents)
    expect(props.lines).toEqual(screen.lines)
    expect(props.split).toEqual(screen.split)
    expect(props.split).toMatchObject({
      kind: 'mixed',
      invoicedCents: 139_150_000,
      uninvoicedCents: 30_850_000,
      invoicedPercent: 82,
    })
    // Se contó $ 349.500 contra $ 350.000 vendidos en efectivo: faltan $ 500.
    expect(props.cash).toEqual({
      expectedCents: 35_000_000,
      countedCents: 34_950_000,
      diffCents: 50_000,
    })
    expect(props.dayTitle).toBe('lunes 05/10')
    expect(props.shift).toBeNull()
    // Lo que el cierre no guarda, el papel no lo inventa.
    expect(props.channelsText).toBeNull()
    expect(props.target).toBeNull()
    expect(props.arrivals).toEqual([])
    // Guardado: ya se sabe qué se facturó, y el papel va quieto.
    expect(props.invoiceAsked).toBe(true)
    expect(props.still).toBe(true)
  })

  it('con factura + sin factura = vendido, leyendo los renglones del asiento', () => {
    for (const fixture of [E8, E8B, E8B_OVERRIDE]) {
      const { r, ctx, meta } = prepare(fixture)
      const { doc } = save(fixture.input(r), ctx, meta)
      const props = closeTicketProps([doc], OPTS)
      const invoiced = creditOf(doc, ['sales_invoiced', 'vat'])
      const uninvoiced = creditOf(doc, ['sales_uninvoiced'])
      expect(props.split?.invoicedCents, fixture.id).toBe(invoiced)
      expect(invoiced + uninvoiced, fixture.id).toBe(props.soldCents)
      expect(props.split?.uninvoicedCents, fixture.id).toBe(uninvoiced)
    }
  })

  it('E8b: nota de crédito, Factura A en cuenta corriente y tres canales', () => {
    const { r, ctx, meta } = prepare(E8B)
    const input = E8B.input(r)
    const { doc, totalCents } = save(input, ctx, meta)
    const props = closeTicketProps([doc], OPTS)
    const screen = live(input, ctx)
    expect(props.soldCents).toBe(70_100_000)
    expect(props.soldCents).toBe(totalCents)
    expect(props.lines).toEqual(screen.lines)
    // La cuenta corriente es UN renglón del ticket, aunque el asiento lleve uno por cliente.
    expect(props.lines.at(-1)).toMatchObject({ name: 'Cuenta corriente', cents: 12_100_000 })
    expect(props.split).toEqual(screen.split)
    expect(props.cash).toBeNull()
  })

  it('un canal facturado de más (confirmado con motivo) no rompe el reparto del día', () => {
    const { r, ctx, meta } = prepare(E8B_OVERRIDE)
    const input = E8B_OVERRIDE.input(r)
    const { doc } = save(input, ctx, meta)
    const props = closeTicketProps([doc], OPTS)
    // Delivery quedó con «sin factura» en el Debe: resta, y el total del día sigue cerrando.
    expect(doc.lines.some((l) => l.role === 'sales_uninvoiced' && l.side === 'debit')).toBe(true)
    expect(props.split).toEqual(live(input, ctx).split)
    expect(props.split).toMatchObject({ kind: 'mixed', invoicedCents: 56_870_000 })
  })

  it('todo el día facturado de más: el papel lo dice sin sello y sin hablar de «al guardar»', () => {
    const { r, ctx, meta } = prepare()
    const input = salesCloseInput({
      warningsAck: ['invoiced_exceeds_sold'],
      overrideReason: 'Factura de una venta del día anterior',
      date: '2026-10-06',
      methods: [{ salesMethodId: r.method('cash'), amountCents: 100_000_00 }],
      invoiced: [
        {
          voucherType: 'factura_b',
          pointOfSale: 3,
          numberFrom: 1,
          numberTo: 4,
          channel: 'salon',
          totalCents: 141_500_00,
        },
      ],
    })
    const { doc } = save(input, ctx, meta)
    const props = closeTicketProps([doc], OPTS)
    expect(props.split).toEqual(live(input, ctx).split)
    expect(props.split).toMatchObject({ kind: 'over', overCents: 41_500_00, uninvoicedCents: 0 })
    const html = renderText(props)
    expect(html).toContain('Facturado de más')
    expect(html).toContain('$ 41.500')
    expect(html).not.toContain('Al guardar')
    expect(html).not.toContain('adm-stamp-in')
  })
})

describe('el ticket de un cierre guardado · con factura y sin factura', () => {
  const methods = (r: ReturnType<typeof prepare>['r']) => [
    { salesMethodId: r.method('cash'), amountCents: 48_630_000 },
    { salesMethodId: r.method('credit'), amountCents: 41_820_050 },
  ]

  it('un cierre sin facturas: todo queda sin factura, con su sello', () => {
    const { r, ctx, meta } = prepare()
    const input = salesCloseInput({ date: '2026-10-07', methods: methods(r), invoiced: [] })
    const { doc, totalCents } = save(input, ctx, meta)
    const props = closeTicketProps([doc], OPTS)
    expect(props.soldCents).toBe(90_450_050)
    expect(props.soldCents).toBe(totalCents)
    expect(props.split).toEqual(live(input, ctx).split)
    expect(props.split).toEqual({
      kind: 'none',
      invoicedCents: 0,
      uninvoicedCents: 90_450_050,
      overCents: 0,
      invoicedPercent: 0,
    })
    const html = renderText(props)
    expect(html).toContain('Sin factura')
    // Un importe con centavos: los llevan todos, y «con factura» es un cero de verdad.
    expect(html).toContain('$ 904.500,50')
    expect(html).toContain('$ 0,00')
    expect(html).toContain('todo queda registrado en los libros')
    expect(html).not.toMatch(/en negro|en blanco|afuera de los libros|ganancia/i)
  })

  it('un bar sin puntos de venta da el mismo papel que no haber facturado', () => {
    const { r, ctx, meta } = prepare()
    const input = salesCloseInput({ date: '2026-10-07', methods: methods(r), invoiced: [] })
    const withPoints = closeTicketProps([save(input, ctx, meta).doc], OPTS)
    const bare: PostingContext = { ...ctx, salesPoints: new Map() }
    const without = closeTicketProps([save(input, bare, meta).doc], OPTS)
    expect(without).toEqual(withPoints)
    expect(without.split?.kind).toBe('none')
    expect(without.invoiceAsked).toBe(true)
  })

  it('con las ventas sin factura en la misma cuenta que las facturadas, el reparto no cambia', () => {
    const { r, ctx, meta } = prepare(E8)
    const input = E8.input(r)
    const single: PostingContext = {
      ...ctx,
      settings: { ...ctx.settings, uninvoicedSalesMode: 'single_account' },
    }
    const split = closeTicketProps([save(input, single, meta).doc], OPTS).split
    expect(split).toEqual(closeTicketProps([save(input, ctx, meta).doc], OPTS).split)
  })

  it('todo facturado: «Todo con factura», sin nada del otro lado', () => {
    const { r, ctx, meta } = prepare()
    const input = salesCloseInput({
      date: '2026-10-07',
      methods: [{ salesMethodId: r.method('debit'), amountCents: 12_100_000 }],
      invoiced: [
        {
          voucherType: 'factura_b',
          pointOfSale: 3,
          numberFrom: 10,
          numberTo: 30,
          channel: 'salon',
          totalCents: 12_100_000,
        },
      ],
    })
    const props = closeTicketProps([save(input, ctx, meta).doc], OPTS)
    expect(props.split).toMatchObject({ kind: 'all', invoicedCents: 12_100_000 })
    expect(renderText(props)).toContain('Todo con factura')
  })
})

describe('el ticket de un cierre guardado · el efectivo', () => {
  const base = (r: ReturnType<typeof prepare>['r'], patch: Record<string, unknown> = {}) =>
    salesCloseInput({ ...E8.input(r), controlTotalCents: null, ...patch })

  it('sin contar no hay bloque de efectivo (y no dice «sin contar»)', () => {
    const { r, ctx, meta } = prepare(E8)
    const props = closeTicketProps([save(base(r, { cashCountedCents: null }), ctx, meta).doc], OPTS)
    expect(props.cash).toBeNull()
    expect(props.lines[0]).toMatchObject({ name: 'Efectivo', cents: 35_000_000 })
    const html = renderText(props)
    expect(html).not.toContain('Efectivo contado')
    expect(html).not.toContain('sin contar')
  })

  it('contado y coincide: el cierre no guarda el conteo, así que tampoco hay bloque', () => {
    const { r, ctx, meta } = prepare(E8)
    const { doc } = save(base(r, { cashCountedCents: 35_000_000 }), ctx, meta)
    expect(doc.lines.some((l) => l.role === 'cash_diff')).toBe(false)
    expect(closeTicketProps([doc], OPTS).cash).toBeNull()
  })

  it('sobró plata: lo vendido en efectivo es lo contado menos lo que sobró', () => {
    const { r, ctx, meta } = prepare(E8)
    const { doc, totalCents } = save(base(r, { cashCountedCents: 35_020_000 }), ctx, meta)
    const props = closeTicketProps([doc], OPTS)
    expect(props.cash).toEqual({
      expectedCents: 35_000_000,
      countedCents: 35_020_000,
      diffCents: -20_000,
    })
    expect(props.lines[0]).toMatchObject({ name: 'Efectivo', cents: 35_000_000 })
    expect(props.soldCents).toBe(totalCents)
    expect(renderText(props)).toContain('Sobran $ 200')
  })

  it('faltó plata: el renglón «Efectivo» sigue siendo lo vendido, no lo contado', () => {
    const { r, ctx, meta } = prepare(E8)
    const props = closeTicketProps([save(E8.input(r), ctx, meta).doc], OPTS)
    expect(props.lines[0]).toMatchObject({ name: 'Efectivo', cents: 35_000_000 })
    const html = renderText(props)
    expect(html).toContain('Efectivo contado')
    expect(html).toContain('$ 349.500')
    expect(html).toContain('Faltan $ 500')
  })

  /** El bar suma un medio que entra directo al banco (una transferencia), antes o después del efectivo. */
  const withBankMethod = (ctx: PostingContext, bankId: string, sort: number) => {
    const bank: SalesMethodRef = {
      id: BANK_METHOD_ID,
      sort,
      name: 'Transferencia al banco',
      kind: 'treasury',
      channel: 'salon',
      treasuryAccountId: bankId,
      partyId: null,
      settlementDays: 0,
    }
    return { ...ctx, methods: new Map([...ctx.methods, [bank.id, bank]]) }
  }
  const zeroCount = (r: ReturnType<typeof prepare>['r']) =>
    salesCloseInput({
      date: '2026-10-07',
      methods: [
        { salesMethodId: r.method('cash'), amountCents: 50_000 },
        { salesMethodId: BANK_METHOD_ID, amountCents: 1_000_000 },
      ],
      invoiced: [],
      cashCountedCents: 0,
    })

  it('se contó $ 0: el asiento no guarda el renglón de la caja, y el efectivo igual figura', () => {
    const { r, ctx, meta } = prepare()
    const { doc, totalCents } = save(
      zeroCount(r),
      withBankMethod(ctx, r.treasury('banco'), 99),
      meta,
    )
    // Un solo renglón de caja: el del banco. El del efectivo (en $ 0) no se guardó.
    expect(doc.lines.filter((l) => l.role === 'treasury').map((l) => l.salesMethodName)).toEqual([
      'Transferencia al banco',
    ])
    const props = closeTicketProps([doc], OPTS)
    expect(props.soldCents).toBe(totalCents)
    expect(props.soldCents).toBe(1_050_000)
    expect(props.lines.map((l) => [l.name, l.cents])).toEqual([
      ['Transferencia al banco', 1_000_000],
      ['Efectivo', 50_000],
    ])
    expect(props.cash).toEqual({ expectedCents: 50_000, countedCents: 0, diffCents: 50_000 })
  })

  it('límite conocido: contado en $ 0 y otro medio de caja justo antes; el total no cambia', () => {
    const { r, ctx, meta } = prepare()
    const { doc, totalCents } = save(
      zeroCount(r),
      withBankMethod(ctx, r.treasury('banco'), -1),
      meta,
    )
    const props = closeTicketProps([doc], OPTS)
    // El papel no puede saber cuál de los dos era el efectivo: la diferencia queda en el
    // renglón de al lado. Lo vendido, el reparto y la diferencia siguen siendo los guardados.
    expect(props.soldCents).toBe(totalCents)
    expect(props.lines.reduce((sum, l) => sum + l.cents, 0)).toBe(totalCents)
    expect(props.cash?.diffCents).toBe(50_000)
    expect(props.split).toEqual(
      live(zeroCount(r), withBankMethod(ctx, r.treasury('banco'), -1)).split,
    )
  })

  it('sin ventas en efectivo pero con plata en la caja: sobra todo lo contado', () => {
    const { r, ctx, meta } = prepare()
    const input = salesCloseInput({
      date: '2026-10-07',
      methods: [
        { salesMethodId: r.method('cash'), amountCents: 0 },
        { salesMethodId: r.method('debit'), amountCents: 1_000_000 },
      ],
      invoiced: [],
      cashCountedCents: 20_000,
    })
    const { doc, totalCents } = save(input, ctx, meta)
    const props = closeTicketProps([doc], OPTS)
    expect(props.soldCents).toBe(totalCents)
    expect(props.soldCents).toBe(1_000_000)
    // El efectivo no se vendió: no figura como medio, pero el arqueo sí.
    expect(props.lines.map((l) => l.name)).toEqual(['Débito'])
    expect(props.cash).toEqual({ expectedCents: 0, countedCents: 20_000, diffCents: -20_000 })
  })
})

describe('el ticket de un cierre guardado · dos turnos el mismo día', () => {
  const noon = (r: ReturnType<typeof prepare>['r']) =>
    salesCloseInput({ ...E8.input(r), shift: 'mediodía', controlTotalCents: null })
  const night = (r: ReturnType<typeof prepare>['r'], patch: Record<string, unknown> = {}) =>
    salesCloseInput({
      date: '2026-10-05',
      shift: 'noche',
      methods: [
        { salesMethodId: r.method('cash'), amountCents: 12_000_050 },
        { salesMethodId: r.method('qr'), amountCents: 9_000_000 },
        { salesMethodId: r.method('rappi'), amountCents: 3_500_000 },
      ],
      invoiced: [
        {
          voucherType: 'factura_b',
          pointOfSale: 3,
          numberFrom: 14_663,
          numberTo: 14_700,
          channel: 'salon',
          totalCents: 6_050_000,
        },
      ],
      ...patch,
    })

  it('se suman en un solo papel: cada medio, el total y el reparto', () => {
    const { r, ctx, meta } = prepare(E8)
    const a = save(noon(r), ctx, meta)
    const b = save(night(r), ctx, meta)
    const props = closeTicketProps([a.doc, b.doc], OPTS)

    expect(props.soldCents).toBe(a.totalCents + b.totalCents)
    expect(props.soldCents).toBe(170_000_000 + 24_500_050)
    expect(props.shift).toBe('2 turnos')
    expect(props.dayTitle).toBe('lunes 05/10')
    const byName = Object.fromEntries(props.lines.map((l) => [l.name, l.cents]))
    expect(byName).toEqual({
      Efectivo: 35_000_000 + 12_000_050,
      Transferencia: 18_000_000,
      'QR Mercado Pago': 22_000_000 + 9_000_000,
      Débito: 41_000_000,
      Crédito: 33_000_000,
      PedidosYa: 15_000_000,
      Rappi: 6_000_000 + 3_500_000,
    })
    // Un renglón por medio, en el orden de Ajustes.
    expect(props.lines.map((l) => l.name)).toEqual([
      'Efectivo',
      'Transferencia',
      'QR Mercado Pago',
      'Débito',
      'Crédito',
      'PedidosYa',
      'Rappi',
    ])
    const one = live(noon(r), ctx)
    const two = live(night(r), ctx)
    expect(props.split).toEqual(
      invoiceSplit(one.soldCents + two.soldCents, [
        { invoicedTotalCents: one.split.invoicedCents },
        { invoicedTotalCents: two.split.invoicedCents },
      ]),
    )
  })

  it('con diferencia en un solo turno, el arqueo cierra contra el «Efectivo» de los dos', () => {
    const { r, ctx, meta } = prepare(E8)
    const props = closeTicketProps(
      [save(noon(r), ctx, meta).doc, save(night(r), ctx, meta).doc],
      OPTS,
    )
    // Mediodía: se contó 349.500 de 350.000. Noche: no hubo diferencia (entró lo vendido).
    expect(props.cash).toEqual({
      expectedCents: 35_000_000 + 12_000_050,
      countedCents: 34_950_000 + 12_000_050,
      diffCents: 50_000,
    })
    const cashLine = props.lines.find((l) => l.name === 'Efectivo')
    expect(cashLine?.cents).toBe(props.cash?.expectedCents)
  })

  it('con diferencia en los dos turnos, las diferencias se suman con su signo', () => {
    const { r, ctx, meta } = prepare(E8)
    const props = closeTicketProps(
      [
        save(noon(r), ctx, meta).doc,
        save(night(r, { cashCountedCents: 12_030_050 }), ctx, meta).doc,
      ],
      OPTS,
    )
    // Faltaron $ 500 al mediodía y sobraron $ 300 a la noche: faltan $ 200.
    expect(props.cash).toEqual({
      expectedCents: 35_000_000 + 12_000_050,
      countedCents: 34_950_000 + 12_030_050,
      diffCents: 20_000,
    })
  })

  it('sin diferencia en ninguno, no hay bloque de efectivo', () => {
    const { r, ctx, meta } = prepare(E8)
    const props = closeTicketProps(
      [
        save(salesCloseInput({ ...noon(r), cashCountedCents: null }), ctx, meta).doc,
        save(night(r), ctx, meta).doc,
      ],
      OPTS,
    )
    expect(props.cash).toBeNull()
  })

  it('recibe tal cual lo que devuelve la lectura del comprobante (`DocumentDetail`)', () => {
    // Lo comprueba el compilador: Ventas y la ficha del comprobante le pasan eso.
    const fromQuery = (docs: readonly DocumentDetail[]) => closeTicketProps(docs, OPTS)
    expect(fromQuery([]).lines).toEqual([])
  })

  it('un solo turno conserva su nombre; lo que no es un cierre se ignora', () => {
    const { r, ctx, meta } = prepare(E8)
    const { doc } = save(night(r), ctx, meta)
    const alone = closeTicketProps([doc], OPTS)
    expect(alone.shift).toBe('noche')
    const withOther = closeTicketProps([{ ...doc, kind: 'collection' }, doc], OPTS)
    expect(withOther).toEqual(alone)
    expect(closeTicketProps([], OPTS)).toMatchObject({ soldCents: 0, lines: [], cash: null })
    expect(closeTicketProps([], OPTS).split?.kind).toBe('empty')
  })
})

/**
 * El cierre #47 del bar de ejemplo (martes 06/10/2026), tal como está guardado:
 * los renglones del comprobante y lo que ya se cobró de cada partida al 13/10
 * (las dos de Mercado Pago, enteras).
 */
const DEMO_47: SavedClose = (() => {
  const row = (
    lineNo: number,
    role: string,
    side: 'debit' | 'credit',
    amountCents: number,
    extra: Partial<SavedClose['lines'][number]> = {},
  ): SavedClose['lines'][number] => ({
    id: `demo-47-${lineNo}`,
    lineNo,
    role,
    side,
    amountCents,
    partyId: null,
    partyName: null,
    dueDate: null,
    treasuryAccountId: null,
    treasuryName: null,
    salesMethodId: null,
    salesMethodName: null,
    memo: null,
    ...extra,
  })
  const owed = (
    lineNo: number,
    amountCents: number,
    method: string,
    party: string,
    dueDate: string,
  ) =>
    row(lineNo, 'receivable', 'debit', amountCents, {
      partyId: `p-${party}`,
      partyName: party,
      dueDate,
      salesMethodId: `m-${method}`,
      salesMethodName: method,
      memo: method,
    })
  const lines = [
    row(1, 'treasury', 'debit', 12_001_300, {
      treasuryAccountId: 't-caja',
      treasuryName: 'Caja',
      salesMethodId: 'm-Efectivo',
      salesMethodName: 'Efectivo',
      memo: 'Efectivo',
    }),
    owed(2, 8_000_900, 'Transferencia', 'Mercado Pago', '2026-10-06'),
    owed(3, 11_334_600, 'QR Mercado Pago', 'Mercado Pago', '2026-10-06'),
    owed(4, 19_335_400, 'Débito', 'Tarjetas de débito (Posnet)', '2026-10-07'),
    owed(5, 16_001_720, 'Crédito', 'Tarjetas de crédito (Posnet)', '2026-10-16'),
    owed(6, 6_101_900, 'PedidosYa', 'PedidosYa', '2026-10-20'),
    owed(7, 2_871_460, 'Rappi', 'Rappi', '2026-10-20'),
    row(8, 'sales_invoiced', 'credit', 40_352_000, { memo: 'Ventas facturadas' }),
    row(9, 'sales_uninvoiced', 'credit', 17_848_000, { memo: 'Ventas sin factura' }),
    row(10, 'sales_invoiced', 'credit', 7_416_000, { memo: 'Ventas facturadas' }),
    row(11, 'vat', 'credit', 10_031_280, { memo: 'IVA 21 %' }),
  ]
  const collected: Collected = { Transferencia: 8_000_900, 'QR Mercado Pago': 11_334_600 }
  return {
    kind: 'sales_close',
    accountingDate: '2026-10-06',
    shift: null,
    lines,
    entry: {
      lines: lines.map((line) => ({
        lineNo: line.lineNo,
        dueDate: line.dueDate,
        openCents: line.partyId
          ? line.amountCents - (collected[line.salesMethodName ?? ''] ?? 0)
          : null,
      })),
    },
  }
})()

describe('el ticket de un cierre guardado · el #47 del bar de ejemplo', () => {
  it('total $ 756.472,80 · con factura $ 577.992,80 · sin factura $ 178.480,00 · sin bloque de efectivo', () => {
    const props = closeTicketProps([DEMO_47], OPTS)
    expect(props.soldCents).toBe(75_647_280)
    expect(props.split).toEqual({
      kind: 'mixed',
      invoicedCents: 57_799_280,
      uninvoicedCents: 17_848_000,
      overCents: 0,
      invoicedPercent: 76,
    })
    expect(props.cash).toBeNull()
    expect(props.dayTitle).toBe('martes 06/10')

    const html = renderText(props)
    expect(html).toContain('martes 06/10')
    expect(html).toContain('$ 756.472,80')
    expect(html).toContain('$ 577.992,80')
    expect(html).toContain('$ 178.480,00')
    expect(html).toContain('76 % con factura')
    expect(html).not.toContain('Efectivo contado')
    expect(html).not.toContain('Diferencia de caja')
    // Sin `arrivals`, el papel no cuenta qué llegó: lo dice la ficha, con sus vínculos.
    expect(html).not.toContain('Cuándo entra')
    // Es un papel que solo se mira: sin sellazo y sin número que cuenta.
    expect(html).not.toContain('adm-stamp-in')
  })

  it('«Cuándo entra», con lo que pasó después: entró, ya entró, tendría que haber llegado, llega', () => {
    const props = closeTicketProps([DEMO_47], { today: TODAY, arrivals: true })
    expect(props.arrivals.map((a) => [said(a), a.cents])).toEqual([
      ['Entró a Caja', 12_001_300],
      // QR y transferencia son del mismo pagador: un renglón.
      ['Mercado Pago · ya entró', 19_335_500],
      ['Débito · tendría que haber llegado el 07/10', 19_335_400],
      ['Crédito · llega el vie 16/10', 16_001_720],
      ['PedidosYa · llega el mar 20/10', 6_101_900],
      ['Rappi · llega el mar 20/10', 2_871_460],
    ])
    // Nada se pierde ni se inventa: suma lo vendido.
    expect(props.arrivals.reduce((sum, a) => sum + a.cents, 0)).toBe(props.soldCents)
    expect(new Set(props.arrivals.map((a) => a.key)).size).toBe(props.arrivals.length)
    // El nombre es el renglón; lo que pasó con esa plata va debajo, en chico.
    expect(props.arrivals[0]).toEqual({
      key: 'caja:t-caja',
      label: 'Entró a Caja',
      cents: 12_001_300,
    })
    expect(props.arrivals[2]).toMatchObject({
      label: 'Débito',
      hint: 'tendría que haber llegado el 07/10',
    })
    const html = renderText(props)
    expect(html).toContain('Cuándo entra')
    expect(html).toContain('>Débito<')
    expect(html).toContain('>tendría que haber llegado el 07/10<')
    expect(html).toContain('>llega el vie 16/10<')
    expect(html).toContain('>ya entró<')
    // «Se acredita» no es palabra de esta pantalla: la plata entra o llega.
    expect(html).not.toMatch(/acredit/i)
  })

  it('el mismo cierre, mirado otro día y con otros cobros', () => {
    const open: Collected = {
      // Nada de Mercado Pago contado todavía; el débito llegó; de PedidosYa, una parte.
      Débito: 19_335_400,
      PedidosYa: 6_001_900,
    }
    const doc: SavedClose = {
      ...DEMO_47,
      entry: {
        lines: DEMO_47.lines.map((line) => ({
          lineNo: line.lineNo,
          dueDate: line.dueDate,
          openCents: line.partyId
            ? line.amountCents - (open[line.salesMethodName ?? ''] ?? 0)
            : null,
        })),
      },
    }
    const props = closeTicketProps([doc], { today: '2026-10-16', arrivals: true })
    expect(props.arrivals.map((a) => [said(a), a.cents])).toEqual([
      ['Entró a Caja', 12_001_300],
      ['Débito · ya llegó', 19_335_400],
      // Lo del QR y las transferencias no «vence»: está en camino hasta que se lo cuenta.
      ['En camino a Mercado Pago', 19_335_500],
      ['Crédito · llega hoy', 16_001_720],
      ['PedidosYa · llegó una parte: faltan $ 1.000', 6_101_900],
      ['Rappi · llega el mar 20/10', 2_871_460],
    ])
  })

  it('sin el asiento a mano, nada figura como cobrado', () => {
    const props = closeTicketProps([{ ...DEMO_47, entry: null }], { today: TODAY, arrivals: true })
    expect(arrivalLabels(props)).toEqual([
      'Entró a Caja',
      'En camino a Mercado Pago',
      'Débito · tendría que haber llegado el 07/10',
      'Crédito · llega el vie 16/10',
      'PedidosYa · llega el mar 20/10',
      'Rappi · llega el mar 20/10',
    ])
  })
})

describe('el ticket de un cierre guardado · cuenta corriente y arqueo en «Cuándo entra»', () => {
  it('lo vendido en cuenta corriente es plata por cobrarle a clientes, no algo «en camino»', () => {
    const { r, ctx, meta } = prepare(E8B)
    const input = E8B.input(r)
    const pending = closeTicketProps([save(input, ctx, meta).doc], { today: TODAY, arrivals: true })
    expect(pending.arrivals.at(-1)).toMatchObject({
      label: 'A cobrarle a clientes',
      cents: 12_100_000,
    })
    const paid = closeTicketProps(
      [save(input, ctx, meta, { 'Cuenta corriente': 12_100_000 }).doc],
      { today: TODAY, arrivals: true },
    )
    expect(arrivalLabels(paid)).toContain('Clientes · ya pagaron')
    const part = closeTicketProps([save(input, ctx, meta, { 'Cuenta corriente': 2_100_000 }).doc], {
      today: TODAY,
      arrivals: true,
    })
    expect(arrivalLabels(part)).toContain('Clientes · pagaron una parte: faltan $ 100.000')
    for (const props of [pending, paid, part]) {
      expect(arrivalLabels(props).join(' ')).not.toMatch(/En camino a Empresa/)
      expect(props.arrivals.reduce((sum, a) => sum + a.cents, 0)).toBe(props.soldCents)
    }
  })

  it('si se contó el efectivo, a la caja entró lo contado (lo que registra el asiento)', () => {
    const { r, ctx, meta } = prepare(E8)
    const props = closeTicketProps([save(E8.input(r), ctx, meta).doc], {
      today: TODAY,
      arrivals: true,
    })
    expect(props.arrivals[0]).toMatchObject({ label: 'Entró a Caja', cents: 34_950_000 })
    // Lo vendido menos lo que faltó en la caja.
    expect(props.arrivals.reduce((sum, a) => sum + a.cents, 0)).toBe(
      props.soldCents - (props.cash?.diffCents ?? 0),
    )
  })
})
