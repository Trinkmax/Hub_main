import { describe, expect, it } from 'vitest'
import { documentActions } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-view'
import { agingSummary, trafficLight } from '@/lib/accounting/aging'
import type {
  DocumentDetail,
  DocumentLineDetail,
  DocumentListPage,
  DocumentListRow,
  EntryDetail,
} from '@/lib/accounting/queries/documents'
import type {
  OpenItemRow,
  PartyDetail,
  PartyList,
  PartyListRow,
  PartyPosition,
} from '@/lib/accounting/queries/parties'
import type { WeekPlanRow } from '@/lib/accounting/week-plan'
import {
  DOCUMENT_TYPE_FILTER,
  debtRow,
  debtsData,
  documentData,
  documentRow,
  documentsData,
  documentTotals,
  openItemRow,
  partyCard,
  partyData,
  partyOptionRow,
  voidingData,
  weekPlanData,
  weekPlanRow,
} from '@/lib/tex/tools/read/compras'

const TODAY = '2026-11-05'

function party(over: Partial<PartyDetail> = {}): PartyDetail {
  return {
    id: 'coca',
    kind: 'supplier',
    name: 'Coca-Cola FEMSA SA',
    tradeName: 'Coca',
    taxIdType: 'cuit',
    taxId: '30111111112',
    ivaCondition: 'responsable_inscripto',
    email: 'cobranzas@coca.test',
    phone: '351 555-5555',
    address: 'Calle Falsa 123',
    paymentTermDays: 30,
    defaultAccountId: 'cuenta-bebidas',
    defaultAccountName: 'Bebidas',
    defaultVoucherType: 'factura_a',
    payableAccountId: 'prov',
    payableAccountName: 'Proveedores',
    receivableAccountId: 'cli',
    receivableAccountName: 'Clientes',
    commissionVatMode: 'none',
    commissionBp: null,
    iibbWithholdingBp: null,
    vatWithholdingBp: null,
    incomeTaxWithholdingBp: null,
    sircupaBp: null,
    notes: 'Llamar a Juan Pérez al 351 444-4444',
    active: true,
    systemKey: null,
    contacts: [{ name: 'Juan Pérez', phone: '351 444-4444' }] as PartyDetail['contacts'],
    deliveryDays: [1, 7],
    orderLeadDays: 2,
    updatedAt: '2026-10-01T00:00:00Z',
    group: 'payables',
    ...over,
  }
}

function item(over: Partial<OpenItemRow> = {}): OpenItemRow {
  return {
    lineId: 'linea-1',
    documentId: 'doc-1',
    documentSeq: 12,
    documentKind: 'purchase',
    documentLabel: 'Factura A 0003-00001234',
    accountId: 'prov',
    accountCode: '2.1',
    accountName: 'Proveedores',
    side: 'debt',
    salesMethodId: null,
    entryDate: '2026-10-01',
    dueDate: '2026-10-20',
    memo: null,
    amountCents: 100_000_00,
    openCents: 40_000_00,
    daysOverdue: 16,
    bucket: 'overdue_1_30',
    ...over,
  }
}

function position(over: Partial<PartyPosition> = {}): PartyPosition {
  const debtItems = over.debtItems ?? [item()]
  const items = debtItems.map((i) => ({ dueDate: i.dueDate, openCents: i.openCents }))
  const creditItems = over.creditItems ?? []
  const creditCents = creditItems.reduce((sum, i) => sum + i.openCents, 0)
  const debtCents = debtItems.reduce((sum, i) => sum + i.openCents, 0)
  return {
    partyId: 'coca',
    group: 'payables',
    asOf: TODAY,
    debtCents,
    creditCents,
    netCents: debtCents - creditCents,
    aging: agingSummary(items, TODAY),
    traffic: trafficLight({ items, creditCents, asOf: TODAY, group: 'payables' }),
    debtItems,
    creditItems,
    ...over,
  }
}

