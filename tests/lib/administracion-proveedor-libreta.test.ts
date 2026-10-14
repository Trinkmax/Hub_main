import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agingMath,
  agingTranches,
  documentText,
  ledgerTrendTitle,
  ledgerVerb,
  statementBalancePoints,
  supplierFacts,
  supplierHero,
  supplierLedger,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/supplier-ledger'
import { DataTab } from '@/app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/data-tab'
import { LedgerLines } from '@/app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/ledger-lines'
import { PendingTab } from '@/app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/pending-tab'
import { SupplierCover } from '@/app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/supplier-cover'
import { agingSummary, trafficLight } from '@/lib/accounting/aging'
import type {
  OpenItemRow,
  PartyDetail,
  PartyPosition,
  PartyStatementRow,
} from '@/lib/accounting/queries/parties'

/**
 * La hoja de un proveedor («su libreta»): qué dice la tapa, sus tres datos de
 * carga, los renglones con sus tres palabras (te dejó · le pagaste · le debés)
 * y la escalera de la deuda. Y ya dibujada: sin deuda no hay «$ 0» y la
 * contadora no recibe ningún botón de carga, de pago ni de edición.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/compras/proveedores/x',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
const accounting = () => ({
  tenantSlug: 'hub',
  today: '2026-10-13',
  access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
  readOnly: ui.readOnly,
  openAction: () => {},
  closeAction: () => {},
})
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => accounting(),
  useAccountingOptional: () => accounting(),
}))
vi.mock('@/lib/accounting/actions/master', () => ({
  saveParty: vi.fn(),
  deleteParty: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/documents', () => ({
  allocateItems: vi.fn(),
  unallocateItem: vi.fn(),
}))

afterEach(() => {
  ui.readOnly = false
})

const TODAY = '2026-10-13'
const SLUG = 'hub'
const NB = String.fromCharCode(160)
const PARTY_ID = '00000000-0000-4000-8000-0000000000a1'

function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(NB, ' ')
}
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const plain = (s: string) => s.replaceAll(NB, ' ')

function party(patch: Partial<PartyDetail> = {}): PartyDetail {
  return {
    id: PARTY_ID,
    kind: 'supplier',
    name: 'Distribuidora de Bebidas Demo SA',
    tradeName: null,
    taxIdType: 'cuit',
    taxId: '30701112225',
    ivaCondition: 'responsable_inscripto',
    email: null,
    phone: null,
    address: null,
    paymentTermDays: 21,
    defaultAccountId: 'acc-1',
    defaultAccountName: 'Compras: bebidas sin alcohol',
    defaultVoucherType: 'factura_a',
    payableAccountId: 'pay',
    payableAccountName: 'Proveedores',
    receivableAccountId: 'rec',
    receivableAccountName: null,
    commissionVatMode: 'none',
    commissionBp: null,
    iibbWithholdingBp: null,
    vatWithholdingBp: null,
    incomeTaxWithholdingBp: null,
    sircupaBp: null,
    notes: null,
    active: true,
    systemKey: null,
    contacts: [],
    deliveryDays: [],
    orderLeadDays: null,
    updatedAt: '2026-10-12T10:00:00Z',
    group: 'payables',
    ...patch,
  }
}

/** Un proveedor como los 75 de HUB: entró por una lista y no se sabe nada de él. */
const bare = () =>
  party({
    name: 'Barracuda Bebidas',
    taxIdType: 'none',
    taxId: null,
    ivaCondition: 'sin_datos',
    paymentTermDays: 0,
    defaultAccountId: null,
    defaultAccountName: null,
    defaultVoucherType: null,
  })

function item(patch: Partial<OpenItemRow> = {}): OpenItemRow {
  return {
    lineId: 'l1',
    documentId: '00000000-0000-4000-8000-0000000000d1',
    documentSeq: 12,
    documentKind: 'purchase',
    documentLabel: 'Factura A 0003-00001100',
    accountId: 'pay',
    accountCode: '2.1.01',
    accountName: 'Proveedores',
    side: 'debt',
    salesMethodId: null,
    entryDate: '2026-09-10',
    dueDate: '2026-10-01',
    memo: null,
    amountCents: 121_000_000,
    openCents: 121_000_000,
    daysOverdue: 12,
    bucket: 'overdue_1_30',
    ...patch,
  }
}

