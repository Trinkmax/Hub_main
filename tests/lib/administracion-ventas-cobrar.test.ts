import { describe, expect, it } from 'vitest'
import {
  arrivalStops,
  groupOpenItems,
  incomingDays,
  incomingTitle,
  itemArrival,
  partyCreditSentence,
  partySentence,
  receivableArrival,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/incoming'
import {
  channelSales,
  invoicedSummary,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/invoiced-view'
import {
  collectionAmounts,
  netTotals,
  netVisibleRows,
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
 * «Por cobrar», «Lo que llegó», «Cobros», «Facturas» y la hoja «Registrar un
 * cobro»: las cuentas y las oraciones. Lo más delicado está al final: la hoja
 * de cobrar se reordenó en tres pasos, pero tiene que mandar EXACTAMENTE lo
 * mismo que antes, así que `buildCollectionValues` se compara contra el objeto
 * literal que armaba la hoja en tres casos reales.
 */

/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const TODAY = '2026-10-13'

describe('la columna «Llega» de quien te debe', () => {
  const row = {
    debtCents: 253_615_080,
    overdueCents: 147_995_440,
    oldestDueDate: '2026-10-07',
    nextDueDate: '2026-10-13',
  }
  const dated = { ...row, overdueCents: 0, oldestDueDate: null }

  it('lo atrasado lo dice, con desde cuándo y, si no es todo, cuánto', () => {
    expect(receivableArrival(row, { today: TODAY })).toEqual({
      kind: 'late',
      text: 'Atrasado',
      note: `$${NB}1.479.954 · 6 días tarde`,
    })
    expect(
      receivableArrival(
        { ...row, overdueCents: row.debtCents, oldestDueDate: '2026-10-12' },
        { today: TODAY },
      ).note,
    ).toBe('1 día tarde')
    expect(
      receivableArrival(
        { ...row, overdueCents: row.debtCents, oldestDueDate: null },
        { today: TODAY },
      ).note,
    ).toBeNull()
  })

  it('lo que todavía no llegó: hoy, mañana o en cuántos días', () => {
    expect(receivableArrival(dated, { today: TODAY })).toEqual({
      kind: 'date',
      text: 'Hoy',
      note: null,
    })
    expect(receivableArrival({ ...dated, nextDueDate: '2026-10-14' }, { today: TODAY }).text).toBe(
      'Mañana',
    )
    expect(receivableArrival({ ...dated, nextDueDate: '2026-10-23' }, { today: TODAY }).text).toBe(
      'En 10 días',
    )
  })

  it('sin fecha lo dice; sin deuda no llega nada', () => {
    expect(receivableArrival({ ...dated, nextDueDate: null }, { today: TODAY })).toEqual({
      kind: 'none',
      text: 'Sin fecha',
      note: null,
    })
    expect(receivableArrival({ ...row, debtCents: 0 }, { today: TODAY }).kind).toBe('none')
  })

  it('lo de una billetera nunca es un atraso, aunque la base lo traiga vencido', () => {
    expect(receivableArrival(row, { today: TODAY, wallet: true })).toEqual({
      kind: 'wallet',
      text: 'Falta contarla',
      note: null,
    })
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

describe('«Lo que llegó»: cada cifra por separado', () => {
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

  it('un medio sin movimiento no tiene renglón', () => {
    expect(netVisibleRows(rows).map((r) => r.methodId)).toEqual(['ef', 'cr', 'pya', 'rappi'])
    expect(netVisibleRows([])).toEqual([])
  })

  it('los totales: lo vendido, lo que llegó, lo descontado y lo que sigue en camino', () => {
    expect(netTotals(rows)).toEqual({
      soldCents: 4_652_516,
      creditedCents: 2_494_900,
      deductedCents: 405_100,
      pendingCents: 1_752_516,
    })
  })

  it('un descuento negativo de la base no resta de lo descontado', () => {
    expect(netTotals([net({ creditedCents: 1_000, unexplainedCents: -50 })]).deductedCents).toBe(0)
  })
})

describe('«Cobros»: lo que entró de cada uno', () => {
  const means = (...amounts: Array<[string, number]>) =>
    amounts.map(([label, amountCents]) => ({ label, amountCents })) as never

  it('lo que entró a las cajas, lo descontado y a dónde fue', () => {
    expect(
      collectionAmounts({ totalCents: 191_546_500, means: means(['Banco Nación', 178_800_000]) }),
    ).toEqual({ shown: 178_800_000, discount: 12_746_500, where: 'Banco Nación' })
    expect(
      collectionAmounts({
        totalCents: 300,
        means: means(['Caja', 100], ['Banco', 100], ['Mercado Pago', 100]),
      }),
    ).toEqual({ shown: 300, discount: 0, where: 'Caja, Banco y Mercado Pago' })
  })

  it('sin el detalle de las cajas, se ve la liquidación entera', () => {
    expect(collectionAmounts({ totalCents: 500, means: null })).toEqual({
      shown: 500,
      discount: 0,
      where: '',
    })
    expect(collectionAmounts({ totalCents: 500, means: [] }).shown).toBe(500)
  })

  it('si entró de más no es un descuento negativo', () => {
    expect(collectionAmounts({ totalCents: 100, means: means(['Caja', 150]) }).discount).toBe(0)
  })
})

// ─── Facturas ────────────────────────────────────────────────────────────────

describe('los totales de «Facturas»', () => {
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
    const totals = invoicedSummary(rows)
    expect(totals?.channels.map((c) => c.label)).toEqual(['Salón', 'Delivery'])
    expect(totals?.soldCents).toBe(800_897_000)
    expect(totals?.invoicedCents).toBe(610_802_000)
    expect(totals?.uninvoicedCents).toBe(190_095_000)
    expect(channelSales(rows)).toHaveLength(3)
  })

  it('el mismo reparto que el cierre de cada noche', () => {
    const totals = invoicedSummary(rows)
    if (!totals) throw new Error('faltan los totales')
    expect(totals.split).toMatchObject({ kind: 'mixed', invoicedPercent: 76 })
  })

  it('sin puntos de venta todo queda sin factura', () => {
    const totals = invoicedSummary([summary({ soldCents: 500_000, uninvoicedCents: 500_000 })])
    expect(totals?.split.kind).toBe('none')
  })

  it('todo con factura, y el período sin ventas', () => {
    const all = invoicedSummary([
      summary({ soldCents: 121_000, invoicedNetCents: 100_000, vatCents: 21_000 }),
    ])
    expect(all?.split.kind).toBe('all')
    expect(invoicedSummary([])).toBeNull()
    expect(invoicedSummary([summary({})])).toBeNull()
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