describe('buscar_participe', () => {
  it('con su id y lo que hace falta para desambiguar', () => {
    expect(
      partyOptionRow({
        id: 'coca',
        name: 'Coca-Cola FEMSA SA',
        tradeName: 'Coca',
        kind: 'supplier',
        taxId: '30111111112',
        ivaCondition: 'responsable_inscripto',
        active: false,
        systemKey: null,
        paymentTermDays: 0,
        defaultAccountId: null,
      }),
    ).toEqual({
      id: 'coca',
      nombre: 'Coca-Cola FEMSA SA',
      fantasia: 'Coca',
      tipo: 'Proveedor',
      cuit: '30111111112',
      inactivo: true,
    })
  })
})

describe('ver_participe', () => {
  it('una partida abierta, con el id para pagar', () => {
    expect(openItemRow(item())).toEqual({
      partida_id: 'linea-1',
      comprobante_id: 'doc-1',
      comprobante: 'Factura A 0003-00001234',
      fecha: '01/10/2026',
      vence: '20/10/2026',
      dias_vencido: 16,
      total: '$ 100.000',
      falta: '$ 40.000',
    })
  })

  it('lo que todavía no venció no dice días de atraso', () => {
    expect(openItemRow(item({ daysOverdue: -3 })).dias_vencido).toBeUndefined()
    expect(openItemRow(item({ daysOverdue: null, dueDate: null })).vence).toBeUndefined()
  })

  it('la ficha, con los días de entrega en palabras', () => {
    expect(partyCard(party())).toEqual({
      id: 'coca',
      nombre: 'Coca-Cola FEMSA SA',
      fantasia: 'Coca',
      tipo: 'Proveedor',
      cuit: '30111111112',
      condicion_iva: 'Responsable inscripto',
      plazo_de_pago_dias: 30,
      categoria: 'Bebidas',
      categoria_id: 'cuenta-bebidas',
      comprobante_habitual: 'Factura A',
      dias_de_entrega: ['lun', 'dom'],
      pedir_con_dias_de_anticipacion: 2,
    })
  })

  it('nunca lleva los datos personales de nadie (CLAUDE.md §9)', () => {
    const text = JSON.stringify(partyData(party(), position()))
    for (const secret of ['351', 'Juan', 'cobranzas', 'Falsa']) {
      expect(text).not.toContain(secret)
    }
  })

  it('saldo, vencido y lo abierto', () => {
    const data = partyData(party(), position())
    expect(data.saldo).toMatchObject({
      lado: 'le debés',
      debe: '$ 40.000',
      neto: '$ 40.000',
      vencido: '$ 40.000',
    })
    expect(data.saldo.estado).not.toContain(' ')
    expect(data.abiertos).toEqual({ filas: [openItemRow(item())], hay_mas: false })
    expect(data).not.toHaveProperty('a_favor_sin_aplicar')
  })

  it('un cliente se lee del otro lado, y lo a favor va aparte', () => {
    const data = partyData(
      party({ kind: 'customer', group: 'receivables' }),
      position({
        group: 'receivables',
        creditItems: [item({ lineId: 'nc', side: 'credit', openCents: 5_000_00 })],
      }),
    )
    expect(data.saldo).toMatchObject({ lado: 'te debe', a_favor: '$ 5.000', neto: '$ 35.000' })
    expect(data.a_favor_sin_aplicar?.filas[0]?.partida_id).toBe('nc')
  })

  it('una lista larga se corta y lo dice', () => {
    const many = Array.from({ length: 50 }, (_, i) => item({ lineId: `l${i}` }))
    const data = partyData(party(), position({ debtItems: many }))
    expect(data.abiertos.filas).toHaveLength(40)
    expect(data.abiertos.hay_mas).toBe(true)
  })

  it('con las dos listas llenas entra entero en el tope del ciclo', () => {
    const uuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
    const many = Array.from({ length: 80 }, () =>
      item({
        lineId: uuid,
        documentId: uuid,
        documentLabel: 'Nota de crédito de proveedor 0003-00001234',
      }),
    )
    const data = partyData(party(), position({ debtItems: many, creditItems: many }))
    expect(data.abiertos.hay_mas).toBe(true)
    expect(data.a_favor_sin_aplicar?.hay_mas).toBe(true)
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })
})

