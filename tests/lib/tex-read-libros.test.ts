import { describe, expect, it } from 'vitest'
import type { AccountRow } from '@/lib/accounting/queries/accounts'
import type {
  ImputationFlag,
  IvaAmounts,
  IvaBookRow,
  IvaBookTotals,
  IvaPosition,
  JournalEntryRow,
  JournalSummary,
  LedgerPage,
  LedgerRow,
  TrialBalance,
  TrialBalanceRow,
} from '@/lib/accounting/queries/books'
import type { PeriodRow } from '@/lib/accounting/queries/periods'
import { FISCAL_AMOUNT_KEYS } from '@/lib/accounting/types'
import {
  accountRow,
  imputationFlagRow,
  ivaBookData,
  ivaBookRow,
  ivaPositionData,
  journalData,
  journalRow,
  ledgerData,
  ledgerLineIds,
  ledgerRow,
  monthReviewData,
  monthsData,
  type ReimputableLine,
  searchAccounts,
  suspectsData,
  trialData,
  trialLevelThatFits,
  trialRow,
} from '@/lib/tex/tools/read/libros'

const TODAY = '2026-11-05'

function trialAccount(over: Partial<TrialBalanceRow> = {}): TrialBalanceRow {
  return {
    accountId: 'caja',
    code: '1.1.01',
    name: 'Caja',
    level: 5,
    accountType: 'asset',
    normalSide: 'debit',
    postable: true,
    active: true,
    isVirtual: false,
    openingDebitCents: 0,
    openingCreditCents: 0,
    periodDebitCents: 0,
    periodCreditCents: 0,
    closingDebitCents: 0,
    closingCreditCents: 0,
    ...over,
  }
}

function trial(rows: TrialBalanceRow[], over: Partial<TrialBalance> = {}): TrialBalance {
  return {
    from: '2026-10-01',
    to: '2026-10-31',
    rows,
    totals: {
      openingDebitCents: 0,
      openingCreditCents: 0,
      periodDebitCents: 1_000_00,
      periodCreditCents: 1_000_00,
      closingDebitCents: 700_00,
      closingCreditCents: 700_00,
    },
    balanced: true,
    differenceCents: 0,
    ...over,
  }
}

describe('ver_sumas_y_saldos', () => {
  const moved = { periodDebitCents: 100_00, closingDebitCents: 100_00 }
  const rowsAt = (level: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      trialAccount({ accountId: `c${level}-${i}`, level, ...moved }),
    )

  it('una fila chica, con el saldo y su lado', () => {
    expect(
      trialRow(
        trialAccount({
          openingCreditCents: 50_00,
          periodDebitCents: 100_00,
          periodCreditCents: 20_00,
          closingDebitCents: 30_00,
        }),
      ),
    ).toEqual({
      id: 'caja',
      cuenta: '1.1.01 Caja',
      saldo_inicial: '$ 50 acreedor',
      debe: '$ 100',
      haber: '$ 20',
      saldo: '$ 30 deudor',
    })
  })

  it('marca los grupos: ya suman a sus cuentas', () => {
    expect(trialRow(trialAccount({ postable: false, level: 1 })).grupo).toBe(true)
  })

  it('la línea virtual de resultados no tiene id: no es una cuenta del plan', () => {
    const row = trialRow(
      trialAccount({ isVirtual: true, name: 'Resultados de ejercicios anteriores', code: '' }),
    )
    expect(row.id).toBeUndefined()
    expect(row.cuenta).toBe('Resultados de ejercicios anteriores')
  })

  it('elige el nivel más detallado que entra', () => {
    expect(trialLevelThatFits(rowsAt(5, 10), 40)).toBe('todo')
    // 30 de nivel 4 y 30 de nivel 5: todo junto no entra.
    expect(trialLevelThatFits([...rowsAt(4, 30), ...rowsAt(5, 30)], 40)).toBe(4)
    expect(trialLevelThatFits([...rowsAt(1, 5), ...rowsAt(2, 50)], 40)).toBe(1)
  })

  it('lo que está en cero de punta a punta no cuenta para el tope', () => {
    const zeros = Array.from({ length: 100 }, (_, i) => trialAccount({ accountId: `z${i}` }))
    expect(trialLevelThatFits([...rowsAt(5, 10), ...zeros], 40)).toBe('todo')
    expect(trialData(trial([...rowsAt(5, 10), ...zeros]), 'Octubre 2026', null).filas).toHaveLength(
      10,
    )
  })

  it('con los totales y si cuadra', () => {
    expect(trialData(trial(rowsAt(5, 1)), 'Octubre 2026', null)).toMatchObject({
      periodo: 'Octubre 2026',
      nivel: 'todas las cuentas con movimiento o saldo',
      cuadra: true,
      debe_del_periodo: '$ 1.000',
      haber_del_periodo: '$ 1.000',
      saldos_deudores: '$ 700',
      saldos_acreedores: '$ 700',
      hay_mas: false,
    })
  })

  it('si no cuadra, por cuánto', () => {
    const data = trialData(
      trial(rowsAt(5, 1), { balanced: false, differenceCents: 5_00 }),
      'Octubre 2026',
      null,
    )
    expect(data).toMatchObject({ cuadra: false, no_cuadra_por: '$ 5' })
  })

  it('el nivel pedido manda', () => {
    const data = trialData(trial([...rowsAt(1, 2), ...rowsAt(5, 3)]), 'Octubre 2026', 1)
    expect(data.nivel).toBe(1)
    expect(data.filas).toHaveLength(2)
  })
})

