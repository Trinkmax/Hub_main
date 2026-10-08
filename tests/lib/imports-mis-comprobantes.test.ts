import { describe, expect, it } from 'vitest'
import {
  CREDIT_NOTE_CODES,
  inferVatRate,
  mcComponentsSum,
  mcIsDiscriminated,
  mcNaturalKey,
  normalizeCurrency,
  parseMisComprobantes,
  toDocType,
  toVoucherCode,
} from '@/lib/imports/arca/mis-comprobantes'
import { openTable } from '@/lib/imports/detect'
import type { McItem, McRateKey } from '@/lib/imports/types'
import {
  IMPORT_FIXTURES,
  type ImportFixture,
  importFixture,
} from '@/tests/fixtures/imports/fixtures'
import {
  G3_RECIBIDOS_TITLES,
  MC_DIC_SPEC,
  MC_G2_EMITIDOS_SPEC,
  MC_G2_RECIBIDOS_SPEC,
  MC_NOV_SPEC,
  MC_SMALL_SPEC,
  makeCuit,
  makeEmitidos,
  makeRecibidos,
  SAS_CUIT,
  type SynthVoucher,
} from '@/tests/fixtures/imports/synth'

async function parseFixture(file: ImportFixture, sasCuit: string | null = SAS_CUIT) {
  const opened = await openTable({ bytes: importFixture(file), fileName: file })
  if (!opened.ok) throw new Error(opened.issue.code)
  return parseMisComprobantes(opened.table.rows, {
    sasCuit,
    fileName: opened.table.entryName ?? file,
    container: opened.table.cellKind,
  })
}

const codes = (it: { issues: readonly { code: string }[] }) => it.issues.map((i) => i.code)

/** El tipo de cambio como lo guarda el parser: `'1475,006'` → `'1475.006'`, `'1,00'` → `'1'`. */
const canonicalRate = (rate: string) => {
  const [int = '', frac = ''] = rate.split(',')
  const f = frac.replace(/0+$/, '')
  return f === '' ? int : `${int}.${f}`
}

/** Compara cada comprobante parseado con el que generó el sintetizador (ida y vuelta completa). */
function expectRoundTrip(
  items: readonly { item: McItem }[],
  synth: readonly SynthVoucher[],
  g3: boolean,
) {
  expect(items).toHaveLength(synth.length)
  items.forEach(({ item }, i) => {
    const v = synth[i] as SynthVoucher
    expect(item).toMatchObject({
      issueDate: v.date,
      code: v.code,
      pointOfSale: v.pv,
      number: v.number,
      numberTo: v.numberTo,
      currency: v.currency,
      fxRate: canonicalRate(v.rate),
      total: v.total,
      otherTaxes: v.otherTaxes,
    })
    if (v.discriminated) {
      expect(item.netTotal).toBe(v.netTotal)
      expect(item.vatTotal).toBe(v.vatTotal)
      expect(item.nonTaxed).toBe(v.nonTaxed ?? 0)
      expect(item.exempt).toBe(v.exempt ?? 0)
      if (g3) {
        for (const k of ['r0', 'r25', 'r5', 'r105', 'r21', 'r27'] as McRateKey[]) {
          expect(item.net[k]).toBe(v.net[k] ?? 0)
          if (k !== 'r0') expect(item.vat[k]).toBe(v.vat[k] ?? 0)
        }
      }
    } else {
      expect(mcIsDiscriminated(item)).toBe(false)
    }
  })
}

// ─── Los conteos de `arca-mis-comprobantes.md` §9.5 ──────────────────────────