function partyRow(over: Partial<PartyListRow> = {}): PartyListRow {
  return {
    partyId: 'coca',
    partyName: 'Coca-Cola FEMSA SA',
    partyKind: 'supplier',
    taxId: null,
    tradeName: 'Coca',
    active: true,
    systemKey: null,
    debtCents: 100_00,
    creditCents: 0,
    netCents: 100_00,
    notDueCents: 0,
    dueSoonCents: 0,
    overdue1to30Cents: 0,
    overdue31to60Cents: 0,
    overdue60PlusCents: 0,
    noDueCents: 0,
    overdueCents: 0,
    oldestDueDate: null,
    nextDueDate: null,
    lastIncreaseDate: null,
    trafficLight: 'green',
    trafficText: 'Al día',
    ...over,
  }
}

describe('ver_deudas', () => {
  it('una fila, con el nombre con el que lo conocen', () => {
    expect(
      debtRow(
        partyRow({
          overdueCents: 40_00,
          dueSoonCents: 60_00,
          oldestDueDate: '2026-10-20',
          nextDueDate: '2026-11-10',
          trafficText: 'Vencida hace 16 días',
        }),
      ),
    ).toEqual({
      id: 'coca',
      nombre: 'Coca',
      tipo: 'Proveedor',
      debe: '$ 100',
      vencido: '$ 40',
      vence_pronto: '$ 60',
      vencido_mas_viejo: '20/10/2026',
      proximo_vencimiento: '10/11/2026',
      estado: 'Vencida hace 16 días',
    })
  })

  function list(rows: PartyListRow[]): PartyList {
    return {
      rows,
      asOf: TODAY,
      totals: {
        debtCents: rows.reduce((sum, r) => sum + r.debtCents, 0),
        overdueCents: rows.reduce((sum, r) => sum + r.overdueCents, 0),
        dueSoonCents: rows.reduce((sum, r) => sum + r.dueSoonCents, 0),
        creditCents: rows.reduce((sum, r) => sum + r.creditCents, 0),
        count: rows.length,
      },
    }
  }

  it('solo a quien se le debe, y los totales de cada pantalla', () => {
    const data = debtsData(
      list([
        partyRow({ partyId: 'coca', debtCents: 100_00, overdueCents: 100_00 }),
        partyRow({ partyId: 'arca', partyKind: 'tax_agency', debtCents: 50_00, tradeName: null }),
        partyRow({ partyId: 'saldado', debtCents: 0, creditCents: 10_00 }),
      ]),
    )
    expect(data).toMatchObject({
      total: '$ 150',
      vencido: '$ 100',
      a_favor: '$ 10',
      // Compras › Proveedores deja afuera a los organismos.
      de_proveedores: '$ 100',
      de_impuestos_y_sueldos: '$ 50',
      cuantos: 2,
      hay_mas: false,
    })
    expect(data.filas?.map((row) => row.id)).toEqual(['coca', 'arca'])
  })

  it('sin deudas, los totales en cero y una lista vacía', () => {
    const data = debtsData(list([]))
    expect(data).toMatchObject({ total: '$ 0', vencido: '$ 0', cuantos: 0, filas: [] })
  })
})

function row(over: Partial<DocumentListRow> = {}): DocumentListRow {
  return {
    id: 'doc-1',
    seq: 125,
    kind: 'purchase',
    title: 'Factura A 0003-00001290',
    voucherType: 'factura_a',
    pointOfSale: 3,
    number: 1290,
    partyId: 'coca',
    partyName: 'Coca',
    issueDate: '2026-11-01',
    accountingDate: '2026-11-02',
    dueDate: null,
    description: 'Bebidas',
    totalCents: 100_00,
    openCents: 40_00,
    paymentStatus: 'partial',
    status: 'posted',
    imputation: 'Mercadería',
    means: null,
    appliedTo: null,
    attachmentCount: 0,
    createdByName: 'Franco',
    createdAt: '2026-11-02T10:00:00Z',
    ...over,
  }
}