function ledger(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    rowKind: 'line',
    entryId: 'asiento-1',
    entryNumber: 44,
    numberIsProvisional: true,
    entryDate: '2026-10-10',
    documentId: 'doc-1',
    documentSeq: 12,
    documentLabel: 'Factura A 0003-00001234',
    description: 'Coca · Factura A 0003-00001234',
    partyId: null,
    partyName: null,
    dueDate: null,
    memo: null,
    debitCents: 100_00,
    creditCents: 0,
    runningBalanceCents: 100_00,
    accountId: 'merca',
    accountCode: '5.1',
    accountName: 'Mercadería',
    ...over,
  }
}

function docLine(over: Partial<ReimputableLine> = {}): ReimputableLine {
  return {
    id: 'renglon-1',
    documentId: 'doc-1',
    accountId: 'merca',
    role: 'net',
    side: 'debit',
    amountCents: 100_00,
    partyId: null,
    treasuryAccountId: null,
    ...over,
  }
}

const PLAIN = { requiresParty: false, isTreasury: false }
const ACCOUNTS = new Map([
  ['merca', PLAIN],
  ['prov', { requiresParty: true, isTreasury: false }],
  ['caja', { requiresParty: false, isTreasury: true }],
])

describe('ver_mayor', () => {
  it('aparea cada fila con su renglón del comprobante', () => {
    expect(ledgerLineIds([ledger()], [docLine()], ACCOUNTS, null)).toEqual(['renglon-1'])
  })

  it('el «Saldo anterior» no tiene renglón', () => {
    expect(
      ledgerLineIds(
        [ledger({ rowKind: 'opening', documentId: null })],
        [docLine()],
        ACCOUNTS,
        null,
      ),
    ).toEqual([null])
  })

  it('dos renglones iguales del mismo comprobante se reparten', () => {
    const rows = [ledger(), ledger()]
    const lines = [docLine({ id: 'a' }), docLine({ id: 'b' })]
    expect(ledgerLineIds(rows, lines, ACCOUNTS, null)).toEqual(['a', 'b'])
  })

  it('no aparea por error otro importe, otro lado u otra cuenta', () => {
    const line = docLine()
    expect(ledgerLineIds([ledger({ debitCents: 99_00 })], [line], ACCOUNTS, null)).toEqual([null])
    expect(
      ledgerLineIds([ledger({ debitCents: 0, creditCents: 100_00 })], [line], ACCOUNTS, null),
    ).toEqual([null])
    expect(ledgerLineIds([ledger({ accountId: 'otra' })], [line], ACCOUNTS, null)).toEqual([null])
    expect(ledgerLineIds([ledger({ documentId: 'otro' })], [line], ACCOUNTS, null)).toEqual([null])
  })

  it('solo ofrece lo que se puede reimputar: nunca una caja ni una cuenta corriente', () => {
    const cases: Array<Partial<ReimputableLine>> = [
      { accountId: 'caja' },
      { accountId: 'prov' },
      { partyId: 'coca' },
      { treasuryAccountId: 'caja' },
      { role: 'vat' },
    ]
    for (const over of cases) {
      const line = docLine(over)
      expect(
        ledgerLineIds([ledger({ accountId: line.accountId })], [line], ACCOUNTS, null),
        JSON.stringify(over),
      ).toEqual([null])
    }
  })

  it('en un mes cerrado no ofrece ningún id', () => {
    expect(ledgerLineIds([ledger()], [docLine()], ACCOUNTS, '2026-11-01')).toEqual([null])
    expect(ledgerLineIds([ledger()], [docLine()], ACCOUNTS, '2026-10-01')).toEqual(['renglon-1'])
  })

  it('una fila chica; en un grupo dice de qué cuenta es', () => {
    expect(ledgerRow(ledger(), 'renglon-1', false)).toEqual({
      fecha: '10/10/2026',
      comprobante: 'Factura A 0003-00001234',
      comprobante_id: 'doc-1',
      renglon_id: 'renglon-1',
      detalle: 'Coca',
      debe: '$ 100',
      saldo: '$ 100 deudor',
    })
    expect(ledgerRow(ledger(), null, true).detalle).toBe('Mercadería · Coca')
  })

  function page(over: Partial<LedgerPage> = {}): LedgerPage {
    return {
      rows: [
        ledger({ rowKind: 'opening', documentId: null }),
        ledger({ documentId: 'viejo' }),
        ledger({ documentId: 'nuevo' }),
      ],
      nextCursor: null,
      totalRows: 2,
      from: '2026-10-01',
      to: '2026-10-31',
      account: {
        id: 'merca',
        code: '5.1',
        name: 'Mercadería',
        normalSide: 'debit',
        postable: true,
        requiresParty: false,
      },
      periodTotals: { openingCents: 0, debitCents: 200_00, creditCents: 0, closingCents: 200_00 },
      ...over,
    }
  }

  it('lo último primero, con el id del renglón en su fila y los totales de todo el período', () => {
    const data = ledgerData(page(), 'Octubre 2026', ['r-viejo', 'r-nuevo'], null)
    expect(data.filas?.map((row) => [row.comprobante_id, row.renglon_id])).toEqual([
      ['nuevo', 'r-nuevo'],
      ['viejo', 'r-viejo'],
    ])
    expect(data).toMatchObject({
      cuenta: { id: 'merca', cuenta: '5.1 Mercadería' },
      saldo_al_empezar: '$ 0',
      debe: '$ 200',
      saldo_al_terminar: '$ 200 deudor',
      cuantos: 2,
      hay_mas: false,
    })
    expect(data.reimputar).toBeUndefined()
  })

  it('dice desde cuándo se puede reimputar', () => {
    const data = ledgerData(page(), 'Octubre 2026', [null, null], '2026-11-01')
    expect(data.reimputar).toBe(
      'Lo anterior al 01/11/2026 es de un mes cerrado: no se reimputa y no trae renglon_id.',
    )
  })

  it('con muchos, los últimos 40 y lo avisa si no llegó al final', () => {
    const lines = Array.from({ length: 60 }, (_, i) => ledger({ documentId: `d${i}` }))
    const data = ledgerData(
      page({ rows: lines, totalRows: 900, nextCursor: 'x' }),
      'Octubre 2026',
      [],
      null,
    )
    expect(data.filas).toHaveLength(40)
    expect(data.filas?.[0]?.comprobante_id).toBe('d59')
    expect(data.nota).toContain('más de 500')
  })

  it('con textos largos entra entero en el tope del ciclo', () => {
    const lines = Array.from({ length: 60 }, (_, i) =>
      ledger({
        documentId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        documentLabel: 'Nota de crédito de proveedor 0003-00001234',
        description: `Un detalle bien largo del movimiento número ${i} que se repite y se repite`,
        partyName: 'Distribuidora de bebidas del centro SRL',
      }),
    )
    const ids = lines.map(() => '7c9e6679-7425-40de-944b-e07fc1f90ae7')
    const data = ledgerData(page({ rows: lines, totalRows: 60 }), 'Octubre 2026', ids, null)
    expect(data.hay_mas).toBe(true)
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })
})

