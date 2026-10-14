import { describe, expect, it } from 'vitest'
import {
  arrivalStops,
  groupOpenItems,
  incomingDays,
  incomingSentence,
  incomingStrip,
  incomingTitle,
  itemArrival,
  partyCreditSentence,
  partySentence,
  type ReceivableTranches,
  receivableMeta,
  receivableRail,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/incoming'
import {
  channelSales,
  invoicedStamp,
  invoicedTitle,
  monthTicket,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/invoiced-view'
import {
  netRows,
  netSentence,
  netTitle,
  netTotals,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/net-view'
import {
  buildCollectionValues,
  type CollectionFormState,
  emptyDeductions,
  payerCards,
  settlementSummary,
} from '@/components/administracion/acciones/cobrar-cuenta'
import type { NetByMethodRow, SalesSummaryRow } from '@/lib/accounting/queries/books'
import { collectionSchema } from '@/lib/accounting/schemas'

/**
 * «Plata por cobrar», «Lo que llegó», «Facturas» y la hoja «Registrar un
 * cobro»: las cuentas y las oraciones. Lo más delicado está al final: la hoja
 * de cobrar se reordenó en tres pasos, pero tiene que mandar EXACTAMENTE lo
 * mismo que antes, así que `buildCollectionValues` se compara contra el objeto
 * literal que armaba la hoja en tres casos reales.
 */

/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const TODAY = '2026-10-13'

const tranches = (over: Partial<ReceivableTranches> = {}): ReceivableTranches => ({
  totalCents: 0,
  lateCents: 0,
  weekCents: 0,
  laterCents: 0,
  walletCents: 0,
  lateParties: 0,
  ...over,
})

describe('incomingSentence: la oración del héroe', () => {
  it('lo atrasado y lo que llega esta semana, cada cifra con su palabra', () => {
    expect(
      incomingSentence(
        tranches({ totalCents: 546_982_800, lateCents: 259_541_900, weekCents: 287_440_900 }),
      ),
    ).toBe(`$${NB}2.595.419 ya tendrían que haber llegado. Esta semana llegan $${NB}2.874.409.`)
  })

  it('una sola de las dos, o nada con fecha todavía', () => {
    expect(incomingSentence(tranches({ totalCents: 100, lateCents: 100 }))).toBe(
      `$${NB}1 ya tendrían que haber llegado.`,
    )
    expect(incomingSentence(tranches({ totalCents: 500_000, laterCents: 500_000 }))).toBe(
      'Todavía no llegó la fecha de nada.',
    )
    expect(incomingSentence(tranches())).toBe('Todavía no llegó la fecha de nada.')
  })

  it('lo de Mercado Pago y lo que tienen a favor van aparte', () => {
    expect(
      incomingSentence(tranches({ totalCents: 40_000_000, walletCents: 40_000_000 }), {
        creditCents: 17_460_000,
      }),
    ).toBe(
      `$${NB}400.000 ya están en Mercado Pago: falta contarla. Además hay $${NB}174.600 a favor de ellos.`,
    )
  })
})

describe('incomingStrip: la franja «En camino» de «El mes»', () => {
  it('lo atrasado gana; después lo de esta semana; después lo que todavía no tiene fecha', () => {
    expect(
      incomingStrip(tranches({ totalCents: 9, lateCents: 259_541_900, weekCents: 5 })),
    ).toEqual({
      tone: 'late',
      word: 'Atrasado',
      sentence: `Hay $${NB}2.595.419 que ya tendrían que haber llegado.`,
    })
    expect(incomingStrip(tranches({ totalCents: 9, weekCents: 287_440_900 }))?.sentence).toBe(
      `Esta semana te llegan $${NB}2.874.409.`,
    )
    expect(incomingStrip(tranches({ totalCents: 546_982_800, laterCents: 546_982_800 }))).toEqual({
      tone: 'muted',
      word: 'En camino',
      sentence: `Tenés $${NB}5.469.828 por cobrar: todavía no llegó la fecha.`,
    })
  })

  it('solo lo de la billetera no es rojo; sin nada por cobrar no hay franja', () => {
    expect(incomingStrip(tranches({ totalCents: 100_000, walletCents: 100_000 }))?.tone).toBe(
      'muted',
    )
    expect(incomingStrip(tranches())).toBeNull()
  })
})

describe('el renglón de quien te debe', () => {
  const row = {
    debtCents: 253_615_080,
    overdueCents: 147_995_440,
    oldestDueDate: '2026-10-07',
    nextDueDate: '2026-10-13',
    creditCents: 0,
    active: true,
  }

  it('el margen dice desde cuándo o para cuándo, nunca un importe', () => {
    expect(receivableRail(row, { today: TODAY })).toEqual({
      kind: 'late',
      value: '6',
      unit: 'días tarde',
      tone: 'late',
    })
    expect(receivableRail({ ...row, oldestDueDate: '2026-10-12' }, { today: TODAY }).unit).toBe(
      'día tarde',
    )
    expect(
      receivableRail({ ...row, overdueCents: 0, oldestDueDate: null }, { today: TODAY }),
    ).toEqual({ kind: 'today', label: 'llega', value: 'hoy', tone: 'ok' })
    expect(
      receivableRail(
        { ...row, overdueCents: 0, oldestDueDate: null, nextDueDate: '2026-10-15' },
        { today: TODAY },
      ),
    ).toEqual({ kind: 'date', label: 'llega', value: '15', unit: 'jue', tone: 'muted' })
    expect(
      receivableRail(
        { ...row, overdueCents: 0, oldestDueDate: null, nextDueDate: null },
        { today: TODAY },
      ).value,
    ).toBe('—')
    expect(receivableRail({ ...row, debtCents: 0 }, { today: TODAY }).kind).toBe('none')
  })

  it('el estado, en palabras', () => {
    expect(receivableMeta(row, { today: TODAY })).toBe(
      `$${NB}1.479.954 ya tendría que haber llegado`,
    )
    expect(receivableMeta({ ...row, overdueCents: 0 }, { today: TODAY })).toBe(
      'Lo próximo llega hoy',
    )
    expect(
      receivableMeta({ ...row, overdueCents: 0, nextDueDate: '2026-10-15' }, { today: TODAY }),
    ).toBe('Lo próximo llega el jue 15/10')
    expect(
      receivableMeta({ ...row, debtCents: 0, creditCents: 100, active: false }, { today: TODAY }),
    ).toBe('No te debe nada · desactivado')
  })
})

describe('incomingDays: lo que llega cada día de las próximas dos semanas', () => {
  const items = [
    { dueDate: '2026-10-07', openCents: 999_999_900 }, // atrasado: no entra en la tira
    { dueDate: '2026-10-13', openCents: 50_000_000 },
    { dueDate: '2026-10-15', openCents: 100_000_000 },
    { dueDate: '2026-10-15', openCents: 24_000_000 },
    { dueDate: '2026-10-26', openCents: 10_000_000 },
    { dueDate: '2026-10-27', openCents: 77_000_000 }, // fuera de la ventana
    { dueDate: null, openCents: 5_000_000 },
  ]

  it('catorce días desde hoy, sin lo atrasado ni lo que no tiene fecha', () => {
    const incoming = incomingDays(items, TODAY)
    expect(incoming.days).toHaveLength(14)
    expect(incoming.days[0]).toEqual({
      date: '2026-10-13',
      label: 'Mar 13/10',
      cents: 50_000_000,
      count: 1,
    })
    expect(incoming.days[2]).toEqual({
      date: '2026-10-15',
      label: 'Jue 15/10',
      cents: 124_000_000,
      count: 2,
    })
    expect(incoming.days.at(-1)?.date).toBe('2026-10-26')
    expect(incoming.totalCents).toBe(184_000_000)
    expect(incoming.peak?.date).toBe('2026-10-15')
  })

  it('el título afirma el día que más entra', () => {
    expect(incomingTitle(incomingDays(items, TODAY), TODAY)).toBe(
      `El día que más entra es el jueves 15/10: $${NB}1.240.000`,
    )
    expect(incomingTitle(incomingDays([{ dueDate: TODAY, openCents: 100 }], TODAY), TODAY)).toBe(
      `El día que más entra es hoy: $${NB}1`,
    )
  })

  it('sin nada por venir: catorce días en cero y sin día más cargado', () => {
    const empty = incomingDays([], TODAY)
    expect(empty.totalCents).toBe(0)
    expect(empty.peak).toBeNull()
    expect(empty.days.every((day) => day.cents === 0)).toBe(true)
    expect(incomingTitle(empty, TODAY)).toBe('En estas dos semanas no llega nada')
  })
})

describe('la ficha de quien te debe', () => {
  const items = [
    { lineId: 'd', dueDate: '2026-11-02', openCents: 4 },
    { lineId: 'a', dueDate: '2026-10-07', openCents: 1 },
    { lineId: 'e', dueDate: null, openCents: 5 },
    { lineId: 'c', dueDate: '2026-10-20', openCents: 3 },
    { lineId: 'b', dueDate: '2026-10-13', openCents: 2 },
  ]

  it('agrupa por cuándo llega: atrasado, esta semana, más adelante', () => {
    const groups = groupOpenItems(items, TODAY)
    expect(groups.map((g) => [g.key, g.title, g.items.map((i) => i.lineId), g.totalCents])).toEqual(
      [
        ['late', 'Ya tendría que haber llegado', ['a'], 1],
        ['week', 'Llega esta semana', ['b', 'c'], 5],
        ['later', 'Más adelante', ['d', 'e'], 9],
      ],
    )
  })

  it('lo que llega hoy todavía no está atrasado, y un grupo vacío no se devuelve', () => {
    const groups = groupOpenItems([{ dueDate: TODAY, openCents: 10 }], TODAY)
    expect(groups.map((g) => g.key)).toEqual(['week'])
    expect(groupOpenItems([], TODAY)).toEqual([])
  })

  it('la oración del héroe', () => {
    const pos = {
      debtCents: 253_615_080,
      creditCents: 0,
      aging: { overdueCents: 147_995_440, oldestDueDate: '2026-10-07', nextDueDate: TODAY },
    }
    expect(partySentence(pos, { today: TODAY })).toBe(
      `$${NB}1.479.954 ya tendrían que haber llegado (desde el 07/10). Lo próximo llega hoy.`,
    )
    expect(
      partySentence(
        { ...pos, aging: { overdueCents: 0, oldestDueDate: null, nextDueDate: '2026-10-15' } },
        { today: TODAY },
      ),
    ).toBe('Lo próximo llega el jue 15/10.')
    expect(partySentence({ ...pos, debtCents: 0 }, { today: TODAY })).toBe('No te debe nada.')
    expect(partySentence(pos, { today: TODAY, walletName: 'Mercado Pago' })).toBe(
      'Esa plata ya está en tu Mercado Pago: contala para anotarla.',
    )
  })

  it('lo que tiene a favor se dice según quién es', () => {
    expect(partyCreditSentence({ creditCents: 17_460_000 }, { isCustomer: false })).toBe(
      `Le debemos $${NB}174.600: se descuenta en la próxima liquidación.`,
    )
    expect(partyCreditSentence({ creditCents: 17_460_000 }, { isCustomer: true })).toBe(
      `Tiene $${NB}174.600 a favor.`,
    )
    expect(partyCreditSentence({ creditCents: 0 }, { isCustomer: true })).toBeNull()
  })

  it('cada partida dice cuándo llega', () => {
    expect(itemArrival('2026-10-07', TODAY)).toBe('tenía que llegar el 07/10')
    expect(itemArrival('2026-10-14', TODAY)).toBe('llega el mié 14/10')
    expect(itemArrival(TODAY, TODAY)).toBe('llega hoy')
    expect(itemArrival(null, TODAY)).toBe('sin fecha de llegada')
  })
})

describe('arrivalStops: ¿cuándo te paga cada medio?', () => {
  const method = (name: string, kind: string, settlementDays = 0, over: object = {}) => ({
    name,
    kind,
    settlementDays,
    partyName: null,
    treasuryName: null,
    active: true,
    ...over,
  })

  it('los plazos de un bar real, en orden', () => {
    const stops = arrivalStops([
      method('Efectivo', 'treasury', 0, { treasuryName: 'Caja Efectivo' }),
      method('Transferencia', 'settled_now', 0, { partyName: 'Mercado Pago' }),
      method('QR', 'settled_now', 0, { partyName: 'Mercado Pago' }),
      method('Débito', 'receivable', 1),
      method('Crédito', 'receivable', 10),
      method('PedidosYa', 'receivable', 14),
      method('Rappi', 'receivable', 14),
      method('Seña', 'advance'),
      method('Viejo', 'receivable', 30, { active: false }),
    ])
    expect(stops.map((s) => [s.label, s.inHand, s.methods])).toEqual([
      ['En el momento', true, ['Efectivo']],
      ['Queda en Mercado Pago', true, ['Transferencia', 'QR']],
      ['Al otro día', false, ['Débito']],
      ['A los 10 días', false, ['Crédito']],
      ['A los 14 días', false, ['PedidosYa', 'Rappi']],
    ])
  })

  it('sin medios no hay paradas; la cuenta corriente va última', () => {
    expect(arrivalStops([])).toEqual([])
    expect(
      arrivalStops([
        method('Cuenta corriente', 'customer_account'),
        method('Débito', 'receivable'),
      ]).map((s) => s.label),
    ).toEqual(['El mismo día', 'Cuando te paga el cliente'])
  })
})

// ─── Lo que llegó ────────────────────────────────────────────────────────────

function net(over: Partial<NetByMethodRow>): NetByMethodRow {
  return {
    methodId: 'm',
    methodName: 'Medio',
    channel: 'salon',
    soldCents: 0,
    commissionCents: 0,
    commissionVatCents: 0,
    withholdingsCents: 0,
    otherChargesCents: 0,
    unexplainedCents: 0,
    creditedCents: 0,
    pendingCents: 0,
    discountBp: null,
    ...over,
  }
}

describe('netRows: de cada $ 100', () => {
  const rows = [
    net({
      methodId: 'ef',
      methodName: 'Efectivo',
      soldCents: 900_000,
      creditedCents: 900_000,
      discountBp: 0,
    }),
    net({
      methodId: 'cr',
      methodName: 'Crédito',
      soldCents: 2_000_000,
      commissionCents: 60_000,
      commissionVatCents: 12_600,
      withholdingsCents: 30_000,
      creditedCents: 897_400,
      pendingCents: 1_000_000,
      discountBp: 1026,
    }),
    net({
      methodId: 'pya',
      methodName: 'PedidosYa',
      channel: 'delivery',
      soldCents: 1_000_000,
      commissionCents: 250_000,
      commissionVatCents: 52_500,
      creditedCents: 697_500,
      discountBp: 3025,
    }),
    net({
      methodId: 'rappi',
      methodName: 'Rappi',
      channel: 'delivery',
      soldCents: 752_516,
      pendingCents: 752_516,
    }),
    net({ methodId: 'nada', methodName: 'Sin movimiento' }),
  ]
  const views = netRows(rows)

  it('del más caro al más barato; los que no liquidaron, al final; sin movimiento, afuera', () => {
    expect(views.map((v) => v.name)).toEqual(['PedidosYa', 'Crédito', 'Efectivo', 'Rappi'])
  })

  it('cada renglón dice lo que te queda de cada $ 100', () => {
    expect(views[0]?.line).toBe(`te quedan $${NB}69,75 de cada $ 100`)
    expect(views[1]?.line).toBe(`te quedan $${NB}89,74 de cada $ 100`)
    expect(views[2]).toMatchObject({ state: 'whole', line: 'te llega todo' })
    expect(views[3]).toMatchObject({
      state: 'pending',
      line: `Todavía no te liquidó: $${NB}7.525 en camino`,
      segments: [],
      discountBp: null,
    })
  })

  it('los tramos de la barra suman 100 sobre lo ya liquidado', () => {
    const credit = views[1]
    expect(credit?.settledCents).toBe(1_000_000)
    expect(credit?.segments.map((s) => s.key)).toEqual(['arrived', 'commission', 'withholdings'])
    expect(credit?.segments.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100, 6)
    expect(credit?.segments[0]?.percent).toBeCloseTo(89.74, 2)
  })

  it('el título afirma cuál es el que más cuesta', () => {
    expect(netTitle(views, 'en octubre')).toBe(
      `PedidosYa es el que más te cuesta: se queda con $${NB}30,25 de cada $ 100`,
    )
  })

  it('los otros títulos: todo llegó, sin descuentos todavía, nada liquidado', () => {
    const cash = netRows([rows[0] as NetByMethodRow])
    expect(netTitle(cash, 'en septiembre')).toBe('En septiembre te llegó todo lo que vendiste')
    expect(
      netTitle(netRows([rows[0] as NetByMethodRow, rows[3] as NetByMethodRow]), 'en octubre'),
    ).toBe('Lo que ya te llegó en octubre vino sin descuentos')
    expect(netTitle(netRows([rows[3] as NetByMethodRow]), 'en octubre')).toBe(
      'Todavía no te liquidaron nada en octubre',
    )
    expect(netTitle([], 'en octubre')).toBe('Todavía no te liquidaron nada en octubre')
  })

  it('la oración dice cada cifra por separado, sin afirmar que sumen', () => {
    const totals = netTotals(rows)
    expect(totals).toEqual({
      soldCents: 4_652_516,
      creditedCents: 2_494_900,
      deductedCents: 405_100,
      pendingCents: 1_752_516,
    })
    expect(netSentence(totals)).toBe(
      `Vendiste $${NB}46.525. Ya te llegaron $${NB}24.949, te descontaron $${NB}4.051 entre comisiones, impuestos y retenciones, y $${NB}17.525 siguen en camino.`,
    )
    expect(
      netSentence({
        soldCents: 100_000,
        creditedCents: 100_000,
        deductedCents: 0,
        pendingCents: 0,
      }),
    ).toBe(`Vendiste $${NB}1.000. Ya te llegaron $${NB}1.000.`)
    expect(
      netSentence({
        soldCents: 100_000,
        creditedCents: 0,
        deductedCents: 0,
        pendingCents: 100_000,
      }),
    ).toBe(`Vendiste $${NB}1.000. Todo sigue en camino.`)
    expect(netSentence({ soldCents: 0, creditedCents: 0, deductedCents: 0, pendingCents: 0 })).toBe(
      `Vendiste $${NB}0.`,
    )
  })

  it('un descuento negativo de la base no rompe la barra', () => {
    const [view] = netRows([
      net({ soldCents: 1_000, creditedCents: 1_000, unexplainedCents: -50, discountBp: 0 }),
    ])
    expect(view?.segments).toEqual([{ key: 'arrived', cents: 1_000, percent: 100 }])
  })
})

// ─── Facturas ────────────────────────────────────────────────────────────────

describe('el ticket del mes', () => {
  const summary = (over: Partial<SalesSummaryRow>): SalesSummaryRow => ({
    month: '2026-10-01',
    channel: 'salon',
    soldCents: 0,
    invoicedNetCents: 0,
    vatCents: 0,
    uninvoicedCents: 0,
    ...over,
  })
  const rows = [
    summary({
      soldCents: 710_128_800,
      invoicedNetCents: 429_780_000,
      vatCents: 90_253_800,
      uninvoicedCents: 190_095_000,
    }),
    summary({
      channel: 'delivery',
      soldCents: 90_768_200,
      invoicedNetCents: 75_015_000,
      vatCents: 15_753_200,
    }),
    summary({ channel: 'events' }),
  ]

  it('suma por canal y deja afuera los canales sin ventas', () => {
    const ticket = monthTicket(rows)
    expect(ticket?.channels.map((c) => c.label)).toEqual(['Salón', 'Delivery'])
    expect(ticket?.soldCents).toBe(800_897_000)
    expect(ticket?.invoicedCents).toBe(610_802_000)
    expect(ticket?.uninvoicedCents).toBe(190_095_000)
    expect(channelSales(rows)).toHaveLength(3)
  })

  it('lleva el mismo sello que el ticket de cada noche', () => {
    const ticket = monthTicket(rows)
    if (!ticket) throw new Error('falta el ticket')
    expect(invoicedStamp(ticket.split)).toEqual({ tone: 'factura', text: '76 % con factura' })
    expect(invoicedTitle(ticket.split, 'en octubre')).toBe(
      'El 76 % de lo vendido en octubre fue con factura',
    )
  })

  it('sin puntos de venta todo queda sin factura: sello azul, no una alarma', () => {
    const ticket = monthTicket([summary({ soldCents: 500_000, uninvoicedCents: 500_000 })])
    if (!ticket) throw new Error('falta el ticket')
    expect(invoicedStamp(ticket.split)).toEqual({ tone: 'sin', text: 'Sin factura' })
    expect(invoicedTitle(ticket.split, 'en octubre')).toBe(
      'Todo lo vendido en octubre quedó como venta sin factura',
    )
  })

  it('todo con factura, y el período sin ventas', () => {
    const all = monthTicket([
      summary({ soldCents: 121_000, invoicedNetCents: 100_000, vatCents: 21_000 }),
    ])
    if (!all) throw new Error('falta el ticket')
    expect(invoicedStamp(all.split)?.text).toBe('Todo con factura')
    expect(invoicedTitle(all.split, 'en ese período')).toBe(
      'Todo lo vendido en ese período fue con factura',
    )
    expect(monthTicket([])).toBeNull()
    expect(monthTicket([summary({})])).toBeNull()
  })
})

// ─── La hoja «Registrar un cobro» ────────────────────────────────────────────

describe('settlementSummary: «Te descontaron $ X»', () => {
  it('lo de las ventas menos lo que entró, con su porcentaje', () => {
    expect(settlementSummary({ grossCents: 191_546_500, receivedCents: 178_800_000 })).toEqual({
      discountCents: 12_746_500,
      percentText: '6,7 %',
      keptOfHundred: `$${NB}93,35`,
    })
  })

  it('sin descuento, y mientras falta un dato', () => {
    expect(settlementSummary({ grossCents: 100_000, receivedCents: 100_000 })).toEqual({
      discountCents: 0,
      percentText: '0 %',
      keptOfHundred: `$${NB}100,00`,
    })
    expect(settlementSummary({ grossCents: null, receivedCents: 100 })).toBeNull()
    expect(settlementSummary({ grossCents: 100, receivedCents: null })).toBeNull()
    expect(settlementSummary({ grossCents: 0, receivedCents: 0 })).toBeNull()
  })

  it('si entró más de lo que suman las ventas no es un descuento', () => {
    expect(settlementSummary({ grossCents: 100_000, receivedCents: 100_001 })).toBeNull()
  })
})

describe('payerCards: «¿Quién te pagó?»', () => {
  const parties = new Map(
    [
      {
        id: 'posnet',
        name: 'Tarjetas de crédito (Posnet)',
        tradeName: null,
        kind: 'card_processor' as const,
        active: true,
      },
      {
        id: 'pya',
        name: 'Delivery Hero SA',
        tradeName: 'PedidosYa',
        kind: 'delivery_platform' as const,
        active: true,
      },
      {
        id: 'viejo',
        name: 'Plataforma vieja',
        tradeName: null,
        kind: 'delivery_platform' as const,
        active: false,
      },
      {
        id: 'cli',
        name: 'Eventos Córdoba Demo SA',
        tradeName: null,
        kind: 'customer' as const,
        active: true,
      },
    ].map((p) => [p.id, p]),
  )
  const receivables = [
    {
      partyId: 'cli',
      debtCents: 72_600_000,
      creditCents: 0,
      overdueCents: 0,
      oldestDueDate: '2026-10-18',
    },
    {
      partyId: 'viejo',
      debtCents: 999_999_900,
      creditCents: 0,
      overdueCents: 999_999_900,
      oldestDueDate: '2026-01-01',
    },
    { partyId: 'pya', debtCents: 64_458_400, creditCents: 0, overdueCents: 0, oldestDueDate: null },
    {
      partyId: 'posnet',
      debtCents: 253_615_100,
      creditCents: 0,
      overdueCents: 147_995_400,
      oldestDueDate: '2026-10-07',
    },
    { partyId: 'nadie', debtCents: 5, creditCents: 0, overdueCents: 0, oldestDueDate: null },
  ]

  it('los que deben, el más atrasado primero, con lo que debe cada uno', () => {
    expect(payerCards(receivables, parties)).toEqual([
      {
        id: 'posnet',
        name: 'Tarjetas de crédito (Posnet)',
        kind: 'card_processor',
        debtCents: 253_615_100,
        consequence: `Te debe $${NB}2.536.151 · atrasado desde el 07/10`,
      },
      {
        id: 'cli',
        name: 'Eventos Córdoba Demo SA',
        kind: 'customer',
        debtCents: 72_600_000,
        consequence: `Te debe $${NB}726.000 · llega el 18/10`,
      },
      {
        id: 'pya',
        name: 'PedidosYa',
        kind: 'delivery_platform',
        debtCents: 64_458_400,
        consequence: `Te debe $${NB}644.584`,
      },
    ])
  })

  it('como mucho cuatro tarjetas; sin nadie que deba, ninguna', () => {
    expect(payerCards(receivables, parties, 1)).toHaveLength(1)
    expect(payerCards([], parties)).toEqual([])
    expect(payerCards(receivables, new Map())).toEqual([])
  })
})

describe('buildCollectionValues: la hoja manda lo mismo que antes', () => {
  const base: CollectionFormState = {
    partyId: null,
    date: '2026-10-13',
    apps: new Map(),
    creditItems: [],
    credits: new Set(),
    grossValue: null,
    rows: emptyDeductions(),
    feesOtherAccountId: '00000000-0000-4000-8000-00000000f0f0',
    received: null,
    treasuryId: null,
    reference: '',
    voucherMode: 'none',
    voucherType: 'liquidacion',
    voucherPos: '',
    voucherNumber: '',
  }
  const PARTY = '11111111-1111-4111-8111-111111111111'
  const BANK = '22222222-2222-4222-8222-222222222222'
  const LINE_A = '33333333-3333-4333-8333-333333333333'
  const LINE_B = '44444444-4444-4444-8444-444444444444'
  const CREDIT = '55555555-5555-4555-8555-555555555555'

  it('la liquidación de una tarjeta con comisión, su IVA y la factura en la liquidación', () => {
    const values = buildCollectionValues({
      ...base,
      partyId: PARTY,
      apps: new Map([
        [LINE_A, 100_000_000],
        [LINE_B, 91_546_500],
      ]),
      grossValue: 191_546_500,
      rows: {
        ...emptyDeductions(),
        comision: { amount: 10_534_300, cert: '' },
        iva_comision: { amount: 2_212_200, cert: 'no va' },
      },
      received: 178_800_000,
      treasuryId: BANK,
      reference: '  LIQ-0042  ',
      voucherMode: 'included',
      voucherType: 'liquidacion',
      voucherPos: '0001',
      voucherNumber: '00031009',
    })
    expect(values).toEqual({
      partyId: PARTY,
      date: '2026-10-13',
      applications: [
        { lineId: LINE_A, amountCents: 100_000_000 },
        { lineId: LINE_B, amountCents: 91_546_500 },
      ],
      creditsUsed: [],
      grossCents: 191_546_500,
      deductions: [
        {
          taxKind: 'comision',
          amountCents: 10_534_300,
          accountId: null,
          certificateNumber: null,
          salesMethodId: null,
        },
        {
          taxKind: 'iva_comision',
          amountCents: 2_212_200,
          accountId: null,
          certificateNumber: null,
          salesMethodId: null,
        },
      ],
      received: [{ treasuryAccountId: BANK, amountCents: 178_800_000, reference: 'LIQ-0042' }],
      writeOffCents: 0,
      commissionVoucher: {
        mode: 'included',
        voucherType: 'liquidacion',
        pointOfSale: 1,
        number: 31009,
        issueDate: '2026-10-13',
      },
      notes: null,
    })
    // Y el servidor lo acepta tal cual (con lo que agrega `usePosting`).
    expect(
      collectionSchema.safeParse({
        ...values,
        clientRef: '99999999-9999-4999-8999-999999999999',
        previewHash: 'a'.repeat(64),
        warningsAck: [],
      }).success,
    ).toBe(true)
  })

  it('un cobro a cuenta, sin ventas elegidas ni descuentos', () => {
    expect(
      buildCollectionValues({
        ...base,
        partyId: PARTY,
        received: 5_000_000,
        treasuryId: BANK,
        voucherMode: 'none',
      }),
    ).toEqual({
      partyId: PARTY,
      date: '2026-10-13',
      applications: [],
      creditsUsed: [],
      grossCents: null,
      deductions: [],
      received: [{ treasuryAccountId: BANK, amountCents: 5_000_000, reference: null }],
      writeOffCents: 0,
      commissionVoucher: { mode: 'none' },
      notes: null,
    })
  })

  it('un cliente que retuvo Ganancias con certificado y usa su saldo a favor', () => {
    expect(
      buildCollectionValues({
        ...base,
        partyId: PARTY,
        apps: new Map([[LINE_A, 72_600_000]]),
        creditItems: [
          { lineId: CREDIT, openCents: 600_000 },
          { lineId: LINE_B, openCents: 123 },
        ],
        credits: new Set([CREDIT]),
        grossValue: 72_000_000,
        rows: {
          ...emptyDeductions(),
          ret_ganancias: { amount: 1_440_000, cert: ' 0001-00004567 ' },
          otro: { amount: 10_000, cert: '' },
          diferencia: { amount: 0, cert: '' },
        },
        received: 70_550_000,
        treasuryId: BANK,
        voucherMode: 'later',
      }),
    ).toEqual({
      partyId: PARTY,
      date: '2026-10-13',
      applications: [{ lineId: LINE_A, amountCents: 72_600_000 }],
      creditsUsed: [{ lineId: CREDIT, amountCents: 600_000 }],
      grossCents: 72_000_000,
      deductions: [
        {
          taxKind: 'ret_ganancias',
          amountCents: 1_440_000,
          accountId: null,
          certificateNumber: '0001-00004567',
          salesMethodId: null,
        },
        {
          taxKind: 'otro',
          amountCents: 10_000,
          accountId: '00000000-0000-4000-8000-00000000f0f0',
          certificateNumber: null,
          salesMethodId: null,
        },
      ],
      received: [{ treasuryAccountId: BANK, amountCents: 70_550_000, reference: null }],
      writeOffCents: 0,
      commissionVoucher: { mode: 'later' },
      notes: null,
    })
  })

  it('vacío de todo: las mismas claves, sin inventar valores', () => {
    expect(buildCollectionValues({ ...base, date: null })).toEqual({
      partyId: '',
      date: '',
      applications: [],
      creditsUsed: [],
      grossCents: null,
      deductions: [],
      received: [],
      writeOffCents: 0,
      commissionVoucher: { mode: 'none' },
      notes: null,
    })
  })

  it('la factura de la comisión sin número escrito viaja con `null`, no con cero', () => {
    const values = buildCollectionValues({
      ...base,
      voucherMode: 'included',
      voucherType: 'factura_a',
    })
    expect(values.commissionVoucher).toEqual({
      mode: 'included',
      voucherType: 'factura_a',
      pointOfSale: null,
      number: null,
      issueDate: '2026-10-13',
    })
  })

  it('una venta tildada sin importe viaja como `null` (el servidor la rechaza con su mensaje)', () => {
    const values = buildCollectionValues({ ...base, apps: new Map([[LINE_A, null]]) })
    expect(values.applications).toEqual([{ lineId: LINE_A, amountCents: null }])
  })
})