describe('buscar_comprobantes', () => {
  it('los tipos son solo de la base', () => {
    expect(DOCUMENT_TYPE_FILTER.compras_y_gastos).toContain('purchase')
    expect(DOCUMENT_TYPE_FILTER.facturas_de_venta).toEqual([
      'sales_invoice',
      'sales_credit_note',
      'sales_debit_note',
    ])
  })

  it('una fila chica, sin quién la cargó', () => {
    expect(documentRow(row())).toEqual({
      id: 'doc-1',
      numero: '#125',
      fecha: '02/11/2026',
      comprobante: 'Factura A 0003-00001290',
      participe: 'Coca',
      total: '$ 100',
      falta: '$ 40',
      estado: 'Pago parcial',
      cuenta: 'Mercadería',
      detalle: 'Bebidas',
    })
  })

  it('dice si es sin factura y si está anulado', () => {
    expect(documentRow(row({ voucherType: 'sin_comprobante' })).sin_factura).toBe(true)
    expect(documentRow(row({ status: 'voided', paymentStatus: 'voided' })).estado).toBe('Anulado')
    expect(documentRow(row({ paymentStatus: 'none', openCents: null })).estado).toBeUndefined()
  })

  const page = (
    rows: DocumentListRow[],
    over: Partial<DocumentListPage> = {},
  ): DocumentListPage => ({
    rows,
    nextCursor: null,
    totalRows: rows.length,
    truncated: false,
    ...over,
  })

  it('suma por tipo, sin los anulados: una compra no se suma con un pago', () => {
    expect(
      documentTotals(
        page([
          row(),
          row({ id: 'b', totalCents: 50_00, openCents: 0 }),
          row({ id: 'c', status: 'voided', totalCents: 999_00, openCents: null }),
          row({ id: 'd', kind: 'payment', totalCents: 30_00, openCents: null }),
        ]),
      ),
    ).toEqual([
      { tipo: 'Compra', cuantos: 2, total: '$ 150', falta: '$ 40' },
      { tipo: 'Pago', cuantos: 1, total: '$ 30' },
    ])
  })

  it('un total de una parte se leería como verdadero: sin leer todo, no hay total', () => {
    expect(documentTotals(page([row()], { totalRows: 500 }))).toBeNull()
    expect(documentTotals(page([row()], { truncated: true }))).toBeNull()
  })

  it('muestra 40 pero suma todos los que leyó', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row({ id: `d${i}`, openCents: 0 }))
    const data = documentsData(page(rows), 'Noviembre 2026')
    expect(data.filas).toHaveLength(40)
    expect(data).toMatchObject({
      cuantos: 60,
      hay_mas: true,
      totales: [{ tipo: 'Compra', cuantos: 60, total: '$ 6.000' }],
    })
    expect(data.nota).toBeUndefined()
  })

  it('con textos largos entra entero en el tope del ciclo', () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      row({
        id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        kind: i % 2 === 0 ? 'purchase' : 'purchase_credit_note',
        title: 'Nota de crédito de proveedor 0003-00001234',
        partyName: 'Distribuidora de bebidas del centro SRL',
        description: 'Un detalle bien largo del comprobante que se repite y se repite y se repite',
        imputation: 'Una cuenta con un nombre largo',
      }),
    )
    const data = documentsData(page(rows), 'Noviembre 2026')
    expect(data.filas?.length).toBeLessThan(40)
    expect(data.hay_mas).toBe(true)
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })

  it('si son demasiados, lo dice en vez de sumar a medias', () => {
    const data = documentsData(page([row()], { totalRows: 900 }), 'Noviembre 2026')
    expect(data.totales).toBeUndefined()
    expect(data.nota).toContain('demasiados')
  })
})