function position(debtItems: OpenItemRow[], creditItems: OpenItemRow[] = []): PartyPosition {
  const items = debtItems.map((i) => ({ dueDate: i.dueDate, openCents: i.openCents }))
  const debtCents = debtItems.reduce((sum, i) => sum + i.openCents, 0)
  const creditCents = creditItems.reduce((sum, i) => sum + i.openCents, 0)
  return {
    partyId: PARTY_ID,
    group: 'payables',
    asOf: TODAY,
    debtCents,
    creditCents,
    netCents: debtCents - creditCents,
    aging: agingSummary(items, TODAY),
    traffic: trafficLight({ items, creditCents, asOf: TODAY, soonDays: 7, group: 'payables' }),
    debtItems,
    creditItems,
  }
}

const THREE = [
  item(),
  item({
    lineId: 'l2',
    documentLabel: 'Remito u otro comprobante (sin factura)',
    entryDate: '2026-09-24',
    dueDate: '2026-10-18',
    amountCents: 135_220_000,
    openCents: 135_220_000,
  }),
  item({
    lineId: 'l3',
    documentLabel: 'Factura A 0003-00001205',
    entryDate: '2026-10-05',
    dueDate: '2026-11-20',
    amountCents: 100_000_000,
    openCents: 77_440_000,
  }),
]
const CREDIT = item({
  lineId: 'c1',
  side: 'credit',
  documentKind: 'purchase_credit_note',
  documentLabel: 'Nota de crédito A 0003-00000015',
  entryDate: '2026-10-03',
  dueDate: null,
  amountCents: 6_050_000,
  openCents: 6_050_000,
})

describe('la tapa: el número y su oración', () => {
  const base = {
    debtCents: 0,
    creditCents: 0,
    debtCount: 0,
    overdueCents: 0,
    oldestDueDate: null,
    nextDueDate: null,
    today: TODAY,
  }

  it('con deuda vencida: cuántas compras y desde cuándo la más vieja', () => {
    const hero = supplierHero({
      ...base,
      debtCents: 333_660_000,
      debtCount: 3,
      overdueCents: 121_000_000,
      oldestDueDate: '2026-10-01',
      creditCents: 6_050_000,
    })
    expect(hero.kind).toBe('debt')
    expect(plain(hero.sentence)).toBe(
      '3 compras sin pagar. La más vieja venció hace 12 días. Tenés $ 60.500 a favor.',
    )
  })

  it('con deuda al día: cuándo vence la próxima', () => {
    expect(
      supplierHero({ ...base, debtCents: 100, debtCount: 2, nextDueDate: '2026-10-21' }).sentence,
    ).toBe('2 compras sin pagar. Nada vencido: la próxima vence el 21/10.')
    expect(
      supplierHero({ ...base, debtCents: 100, debtCount: 1, nextDueDate: TODAY }).sentence,
    ).toBe('1 compra sin pagar. Vence hoy.')
    expect(
      supplierHero({ ...base, debtCents: 100, debtCount: 1, nextDueDate: '2026-10-14' }).sentence,
    ).toBe('1 compra sin pagar. Vence mañana.')
  })

  it('una sola compra, vencida ayer, o sin fecha', () => {
    expect(
      supplierHero({
        ...base,
        debtCents: 100,
        debtCount: 1,
        overdueCents: 100,
        oldestDueDate: '2026-10-12',
      }).sentence,
    ).toBe('1 compra sin pagar. Venció hace 1 día.')
    expect(supplierHero({ ...base, debtCents: 100, debtCount: 1 }).sentence).toBe(
      '1 compra sin pagar. Sin fecha de pago.',
    )
  })

  it('sin deuda con algo a favor, y sin nada: nunca «$ 0»', () => {
    expect(supplierHero({ ...base, creditCents: 6_050_000 })).toEqual({
      kind: 'credit',
      cents: 6_050_000,
      sentence: 'No le debés nada. Se descuenta solo de la próxima compra.',
    })
    expect(supplierHero(base)).toEqual({
      kind: 'clear',
      title: 'No le debés nada',
      sentence: 'Está al día.',
    })
  })

  it('sin los saldos iniciales, «al día» es por lo cargado: lo aclara', () => {
    const hero = supplierHero({ ...base, openingPending: true })
    expect(hero.kind).toBe('clear')
    expect(hero.sentence).not.toContain('Está al día')
    expect(hero.sentence).toContain('saldos iniciales')
    // Con deuda no cambia nada: el número es el número.
    expect(supplierHero({ ...base, debtCents: 100, debtCount: 1, openingPending: true }).kind).toBe(
      'debt',
    )
  })

  it('los tres tramos de toda la sección suman la deuda', () => {
    const pos = position(THREE)
    const tranches = agingTranches(pos.aging)
    expect(tranches.map((t) => [t.key, t.cents])).toEqual([
      ['overdue', 121_000_000],
      ['week', 135_220_000],
      ['later', 77_440_000],
    ])
    expect(tranches.reduce((sum, t) => sum + t.cents, 0)).toBe(pos.debtCents)
    const math = agingMath(pos.aging)
    expect(math.map((row) => row.label)).toEqual([
      'Vencido de 1 a 30 días',
      'Vence esta semana',
      'Más adelante',
      'Le debés',
    ])
    expect(math.at(-1)).toMatchObject({ cents: pos.debtCents, total: true })
  })
})

