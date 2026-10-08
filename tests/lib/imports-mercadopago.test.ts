import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/lib/imports/csv'
import { openTable } from '@/lib/imports/detect'
import {
  type MpReleaseContext,
  parseReleaseReport,
  parseTaxesDisaggregated,
  paymentChannel,
  rejoinSplitJson,
} from '@/lib/imports/mercadopago/release'
import type { MpItem } from '@/lib/imports/types'
import {
  IMPORT_FIXTURES,
  type ImportFixture,
  importFixture,
} from '@/tests/fixtures/imports/fixtures'
import { mpReleaseCsv, OWN_CBU, OWN_CVU, SAS_CUIT, THIRD_CBU } from '@/tests/fixtures/imports/synth'

const CTX: MpReleaseContext = { sasCuit: SAS_CUIT, ownCbus: [OWN_CBU, OWN_CVU], cutoffHour: 0 }

async function parseFixture(file: ImportFixture, ctx: MpReleaseContext = CTX) {
  const opened = await openTable({ bytes: importFixture(file), fileName: file })
  if (!opened.ok) throw new Error(opened.issue.code)
  return parseReleaseReport(opened.table.rows, ctx)
}

const bySource = <T extends { item: MpItem }>(
  items: readonly T[],
  sourceId: string,
  description = 'payment',
) => items.find((x) => x.item.sourceId === sourceId && x.item.description === description)