function line(over: Partial<DocumentLineDetail> = {}): DocumentLineDetail {
  return {
    id: 'renglon-1',
    lineNo: 1,
    role: 'net',
    roleLabel: 'Neto 21 %',
    accountId: 'merca',
    accountCode: '5.1',
    accountName: 'Mercadería',
    side: 'debit',
    amountCents: 80_00,
    partyId: null,
    partyName: null,
    dueDate: null,
    treasuryAccountId: null,
    treasuryName: null,
    salesMethodId: null,
    salesMethodName: null,
    vatRateBp: 2100,
    baseCents: null,
    taxKind: null,
    channel: null,
    certificateNumber: null,
    reference: null,
    memo: null,
    ...over,
  }
}

const entry: EntryDetail = {
  id: 'asiento-1',
  documentId: 'doc-1',
  kind: 'standard',
  entryDate: '2026-11-02',
  number: null,
  provisionalNumber: 44,
  description: 'Compra',
  totalCents: 100_00,
  status: 'posted',
  isMirror: false,
  periodId: 'p',
  periodStatus: 'open',
  createdByName: 'Franco',
  createdAt: '2026-11-02T10:00:00Z',
  voidedAt: null,
  voidedByName: null,
  voidReason: null,
  document: null,
  lines: [
    {
      id: 'j1',
      lineNo: 1,
      accountId: 'merca',
      accountCode: '5.1',
      accountName: 'Mercadería',
      side: 'debit',
      amountCents: 100_00,
      partyId: null,
      partyName: null,
      dueDate: null,
      memo: null,
      openCents: null,
    },
    {
      id: 'j2',
      lineNo: 2,
      accountId: 'prov',
      accountCode: '2.1',
      accountName: 'Proveedores',
      side: 'credit',
      amountCents: 100_00,
      partyId: 'coca',
      partyName: 'Coca',
      dueDate: null,
      memo: null,
      openCents: 40_00,
    },
  ],
  debitCents: 100_00,
  creditCents: 100_00,
}

function detail(over: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: 'doc-1',
    seq: 125,
    bundleId: 'b',
    kind: 'purchase',
    title: 'Factura A 0003-00001290',
    voucherType: 'factura_a',
    afipVoucherCode: 1,
    pointOfSale: 3,
    number: 1290,
    partyId: 'coca',
    partyName: 'Coca',
    partyDocNumber: '30111111112',
    partyIvaCondition: 'responsable_inscripto',
    issueDate: '2026-11-01',
    accountingDate: '2026-11-02',
    dueDate: '2026-12-01',
    shift: null,
    description: 'Bebidas',
    notes: null,
    totalCents: 100_00,
    countedCents: null,
    expectedBookCents: null,
    settlesCommissions: false,
    recurringExpenseId: null,
    warningsAck: [],
    overrideReason: null,
    status: 'posted',
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
    createdByName: 'Franco',
    createdAt: '2026-11-02T10:00:00Z',
    period: { id: 'p', month: '2026-11-01', kind: 'month', status: 'open' },
    lines: [line()],
    fiscalVouchers: [],
    entry,
    openCents: 40_00,
    paymentStatus: 'partial',
    allocations: [
      {
        id: 'a1',
        kind: 'payment',
        amountCents: 60_00,
        appliedOn: '2026-11-03',
        voidedOn: null,
        otherDocumentId: 'pago-1',
        otherDocumentTitle: 'Pago',
        otherDocumentSeq: 130,
        createdByName: 'Franco',
        createdAt: '2026-11-03T10:00:00Z',
      },
      {
        id: 'a2',
        kind: 'payment',
        amountCents: 10_00,
        appliedOn: '2026-11-03',
        voidedOn: '2026-11-04',
        otherDocumentId: 'pago-viejo',
        otherDocumentTitle: 'Pago',
        otherDocumentSeq: 129,
        createdByName: 'Franco',
        createdAt: '2026-11-03T10:00:00Z',
      },
    ],
    bundleSiblings: [],
    related: null,
    replaces: null,
    replacedBy: null,
    reverses: null,
    reversedBy: null,
    corrects: null,
    undoUntil: '2026-11-02T10:10:00.000Z',
    ...over,
  }
}