describe('sus tres datos de carga', () => {
  it('con los tres puestos', () => {
    const facts = supplierFacts(party())
    expect(facts.map((f) => [f.key, f.set, f.text])).toEqual([
      ['category', true, 'Bebidas sin alcohol'],
      ['invoicing', true, 'Responsable inscripto · CUIT 30-70111222-5'],
      ['term', true, 'Le pagás a 21 días'],
    ])
  })

  it('el proveedor típico de un bar que recién arranca: faltan los tres', () => {
    const facts = supplierFacts(bare())
    expect(facts.every((f) => !f.set)).toBe(true)
    expect(facts.map((f) => f.missing)).toEqual([
      'En qué le comprás',
      'Cómo te factura',
      'A cuántos días le pagás',
    ])
    expect(facts.map((f) => f.missingReadOnly)).toEqual([
      'Sin categoría',
      'Sin datos de cómo factura',
      'Sin plazo',
    ])
  })

  it('sabemos cómo factura pero no el CUIT; y un DNI se nombra como DNI', () => {
    const noCuit = supplierFacts(party({ taxIdType: 'none', taxId: null }))
    expect(noCuit[1]?.text).toBe('Responsable inscripto · Sin CUIT')
    expect(documentText('dni', '30123456')).toBe('DNI 30123456')
    expect(documentText('cuil', '20123456786')).toBe('CUIL 20-12345678-6')
    expect(documentText('none', null)).toBeNull()
    expect(supplierFacts(party({ paymentTermDays: 1 }))[2]?.text).toBe('Le pagás a 1 día')
  })
})

function line(patch: Partial<PartyStatementRow> = {}): PartyStatementRow {
  return {
    rowKind: 'line',
    entryId: 'e1',
    documentId: '00000000-0000-4000-8000-0000000000d1',
    documentSeq: 1,
    documentKind: 'purchase',
    entryDate: '2026-09-10',
    documentLabel: 'Factura A 0003-00001100',
    dueDate: '2026-10-01',
    accountId: 'pay',
    memo: null,
    increaseCents: 121_000_000,
    decreaseCents: 0,
    runningBalanceCents: 121_000_000,
    lineId: 'l1',
    openCents: 121_000_000,
    ...patch,
  }
}