describe('la tabla de §9.5 se reproduce con los fixtures sintéticos', () => {
  const table: Array<
    [
      string,
      ImportFixture,
      {
        headerRow: number
        kind: string
        layout: string
        generation: string
        rows: number
        duplicateKeys: number
        creditNotes: number
        foreignCurrency: number
        totalGapRows: number
        maxRoundingCents: number
      },
    ]
  > = [
    [
      'Recibidos dic-2025 (G3)',
      IMPORT_FIXTURES.mcG3Dic,
      {
        headerRow: 1,
        kind: 'recibidos',
        layout: 'mc_g3',
        generation: 'g3',
        rows: 513,
        duplicateKeys: 0,
        creditNotes: 77,
        foreignCurrency: 8,
        totalGapRows: 0,
        maxRoundingCents: 35,
      },
    ],
    [
      'Recibidos nov-2025 (G3)',
      IMPORT_FIXTURES.mcG3Nov,
      {
        headerRow: 1,
        kind: 'recibidos',
        layout: 'mc_g3',
        generation: 'g3',
        rows: 539,
        duplicateKeys: 0,
        creditNotes: 75,
        foreignCurrency: 12,
        totalGapRows: 0,
        maxRoundingCents: 55,
      },
    ],
    [
      'Recibidos sep-24 → ago-25 (G2)',
      IMPORT_FIXTURES.mcG2Recibidos,
      {
        headerRow: 1,
        kind: 'recibidos',
        layout: 'mc_g2',
        generation: 'g2',
        rows: 1094,
        duplicateKeys: 0,
        creditNotes: 39,
        foreignCurrency: 12,
        totalGapRows: 112,
        maxRoundingCents: 4,
      },
    ],
    [
      'Emitidos sep-24 → ago-25 (G2)',
      IMPORT_FIXTURES.mcG2Emitidos,
      {
        headerRow: 1,
        kind: 'emitidos',
        layout: 'mc_g2',
        generation: 'g2',
        rows: 3543,
        duplicateKeys: 0,
        creditNotes: 25,
        foreignCurrency: 0,
        totalGapRows: 0,
        maxRoundingCents: 1,
      },
    ],
    [
      'Portal IVA compras (viejo)',
      IMPORT_FIXTURES.pivaViejo,
      {
        headerRow: 1,
        kind: 'portal_iva_compras',
        layout: 'portal_iva_compras',
        generation: 'g3',
        rows: 8,
        duplicateKeys: 0,
        creditNotes: 0,
        foreignCurrency: 0,
        totalGapRows: 0,
        maxRoundingCents: 5,
      },
    ],
    [
      'Portal IVA compras (nuevo)',
      IMPORT_FIXTURES.pivaNuevo,
      {
        headerRow: 1,
        kind: 'portal_iva_compras',
        layout: 'portal_iva_compras',
        generation: 'g3',
        rows: 4,
        duplicateKeys: 0,
        creditNotes: 0,
        foreignCurrency: 0,
        totalGapRows: 0,
        maxRoundingCents: 5,
      },
    ],
    [
      'Excel G3 (título + títulos cortos)',
      IMPORT_FIXTURES.mcXlsx,
      {
        headerRow: 2,
        kind: 'recibidos',
        layout: 'mc_xlsx',
        generation: 'g3',
        rows: 3,
        duplicateKeys: 0,
        creditNotes: 1,
        foreignCurrency: 0,
        totalGapRows: 0,
        maxRoundingCents: 0,
      },
    ],
    [
      'CSV G1 (coma, todo entre comillas)',
      IMPORT_FIXTURES.mcG1,
      {
        headerRow: 1,
        kind: 'recibidos',
        layout: 'mc_g1',
        generation: 'g1',
        rows: 1,
        duplicateKeys: 0,
        creditNotes: 0,
        foreignCurrency: 0,
        totalGapRows: 0,
        maxRoundingCents: 0,
      },
    ],
  ]

  for (const [label, file, expected] of table) {
    it(label, async () => {
      const r = await parseFixture(file)
      expect(r.ok).toBe(true)
      expect({
        headerRow: r.headerRow,
        kind: r.kind,
        layout: r.layout,
        generation: r.generation,
        rows: r.stats.rows,
        duplicateKeys: r.stats.duplicateKeys,
        creditNotes: r.stats.creditNotes,
        foreignCurrency: r.stats.foreignCurrency,
        totalGapRows: r.stats.totalGapRows,
        maxRoundingCents: r.stats.maxRoundingCents,
      }).toEqual(expected)
      expect(r.stats.errorRows).toBe(0)
      expect(r.rowErrors).toEqual([])
      expect(r.items).toHaveLength(expected.rows)
      expect(r.fileIssues).toEqual([])
    })
  }

  it('el Excel saca la CUIT del título; Recibidos G3 la del receptor', async () => {
    expect((await parseFixture(IMPORT_FIXTURES.mcXlsx)).titleCuit).toBe(SAS_CUIT)
    const dic = await parseFixture(IMPORT_FIXTURES.mcG3Dic)
    expect(dic.receiverCuit).toBe(SAS_CUIT)
    expect(dic.fileNameCuit).toBe('20123456786')
    expect(dic.period).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
})

// ─── Ida y vuelta: generador → archivo → parser ──────────────────────────────

describe('cada comprobante vuelve igual a como se generó', () => {
  it('G3 dic y nov (incluye USD con su tipo de cambio exacto)', async () => {
    expectRoundTrip(
      (await parseFixture(IMPORT_FIXTURES.mcG3Dic)).items,
      makeRecibidos(MC_DIC_SPEC),
      true,
    )
    expectRoundTrip(
      (await parseFixture(IMPORT_FIXTURES.mcG3Nov)).items,
      makeRecibidos(MC_NOV_SPEC),
      true,
    )
  })

  it('G2 recibidos y emitidos', async () => {
    expectRoundTrip(
      (await parseFixture(IMPORT_FIXTURES.mcG2Recibidos)).items,
      makeRecibidos(MC_G2_RECIBIDOS_SPEC),
      false,
    )
    expectRoundTrip(
      (await parseFixture(IMPORT_FIXTURES.mcG2Emitidos)).items,
      makeEmitidos(MC_G2_EMITIDOS_SPEC),
      false,
    )
  })

  it('Windows-1252 con «del Emisor»: las tildes llegan bien', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcCp1252)
    expect(r.layout).toBe('mc_g3')
    const synth = makeRecibidos(MC_SMALL_SPEC)
    expectRoundTrip(r.items, synth, true)
    expect(r.items.map((x) => x.item.issuerName)).toEqual(synth.map((v) => v.issuerName))
    expect(r.items.some((x) => /[ÁÉÍÓÚÑ]/.test(x.item.issuerName))).toBe(true)
  })
})