const NOW = Date.parse('2026-11-05T12:00:00Z')
const FACTS = {
  canWrite: true,
  arcaEmitted: false,
  arcaSibling: null,
  reimputable: new Map([['renglon-1', { usual: 'Bebidas' }]]),
  nowMs: NOW,
}

describe('ver_comprobante', () => {
  it('sus renglones con su id y lo que se puede reimputar', () => {
    const data = documentData(detail(), FACTS)
    expect(data.renglones).toEqual([
      {
        renglon_id: 'renglon-1',
        que: 'Neto 21 %',
        cuenta: '5.1 Mercadería',
        cuenta_id: 'merca',
        lado: 'Debe',
        importe: '$ 80',
        reimputable: true,
        cuenta_habitual: 'Bebidas',
      },
    ])
    expect(data.reimputar).toBeUndefined()
  })

  it('su asiento, en líneas cortas y con el número provisorio', () => {
    expect(documentData(detail(), FACTS).asiento).toEqual({
      id: 'asiento-1',
      numero: 44,
      provisorio: true,
      fecha: '02/11/2026',
      lineas: ['D 5.1 Mercadería $ 100', 'H 2.1 Proveedores · Coca $ 100'],
    })
  })

  it('lo aplicado vigente, no lo desaplicado', () => {
    expect(documentData(detail(), FACTS).aplicado).toEqual([
      { comprobante: 'Pago', comprobante_id: 'pago-1', fecha: '03/11/2026', importe: '$ 60' },
    ])
  })

  it('un comprobante enorme entra entero en el tope del ciclo, y dice que hay más', () => {
    const uuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
    const firstLine = entry.lines[0]
    if (!firstLine) throw new Error('sin línea')
    const data = documentData(
      detail({
        lines: Array.from({ length: 80 }, () =>
          line({ id: uuid, accountId: uuid, treasuryName: 'Banco de la Nación Argentina' }),
        ),
        entry: { ...entry, lines: Array.from({ length: 80 }, () => firstLine) },
      }),
      FACTS,
    )
    expect(data.renglones_hay_mas).toBe(true)
    expect(data.asiento?.lineas_hay_mas).toBe(true)
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })

  it('sin quién lo cargó ni el CUIT, que está en su ficha', () => {
    const text = JSON.stringify(documentData(detail(), FACTS))
    expect(text).not.toContain('Franco')
    expect(text).not.toContain('30111111112')
  })

  it('dice si está en un mes cerrado, y entonces no se reimputa', () => {
    const data = documentData(
      detail({ period: { id: 'p', month: '2026-10-01', kind: 'month', status: 'closed' } }),
      FACTS,
    )
    expect(data.mes).toEqual({ mes: '2026-10', abierto: false })
    expect(data.reimputar).toEqual({
      se_puede: false,
      motivo: 'Este mes está cerrado. Reabrilo o hacé un asiento de ajuste.',
    })
  })

  it('se puede deshacer solo en los 10 minutos', () => {
    expect(documentData(detail(), FACTS).se_puede_deshacer).toBeUndefined()
    expect(
      documentData(detail(), { ...FACTS, nowMs: Date.parse('2026-11-02T10:05:00Z') })
        .se_puede_deshacer,
    ).toBe(true)
  })

  describe('si se puede anular', () => {
    const options: { arcaEmitted: boolean; arcaSibling: string | null; canWrite: boolean } = {
      arcaEmitted: false,
      arcaSibling: null,
      canWrite: true,
    }
    const anular = (doc: DocumentDetail, opts = options) =>
      voidingData(doc, documentActions(doc, true), opts)

    it('con el mes abierto, se anula', () => {
      expect(anular(detail())).toEqual({
        se_puede: true,
        como: 'Anular: el mes está abierto.',
        pagos_que_quedan_a_cuenta: '$ 60',
      })
    })

    it('con el mes cerrado, con fecha de hoy', () => {
      const data = anular(
        detail({ period: { id: 'p', month: '2026-10-01', kind: 'month', status: 'closed' } }),
      )
      expect(data.se_puede).toBe(true)
      expect(data).toHaveProperty('como', expect.stringContaining('con fecha de hoy'))
    })

    it('ya anulado', () => {
      expect(anular(detail({ status: 'voided' }))).toEqual({
        se_puede: false,
        motivo: 'Ya está anulado.',
      })
    })

    it('lo que salió por ARCA se corrige con una nota de crédito', () => {
      const data = anular(detail({ kind: 'sales_invoice' }), { ...options, arcaEmitted: true })
      expect(data).toEqual({
        se_puede: false,
        motivo: 'Ya salió por ARCA: se corrige con una nota de crédito.',
      })
    })

    it('junto con una factura que ya está en ARCA, tampoco', () => {
      const data = anular(detail({ kind: 'collection' }), {
        ...options,
        arcaSibling: 'Factura B 0001-00000001',
      })
      expect(data).toHaveProperty('motivo', expect.stringContaining('Factura B 0001-00000001'))
    })

    it('la liquidación de IVA no se anula: se reabre el mes', () => {
      const data = anular(detail({ kind: 'iva_settlement' }))
      expect(data).toMatchObject({ se_puede: false })
      expect(data).toHaveProperty('motivo', expect.stringContaining('reabriendo'))
    })

    it('con una anulación vigente no se vuelve a anular', () => {
      const data = anular(
        detail({
          period: { id: 'p', month: '2026-10-01', kind: 'month', status: 'closed' },
          reversedBy: {
            id: 'r',
            seq: 200,
            title: 'Anulación',
            kind: 'reversal',
            accountingDate: '2026-11-01',
            totalCents: 100_00,
            status: 'posted',
          },
        }),
      )
      expect(data).toEqual({ se_puede: false, motivo: 'Ya tiene su anulación.' })
    })

    it('la contadora mira, pero lo anula un dueño', () => {
      expect(anular(detail(), { ...options, canWrite: false })).toHaveProperty(
        'quien',
        'Lo anula un dueño con acceso de carga.',
      )
    })
  })
})