describe('el reporte de Liquidaciones como lo deja la guía', () => {
  it('saldos, controles y cantidad de movimientos', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mpRelease)
    expect(r.ok).toBe(true)
    expect(r.layout).toBe('mp_release')
    expect(r.decimal).toBe('.')
    expect(r.initialBalance).toBe(15_000_000)
    expect(r.finalBalance).toBe(37_845_493)
    expect(r.fileChecks).toEqual({
      total: 'ok',
      totalDiffCents: 0,
      balanceChain: 'ok',
      balanceMismatchRows: [],
      rowCheckFailures: 0,
      openReserveCents: 0,
    })
    expect(r.items).toHaveLength(19)
    expect(r.rowErrors).toEqual([])
    expect(r.fileIssues).toEqual([])
    expect(r.period).toEqual({ from: '2026-10-01', to: '2026-10-03' })
    expect(r.unknownDescriptions).toEqual(['promo_bonus'])
  })

  it('cada movimiento con su canal', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mpRelease)
    const channel = (id: string, d?: string) => bySource(r.items, id, d)?.item.channel
    expect(channel('91000000001')).toBe('qr')
    expect(channel('91000000002')).toBe('qr')
    expect(channel('91000000003')).toBe('point')
    expect(channel('91000000004')).toBe('transfer_in')
    expect(channel('91000000005')).toBe('transfer_in')
    expect(channel('91000000006')).toBe('qr')
    expect(channel('92000000001', 'reserve_for_payout')).toBe('reserve')
    expect(channel('92000000001', 'payout')).toBe('payout_own')
    expect(channel('92000000002', 'payout')).toBe('payout_third')
    expect(channel('92000000002', 'tax_withholding_payout')).toBe('bank_tax')
    expect(channel('93000000001', 'asset_management')).toBe('yield')
    expect(channel('94000000001', 'tax_withdholding')).toBe('iibb_later')
    expect(channel('91000000007', 'tip')).toBe('tip')
    expect(channel('91000000001', 'refund')).toBe('refund')
    expect(channel('95000000001', 'tax_iva')).toBe('perception')
    expect(channel('96000000001', 'promo_bonus')).toBe('other')
  })

  it('un cobro con QR: bruto, comisión, impuestos y neto (el ejemplo de la investigación)', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mpRelease)
    const qr = bySource(r.items, '91000000001')
    expect(qr?.key).toMatch(/^mp:[0-9a-f]{64}$/)
    expect(qr?.key).toBe(qr?.item.rowKey)
    expect(qr?.issues).toEqual([])
    expect(qr?.item).toMatchObject({
      kind: 'mp',
      recordType: 'release',
      releasedAt: '2026-10-01T16:05:12.000Z',
      approvedAt: '2026-10-01T16:05:12.000Z',
      releaseDate: '2026-10-01',
      businessDate: '2026-10-01',
      netCredit: 6_673_554,
      netDebit: 0,
      gross: 6_780_000,
      mpFee: -65_766,
      taxes: -40_680,
      taxesDetail: [
        { entity: 'debitos_creditos', detail: 'tax_withholding_collector', amount: -40_680 },
      ],
      balanceAfter: 21_673_554,
      signals: {
        operationTags: 'QR',
        subUnit: 'QR',
        businessUnit: 'Mercado Pago',
        posId: '40001',
        storeId: '50001',
        paymentMethodType: 'account_money',
        paymentMethod: 'account_money',
      },
      payoutLast4: null,
      payoutIsOwn: null,
      fromOwnCuit: false,
    })
    const sirtac = bySource(r.items, '91000000002')
    expect(sirtac?.item.taxesDetail.map((t) => t.detail)).toEqual([
      'tax_withholding_collector',
      'tax_withholding_sirtac',
    ])
  })

  it('transferencias: de la propia CUIT (no es venta) y de un tercero', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mpRelease)
    expect(bySource(r.items, '91000000005')?.item.fromOwnCuit).toBe(true)
    expect(bySource(r.items, '91000000004')?.item.fromOwnCuit).toBe(false)
  })

  it('retiros: a una cuenta propia y a un tercero; solo los últimos 4 dígitos', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mpRelease)
    expect(bySource(r.items, '92000000001', 'payout')?.item).toMatchObject({
      payoutIsOwn: true,
      payoutLast4: OWN_CBU.slice(-4),
      externalReference: 'COELSA-SYN-0001',
      netDebit: 10_000_000,
    })
    expect(bySource(r.items, '92000000002', 'payout')?.item).toMatchObject({
      payoutIsOwn: false,
      payoutLast4: THIRD_CBU.slice(-4),
    })
  })

  it('nada personal en lo que se guarda', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mpRelease)
    const json = JSON.stringify(r.items)
    expect(json).not.toContain(OWN_CBU)
    expect(json).not.toContain(THIRD_CBU)
    expect(json).not.toContain(SAS_CUIT)
    expect(json).not.toContain('"23456789"')
    expect(json).not.toContain('Caja barra')
    for (const x of r.items) expect(JSON.stringify(x.item).length).toBeLessThan(8192)
  })

  it('lo raro va a revisión, nunca se descarta', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mpRelease)
    const review = (id: string, d: string) => bySource(r.items, id, d)?.issues.map((i) => i.code)
    expect(review('91000000007', 'tip')).toEqual(['mp_needs_review'])
    expect(review('91000000001', 'refund')).toEqual(['mp_needs_review'])
    expect(review('96000000001', 'promo_bonus')).toEqual(['mp_unknown_description'])
  })

  it('el día contable: calendario o día de servicio (corte 5 AM)', async () => {
    const calendar = await parseFixture(IMPORT_FIXTURES.mpRelease)
    const service = await parseFixture(IMPORT_FIXTURES.mpRelease, { ...CTX, cutoffHour: 5 })
    const late = (r: typeof calendar) => bySource(r.items, '91000000006')?.item
    expect(late(calendar)).toMatchObject({ releaseDate: '2026-10-02', businessDate: '2026-10-02' })
    expect(late(service)).toMatchObject({ releaseDate: '2026-10-02', businessDate: '2026-10-01' })
    // La clave no depende del corte.
    expect(late(service)?.rowKey).toBe(late(calendar)?.rowKey)
  })
})