const STATEMENT = [
  line(),
  line({
    lineId: 'l2',
    entryDate: '2026-09-24',
    documentLabel: 'Remito u otro comprobante (sin factura)',
    dueDate: '2026-10-24',
    increaseCents: 262_660_000,
    runningBalanceCents: 383_660_000,
    openCents: 262_660_000,
  }),
  line({
    lineId: 'l3',
    entryDate: '2026-10-03',
    documentKind: 'payment',
    documentLabel: 'Pago',
    dueDate: null,
    increaseCents: 0,
    decreaseCents: 50_000_000,
    runningBalanceCents: 333_660_000,
    openCents: null,
  }),
  line({
    lineId: 'l4',
    entryDate: '2026-10-03',
    documentKind: 'purchase_credit_note',
    documentLabel: 'Nota de crédito A 0003-00000015',
    dueDate: null,
    increaseCents: 0,
    decreaseCents: 6_050_000,
    runningBalanceCents: 327_610_000,
    openCents: null,
  }),
]

describe('los renglones de su libreta', () => {
  it('el verbo dice el sentido: te dejó, le pagaste, te descontó', () => {
    const up = { increaseCents: 100, decreaseCents: 0 }
    const down = { increaseCents: 0, decreaseCents: 100 }
    expect(ledgerVerb('purchase', up)).toBe('Te dejó')
    expect(ledgerVerb('purchase_debit_note', up)).toBe('Te cargó')
    expect(ledgerVerb('payment', down)).toBe('Le pagaste')
    expect(ledgerVerb('purchase_credit_note', down)).toBe('Te descontó')
    expect(ledgerVerb('opening', up)).toBe('Arrancó con')
    // Cualquier otro, por el signo.
    expect(ledgerVerb('manual', up)).toBe('Sumó')
    expect(ledgerVerb('manual', down)).toBe('Bajó')
    expect(ledgerVerb(null, down)).toBe('Bajó')
  })

  it('arma la libreta con el saldo de arranque y el de cierre', () => {
    const ledger = supplierLedger({
      rows: STATEMENT,
      from: '2026-07-16',
      to: TODAY,
      openingCents: 0,
      hasMore: false,
      today: TODAY,
    })
    expect(ledger.lines.map((l) => l.verb)).toEqual([
      'Te dejó',
      'Te dejó',
      'Le pagaste',
      'Te descontó',
    ])
    expect(ledger.opening).toEqual({ text: 'Al 15/07 no le debías nada', balanceCents: 0 })
    expect(ledger.closing).toEqual({ text: 'Hoy le debés', balanceCents: 327_610_000 })
    expect(ledger.totals).toEqual({ increaseCents: 383_660_000, decreaseCents: 56_050_000 })
    // Con algo a favor sin usar, la libreta ya lo restó y la tapa no: se aclara,
    // para que la misma hoja no muestre dos «le debés» con números distintos.
    const withCredit = supplierLedger({
      rows: STATEMENT,
      from: '2026-07-16',
      to: TODAY,
      openingCents: 0,
      hasMore: false,
      today: TODAY,
      unusedCreditCents: 6_050_000,
    })
    expect(withCredit.closing).toEqual({
      text: 'Hoy le debés, ya restado lo que tenés a favor',
      balanceCents: 327_610_000,
    })
    expect(ledger.lines[0]?.status).toEqual({ text: 'vencida hace 12 días', tone: 'late' })
    expect(ledger.lines[1]?.status).toEqual({ text: 'vence el 24/10', tone: 'muted' })
    // Un pago no tiene vencimiento ni estado.
    expect(ledger.lines[2]?.status).toBeNull()
  })

  it('una compra ya pagada lo dice; con más páginas no hay cierre', () => {
    const ledger = supplierLedger({
      rows: [line({ openCents: 0 })],
      from: '2026-09-01',
      to: '2026-09-30',
      openingCents: 5_000_000,
      hasMore: true,
      today: TODAY,
    })
    expect(ledger.lines[0]?.status).toEqual({ text: 'pagada', tone: 'ok' })
    expect(ledger.closing).toBeNull()
    expect(plain(ledger.opening?.text ?? '')).toBe('Al 31/08 le debías $ 50.000')
  })

  it('sin movimientos: el cierre es el saldo de arranque', () => {
    const ledger = supplierLedger({
      rows: [],
      from: '2026-09-01',
      to: '2026-09-30',
      openingCents: 0,
      hasMore: false,
      today: TODAY,
    })
    expect(ledger.lines).toEqual([])
    expect(ledger.closing).toEqual({ text: 'Al 30/09/2026', balanceCents: 0 })
    expect(ledger.totals).toEqual({ increaseCents: 0, decreaseCents: 0 })
  })

  it('el título que afirma: ¿se acumuló deuda o se fue bajando?', () => {
    const lead = 'En los últimos 90 días'
    const title = (opening: number | null, closing: number | null, movements = 3) =>
      plain(
        ledgerTrendTitle({ lead, openingCents: opening, closingCents: closing, movements }) ?? '',
      )
    expect(title(0, 327_610_000)).toBe('En los últimos 90 días le pasaste a deber $ 3.276.100 más')
    expect(title(500_000_000, 100_000_000)).toBe(
      'En los últimos 90 días le bajaste la deuda en $ 4.000.000',
    )
    expect(title(100, 100)).toBe('En los últimos 90 días la deuda quedó igual')
    expect(title(0, 0, 0)).toBe('En los últimos 90 días no hubo movimientos')
    expect(ledgerTrendTitle({ lead, openingCents: 0, closingCents: null, movements: 2 })).toBeNull()
  })
})