function journal(over: Partial<JournalEntryRow> = {}): JournalEntryRow {
  return {
    entryId: 'asiento-1',
    number: 44,
    numberIsProvisional: false,
    entryDate: '2026-10-10',
    kind: 'standard',
    description: 'Compra',
    documentId: 'doc-1',
    documentSeq: 12,
    documentKind: 'purchase',
    documentLabel: 'Factura A',
    createdByName: 'Franco',
    totalCents: 100_00,
    lines: [
      {
        lineNo: 1,
        accountCode: '5.1',
        accountName: 'Mercadería',
        partyId: null,
        partyName: null,
        partyTaxId: null,
        dueDate: null,
        memo: null,
        debitCents: 100_00,
        creditCents: 0,
      },
      {
        lineNo: 2,
        accountCode: '2.1',
        accountName: 'Proveedores',
        partyId: 'coca',
        partyName: 'Coca',
        partyTaxId: '30111111112',
        dueDate: null,
        memo: null,
        debitCents: 0,
        creditCents: 100_00,
      },
    ],
    ...over,
  }
}

const SUMMARY: JournalSummary = {
  from: '2026-10-01',
  to: '2026-10-31',
  entries: 1,
  debitCents: 100_00,
  creditCents: 100_00,
  balanced: true,
  hasProvisional: false,
}