describe('Recibidos G3: forma de cada comprobante', () => {
  it('clave natural con el código de ARCA, importes positivos y datos acotados', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcG3Dic)
    for (const { key, item } of r.items) {
      expect(key).toBe(`mc:R:${item.issuerCuit}:${item.code}:${item.pointOfSale}:${item.number}`)
      expect(key.length).toBeLessThanOrEqual(200)
      expect(JSON.stringify(item).length).toBeLessThan(8192)
      for (const v of [
        ...Object.values(item.net),
        ...Object.values(item.vat),
        item.total,
        item.otherTaxes,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(Number.isSafeInteger(v)).toBe(true)
      }
      expect(item.receiverDoc).toBe(SAS_CUIT)
      expect(item.authCode).toMatch(/^\d{14}$/)
    }
    // Las NC vienen positivas: el sentido lo da el código.
    const nc = r.items.filter((x) => CREDIT_NOTE_CODES.has(x.item.code))
    expect(nc).toHaveLength(77)
    expect(nc.every((x) => x.item.total > 0)).toBe(true)
  })

  it('moneda extranjera va a revisión; los redondeos de ARCA quedan como dato', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcG3Dic)
    const usd = r.items.filter((x) => x.item.currency === 'USD')
    expect(usd).toHaveLength(8)
    for (const x of usd) {
      expect(codes(x)).toContain('mc_foreign_currency')
      expect(x.item.fxRate).not.toBe('1')
    }
    const rounding = r.items.filter((x) => codes(x).includes('mc_rounding'))
    expect(rounding.length).toBeGreaterThan(0)
    for (const x of rounding) {
      expect(Math.abs(x.item.total - mcComponentsSum(x.item))).toBeLessThanOrEqual(35)
    }
  })

  it('nov: tres comprobantes a nombre de un DNI van a revisión, el archivo es de la SAS', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcG3Nov)
    const dni = r.items.filter((x) => x.item.receiverDocType === 96)
    expect(dni).toHaveLength(3)
    for (const x of dni) expect(codes(x)).toContain('mc_receiver_mismatch')
    expect(r.items.filter((x) => codes(x).includes('mc_receiver_mismatch'))).toHaveLength(3)
    expect(r.fileIssues).toEqual([])
  })

  it('si el archivo es de otra CUIT, error del archivo', async () => {
    const other = makeCuit('30', 71_000_001)
    const r = await parseFixture(IMPORT_FIXTURES.mcG3Dic, other)
    expect(r.fileIssues.map((i) => i.code)).toEqual(['mc_other_cuit'])
    const xlsx = await parseFixture(IMPORT_FIXTURES.mcXlsx, other)
    expect(xlsx.fileIssues.map((i) => i.code)).toEqual(['mc_other_cuit'])
  })
})

