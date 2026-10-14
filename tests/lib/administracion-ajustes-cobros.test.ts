import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  arrivalWord,
  CLOSE_GROUP_META,
  chargeBreakdown,
  chargeTitle,
  closeGroupTitle,
  closeLookup,
  cuitList,
  flowText,
  groupCloseMethods,
  hasRates,
  joinWords,
  moveId,
  netOfTenThousand,
  rateLabel,
  reorderPlan,
  SAMPLE_GROSS_CENTS,
  splitsAGroup,
  withCloseGroup,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/cobros'
import { prefillDeductions } from '@/lib/accounting/posting/collection'
import type { PartyRates } from '@/lib/accounting/types'
import { NBSP } from '@/lib/money'

/**
 * «Medios de cobro»: cuánto te llega de cada $ 10.000, a dónde va cada cobro, en qué grupo del
 * cierre cae cada medio y qué se guarda al cambiar el orden. Ninguna cuenta es nueva: tiene que
 * dar lo mismo que la precarga de «Registrar un cobro» y agrupar igual que el Cierre del día.
 */

const NONE: PartyRates = {
  commissionBp: null,
  iibbWithholdingBp: null,
  vatWithholdingBp: null,
  incomeTaxWithholdingBp: null,
  sircupaBp: null,
}
const r = (over: Partial<PartyRates>): PartyRates => ({ ...NONE, ...over })
const pesos = (n: string) => `$${NBSP}${n}`

