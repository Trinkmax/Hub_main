import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agingMath,
  agingTranches,
  documentText,
  ledgerTrendTitle,
  ledgerVerb,
  statementBalancePoints,
  supplierBalanceItem,
  supplierCategoryText,
  supplierLedger,
  supplierTermText,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/supplier-ledger'
import { DataTab } from '@/app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/data-tab'
import { PendingTab } from '@/app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/pending-tab'
import { StatementTab } from '@/app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/statement-tab'
import { SupplierHead } from '@/app/(manager)/[tenantSlug]/administracion/compras/proveedores/[id]/_components/supplier-head'
import { agingSummary, trafficLight } from '@/lib/accounting/aging'
import type {
  OpenItemRow,
  PartyDetail,
  PartyPosition,
  PartyStatementRow,
} from '@/lib/accounting/queries/parties'

/**
 * La cuenta corriente de un proveedor: qué dice su totalizador (Saldo · Plazo ·
 * Va a), la tabla de siempre (Fecha · Comprobante · Vence · Debe · Haber · Saldo)
 * y la escalera de la deuda. Y ya dibujada: sin deuda no hay «$ 0» y la contadora
 * no recibe ningún botón de carga, de pago ni de edición.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
const reads = vi.hoisted(() => ({ getPartyStatement: vi.fn() }))
vi.mock('@/lib/accounting/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/queries')>()),
  getPartyStatement: reads.getPartyStatement,
}))
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

// Los «⋯» se dibujan abiertos: lo que importa es qué ofrecen a cada uno.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: Pass,
  }
})

afterEach(() => {
  ui.readOnly = false
  reads.getPartyStatement.mockReset()
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

describe('el totalizador: el saldo y su tono', () => {
  const base = { debtCents: 0, creditCents: 0, overdueCents: 0, dueSoonCents: 0 }

  it('con deuda: el tono dice qué tan urgente es, y lo que hay a favor va aparte', () => {
    expect(
      supplierBalanceItem({
        ...base,
        debtCents: 333_660_000,
        overdueCents: 121_000_000,
        creditCents: 6_050_000,
      }),
    ).toMatchObject({ label: 'Saldo', cents: 333_660_000, tone: 'bad' })
    expect(
      plain(String(supplierBalanceItem({ ...base, debtCents: 100, creditCents: 6_050_000 }).hint)),
    ).toBe('$ 60.500 a favor')
    expect(supplierBalanceItem({ ...base, debtCents: 100, dueSoonCents: 100 }).tone).toBe('warn')
    expect(supplierBalanceItem({ ...base, debtCents: 100 }).tone).toBe('default')
  })

  it('sin deuda con algo a favor, y sin nada: nunca «$ 0»', () => {
    expect(supplierBalanceItem({ ...base, creditCents: 6_050_000 })).toEqual({
      label: 'A favor',
      cents: 6_050_000,
      tone: 'ok',
    })
    expect(supplierBalanceItem(base)).toEqual({ label: 'Saldo', text: 'Al día', tone: 'ok' })
  })

  it('sin los saldos iniciales, «al día» es por lo cargado: no se promete', () => {
    const item = supplierBalanceItem({ ...base, openingPending: true })
    expect(item.text).toBe('Sin deuda cargada')
    expect(item.hint).toBe('Faltan los saldos iniciales')
    expect(item.tone).toBeUndefined()
    // Con deuda no cambia nada: el número es el número.
    expect(supplierBalanceItem({ ...base, debtCents: 100, openingPending: true }).cents).toBe(100)
  })

  it('el plazo y a dónde van sus compras, con las palabras del dueño', () => {
    expect(supplierTermText(21)).toBe('21 días')
    expect(supplierTermText(1)).toBe('1 día')
    expect(supplierTermText(0)).toBe('Sin plazo')
    expect(supplierCategoryText('Compras: bebidas sin alcohol')).toBe('Bebidas sin alcohol')
    expect(supplierCategoryText(null)).toBeNull()
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

describe('cómo se nombra su documento', () => {
  it('un DNI se nombra como DNI; sin documento, nada', () => {
    expect(documentText('cuit', '30701112225')).toBe('CUIT 30-70111222-5')
    expect(documentText('dni', '30123456')).toBe('DNI 30123456')
    expect(documentText('cuil', '20123456786')).toBe('CUIL 20-12345678-6')
    expect(documentText('none', null)).toBeNull()
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

describe('los movimientos', () => {
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

function head(patch: Partial<Parameters<typeof SupplierHead>[0]> = {}) {
  return html(
    createElement(SupplierHead, {
      tenantSlug: SLUG,
      party: party(),
      position: position(THREE, [CREDIT]),
      positionError: null,
      canWrite: true,
      canPickCategory: false,
      baseHref: `/hub/administracion/compras/proveedores/${PARTY_ID}`,
      ficha: false,
      exportHref: '/api/x',
      exportFileName: 'x.csv',
      ...patch,
    }),
  )
}

describe('arriba de la cuenta corriente', () => {
  it('el nombre en Fraunces, Saldo · Plazo · Va a, y [Ficha] [Compra] [Pagar]', () => {
    const out = head()
    const read = text(out)
    expect(out).toContain('<h1')
    expect(out).toContain('font-serif')
    expect(read).toContain('Distribuidora de Bebidas Demo SA')
    for (const label of ['Saldo', 'Plazo', 'Va a']) expect(read).toContain(label)
    expect(read).toContain('3.336.600')
    expect(read).toContain('21 días')
    expect(read).toContain('Bebidas sin alcohol')
    for (const action of ['Ficha', 'Compra', 'Pagar']) expect(read).toContain(action)
    expect(read).toContain('Proveedores')
    // Lo de cada tanto, en el ⋯.
    expect(read).toContain('Compra y pago')
    expect(read).toContain('Me hizo una nota de crédito')
    expect(read).toContain('Exportar su cuenta de este año')
    // La tapa verde y sus oraciones ya no están.
    expect(out).not.toContain('adm-hero')
    expect(read).not.toContain('¿Cómo se calcula?')
  })

  it('«Ficha» abre `?tab=datos`, y desde ahí se vuelve a la cuenta', () => {
    expect(head()).toContain(`/hub/administracion/compras/proveedores/${PARTY_ID}?tab=datos`)
    const ficha = head({ ficha: true })
    expect(text(ficha)).toContain('Cuenta corriente')
    expect(ficha).not.toContain('?tab=datos')
  })

  it('el proveedor típico de un bar que arranca: sin «$ 0» y con «Compra»', () => {
    const read = text(head({ party: bare(), position: position([]) }))
    expect(read).toContain('Al día')
    expect(read).toContain('Sin plazo')
    expect(read).toContain('Sin categoría')
    expect(read).not.toContain('$ 0')
    expect(read).toContain('Compra')
  })

  it('HUB sin saldos iniciales: no promete «al día»', () => {
    const read = text(head({ party: bare(), position: position([]), openingPending: true }))
    expect(read).toContain('Sin deuda cargada')
    expect(read).toContain('Faltan los saldos iniciales')
    expect(read).not.toContain('Al día')
  })

  it('si no se pudo leer cuánto se le debe, lo dice y deja reintentar', () => {
    const read = text(head({ position: null, positionError: 'No pudimos cargar esto.' }))
    expect(read).toContain('No pudimos cargar esto.')
    expect(read).toContain('Reintentar')
    expect(read).not.toContain('$ 0')
  })

  it('la contadora solo puede exportar: ni pagar, ni cargar, ni editar', () => {
    ui.readOnly = true
    const out = head({ party: bare(), canWrite: false })
    const read = text(out)
    expect(read).toContain('Solo lectura')
    expect(read).toContain('Exportar su cuenta de este año')
    expect(read).toContain('Ficha')
    expect(read).not.toContain('Pagar')
    expect(read).not.toContain('Compra')
    // Lo que falta se lee como falta, sin nada para tocar.
    expect(read).toContain('Sin categoría')
    expect(read).toContain('Sin plazo')
    expect(out.split('<button').length - 1).toBe(1)
  })

  it('un nombre de 60 caracteres con fantasía y nueve cifras', () => {
    const long = 'Distribuidora Mayorista de Bebidas y Alimentos del Centro SA'
    const read = text(
      head({
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
  it('una compra por fila, con su vencimiento, [Pagar] y la doble raya', () => {
    const out = owed(true, position(THREE, [CREDIT]))
    const read = text(out)
    expect(read).toContain('Lo que le debés')
    for (const head of ['Comprobante', 'Del', 'Vence', 'Falta']) expect(read).toContain(head)
    expect(read).toContain('vencido hace 12 días')
    expect(read).toContain('vence en 5 días')
    expect(read).toContain('vence el 20/11')
    expect(read).toContain('de un total de $ 1.000.000')
    expect(read).toContain('Total $ 3.336.600')
    expect(out).toContain('adm-double-rule')
    expect(read).toContain('Pagar')
    expect(read).toContain('A tu favor')
    expect(read).toContain('Usarlo ahora')
  })

  it('[Pagar] de una fila abre el pago con ESA compra tildada', () => {
    const out = owed(true, position(THREE))
    expect(out).toContain('Pagar Factura A 0003-00001100')
  })

  it('los tramos de antigüedad quedan al pie, con lo que suman', () => {
    const read = text(owed(true, position(THREE)))
    expect(read).toContain('Vencido de 1 a 30 días: $ 1.210.000')
    expect(read).toContain('Vence esta semana: $ 1.352.200')
    expect(read).toContain('Más adelante: $ 774.400')
  })

  it('una compra sin factura se debe igual', () => {
    const read = text(owed(true, position(THREE)))
    expect(read).toContain('Remito u otro comprobante (sin factura)')
    expect(read).toContain('$ 1.352.200')
  })

  it('sin deuda no se dibuja: el totalizador ya lo dice', () => {
    expect(owed(true, position([]))).toBe('')
    // Sin deuda pero con algo a favor: solo eso, sin «Lo que le debés» ni carga.
    const onlyCredit = text(owed(true, position([], [CREDIT])))
    expect(onlyCredit).toContain('A tu favor')
    expect(onlyCredit).toContain('Se descuenta sola en el próximo pago.')
    expect(onlyCredit).not.toContain('Lo que le debés')
    expect(onlyCredit).not.toContain('Usarlo ahora')
    expect(onlyCredit).not.toContain('$ 0')
  })

  it('la contadora ve las filas sin ningún botón', () => {
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

describe('la tabla de la cuenta corriente', () => {
  const page = (rows: PartyStatementRow[], patch: Record<string, unknown> = {}) => ({
    rows,
    nextCursor: null,
    totalRows: rows.length,
    from: '2026-07-16',
    to: TODAY,
    openingCents: 0,
    ...patch,
  })
  const statement = async (
    canWrite: boolean,
    patch: Partial<Parameters<typeof StatementTab>[0]> = {},
  ) =>
    html(
      await StatementTab({
        tenantId: 't-1',
        tenantSlug: SLUG,
        partyId: PARTY_ID,
        partyName: 'Distribuidora de Bebidas Demo SA',
        baseHref: `/hub/administracion/compras/proveedores/${PARTY_ID}`,
        sp: {},
        today: TODAY,
        canWrite,
        unusedCreditCents: 0,
        ...patch,
      }),
    )

  it('Fecha · Comprobante · Vence · Debe · Haber · Saldo, con centavos y doble raya', async () => {
    reads.getPartyStatement.mockResolvedValue(page(STATEMENT))
    const out = await statement(true)
    const read = text(out)
    for (const head of ['Fecha', 'Comprobante', 'Vence', 'Debe', 'Haber', 'Saldo']) {
      expect(read).toContain(head)
    }
    // Lo que te dejó va al Haber; lo que le pagaste, al Debe.
    expect(read).toContain('$ 1.210.000,00')
    expect(read).toContain('$ 500.000,00')
    expect(read).toContain('$ 3.276.100,00')
    expect(read).toContain('Saldo al 15/07/2026')
    expect(out).toContain('adm-double-rule')
    // Lo que ya venció va en rojo, y cada fila lleva a su comprobante.
    expect(out).toContain('text-destructive')
    expect(out).toContain('/hub/administracion/comprobantes/00000000-0000-4000-8000-0000000000d1')
    // La escalera queda plegada debajo, con la misma plata.
    expect(read).toContain('Ver cómo fue la deuda')
    expect(read).toContain('le pasaste a deber')
  })

  it('con algo a favor sin usar, el saldo de la tabla lo aclara', async () => {
    reads.getPartyStatement.mockResolvedValue(page(STATEMENT))
    const read = text(await statement(true, { unusedCreditCents: 6_050_000 }))
    expect(read).toContain('ya restado $ 60.500 a favor')
  })

  it('un saldo a favor se dice con palabras, nunca con un menos pelado', async () => {
    reads.getPartyStatement.mockResolvedValue(
      page([line({ runningBalanceCents: -6_050_000, increaseCents: 0, decreaseCents: 6_050_000 })]),
    )
    const read = text(await statement(true))
    expect(read).toContain('A favor $ 60.500,00')
    expect(read).not.toContain('−$ 60.500')
  })

  it('si la lista sigue, ofrece los siguientes y no inventa un saldo final', async () => {
    reads.getPartyStatement.mockResolvedValue(
      page(STATEMENT, { nextCursor: 'cursor', totalRows: 300 }),
    )
    const out = await statement(true)
    expect(text(out)).toContain('Ver los siguientes')
    expect(text(out)).toContain('Ves 4 de 300 movimientos')
    expect(out).not.toContain('adm-double-rule')
  })

  it('sin movimientos: una oración, y el primer paso solo para quien carga', async () => {
    reads.getPartyStatement.mockResolvedValue(page([]))
    const owner = text(await statement(true))
    expect(owner).toContain('No hubo movimientos en los últimos 90 días')
    expect(owner).toContain('Cargar una compra')
    expect(owner).not.toContain('$ 0')

    ui.readOnly = true
    const accountant = await statement(false)
    expect(text(accountant)).toContain('No hubo movimientos')
    expect(accountant).not.toContain('compras/nueva')
  })

  it('si no se pudo leer, lo dice adentro de la hoja y deja reintentar', async () => {
    reads.getPartyStatement.mockRejectedValue(new Error('boom'))
    const read = text(await statement(true))
    expect(read).toContain('No pudimos cargar esto')
    expect(read).toContain('Reintentar')
  })
})