describe('la variante del panel', () => {
  it('«;», JSON con comillas sin encerrar, GMT-4 y la etiqueta vieja withdrawal', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mpPanel, { ...CTX, cutoffHour: 5 })
    expect(r.decimal).toBe('.')
    expect(r.initialBalance).toBe(2_000_000)
    expect(r.finalBalance).toBe(2_945_100)
    expect(r.fileChecks.total).toBe('ok')
    expect(r.fileChecks.balanceChain).toBe('ok')
    const [pay, out] = r.items
    expect(pay?.item).toMatchObject({
      channel: 'qr',
      releasedAt: '2026-10-05T03:30:00.000Z',
      releaseDate: '2026-10-05',
      businessDate: '2026-10-04',
      approvedAt: null,
      taxes: -12_000,
      taxesDetail: [
        { entity: 'debitos_creditos', detail: 'tax_withholding_collector', amount: -12_000 },
      ],
      fromOwnCuit: null,
    })
    expect(out?.item).toMatchObject({
      description: 'withdrawal',
      channel: 'payout_third',
      payoutIsOwn: null,
    })
    expect(out?.issues.map((i) => i.code)).toEqual(['mp_payout_unknown_account'])
  })
})

describe('controles que no cierran', () => {
  const rowsOf = () => parseCsv(mpReleaseCsv(), ',')
  const col = (rows: string[][], name: string) => (rows[0] ?? []).indexOf(name)
  const rowOf = (rows: string[][], sourceId: string, description: string) =>
    rows.findIndex(
      (r) => r[col(rows, 'SOURCE_ID')] === sourceId && r[col(rows, 'DESCRIPTION')] === description,
    )

  it('el control por fila', () => {
    const rows = rowsOf()
    const i = rowOf(rows, '91000000001', 'payment')
    const target = rows[i] as string[]
    target[col(rows, 'GROSS_AMOUNT')] = '67900.00'
    const r = parseReleaseReport(rows, CTX)
    expect(r.fileChecks.rowCheckFailures).toBe(1)
    expect(r.items.find((x) => x.row === i + 1)?.issues).toContainEqual({
      level: 'review',
      code: 'mp_row_check',
      row: i + 1,
      cents: -10_000,
    })
  })

  it('el saldo corrido y el total del archivo', () => {
    const rows = rowsOf()
    const i = rowOf(rows, '91000000003', 'payment')
    const target = rows[i] as string[]
    target[col(rows, 'BALANCE_AMOUNT')] = '1.00'
    const total = rows[rows.length - 1] as string[]
    total[col(rows, 'NET_CREDIT_AMOUNT')] = '1.00'
    const r = parseReleaseReport(rows, CTX)
    expect(r.fileChecks.balanceChain).toBe('mismatch')
    expect(r.fileChecks.balanceMismatchRows).toContain(i + 1)
    expect(r.fileChecks.total).toBe('mismatch')
    expect(r.fileIssues.map((x) => x.code)).toContain('mp_total_mismatch')
  })

  it('impuestos que no suman, fecha ilegible y tipo de fila desconocido', () => {
    const rows = rowsOf()
    const a = rowOf(rows, '91000000002', 'payment')
    ;(rows[a] as string[])[col(rows, 'TAXES_AMOUNT')] = '-401.00'
    const b = rowOf(rows, '91000000003', 'payment')
    ;(rows[b] as string[])[col(rows, 'DATE')] = 'ayer'
    const c = rowOf(rows, '93000000002', 'asset_management')
    ;(rows[c] as string[])[col(rows, 'RECORD_TYPE')] = 'release_v2'
    const r = parseReleaseReport(rows, CTX)
    expect(r.items.find((x) => x.row === a + 1)?.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['mp_taxes_mismatch', 'mp_row_check']),
    )
    expect(r.rowErrors).toEqual([
      { level: 'error', code: 'mp_bad_date', row: b + 1, field: 'DATE' },
    ])
    expect(r.items.find((x) => x.row === c + 1)?.issues.map((i) => i.code)).toEqual([
      'mp_unknown_record_type',
    ])
  })

  it('sin títulos, o con el reporte equivocado', () => {
    expect(parseReleaseReport([['hola']]).fileIssues.map((i) => i.code)).toEqual(['mp_no_header'])
    const settlement = [
      ['DATE', 'SOURCE_ID', 'TRANSACTION_TYPE', 'TRANSACTION_AMOUNT', 'SETTLEMENT_NET_AMOUNT'],
    ]
    expect(parseReleaseReport(settlement).fileIssues.map((i) => i.code)).toEqual(['mp_settlement'])
  })
})