describe('G2: alícuota deducida, percepciones sin detallar y B/C con otros tributos', () => {
  it('cada caso donde corresponde', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcG2Recibidos)
    const synth = makeRecibidos(MC_G2_RECIBIDOS_SPEC)
    let mixed = 0
    let gaps = 0
    let bcOther = 0
    r.items.forEach((x, i) => {
      const v = synth[i] as SynthVoucher
      const rates = Object.keys(v.net) as McRateKey[]
      if (v.discriminated && rates.length === 1) {
        const k = rates[0] as McRateKey
        expect(x.item.net[k]).toBe(v.netTotal)
        if (k !== 'r0') expect(x.item.vat[k]).toBe(v.vatTotal)
        expect(codes(x)).not.toContain('mc_rate_unknown')
      }
      if (rates.length > 1) {
        mixed++
        expect(codes(x)).toContain('mc_rate_unknown')
        expect(Object.values(x.item.net).every((c) => c === 0)).toBe(true)
      }
      if (codes(x).includes('mc_total_gap')) {
        gaps++
        const gap = x.issues.find((iss) => iss.code === 'mc_total_gap')
        expect(gap?.cents).toBeGreaterThan(100)
        expect(gap?.level).toBe('review')
      }
      if (!v.discriminated && v.otherTaxes > 0) {
        bcOther++
        expect(codes(x)).not.toContain('mc_total_gap')
        expect(codes(x)).not.toContain('mc_total_over')
      }
    })
    expect({ mixed, gaps, bcOther }).toEqual({ mixed: 20, gaps: 112, bcOther: 5 })
    // `DOL` → USD.
    expect(r.items.filter((x) => x.item.currency === 'USD')).toHaveLength(12)
  })
})

describe('Emitidos: sin datos de los clientes', () => {
  it('el emisor es la SAS; del receptor solo el tipo y una CUIT', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcG2Emitidos)
    expect(r.kind).toBe('emitidos')
    for (const { key, item } of r.items) {
      expect(key).toBe(`mc:E:${item.code}:${item.pointOfSale}:${item.number}:${item.numberTo}`)
      expect(item.issuerCuit).toBe(SAS_CUIT)
      expect(item.issuerName).toBe('')
      if (item.receiverDocType === 80) expect(item.receiverDoc).toMatch(/^\d{11}$/)
      else expect(item.receiverDoc).toBeNull()
    }
    const json = JSON.stringify(r.items)
    expect(json).not.toContain('CLIENTE DE PRUEBA')
    expect(new Set(r.items.map((x) => x.item.receiverDocType))).toEqual(new Set([80, 96, 99, 86]))
  })

  it('sin la CUIT de la SAS el emisor queda vacío (la clave no la usa)', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcG2Emitidos, null)
    expect(r.items[0]?.item.issuerCuit).toBe('')
    expect(r.fileIssues).toEqual([])
  })
})

describe('el CSV «pasado por Excel»', () => {
  it('se marca para pedir el ZIP original; el CAE dañado queda nulo', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcExcelResaved)
    expect(r.excelResaved).toBe(true)
    expect(r.fileIssues).toEqual([{ level: 'error', code: 'mc_excel_resaved', row: null }])
    const synth = makeRecibidos(MC_SMALL_SPEC)
    expect(r.items.map((x) => x.item.issueDate)).toEqual(synth.map((v) => v.date))
    for (const x of r.items) {
      expect(x.item.authCode).toBeNull()
      expect(codes(x)).toContain('mc_cae_damaged')
    }
  })
})