describe('ver_diario', () => {
  it('un asiento en una línea por renglón, sin quién lo cargó ni el CUIT', () => {
    expect(journalRow(journal({ numberIsProvisional: true }))).toEqual({
      id: 'asiento-1',
      numero: 44,
      provisorio: true,
      fecha: '10/10/2026',
      comprobante: 'Factura A',
      comprobante_id: 'doc-1',
      detalle: 'Compra',
      lineas: ['D 5.1 Mercadería $ 100', 'H 2.1 Proveedores · Coca $ 100'],
    })
  })

  it('con los totales de todo el período', () => {
    expect(journalData([journal()], SUMMARY, 'Octubre 2026')).toMatchObject({
      asientos: 1,
      debe: '$ 100',
      haber: '$ 100',
      cuadra: true,
      hay_mas: false,
    })
  })

  it('con asientos enormes corta por tamaño, con filas enteras, antes del tope del ciclo', () => {
    const longLine = journal().lines[0]
    if (!longLine) throw new Error('sin línea')
    const huge = journal({
      lines: Array.from({ length: 30 }, () => ({
        ...longLine,
        accountName: 'Una cuenta con un nombre bien largo para probar',
      })),
    })
    const data = journalData(
      Array.from({ length: 40 }, () => huge),
      { ...SUMMARY, entries: 40 },
      'Octubre 2026',
    )
    expect(data.filas?.length).toBeLessThan(40)
    expect(data.hay_mas).toBe(true)
    expect(data.nota).toContain('período más corto')
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })

  it('si la base trajo menos de los que hay, también hay más', () => {
    const data = journalData([journal()], { ...SUMMARY, entries: 500 }, 'Octubre 2026')
    expect(data.hay_mas).toBe(true)
  })
})

function position(over: Partial<IvaPosition> = {}): IvaPosition {
  return {
    month: '2026-10-01',
    periodId: 'p',
    status: 'open',
    closedAt: null,
    mode: 'on_close',
    applies: true,
    figures: { df: 0, cf: 0, perc: 0, ret: 0, st0: 0, ld0: 0 },
    debitFiscal: { byRate: { '2100': 210_00 }, totalCents: 210_00 },
    creditFiscal: { byRate: { '2100': 100_00, '1050': 10_50 }, totalCents: 110_50 },
    technicalBalancePrevCents: 0,
    freeBalancePrevCents: 0,
    perceptionsCents: 0,
    withholdingsCents: 0,
    technicalBalanceCents: 0,
    toPayCents: 99_50,
    technicalBalanceNewCents: 0,
    freeBalanceNewCents: 0,
    inFavorCents: 0,
    isZero: false,
    pendingDocumentationCents: 0,
    reconciliation: {
      purchasesBookVatComputableCents: 0,
      journalVatCreditCents: 0,
      salesBookVatCents: 0,
      journalVatDebitCents: 0,
      differences: [],
      differencesCount: 0,
      unexplainedVatCreditCents: 0,
      unexplainedVatDebitCents: 0,
      matches: true,
      fullyExplained: true,
    },
    settlementDocumentId: null,
    settlementUpToDate: null,
    ...over,
  }
}