describe('la escalera de la deuda', () => {
  const ledger = supplierLedger({
    rows: STATEMENT,
    from: '2026-09-08',
    to: '2026-10-05',
    openingCents: 0,
    hasMore: false,
    today: TODAY,
  })
  const points = statementBalancePoints({
    lines: ledger.lines,
    from: '2026-09-08',
    to: '2026-10-05',
    openingCents: 0,
  })

  it('un punto por día, del primero al último del período', () => {
    expect(points).toHaveLength(28)
    expect(points[0]).toEqual({ date: '2026-09-08', cents: 0 })
    expect(points.at(-1)).toEqual({ date: '2026-10-05', cents: 327_610_000 })
  })

  it('los días sin movimiento arrastran el saldo', () => {
    const at = (date: string) => points.find((p) => p.date === date)?.cents
    expect(at('2026-09-09')).toBe(0)
    expect(at('2026-09-10')).toBe(121_000_000)
    expect(at('2026-09-23')).toBe(121_000_000)
    expect(at('2026-09-24')).toBe(383_660_000)
    // Dos movimientos el mismo día: vale el saldo con que cierra el día.
    expect(at('2026-10-03')).toBe(327_610_000)
  })

  it('arranca en el saldo de apertura; lo que hay a favor se dibuja en cero', () => {
    expect(
      statementBalancePoints({
        lines: [],
        from: '2026-10-01',
        to: '2026-10-03',
        openingCents: 5_000_000,
      }),
    ).toEqual([
      { date: '2026-10-01', cents: 5_000_000 },
      { date: '2026-10-02', cents: 5_000_000 },
      { date: '2026-10-03', cents: 5_000_000 },
    ])
    expect(
      statementBalancePoints({
        lines: [],
        from: '2026-10-01',
        to: '2026-10-01',
        openingCents: -100,
      }),
    ).toEqual([{ date: '2026-10-01', cents: 0 }])
    expect(
      statementBalancePoints({ lines: [], from: '2026-10-05', to: '2026-10-01', openingCents: 0 }),
    ).toEqual([])
  })
})

// ─── Lo que se ve armado ─────────────────────────────────────────────────────

function cover(patch: Partial<Parameters<typeof SupplierCover>[0]> = {}) {
  return html(
    createElement(SupplierCover, {
      tenantSlug: SLUG,
      party: party(),
      position: position(THREE, [CREDIT]),
      positionError: null,
      verification: null,
      canWrite: true,
      canPickCategory: false,
      tone: 'bosque',
      today: TODAY,
      baseHref: `/hub/administracion/compras/proveedores/${PARTY_ID}`,
      exportHref: '/api/x',
      exportFileName: 'x.csv',
      ...patch,
    }),
  )
}