describe('ver_plan_semana', () => {
  const plan = (over: Partial<WeekPlanRow> = {}): WeekPlanRow => ({
    partyId: 'coca',
    partyName: 'Coca',
    partyKind: 'supplier',
    defaultVoucherType: null,
    debtCents: 0,
    overdueCents: 0,
    purchasedCents: 0,
    paidCents: 0,
    budgetCents: 0,
    ...over,
  })

  it('lo que falta de cada uno, en palabras', () => {
    expect(weekPlanRow(plan({ budgetCents: 100_00, paidCents: 40_00, debtCents: 100_00 }))).toEqual(
      {
        id: 'coca',
        nombre: 'Coca',
        presupuesto: '$ 100',
        pagado: '$ 40',
        deuda: '$ 100',
        falta: '$ 60',
      },
    )
    expect(
      weekPlanRow(plan({ budgetCents: 100_00, paidCents: 120_00, debtCents: 1 })),
    ).toMatchObject({ te_pasaste: '$ 20' })
    expect(
      weekPlanRow(plan({ budgetCents: 100_00, paidCents: 100_00, debtCents: 1 })),
    ).toMatchObject({ listo: true })
    expect(weekPlanRow(plan({ budgetCents: 100_00 }))).toMatchObject({ paga_al_recibir: true })
  })

  it('los totales de la planilla', () => {
    const data = weekPlanData('2026-11-02', [
      plan({ budgetCents: 100_00, paidCents: 40_00, debtCents: 100_00 }),
      plan({ partyId: 'b', budgetCents: 100_00, overdueCents: 30_00, debtCents: 30_00 }),
    ])
    expect(data).toMatchObject({
      semana: 'Semana del 02/11 al 08/11',
      lunes: '2026-11-02',
      presupuesto: '$ 200',
      pagado: '$ 40',
      falta: '$ 160',
      porcentaje: '20 %',
      vencido: '$ 30',
      hay_mas: false,
    })
  })

  it('sin presupuesto, no inventa un porcentaje', () => {
    expect(weekPlanData('2026-11-02', []).porcentaje).toBeUndefined()
  })
})