describe('G1 y el Excel, campo por campo', () => {
  it('G1: punto decimal, tipo con texto, ceros a la izquierda y nombre con coma', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcG1)
    expect(r.items[0]?.item).toEqual({
      kind: 'mc',
      issueDate: '2022-03-15',
      code: 1,
      pointOfSale: 2,
      number: 123,
      numberTo: 123,
      authCode: '72111111111111',
      issuerCuit: makeCuit('30', 61_234_567),
      issuerName: 'PROVEEDOR, UNO SA',
      receiverDocType: null,
      receiverDoc: null,
      currency: 'ARS',
      fxRate: '1',
      net: { r0: 0, r25: 0, r5: 0, r105: 0, r21: 10_000, r27: 0 },
      vat: { r25: 0, r5: 0, r105: 0, r21: 2_100, r27: 0 },
      netTotal: 10_000,
      nonTaxed: 0,
      exempt: 0,
      otherTaxes: 0,
      vatTotal: 2_100,
      total: 12_100,
      generation: 'g1',
    })
  })

  it('Excel: fecha como texto y como celda de fecha, CAE numérico y nombre en rich text', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.mcXlsx)
    const [a, nc, c] = r.items.map((x) => x.item)
    expect(a).toMatchObject({
      issueDate: '2025-12-01',
      code: 1,
      pointOfSale: 3,
      number: 110266,
      authCode: '75483269557186',
      issuerName: 'DISTRIBUIDORA EJEMPLO & CÍA SA',
      receiverDocType: 80,
      receiverDoc: SAS_CUIT,
      net: { r21: 2_768_595 },
      vat: { r21: 581_405 },
      total: 3_350_000,
    })
    expect(nc).toMatchObject({ issueDate: '2025-12-02', code: 3, total: 2_229_727 })
    expect(c).toMatchObject({
      code: 11,
      total: 25_500_000,
      netTotal: 0,
      authCode: '75481927731455',
    })
    expect(r.excelResaved).toBe(false)
  })
})

describe('Portal IVA: el desglose de «Otros Tributos»', () => {
  it('queda por clave natural y suma en otherTaxes', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.pivaViejo)
    for (const { key, item } of r.items) {
      const t = r.portalIvaTaxes[key]
      expect(t).toBeDefined()
      if (!t) continue
      expect(item.otherTaxes).toBe(
        t.percVat + t.percIibb + t.percOtherNational + t.municipal + t.internal,
      )
      if (item.code === 1) expect(t.vatComputable).toBe(item.vat.r21)
    }
    expect(r.items.some((x) => (r.portalIvaTaxes[x.key]?.percIibb ?? 0) > 0)).toBe(true)
    expect(r.items.some((x) => (r.portalIvaTaxes[x.key]?.percOtherNational ?? 0) > 0)).toBe(true)
  })
})

// ─── Filas raras (hechas a mano) ─────────────────────────────────────────────

const ISSUER = makeCuit('30', 55_667_788)
const HEADER = [...G3_RECIBIDOS_TITLES] as string[]
/** Una Factura A válida de G3; `over` cambia celdas por índice. */
function row(over: Record<number, string> = {}): string[] {
  const base = [
    '2025-12-01',
    '1',
    '3',
    '110266',
    '110266',
    '75483269557186',
    '80',
    ISSUER,
    'PROVEEDOR UNO SA',
    '80',
    SAS_CUIT,
    '1,00',
    '$',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '5814,05',
    '27685,95',
    '',
    '',
    '27685,95',
    '0,00',
    '0,00',
    '0,00',
    '5814,05',
    '33500,00',
  ]
  for (const [i, v] of Object.entries(over)) base[Number(i)] = v
  return base
}
const parseRows = (rows: string[][], sasCuit: string | null = SAS_CUIT) =>
  parseMisComprobantes(rows, { sasCuit })