describe('la tapa dibujada', () => {
  it('con deuda: el nombre, «Le debés», los tramos y [Pagarle] al lado', () => {
    const out = cover()
    const read = text(out)
    expect(out).toContain('<h1')
    expect(read).toContain('Distribuidora de Bebidas Demo SA')
    expect(read).toContain('Le debés')
    expect(read).toContain('3.336.600')
    expect(read).toContain('3 compras sin pagar. La más vieja venció hace 12 días.')
    for (const word of ['Vencido', 'Vence esta semana', 'Más adelante'])
      expect(read).toContain(word)
    expect(read).toContain('Pagarle')
    expect(read).toContain('Cargarle una compra')
    expect(read).toContain('Bebidas sin alcohol')
    expect(read).toContain('Le pagás a 21 días')
  })

  it('el proveedor típico de un bar que arranca: sin «$ 0» y con «Cargarle una compra»', () => {
    const read = text(cover({ party: bare(), position: position([]) }))
    expect(read).toContain('No le debés nada')
    expect(read).toContain('Está al día.')
    expect(read).not.toContain('$ 0')
    expect(read).toContain('Cargarle una compra')
    expect(read).not.toContain('Pagarle')
  })

  it('HUB sin saldos iniciales: la tapa del proveedor no promete «al día»', () => {
    const read = text(cover({ party: bare(), position: position([]), openingPending: true }))
    expect(read).toContain('No le debés nada')
    expect(read).toContain('Por lo que cargaste.')
    expect(read).not.toContain('Está al día.')
  })

  it('si no se pudo leer cuánto se le debe, lo dice en el lugar del número', () => {
    const read = text(cover({ position: null, positionError: 'No pudimos cargar esto.' }))
    expect(read).toContain('No pudimos cargar esto.')
    expect(read).toContain('Reintentar')
    expect(read).not.toContain('$ 0')
  })

  it('la contadora solo puede exportar: ni pagar, ni cargar, ni editar', () => {
    ui.readOnly = true
    const out = cover({ party: bare(), canWrite: false })
    const read = text(out)
    expect(read).toContain('Solo lectura')
    expect(read).toContain('Exportar su libreta de este año')
    expect(read).not.toContain('Pagarle')
    expect(read).not.toContain('Cargarle una compra')
    // Lo que falta se lee como falta, sin «＋» para tocar.
    expect(read).toContain('Sin categoría')
    expect(read).toContain('Sin datos de cómo factura')
    expect(read).toContain('Sin plazo')
    expect(out.split('<button').length - 1).toBe(1)
  })

  it('un nombre de 60 caracteres con fantasía y nueve cifras', () => {
    const long = 'Distribuidora Mayorista de Bebidas y Alimentos del Centro SA'
    const read = text(
      cover({
        party: party({ name: long, tradeName: 'La Mayorista' }),
        position: position([item({ amountCents: 99_999_999_900, openCents: 99_999_999_900 })]),
      }),
    )
    expect(read).toContain('La Mayorista')
    expect(read).toContain(long)
    expect(read).toContain('999.999.999')
  })
})

function owed(canWrite: boolean, pos: PartyPosition) {
  return html(
    createElement(PendingTab, {
      tenantSlug: SLUG,
      partyId: PARTY_ID,
      position: pos,
      pairs: [{ debitLineId: 'c1', creditLineId: 'l1', amountCents: 6_050_000 }],
      today: TODAY,
      canWrite,
    }),
  )
}