describe('ver_posicion_iva', () => {
  it('a pagar, estimado mientras el mes está abierto', () => {
    expect(ivaPositionData(position(), '2026-10')).toEqual({
      mes: '2026-10',
      estado: 'Abierto',
      estimado: true,
      resultado: '$ 100 a pagar',
      texto: 'A pagarle a ARCA.',
      a_pagar: '$ 99,50',
      debito_fiscal: '$ 210',
      credito_fiscal: '$ 110,50',
      debito_por_alicuota: [{ alicuota: '21 %', iva: '$ 210' }],
      credito_por_alicuota: [
        { alicuota: '21 %', iva: '$ 100' },
        { alicuota: '10,5 %', iva: '$ 10,50' },
      ],
      libros_coinciden_con_el_mayor: true,
    })
  })

  it('cerrado ya no es una estimación', () => {
    const data = ivaPositionData(position({ status: 'closed' }), '2026-10')
    expect(data.estimado).toBeUndefined()
    expect(data.estado).toBe('Cerrado')
  })

  it('si el bar no liquida IVA, lo dice y no muestra cuentas', () => {
    expect(ivaPositionData(position({ applies: false }), '2026-10')).toEqual({
      mes: '2026-10',
      estado: 'Abierto',
      estimado: true,
      resultado: 'no liquida IVA',
      texto: 'El bar no liquida IVA.',
    })
  })

  it('a favor', () => {
    const data = ivaPositionData(position({ toPayCents: 0, inFavorCents: 50_00 }), '2026-10')
    expect(data).toMatchObject({ a_favor: '$ 50', resultado: '$ 50 a favor' })
    expect(data.a_pagar).toBeUndefined()
  })
})

function amounts(over: Partial<IvaAmounts> = {}): IvaAmounts {
  const out = {} as IvaAmounts
  for (const key of FISCAL_AMOUNT_KEYS) out[key] = 0
  return { ...out, ...over }
}

describe('ver_libro_iva', () => {
  const book = (over: Partial<IvaBookRow> = {}): IvaBookRow => ({
    voucherId: 'v',
    documentId: 'doc-1',
    documentSeq: 12,
    voucherDate: '2026-10-10',
    voucherType: 'factura_a',
    voucherLabel: 'Factura A',
    afipVoucherCode: 1,
    sign: 1,
    isReversal: false,
    pointOfSale: 3,
    numberFrom: 1290,
    numberTo: null,
    counterpartyName: 'Coca',
    counterpartyDocType: 80,
    counterpartyDocNumber: '30111111112',
    counterpartyIvaCondition: 'responsable_inscripto',
    channel: null,
    amounts: amounts({ net_21_cents: 100_00, vat_21_cents: 21_00, total_cents: 121_00 }),
    accountingDate: '2026-10-10',
    ...over,
  })

  it('una fila con neto, IVA y total, sin el CUIT de la contraparte', () => {
    expect(ivaBookRow(book())).toEqual({
      comprobante_id: 'doc-1',
      fecha: '10/10/2026',
      comprobante: 'Factura A 0003-00001290',
      nombre: 'Coca',
      neto: '$ 100',
      iva: '$ 21',
      total: '$ 121',
    })
  })

  it('una nota de crédito viene en negativo, como en el libro', () => {
    const row = ivaBookRow(
      book({
        amounts: amounts({ net_21_cents: -100_00, vat_21_cents: -21_00, total_cents: -121_00 }),
      }),
    )
    expect(row).toMatchObject({ neto: '-$ 100', iva: '-$ 21', total: '-$ 121' })
  })

  const totals: IvaBookTotals = {
    book: 'purchases',
    month: '2026-10-01',
    amounts: amounts({
      net_21_cents: 100_00,
      vat_21_cents: 21_00,
      total_cents: 121_00,
      vat_computable_cents: 21_00,
    }),
    count: 1,
  }

  it('los totales del libro, y en compras el crédito computable', () => {
    expect(ivaBookData([book()], 1, totals, '2026-10')).toMatchObject({
      libro: 'IVA compras',
      mes: '2026-10',
      cuantos: 1,
      neto: '$ 100',
      iva: '$ 21',
      total: '$ 121',
      credito_computable: '$ 21',
      hay_mas: false,
    })
    const sales = ivaBookData([], 0, { ...totals, book: 'sales', count: null }, '2026-10')
    expect(sales.libro).toBe('IVA ventas')
    expect(sales.credito_computable).toBeUndefined()
    expect(sales.cuantos).toBe(0)
  })

  it('una lista larga se corta', () => {
    const data = ivaBookData(
      Array.from({ length: 41 }, () => book()),
      90,
      totals,
      '2026-10',
    )
    expect(data.filas).toHaveLength(40)
    expect(data.hay_mas).toBe(true)
  })
})