describe('filas raras', () => {
  it('filas en blanco y pies se saltean', () => {
    const blank = HEADER.map(() => '')
    const r = parseRows([HEADER, row(), blank, ['Total', ...HEADER.slice(1).map(() => '')]])
    expect(r.items).toHaveLength(1)
    expect(r.rowErrors).toEqual([])
    expect(r.stats.rows).toBe(1)
  })

  it('una fila con otra cantidad de columnas es un error; celdas vacías de más, no', () => {
    const r = parseRows([HEADER, row().slice(0, 29), [...row(), '', '']])
    expect(r.rowErrors.map((i) => [i.row, i.code])).toContainEqual([2, 'mc_column_count'])
    expect(r.items.map((x) => x.row)).toEqual([3])
  })

  it('código desconocido (revisión), fecha y tipo ilegibles (error)', () => {
    const r = parseRows([
      HEADER,
      row({ 1: '999' }),
      row({ 0: '2025-13-01', 3: '2', 4: '2' }),
      row({ 1: 'X', 3: '3', 4: '3' }),
    ])
    expect(codes(r.items[0] ?? { issues: [] })).toContain('mc_unknown_code')
    expect(r.rowErrors.map((i) => i.code)).toEqual(['mc_bad_date', 'mc_bad_type'])
  })

  it('importe negativo: sin el signo y a revisión; notación científica: error y «pasó por Excel»', () => {
    const neg = parseRows([
      HEADER,
      row({ 20: '-5814,05', 21: '-27685,95', 24: '-27685,95', 28: '-5814,05', 29: '-33500,00' }),
    ])
    expect(neg.items[0]?.item.total).toBe(3_350_000)
    expect(codes(neg.items[0] ?? { issues: [] })).toContain('mc_negative_amount')
    const sci = parseRows([HEADER, row({ 29: '3,35E+04' })])
    expect(sci.rowErrors.map((i) => [i.code, i.field])).toEqual([['mc_bad_amount', 'total']])
    expect(sci.excelResaved).toBe(true)
  })

  it('cuadre: faltante, sobrante y redondeo; IVA total distinto de la suma', () => {
    const r = parseRows([
      HEADER,
      row({ 29: '35000,00' }),
      row({ 3: '2', 4: '2', 29: '33000,00' }),
      row({ 3: '3', 4: '3', 29: '33500,35' }),
      row({ 3: '4', 4: '4', 28: '5814,06', 29: '33500,01' }),
    ])
    const find = (n: number, code: string) => r.items[n]?.issues.find((i) => i.code === code)
    expect(find(0, 'mc_total_gap')).toMatchObject({ level: 'review', cents: 150_000 })
    expect(find(1, 'mc_total_over')).toMatchObject({ level: 'review', cents: -50_000 })
    expect(find(2, 'mc_rounding')).toMatchObject({ level: 'info', cents: 35 })
    expect(find(3, 'mc_vat_sum')).toMatchObject({ level: 'info', cents: 1 })
    expect(r.items[3]?.item.vatTotal).toBe(581_406)
    expect(r.stats).toMatchObject({ totalGapRows: 2, maxRoundingCents: 35 })
  })

  it('duplicados, rangos y el emisor', () => {
    const r = parseRows([
      HEADER,
      row(),
      row(),
      row({ 3: '5', 4: '9' }),
      row({ 3: '9', 4: '5' }),
      row({ 3: '10', 4: '10', 7: `${ISSUER.slice(0, 10)}${(Number(ISSUER[10]) + 1) % 10}` }),
      row({ 3: '11', 4: '11', 7: '' }),
    ])
    expect(r.stats.duplicateKeys).toBe(1)
    expect(codes(r.items[1] ?? { issues: [] })).toContain('mc_duplicate_key')
    expect(codes(r.items[2] ?? { issues: [] })).toContain('mc_range')
    expect(codes(r.items[3] ?? { issues: [] })).toContain('mc_issuer_check_digit')
    expect(r.rowErrors.map((i) => i.code)).toEqual(['mc_range', 'mc_bad_issuer'])
  })

  it('monedas: desconocida a revisión; tipo de cambio ilegible en dólares es error', () => {
    const r = parseRows([
      HEADER,
      row({ 12: 'BRL', 11: '250,5' }),
      row({ 3: '2', 4: '2', 12: 'USD', 11: 'abc' }),
    ])
    expect(r.items[0]?.item).toMatchObject({ currency: 'BRL', fxRate: '250.5' })
    expect(codes(r.items[0] ?? { issues: [] })).toEqual(
      expect.arrayContaining(['mc_unknown_currency', 'mc_foreign_currency']),
    )
    expect(r.rowErrors.map((i) => i.code)).toEqual(['mc_bad_fx'])
  })

  it('punto de venta y número en una sola columna (Excel de sep-2025)', () => {
    const r = parseMisComprobantes(
      [
        [
          'Fecha de Emisión',
          'Tipo de Comprobante',
          'Número de Comprobante',
          'Nro. Doc. Emisor',
          'Denominación Emisor',
          'Moneda',
          'Imp. Total',
        ],
        ['2025-12-01', '11', '00003-00110266', ISSUER, 'X', '$', '1000,00'],
      ],
      { sasCuit: SAS_CUIT },
    )
    expect(r.items[0]?.item).toMatchObject({ pointOfSale: 3, number: 110266, total: 100_000 })
    expect(r.items[0]?.key).toBe(`mc:R:${ISSUER}:11:3:110266`)
  })

  it('sin fila de títulos', () => {
    const r = parseMisComprobantes([['hola'], ['chau']])
    expect(r.ok).toBe(false)
    expect(r.fileIssues).toEqual([{ level: 'error', code: 'mc_no_header', row: null }])
  })
})