describe('«Lo que le debés»', () => {
  it('una compra por renglón, con su vencimiento en el margen y [Pagar]', () => {
    const read = text(owed(true, position(THREE, [CREDIT])))
    expect(read).toContain('Lo que le debés')
    expect(read).toContain('vencido hace 12 días')
    expect(read).toContain('vence en 5 días')
    expect(read).toContain('vence el 20/11')
    expect(read).toContain('de $ 1.000.000')
    expect(read).toContain('Total: le debés $ 3.336.600')
    expect(read).toContain('Pagar')
    expect(read).toContain('A tu favor')
    expect(read).toContain('Usarlo ahora')
  })

  it('una compra sin factura se debe igual', () => {
    const read = text(owed(true, position(THREE)))
    expect(read).toContain('Remito u otro comprobante (sin factura)')
    expect(read).toContain('$ 1.352.200')
  })

  it('sin deuda no se dibuja: la tapa ya dice «No le debés nada» y trae la acción', () => {
    // Tres «nada» apilados y dos botones principales iguales: el panel no va.
    expect(owed(true, position([]))).toBe('')
    // Sin deuda pero con algo a favor: el panel es solo eso, sin «Lo que le debés» ni carga.
    const onlyCredit = text(owed(true, position([], [CREDIT])))
    expect(onlyCredit).toContain('A tu favor')
    expect(onlyCredit).toContain('Se descuenta sola en el próximo pago.')
    expect(onlyCredit).not.toContain('Lo que le debés')
    expect(onlyCredit).not.toContain('Cargarle una compra')
    expect(onlyCredit).not.toContain('$ 0')
  })

  it('la contadora ve los renglones sin ningún botón', () => {
    ui.readOnly = true
    const withDebt = owed(false, position(THREE, [CREDIT]))
    expect(text(withDebt)).toContain('vencido hace 12 días')
    expect(withDebt).not.toContain('<button')
    expect(text(withDebt)).not.toContain('Usarlo ahora')
    const empty = owed(false, position([]))
    expect(empty).not.toContain('<button')
    expect(empty).not.toContain('compras/nueva')
  })
})

describe('«Sus datos»', () => {
  const data = (canWrite: boolean, p: PartyDetail) =>
    html(
      createElement(DataTab, {
        tenantSlug: SLUG,
        party: p,
        canWrite,
        hasBalance: false,
      }),
    )

  it('los teléfonos se pueden tocar y los días de entrega son la semana', () => {
    const out = data(
      true,
      party({
        phone: '351 555-1234',
        contacts: [{ name: 'Lucía', role: 'Vendedora', phone: null, email: 'lucia@demo.test' }],
        deliveryDays: [1, 4],
        orderLeadDays: 2,
      }),
    )
    expect(out).toContain('href="tel:3515551234"')
    expect(out).toContain('href="mailto:lucia@demo.test"')
    const read = text(out)
    for (const title of ['Para pedirle', 'Para cargarle', 'Datos fiscales']) {
      expect(read).toContain(title)
    }
    expect(read).toContain('Trae los lunes, jueves.')
    expect(read).toContain('Hay que pedirle 2 días antes.')
    expect(read).toContain('Bebidas sin alcohol')
  })

  it('lo que falta se lee como falta, no como una raya', () => {
    const read = text(data(true, bare()))
    expect(read).toContain('Sin teléfono cargado')
    expect(read).toContain('Todavía no dijiste qué días trae')
    expect(read).toContain('Sin categoría')
    expect(read).toContain('Sin plazo')
    expect(read).toContain('Todavía no sabemos')
    expect(read).not.toContain('—')
  })

  it('la contadora no ve Editar, Desactivar ni Eliminar', () => {
    ui.readOnly = true
    const out = data(false, party())
    expect(out).not.toContain('<button')
    const read = text(out)
    for (const word of ['Editar datos', 'Desactivar', 'Eliminar']) expect(read).not.toContain(word)
  })
})

describe('los renglones de tres columnas', () => {
  const ledger = supplierLedger({
    rows: STATEMENT,
    from: '2026-07-16',
    to: TODAY,
    openingCents: 0,
    hasMore: false,
    today: TODAY,
  })
  const out = html(createElement(LedgerLines, { tenantSlug: SLUG, ledger }))
  const read = text(out)

  it('las tres palabras de la libreta y cada movimiento con su verbo', () => {
    for (const word of ['Te dejó', 'Le pagaste', 'Le debés']) expect(read).toContain(word)
    expect(read).toContain('Al 15/07 no le debías nada')
    expect(read).toContain('Te descontó')
    expect(read).toContain('vencida hace 12 días')
    expect(read).toContain('Hoy le debés')
    expect(read).toContain('$ 3.276.100')
  })

  it('cada comprobante lleva a su ficha', () => {
    expect(out).toContain('/hub/administracion/comprobantes/00000000-0000-4000-8000-0000000000d1')
  })

  it('en angosto el importe va con su signo (el sentido no depende del color)', () => {
    expect(read).toContain('+ $ 1.210.000')
    expect(read).toContain('− $ 500.000')
  })
})