function account(over: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'a',
    code: '5.1.01',
    name: 'Energía eléctrica',
    type: 'expense',
    normalSide: 'debit',
    parentId: null,
    level: 5,
    path: [],
    postable: true,
    active: true,
    systemKey: null,
    requiresParty: false,
    isTreasury: false,
    purchaseSelectable: true,
    manualSelectable: true,
    description: null,
    sort: 0,
    updatedAt: '',
    ...over,
  }
}

describe('buscar_cuenta', () => {
  const plan = [
    account({ id: 'grupo', code: '5.1', name: 'Servicios', postable: false }),
    account({ id: 'luz', code: '5.1.01', name: 'Energía eléctrica', parentId: 'grupo' }),
    account({ id: 'agua', code: '5.1.02', name: 'Agua', parentId: 'grupo' }),
    account({ id: 'gastos', code: '5.2', name: 'Gastos de energía solar' }),
    account({ id: 'merca', code: '5.10', name: 'Mercadería' }),
  ]
  const ids = (q: string) => searchAccounts(plan, q).map((a) => a.id)

  it('por nombre, sin tildes ni mayúsculas', () => {
    expect(ids('ENERGIA')).toEqual(['luz', 'gastos'])
    expect(ids('agua')).toEqual(['agua'])
  })

  it('primero lo que empieza así, después lo que lo tiene adentro', () => {
    expect(searchAccounts(plan, 'solar').map((a) => a.id)).toEqual(['gastos'])
    expect(ids('electrica')).toEqual(['luz'])
    expect(ids('energ')[0]).toBe('luz')
  })

  it('por código exacto o por el principio', () => {
    expect(ids('5.1.01')).toEqual(['luz'])
    // 5.10 también empieza con «5.1»: como texto, es lo que pidió.
    expect(ids('5.1')).toEqual(['grupo', 'luz', 'agua', 'merca'])
  })

  it('a igual parecido, primero las imputables', () => {
    const tied = [
      account({ id: 'g', code: '1', name: 'Bebidas', postable: false }),
      account({ id: 'c', code: '2', name: 'Bebidas', postable: true }),
    ]
    expect(searchAccounts(tied, 'bebidas').map((a) => a.id)).toEqual(['c', 'g'])
  })

  it('sin coincidencias, nada', () => {
    expect(ids('nada que ver')).toEqual([])
  })

  it('una fila con lo que hace falta para elegir', () => {
    const parents = new Map([['grupo', 'Servicios']])
    expect(accountRow(plan[1] as AccountRow, parents)).toEqual({
      id: 'luz',
      codigo: '5.1.01',
      nombre: 'Energía eléctrica',
      tipo: 'Egresos',
      imputable: true,
      grupo: 'Servicios',
    })
    expect(
      accountRow(
        account({
          postable: false,
          requiresParty: true,
          isTreasury: true,
          description: 'Para esto',
        }),
        parents,
      ),
    ).toMatchObject({
      imputable: false,
      pide_participe: true,
      es_caja: true,
      para_que: 'Para esto',
    })
  })
})