describe('utilidades', () => {
  it('inferVatRate', () => {
    expect(inferVatRate(100_000, 21_000)).toBe('r21')
    expect(inferVatRate(100_000, 21_004)).toBe('r21')
    expect(inferVatRate(100_000, 10_500)).toBe('r105')
    expect(inferVatRate(100_000, 27_000)).toBe('r27')
    expect(inferVatRate(1_000, 52)).toBe('r5')
    expect(inferVatRate(100_000, 0)).toBe('r0')
    expect(inferVatRate(100_000, 15_750)).toBeNull()
    expect(inferVatRate(0, 0)).toBeNull()
  })

  it('toVoucherCode, toDocType y normalizeCurrency', () => {
    expect(toVoucherCode('1 - Factura A')).toBe(1)
    expect(toVoucherCode('201 - Factura de Crédito Electrónica MiPyMEs (FCE) A')).toBe(201)
    expect(toVoucherCode('6.0')).toBe(6)
    expect(toVoucherCode(11)).toBe(11)
    expect(toVoucherCode('Factura')).toBeNull()
    expect(toDocType('CUIT')).toBe(80)
    expect(toDocType('DNI')).toBe(96)
    expect(toDocType('80')).toBe(80)
    expect(toDocType(96)).toBe(96)
    expect(toDocType('Pasaporte')).toBe(94)
    expect(toDocType('')).toBeNull()
    expect(normalizeCurrency('$')).toEqual({ code: 'ARS', known: true })
    expect(normalizeCurrency('PES')).toEqual({ code: 'ARS', known: true })
    expect(normalizeCurrency('DOL')).toEqual({ code: 'USD', known: true })
    expect(normalizeCurrency('U$S')).toEqual({ code: 'USD', known: true })
    expect(normalizeCurrency('060')).toEqual({ code: 'EUR', known: true })
    expect(normalizeCurrency('brl')).toEqual({ code: 'BRL', known: false })
  })

  it('mcNaturalKey', () => {
    const it = { issuerCuit: ISSUER, code: 201, pointOfSale: 3, number: 150, numberTo: 150 }
    expect(mcNaturalKey('recibidos', it)).toBe(`mc:R:${ISSUER}:201:3:150`)
    expect(mcNaturalKey('emitidos', it)).toBe('mc:E:201:3:150:150')
    // Factura A (1) y FCE A (201) con el mismo número no chocan.
    expect(mcNaturalKey('recibidos', { ...it, code: 1 })).not.toBe(mcNaturalKey('recibidos', it))
  })
})