describe('parseTaxesDisaggregated', () => {
  it('sin comillas (lo que manda MP), JSON válido, vacío y basura', () => {
    expect(
      parseTaxesDisaggregated(
        '[{financial_entity:debitos_creditos,amount:-90.00,detail:tax_withholding_collector}]',
      ),
    ).toEqual([{ entity: 'debitos_creditos', detail: 'tax_withholding_collector', amount: -9_000 }])
    expect(
      parseTaxesDisaggregated(
        '[{"financial_entity":"cordoba","amount":-50.5,"detail":"tax_withholding_sircupa"},{"financial_entity":"debitos_creditos","amount":"-30.00","detail":"x"}]',
      ),
    ).toEqual([
      { entity: 'cordoba', detail: 'tax_withholding_sircupa', amount: -5_050 },
      { entity: 'debitos_creditos', detail: 'x', amount: -3_000 },
    ])
    expect(parseTaxesDisaggregated('')).toEqual([])
    expect(parseTaxesDisaggregated('[]')).toEqual([])
    expect(parseTaxesDisaggregated(null)).toEqual([])
    expect(parseTaxesDisaggregated('basura')).toBeNull()
    expect(parseTaxesDisaggregated('[{amount:abc}]')).toBeNull()
  })
})

describe('paymentChannel', () => {
  it('en el orden de §1.6', () => {
    expect(paymentChannel({ operationTags: 'QR' })).toBe('qr')
    expect(paymentChannel({ subUnit: 'QR' })).toBe('qr')
    expect(paymentChannel({ operationTags: 'PO' })).toBe('point')
    expect(paymentChannel({ subUnit: 'Point' })).toBe('point')
    expect(paymentChannel({ subUnit: 'Link de pago' })).toBe('link')
    expect(paymentChannel({ poiId: 'PAX-1' })).toBe('point')
    expect(paymentChannel({ posId: '1' })).toBe('qr')
    expect(paymentChannel({ paymentMethodType: 'bank_transfer' })).toBe('transfer_in')
    expect(paymentChannel({ paymentMethod: 'debin_transfer' })).toBe('transfer_in')
    expect(paymentChannel({ paymentMethodType: 'credit_card' })).toBeNull()
    expect(paymentChannel({})).toBeNull()
  })
})

describe('rejoinSplitJson', () => {
  it('vuelve a unir el JSON sin comillas que partió la coma del CSV', () => {
    const header =
      'DATE,SOURCE_ID,RECORD_TYPE,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,GROSS_AMOUNT,TAXES_AMOUNT,TAXES_DISAGGREGATED,OPERATION_TAGS,POS_ID'
    const line =
      '2026-10-01T13:05:12.000-03:00,1,release,payment,9850.00,0.00,10000.00,-150.00,[{financial_entity:debitos_creditos,amount:-60.00,detail:tax_withholding_collector},{financial_entity:cordoba,amount:-90.00,detail:tax_withholding_sirtac}],QR,40001'
    const rows = parseCsv(`${header}\n${line}\n`, ',')
    expect(rows[1]).toHaveLength(16)
    const fixed = rejoinSplitJson(rows[1] ?? [], 11)
    expect(fixed).toHaveLength(11)
    expect(fixed[8]).toBe(
      '[{financial_entity:debitos_creditos,amount:-60.00,detail:tax_withholding_collector},{financial_entity:cordoba,amount:-90.00,detail:tax_withholding_sirtac}]',
    )
    const r = parseReleaseReport(rows, CTX)
    expect(r.items[0]?.item).toMatchObject({
      channel: 'qr',
      taxes: -15_000,
      taxesDetail: [
        { entity: 'debitos_creditos', detail: 'tax_withholding_collector', amount: -6_000 },
        { entity: 'cordoba', detail: 'tax_withholding_sirtac', amount: -9_000 },
      ],
      signals: { operationTags: 'QR', posId: '40001' },
    })
    expect(r.items[0]?.issues).toEqual([])
    // Una fila que ya tiene la cantidad justa no se toca.
    expect(rejoinSplitJson(['a', '[x', 'y]'], 3)).toEqual(['a', '[x', 'y]'])
  })
})