describe('ver_cuentas_dudosas', () => {
  const flag: ImputationFlag = {
    documentId: 'doc-1',
    documentLineId: 'renglon-1',
    accountingDate: '2026-10-10',
    partyName: 'EPEC',
    amountCents: 100_00,
    accountId: 'agua',
    accountCode: '5.1.02',
    accountName: 'Agua',
    usualAccountId: 'luz',
    usualAccountCode: '5.1.01',
    usualAccountName: 'Energía eléctrica',
  }

  it('un renglón en otra cuenta, con el id del renglón y las dos cuentas', () => {
    expect(imputationFlagRow(flag)).toEqual({
      comprobante_id: 'doc-1',
      renglon_id: 'renglon-1',
      fecha: '10/10/2026',
      participe: 'EPEC',
      importe: '$ 100',
      esta_en: '5.1.02 Agua',
      cuenta_id: 'agua',
      va_siempre_a: '5.1.01 Energía eléctrica',
      cuenta_habitual_id: 'luz',
    })
  })

  it('los saldos al revés, con la oración del ojo de auditor', () => {
    const data = suspectsData(
      [flag],
      trial([
        trialAccount({ accountId: 'bien', closingDebitCents: 10_00 }),
        trialAccount({
          accountId: 'perdida',
          code: '5.1',
          name: 'Alquiler',
          accountType: 'expense',
          closingCreditCents: 10_00,
        }),
        trialAccount({
          accountId: 'sueldos',
          accountType: 'liability',
          normalSide: 'credit',
          closingDebitCents: 10_00,
        }),
      ]),
      new Map([['sueldos', 'payroll_payable']]),
      'Octubre 2026',
    )
    expect(data.renglones_en_otra_cuenta.filas).toHaveLength(1)
    // Sueldos a pagar puede estar deudor mientras no se devengó el mes.
    expect(data.saldos_al_reves).toEqual({
      filas: [
        {
          id: 'perdida',
          cuenta: '5.1 Alquiler',
          saldo: '$ 10 acreedor',
          por_que: 'Una pérdida no debería dar saldo acreedor.',
        },
      ],
      hay_mas: false,
    })
  })

  it('muchos entran enteros en el tope del ciclo', () => {
    const uuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
    const many = Array.from({ length: 200 }, () => ({
      ...flag,
      documentId: uuid,
      documentLineId: uuid,
      accountId: uuid,
      usualAccountId: uuid,
      partyName: 'Distribuidora de bebidas del centro SRL',
    }))
    const reversed = Array.from({ length: 100 }, (_, i) =>
      trialAccount({
        accountId: uuid + i,
        code: '5.1.01.01.001',
        name: 'Una cuenta con un nombre largo',
        accountType: 'expense',
        closingCreditCents: 10_000_000_00,
      }),
    )
    const data = suspectsData(many, trial(reversed), new Map(), 'Octubre 2026')
    expect(data.renglones_en_otra_cuenta.hay_mas).toBe(true)
    expect(data.saldos_al_reves.hay_mas).toBe(true)
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })

  it('sin nada raro, listas vacías', () => {
    expect(suspectsData([], trial([]), new Map(), 'Octubre 2026')).toEqual({
      periodo: 'Octubre 2026',
      renglones_en_otra_cuenta: { filas: [], hay_mas: false },
      saldos_al_reves: { filas: [], hay_mas: false },
    })
  })
})

function period(month: string, over: Partial<PeriodRow> = {}): PeriodRow {
  const start = `${month}-01`
  return {
    id: `p-${month}`,
    fiscalYearId: 'fy',
    kind: 'month',
    month: start,
    startsOn: start,
    endsOn: `${month}-30`,
    status: 'open',
    closedAt: null,
    closedByName: 'Franco Socio',
    numberFrom: null,
    numberTo: null,
    entriesCount: null,
    debitTotalCents: null,
    ivaSettlementDocumentId: null,
    ...over,
  }
}