describe('de cada $ 10.000', () => {
  it('la venta de ejemplo son $ 10.000 (en centavos)', () => {
    expect(SAMPLE_GROSS_CENTS).toBe(1_000_000)
  })

  it('PedidosYa al 25 %: llegan $ 6.975 (comisión + su IVA)', () => {
    expect(netOfTenThousand(r({ commissionBp: 2500 }))).toBe(697_500)
    expect(chargeBreakdown(r({ commissionBp: 2500 }))).toEqual({
      grossCents: 1_000_000,
      commissionCents: 250_000,
      commissionVatCents: 52_500,
      withholdingsCents: 0,
      netCents: 697_500,
    })
  })

  it('crédito al 6,29 %: llegan $ 9.239 (redondeado a pesos)', () => {
    const net = netOfTenThousand(r({ commissionBp: 629 }))
    expect(net).toBe(923_891)
    expect(Math.round((net ?? 0) / 100)).toBe(9239)
  })

  it('es lo bruto menos lo que precarga «Registrar un cobro»', () => {
    const cases: PartyRates[] = [
      r({ commissionBp: 150, sircupaBp: 350 }),
      r({ commissionBp: 80 }),
      r({ commissionBp: 2000, iibbWithholdingBp: 300, vatWithholdingBp: 1050 }),
      r({ incomeTaxWithholdingBp: 200 }),
      r({ commissionBp: 1 }),
    ]
    for (const rates of cases) {
      const deducted = prefillDeductions(SAMPLE_GROSS_CENTS, rates).reduce(
        (sum, d) => sum + d.amountCents,
        0,
      )
      expect(netOfTenThousand(rates)).toBe(SAMPLE_GROSS_CENTS - deducted)
    }
  })

  it('sin tasas no se sabe: `null`, NUNCA $ 10.000', () => {
    expect(netOfTenThousand(NONE)).toBeNull()
    expect(netOfTenThousand(null)).toBeNull()
    expect(netOfTenThousand(undefined)).toBeNull()
    expect(chargeBreakdown(NONE)).toBeNull()
    expect(hasRates(NONE)).toBe(false)
  })

  it('una comisión en 0 % sí es un dato: llega entero', () => {
    expect(hasRates(r({ commissionBp: 0 }))).toBe(true)
    expect(netOfTenThousand(r({ commissionBp: 0 }))).toBe(1_000_000)
  })

  it('las retenciones se suman aparte de la comisión', () => {
    expect(chargeBreakdown(r({ commissionBp: 150, sircupaBp: 350 }))).toEqual({
      grossCents: 1_000_000,
      commissionCents: 15_000,
      commissionVatCents: 3_150,
      withholdingsCents: 35_000,
      netCents: 946_850,
    })
  })

  it('tasas disparatadas no dan plata negativa', () => {
    expect(netOfTenThousand(r({ commissionBp: 10_000, iibbWithholdingBp: 5_000 }))).toBe(0)
  })

  it('nunca pasa de cinco cifras en pesos', () => {
    for (const bp of [0, 1, 80, 629, 2500, 9999]) {
      const net = netOfTenThousand(r({ commissionBp: bp })) ?? 0
      expect(net).toBeLessThanOrEqual(1_000_000)
      expect(net).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('la píldora de la comisión', () => {
  it('dice lo que hay cargado', () => {
    expect(rateLabel(r({ commissionBp: 629 }))).toBe(`Comisión 6,29${NBSP}% + IVA`)
    expect(rateLabel(r({ commissionBp: 150, sircupaBp: 350 }))).toBe(
      `Comisión 1,5${NBSP}% + IVA y retenciones`,
    )
    expect(rateLabel(r({ commissionBp: 0 }))).toBe('Sin comisión')
    expect(rateLabel(r({ commissionBp: 0, iibbWithholdingBp: 300 }))).toBe(
      'Sin comisión, con retenciones',
    )
    expect(rateLabel(r({ sircupaBp: 350 }))).toBe('Solo retenciones')
  })

  it('sin nada cargado no hay texto (la píldora pide «Cargar la comisión»)', () => {
    expect(rateLabel(NONE)).toBeNull()
    expect(rateLabel(null)).toBeNull()
  })
})

describe('a dónde va cada cobro', () => {
  const base = { name: 'X', settlementDays: 0, treasuryName: null, partyName: null }

  it('las mismas palabras que el Cierre del día', () => {
    expect(flowText({ ...base, kind: 'treasury', treasuryName: 'Caja Efectivo' })).toBe(
      'Entra a Caja Efectivo',
    )
    expect(
      flowText({
        ...base,
        kind: 'settled_now',
        treasuryName: 'Mercado Pago',
        partyName: 'Mercado Pago',
      }),
    ).toBe('Queda en camino a Mercado Pago')
    expect(flowText({ ...base, kind: 'customer_account' })).toBe(
      'Queda en la cuenta de cada cliente',
    )
    expect(flowText({ ...base, kind: 'advance' })).toBe('Se descuenta de las señas')
  })

  it('lo que te pagan después dice a los cuántos días y quién', () => {
    const card = { ...base, kind: 'receivable' as const, partyName: 'Tarjetas de crédito (Posnet)' }
    expect(flowText({ ...card, settlementDays: 10 })).toBe(
      'Llega a los 10 días · Tarjetas de crédito (Posnet)',
    )
    expect(flowText({ ...card, settlementDays: 1 })).toBe(
      'Llega al día siguiente · Tarjetas de crédito (Posnet)',
    )
    expect(flowText({ ...card, settlementDays: 0 })).toBe(
      'Llega en el día · Tarjetas de crédito (Posnet)',
    )
  })

  it('si quien paga se llama igual que el medio, no se repite', () => {
    expect(
      flowText({
        name: 'PedidosYa',
        kind: 'receivable',
        settlementDays: 14,
        treasuryName: null,
        partyName: 'PedidosYa',
      }),
    ).toBe('Llega a los 14 días')
  })

  it('nunca dice «se acredita»', () => {
    const all = [
      flowText({ ...base, kind: 'treasury' }),
      flowText({ ...base, kind: 'settled_now' }),
      flowText({ ...base, kind: 'receivable', settlementDays: 30 }),
      arrivalWord({ kind: 'receivable', settlementDays: 30 }),
      arrivalWord({ kind: 'settled_now', settlementDays: 0 }),
    ].join(' ')
    expect(all).not.toMatch(/acredit/i)
  })
})

describe('el título que afirma', () => {
  const row = (name: string, netCents: number | null, charges = true) => ({
    name,
    charges,
    netCents,
  })

  it('con dos o más comisiones: el peor caso', () => {
    const t = chargeTitle([
      row('Efectivo', null, false),
      row('Crédito', 923_891),
      row('PedidosYa', 697_500),
      row('Rappi', null),
      row('Uber Eats', null),
      row('Mercado Pago Delivery', null),
    ])
    expect(t.title).toBe(
      `Lo que más te descuenta es PedidosYa: de cada ${pesos('10.000')} te llegan ${pesos('6.975')}.`,
    )
    expect(t.sentence).toBe('Estimado con las comisiones que cargaste. El efectivo llega entero.')
    expect(t.missing).toBe('Sin comisión cargada: Rappi, Uber Eats y Mercado Pago Delivery.')
    expect(t.worst?.name).toBe('PedidosYa')
  })

  it('con una sola', () => {
    const t = chargeTitle([row('Efectivo', null, false), row('Crédito', 923_891)])
    expect(t.title).toBe(`Con Crédito, de cada ${pesos('10.000')} te llegan ${pesos('9.239')}.`)
    expect(t.missing).toBeNull()
  })

  it('sin ninguna cargada', () => {
    const t = chargeTitle([row('Efectivo', null, false), row('Rappi', null)])
    expect(t.title).toBe('Todavía no cargaste cuánto te descuenta cada uno.')
    expect(t.sentence).toBe(
      'Con la comisión de cada tarjeta y cada app, acá ves cuánto te llega según cómo te pagan.',
    )
    expect(t.missing).toBe('Sin comisión cargada: Rappi.')
    expect(t.worst).toBeNull()
  })

  it('solo efectivo: no inventa un descuento', () => {
    const t = chargeTitle([row('Efectivo', null, false)])
    expect(t.title).toBe('Todo lo que cobrás te llega entero.')
    expect(t.missing).toBeNull()
  })

  it('sin ningún medio prendido', () => {
    expect(chargeTitle([]).title).toBe('Todavía no hay ningún medio de cobro prendido.')
  })

  it('todas las comisiones en 0 %: no hay «peor»', () => {
    const t = chargeTitle([row('Débito', 1_000_000), row('Crédito', 1_000_000)])
    expect(t.title).toBe('Con lo que cargaste, ningún medio te descuenta.')
    expect(t.worst).toBeNull()
  })

  it('muchos sin comisión se resumen', () => {
    const t = chargeTitle(['A', 'B', 'C', 'D', 'E', 'F'].map((name) => row(name, null)))
    expect(t.missing).toBe('Sin comisión cargada: A, B, C y 3 más.')
  })

  it('nunca dice «ganancia»', () => {
    const t = chargeTitle([row('Crédito', 923_891), row('PedidosYa', 697_500)])
    expect(`${t.title} ${t.sentence}`).not.toMatch(/ganancia|ganás|ganaste/i)
  })

  it('juntar palabras', () => {
    expect(joinWords([])).toBe('')
    expect(joinWords(['Rappi'])).toBe('Rappi')
    expect(joinWords(['Rappi', 'Pedix'])).toBe('Rappi y Pedix')
    expect(joinWords(['Rappi', 'Uber Eats', 'Pedix'])).toBe('Rappi, Uber Eats y Pedix')
  })
})

// ─── Los grupos, con los medios de HUB ───────────────────────────────────────

const TREASURIES = [
  { id: 'caja', name: 'Caja Efectivo', kind: 'cash' as const, bankPartyId: null },
  { id: 'mp', name: 'Mercado Pago', kind: 'wallet' as const, bankPartyId: 'p-mp' },
]
const PARTIES = [
  { id: 'p-mp', name: 'Mercado Pago', systemKey: 'mercado_pago' },
  { id: 'p-deb', name: 'Tarjetas de débito (Posnet)', systemKey: 'posnet_debito' },
  { id: 'p-cred', name: 'Tarjetas de crédito (Posnet)', systemKey: 'posnet_credito' },
  { id: 'p-pya', name: 'PedidosYa', systemKey: 'pedidosya' },
  { id: 'p-rappi', name: 'Rappi', systemKey: 'rappi' },
  { id: 'p-mpd', name: 'Mercado Pago Delivery', systemKey: 'mp_delivery' },
  { id: 'p-senas', name: 'Señas de clientes', systemKey: 'senas' },
]
type M = Parameters<typeof closeLookup>[0] & { name: string; settlementDays: number }
const m = (
  name: string,
  kind: M['kind'],
  channel: M['channel'],
  treasuryAccountId: string | null,
  partyId: string | null,
  settlementDays = 0,
): M => ({ id: name, name, kind, channel, treasuryAccountId, partyId, settlementDays })

const HUB: M[] = [
  m('Efectivo', 'treasury', 'salon', 'caja', null),
  m('Transferencia', 'settled_now', 'salon', 'mp', 'p-mp'),
  m('QR Mercado Pago', 'settled_now', 'salon', 'mp', 'p-mp'),
  m('Débito', 'receivable', 'salon', null, 'p-deb', 1),
  m('Crédito', 'receivable', 'salon', null, 'p-cred', 10),
  m('PedidosYa', 'receivable', 'delivery', null, 'p-pya', 14),
  m('Rappi', 'receivable', 'delivery', null, 'p-rappi', 14),
  m('Mercado Pago Delivery', 'receivable', 'delivery', null, 'p-mpd', 14),
  m('Cuenta corriente', 'customer_account', 'events', null, null),
  m('Seña aplicada', 'advance', 'salon', null, 'p-senas'),
]

describe('los grupos del cierre', () => {
  const catalog = { treasuries: TREASURIES, parties: PARTIES }
  const grouped = withCloseGroup(HUB, catalog)

  it('cada medio cae en el grupo en que lo muestra el Cierre del día', () => {
    expect(Object.fromEntries(grouped.map((x) => [x.name, x.group]))).toEqual({
      Efectivo: 'cash',
      Transferencia: 'wallet',
      'QR Mercado Pago': 'wallet',
      Débito: 'cards',
      Crédito: 'cards',
      PedidosYa: 'delivery',
      Rappi: 'delivery',
      'Mercado Pago Delivery': 'delivery',
      'Cuenta corriente': 'account',
      'Seña aplicada': 'advance',
    })
  })

  it('los bloques van en el orden de Ajustes, con sus medios juntos', () => {
    expect(groupCloseMethods(grouped).map((b) => [b.group, b.methods.length])).toEqual([
      ['cash', 1],
      ['wallet', 2],
      ['cards', 2],
      ['delivery', 3],
      ['account', 1],
      ['advance', 1],
    ])
  })

  it('el efectivo es el que entra a una caja de efectivo', () => {
    expect(closeLookup(HUB[0] as M, catalog)).toMatchObject({ isCash: true, mercadoPago: false })
    // Una transferencia directa al banco no es efectivo.
    const bank = { id: 'banco', name: 'Banco Nación', kind: 'bank' as const, bankPartyId: null }
    const direct = m('Transferencia al banco', 'treasury', 'salon', 'banco', null)
    const lookup = closeLookup(direct, { treasuries: [...TREASURIES, bank], parties: PARTIES })
    expect(lookup.isCash).toBe(false)
    expect(lookup.treasury?.name).toBe('Banco Nación')
  })

  it('es de Mercado Pago lo que va a su billetera; una app que paga Mercado Pago sigue siendo delivery', () => {
    expect(closeLookup(HUB[1] as M, catalog).mercadoPago).toBe(true)
    expect(closeLookup(HUB[2] as M, catalog).mercadoPago).toBe(true)
    const viaMp = m('App por MP', 'receivable', 'delivery', null, 'p-mp', 14)
    expect(closeLookup(viaMp, catalog).mercadoPago).toBe(false)
    expect(withCloseGroup([viaMp], catalog)[0]?.group).toBe('delivery')
  })

  it('el grupo de billeteras se titula «Mercado Pago» si todos sus medios lo son', () => {
    const wallet = grouped.filter((x) => x.group === 'wallet')
    expect(closeGroupTitle('wallet', wallet)).toBe('Mercado Pago')
    expect(closeGroupTitle('wallet', [...wallet, { mercadoPago: false }])).toBe(
      'Billeteras y transferencias',
    )
    expect(closeGroupTitle('wallet', [])).toBe('Billeteras y transferencias')
    expect(closeGroupTitle('cards', [{ mercadoPago: true }])).toBe('Tarjetas')
  })

  it('los títulos de grupo son los del formulario del Cierre del día', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'app/(manager)/[tenantSlug]/administracion/ventas/cierre/_components/sales-close-form.tsx',
      ),
      'utf8',
    )
    for (const group of Object.keys(CLOSE_GROUP_META) as Array<keyof typeof CLOSE_GROUP_META>) {
      expect(source).toContain(`${group}: { title: '${CLOSE_GROUP_META[group].title}'`)
    }
  })

  it('avisa si el orden deja separados dos medios del mismo grupo', () => {
    expect(splitsAGroup(['cash', 'wallet', 'wallet', 'cards'])).toBe(false)
    expect(splitsAGroup(['cash', 'wallet', 'cards', 'wallet'])).toBe(true)
    expect(splitsAGroup(['cards', 'cash', 'cards'])).toBe(true)
    expect(splitsAGroup([])).toBe(false)
    expect(splitsAGroup(['cash'])).toBe(false)
  })
})

describe('cambiar el orden', () => {
  const on = (id: string, sort: number) => ({ id, sort, active: true })
  const off = (id: string, sort: number) => ({ id, sort, active: false })
  const HUB_SORT = [
    on('efectivo', 10),
    on('transferencia', 20),
    on('qr', 30),
    on('debito', 40),
    on('credito', 50),
    on('pedidosya', 60),
    on('rappi', 70),
    off('uber', 80),
    off('pedix', 100),
    on('cuenta', 110),
  ]

  it('sin cambios no hay nada que guardar', () => {
    expect(
      reorderPlan(
        HUB_SORT,
        HUB_SORT.filter((x) => x.active).map((x) => x.id),
      ),
    ).toEqual([])
    expect(reorderPlan([], [])).toEqual([])
  })

  it('solo viajan los que cambian, y se reparten los `sort` que ya tenían', () => {
    // Crédito sube arriba de Débito.
    const order = [
      'efectivo',
      'transferencia',
      'qr',
      'credito',
      'debito',
      'pedidosya',
      'rappi',
      'cuenta',
    ]
    expect(reorderPlan(HUB_SORT, order)).toEqual([
      { id: 'credito', sort: 40 },
      { id: 'debito', sort: 50 },
    ])
  })

  it('los apagados no se tocan aunque queden en el medio', () => {
    // Cuenta corriente pasa a ser la segunda: todos los de abajo se corren un lugar.
    const order = [
      'efectivo',
      'cuenta',
      'transferencia',
      'qr',
      'debito',
      'credito',
      'pedidosya',
      'rappi',
    ]
    const plan = reorderPlan(HUB_SORT, order)
    expect(plan.map((p) => p.id)).not.toContain('uber')
    expect(plan.map((p) => p.id)).not.toContain('pedix')
    expect(plan).toEqual([
      { id: 'cuenta', sort: 20 },
      { id: 'transferencia', sort: 30 },
      { id: 'qr', sort: 40 },
      { id: 'debito', sort: 50 },
      { id: 'credito', sort: 60 },
      { id: 'pedidosya', sort: 70 },
      { id: 'rappi', sort: 110 },
    ])
  })

  it('con `sort` repetidos entre los prendidos, todos pasan a posición × 10', () => {
    const repeated = [on('a', 10), on('b', 10), on('c', 30), off('d', 20)]
    expect(reorderPlan(repeated, ['b', 'a', 'c'])).toEqual([
      // b queda en 10 (ya lo tenía): no viaja.
      { id: 'a', sort: 20 },
      // c queda en 30: no viaja.
    ])
    expect(reorderPlan(repeated, ['c', 'b', 'a'])).toEqual([
      { id: 'c', sort: 10 },
      { id: 'b', sort: 20 },
      { id: 'a', sort: 30 },
    ])
  })

  it('un solo medio, ids que no son de un prendido y prendidos que faltan en el orden', () => {
    expect(reorderPlan([on('a', 10)], ['a'])).toEqual([])
    // «x» no existe y «uber» está apagado: se ignoran. «c» no vino: queda al final.
    expect(
      reorderPlan(
        [on('a', 10), on('b', 20), on('c', 30), off('uber', 40)],
        ['b', 'x', 'uber', 'a'],
      ),
    ).toEqual([
      { id: 'b', sort: 10 },
      { id: 'a', sort: 20 },
    ])
  })

  it('subir y bajar un lugar', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    // En la punta, o un id que no está, queda igual.
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moveId(['a', 'b', 'c'], 'z', 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('la lista de CUIT', () => {
  const party = (kind: Parameters<typeof cuitList>[0][number]['kind'], over = {}) => ({
    kind,
    taxId: null as string | null,
    active: true,
    ...over,
  })

  it('llevan CUIT las tarjetas, las billeteras, las apps, los bancos y los organismos', () => {
    const parties = [
      party('payment_wallet'),
      party('card_processor'),
      party('delivery_platform'),
      party('bank'),
      party('tax_agency'),
    ]
    const list = cuitList(parties)
    expect(list.expected).toEqual(parties)
    expect(list.exempt).toEqual([])
    expect(list.missing).toBe(5)
  })

  it('los que juntan a varios (sueldos, proveedores varios, señas) no la llevan ni cuentan', () => {
    const wallet = party('payment_wallet')
    const payroll = party('payroll')
    const misc = party('supplier')
    const advances = party('customer', { active: false })
    const other = party('other')
    const list = cuitList([wallet, payroll, misc, advances, other])
    expect(list.expected).toEqual([wallet])
    expect(list.exempt).toEqual([payroll, misc, advances, other])
    expect(list.missing).toBe(1)
  })

  it('una app apagada sigue en la lista, pero no es un pendiente', () => {
    const off = party('delivery_platform', { active: false })
    const list = cuitList([off, party('bank')])
    expect(list.expected).toContain(off)
    expect(list.missing).toBe(1)
  })

  it('con la CUIT cargada deja de contar; y si un grupo la tiene, se muestra con los demás', () => {
    const bank = party('bank', { taxId: '30500010912' })
    const union = party('other', { taxId: '30546741253' })
    const list = cuitList([bank, union])
    expect(list.expected).toEqual([bank, union])
    expect(list.exempt).toEqual([])
    expect(list.missing).toBe(0)
  })

  it('conserva el orden en que llegan', () => {
    const a = party('tax_agency')
    const b = party('payroll')
    const c = party('payment_wallet')
    const list = cuitList([a, b, c])
    expect(list.expected).toEqual([a, c])
    expect(list.exempt).toEqual([b])
  })
})