describe('ver_estado_de_meses', () => {
  it('cómo está cada mes, sin quién lo cerró', () => {
    const data = monthsData(
      [
        period('2026-09', {
          status: 'closed',
          // A las 23:00 de Córdoba, en UTC ya es el día siguiente.
          closedAt: '2026-10-06T02:00:00Z',
          entriesCount: 120,
        }),
        period('2026-10'),
        period('2026-11'),
        period('2026-12'),
        { ...period('2026-12'), id: 'aj', kind: 'fy_adjustments' },
      ],
      TODAY,
    )
    expect(data).toEqual([
      { mes: '2026-09', estado: 'Cerrado', cerrado_el: '05/10/2026', asientos: 120 },
      { mes: '2026-10', estado: 'Falta cerrar' },
      { mes: '2026-11', estado: 'En curso' },
    ])
    expect(JSON.stringify(data)).not.toContain('Franco')
  })

  const parts = {
    month: '2026-10',
    today: TODAY,
    canWrite: true,
    base: '/hub/administracion',
    period: period('2026-10', { endsOn: '2026-10-31' }),
    earlierOpen: null,
    settings: { openingStatus: 'posted', cuit: '30111111112' },
    calendar: {
      days: [{ date: '2026-10-01', status: 'loaded', totalCents: 100 }],
      soldCents: 100,
      loadedDays: 1,
      missingDays: 0,
      serviceDay: TODAY,
    },
  } as unknown as Parameters<typeof monthReviewData>[0]

  const item = (key: string, label: string) => ({
    key,
    label,
    detail: {},
    amountCents: null,
    count: null,
  })

  it('un mes listo para cerrar lo dice, con lo que se revisó', () => {
    const data = monthReviewData({
      ...parts,
      checklist: {
        canClose: true,
        blockers: [],
        warnings: [],
        info: [],
        iva: null,
        entriesCount: 12,
        debitTotalCents: 500_00,
      },
    })
    expect(data.se_puede_cerrar).toBe(true)
    expect(data.titulo).toContain('Octubre')
    expect(data.asientos).toBe(12)
    expect(data.debe_y_haber).toBe('$ 500')
    expect(data.revision?.map((row) => row.que)).toEqual([
      'Cierres del día',
      'Compras y gastos',
      'La plata',
      'Los papeles del bar',
    ])
    expect(data.revision?.find((row) => row.que === 'La plata')).toMatchObject({
      estado: 'Sin avisos',
      bien: 'Ninguna caja con movimientos quedó sin contar ni en negativo.',
    })
  })

  it('lo que frena y los avisos van con sus palabras', () => {
    const data = monthReviewData({
      ...parts,
      checklist: {
        canClose: false,
        blockers: [item('algo_raro', 'Hay algo que frena el cierre.')],
        warnings: [item('treasuries_not_reconciled', 'Hay cajas sin contar.')],
        info: [],
        iva: null,
        entriesCount: 12,
        debitTotalCents: 500_00,
      },
    })
    expect(data.se_puede_cerrar).toBe(false)
    const other = data.revision?.find((row) => row.que === 'Otros avisos')
    expect(other?.avisos).toEqual(['Hay algo que frena el cierre.'])
    const money = data.revision?.find((row) => row.que === 'La plata')
    expect(money?.bien).toBeUndefined()
    expect(money?.avisos?.length).toBeGreaterThan(0)
  })

  it('los meses se cierran en orden', () => {
    const data = monthReviewData({
      ...parts,
      earlierOpen: '2026-09',
      checklist: {
        canClose: false,
        blockers: [],
        warnings: [],
        info: [],
        iva: null,
        entriesCount: 0,
        debitTotalCents: null,
      },
    })
    expect(data.antes_hay_que_cerrar).toBe('2026-09')
    expect(data.titulo).toContain('septiembre')
  })

  it('sin espacios duros', () => {
    const data = monthReviewData({
      ...parts,
      checklist: {
        canClose: true,
        blockers: [],
        warnings: [],
        info: [],
        iva: position({ status: 'open' }) as never,
        entriesCount: 12,
        debitTotalCents: 500_00,
      },
    })
    expect(data.iva).toBe('$ 100 a pagar')
    expect(JSON.stringify(data)).not.toContain(' ')
  })
})
