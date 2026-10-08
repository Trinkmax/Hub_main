import { describe, expect, it } from 'vitest'
import { groupDailyCharges, matchesRatio } from '@/lib/imports/bank/grouping'
import {
  ARCA_CUIT,
  type BankCategory,
  bankDirectionOf,
  type CustomBankRule,
  classifyBankItem,
  classifyDescription,
  compileBankRule,
  DEFAULT_BANK_RULES,
  MERCADOLIBRE_CUIT,
  suggestRulePattern,
} from '@/lib/imports/bank/rules'
import {
  type BankLayout,
  bankNaturalKey,
  candidateSignatures,
  findCuit,
  isValidCbu,
  layoutToMapping,
  mappingToLayout,
  normalizeBankDescription,
  parseBankStatement,
} from '@/lib/imports/bank/statement'
import { openTable } from '@/lib/imports/detect'
import { headerSignature } from '@/lib/imports/headers'
import type { BankItem } from '@/lib/imports/types'
import {
  IMPORT_FIXTURES,
  type ImportFixture,
  importFixture,
} from '@/tests/fixtures/imports/fixtures'
import {
  BANK_OPENING,
  BANK_SENDER_CUIT,
  BANK_SUPPLIER_CUIT,
  bankBalances,
  bankWeek,
  makeCuit,
  OWN_CBU,
  SAS_CUIT,
  TREASURY_ID,
} from '@/tests/fixtures/imports/synth'

async function parseFixture(file: ImportFixture) {
  const opened = await openTable({ bytes: importFixture(file), fileName: file })
  if (!opened.ok) throw new Error(opened.issue.code)
  return parseBankStatement(opened.table.rows, null, {
    treasuryAccountId: TREASURY_ID,
    delimiter: opened.table.signatureDelimiter,
  })
}

const amounts = (items: readonly { item: BankItem }[]) => items.map((x) => x.item.amount)

describe('NE24 en CSV: metadatos, Windows-1252, columna D/C y saldo', () => {
  it('lee todo y cierra el saldo', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.bankDc)
    const week = bankWeek()
    expect(r.ok).toBe(true)
    expect(r.needsMapping).toBe(false)
    expect(r.direction).toBe('dc')
    expect(r.layout).toMatchObject({ headerRow: 6, decimal: ',', dateOrder: 'dmy' })
    expect(r.layout?.columns).toEqual({
      date: 0,
      valueDate: 1,
      description: 2,
      voucher: 3,
      amount: 4,
      dc: 5,
      balance: 6,
    })
    expect(r.meta).toEqual({
      cbu: OWN_CBU,
      accountNumber: '1230012345',
      cuit: SAS_CUIT,
      currency: 'ARS',
    })
    expect(amounts(r.items)).toEqual(week.map((w) => w.amount))
    expect(r.items.map((x) => x.item.balance)).toEqual(bankBalances(week, BANK_OPENING))
    expect(r.items.every((x) => x.item.balanceOk === true)).toBe(true)
    expect(r.balanceCheck).toEqual({
      status: 'ok',
      mismatchRows: [],
      opening: BANK_OPENING,
      closing: 77_267_000,
      order: 'asc',
    })
    expect(r.period).toEqual({ from: '2026-10-01', to: '2026-10-07' })
    expect(r.rowErrors).toEqual([])
    expect(r.fileIssues).toEqual([])
  })

  it('cada fila: descripción, comprobante, contraparte por CUIT y clave natural', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.bankDc)
    const [first, , , , , sixth] = r.items
    expect(first?.row).toBe(9)
    expect(first?.item).toMatchObject({
      kind: 'bank',
      date: '2026-10-01',
      valueDate: '2026-10-01',
      description: `CR.TRANF.INT.DIST ${BANK_SENDER_CUIT}`,
      voucher: '102345',
      counterpartyCuit: BANK_SENDER_CUIT,
      counterpartyName: null,
      direction: 'dc',
      ordinal: 0,
    })
    expect(sixth?.item.counterpartyCuit).toBe(BANK_SUPPLIER_CUIT)
    for (const x of r.items) {
      expect(x.key).toBe(bankNaturalKey(TREASURY_ID, x.item))
      expect(x.key).toMatch(/^bank:[0-9a-f-]{36}:[0-9a-f]{64}:\d+$/)
      expect(x.key.length).toBeLessThanOrEqual(200)
    }
    expect(r.detectedFormat).toBe(`bank:${r.layoutSignature}`)
    expect(r.detectedFormat).toMatch(/^[a-z0-9_:-]{2,80}$/)
  })

  it('un saldo que no cierra NO frena: la fila queda con aviso', async () => {
    const opened = await openTable({ bytes: importFixture(IMPORT_FIXTURES.bankDc) })
    if (!opened.ok) throw new Error('no abrió')
    const rows = opened.table.rows.map((r) => [...r])
    const target = rows[12] as (string | number | boolean | null)[]
    target[6] = '1.000,00'
    const r = parseBankStatement(rows, null, { treasuryAccountId: TREASURY_ID })
    expect(r.items).toHaveLength(17)
    expect(r.balanceCheck.status).toBe('mismatch')
    expect(r.balanceCheck.mismatchRows).toContain(13)
    const flagged = r.items.find((x) => x.row === 13)
    expect(flagged?.issues.map((i) => i.code)).toEqual(['bank_balance_mismatch'])
    expect(flagged?.item.balanceOk).toBe(false)
  })
})

describe('TXT con «|» e importe con signo', () => {
  it('pendientes afuera, filas idénticas con ordinal, sin saldo', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.bankSigned)
    expect(r.direction).toBe('sign')
    expect(amounts(r.items)).toEqual([-95_600, -20_076, -600, -600, 25_000_000, -150_000_000])
    const [, , a, b] = r.items
    expect(a?.item.fingerprint).toBe(b?.item.fingerprint)
    expect([a?.item.ordinal, b?.item.ordinal]).toEqual([0, 1])
    expect(a?.key).not.toBe(b?.key)
    expect(r.fileIssues).toEqual([{ level: 'info', code: 'bank_pending_skipped', row: 9 }])
    expect(r.balanceCheck).toMatchObject({ status: 'unavailable', opening: null, closing: null })
    expect(r.items.every((x) => x.item.balanceOk === null)).toBe(true)
  })

  it('reimportar el mismo archivo da las mismas claves', async () => {
    const a = await parseFixture(IMPORT_FIXTURES.bankSigned)
    const b = await parseFixture(IMPORT_FIXTURES.bankSigned)
    expect(b.items.map((x) => x.key)).toEqual(a.items.map((x) => x.key))
  })
})

describe('CSV con punto decimal, sin signo y del más nuevo al más viejo', () => {
  it('se da vuelta y el sentido sale de la diferencia de saldo', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.bankBalance)
    expect(r.direction).toBe('balance_diff')
    expect(r.balanceCheck).toEqual({
      status: 'ok',
      mismatchRows: [],
      opening: 200_000,
      closing: -245_600,
      order: 'desc',
    })
    expect(r.items.map((x) => [x.row, x.item.date, x.item.amount, x.item.balance])).toEqual([
      [5, '2026-10-12', 300_000, 500_000],
      [4, '2026-10-13', -900_000, -400_000],
      [3, '2026-10-13', -95_600, -495_600],
      [2, '2026-10-14', 250_000, -245_600],
    ])
    expect(r.items.every((x) => x.item.direction === 'balance_diff' && x.issues.length === 0)).toBe(
      true,
    )
  })
})

describe('XLSX y HTML con columnas Débito y Crédito', () => {
  it('xlsx: fechas como celdas de fecha e importes numéricos', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.bankXlsx)
    const week = bankWeek().slice(0, 8)
    expect(r.direction).toBe('columns')
    expect(r.meta.cbu).toBe(OWN_CBU)
    expect(r.meta.currency).toBe('ARS')
    expect(r.items.map((x) => x.item.date)).toEqual(week.map((w) => w.date))
    expect(amounts(r.items)).toEqual(week.map((w) => w.amount))
    expect(r.balanceCheck).toMatchObject({ status: 'ok', opening: BANK_OPENING })
    // Sin «SALDO ANTERIOR», la primera fila no tiene con qué compararse.
    expect(r.items[0]?.item.balanceOk).toBeNull()
    expect(r.items[1]?.item.balanceOk).toBe(true)
  })

  it('html: el «.xls» que es una página', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.bankHtml)
    expect(r.direction).toBe('columns')
    expect(r.meta.cbu).toBe(OWN_CBU)
    expect(amounts(r.items)).toEqual(
      bankWeek()
        .slice(8)
        .map((w) => w.amount),
    )
    expect(r.balanceCheck.status).toBe('ok')
  })
})

describe('formato desconocido: el mapeo de columnas', () => {
  const rows = [
    ['Columna A', 'Columna B', 'Columna C'],
    ['01/10/2026', 'TRANSF', '1.000,00'],
    ['02/10/2026', 'CR TRANSF', '500,00'],
  ]
  const layout: BankLayout = {
    headerRow: 0,
    columns: { date: 0, description: 1, amount: 2 },
    decimal: ',',
    dateOrder: 'dmy',
  }

  it('pide el mapeo y propone la fila de títulos', () => {
    const r = parseBankStatement(rows, null, { treasuryAccountId: TREASURY_ID })
    expect(r).toMatchObject({ ok: false, needsMapping: true, candidateHeaderRow: 0, items: [] })
    expect(r.fileIssues.map((i) => i.code)).toEqual(['bank_needs_mapping'])
  })

  it('con el mapeo guardado: sin signo ni saldo, el sentido es una suposición a revisar', () => {
    const r = parseBankStatement(rows, layout, { treasuryAccountId: TREASURY_ID, delimiter: ';' })
    expect(r.direction).toBe('text')
    expect(amounts(r.items)).toEqual([-100_000, 50_000])
    expect(r.items.every((x) => x.issues.some((i) => i.code === 'bank_direction_guess'))).toBe(true)
    expect(r.layoutSignature).toBe(headerSignature(rows[0] ?? [], ';'))
  })

  it('la firma de los títulos encuentra el mapeo; el mapeo va y vuelve de la base', () => {
    const signatures = candidateSignatures(rows, ';')
    expect(signatures[0]).toEqual({ index: 0, signature: headerSignature(rows[0] ?? [], ';') })
    const mapping = layoutToMapping(layout)
    expect(mapping).toEqual({
      header_row: 0,
      decimal: ',',
      date_order: 'dmy',
      date: 0,
      description: 1,
      amount: 2,
    })
    expect(mappingToLayout(JSON.parse(JSON.stringify(mapping)))).toEqual(layout)
    expect(mappingToLayout({ header_row: 0, date: 0 })).toBeNull()
    expect(mappingToLayout({ header_row: -1, date: 0, description: 1, amount: 2 })).toBeNull()
    expect(mappingToLayout('x')).toBeNull()
  })
})

describe('casos de borde del extracto', () => {
  it('sin saldo anterior, la primera fila se adivina por el texto (a revisar) y el resto por saldo', () => {
    const r = parseBankStatement(
      [
        ['Fecha', 'Descripción', 'Importe', 'Saldo'],
        ['01/10/2026', 'CR TRANSF', '100,00', '1.100,00'],
        ['02/10/2026', 'COMISION', '10,00', '1.090,00'],
      ],
      null,
      { treasuryAccountId: TREASURY_ID },
    )
    expect(r.direction).toBe('balance_diff')
    expect(amounts(r.items)).toEqual([10_000, -1_000])
    expect(r.items[0]?.item.direction).toBe('text')
    expect(r.items[0]?.issues.map((i) => i.code)).toEqual(['bank_direction_guess'])
    expect(r.items[1]?.item.direction).toBe('balance_diff')
  })

  it('débito y crédito a la vez, D/C ilegible, importe roto, fecha rota, totales y descripción en dos renglones', () => {
    const r = parseBankStatement(
      [
        ['Fecha', 'Descripción', 'Débito', 'Crédito'],
        ['01/10/2026', 'RARO', '5,00', '7,00'],
        ['01/10/2026', 'PAGO', 'abc', ''],
        ['xx/10/2026', 'PAGO', '1,00', ''],
        ['02/10/2026', 'TRANSFERENCIA A', '10,00', ''],
        ['', 'PROVEEDOR EJEMPLO', '', ''],
        ['', 'TOTAL DEBITOS', '16,00', ''],
        ['03/10/2026', 'NO LLEGA', '1,00', ''],
      ],
      null,
      { treasuryAccountId: TREASURY_ID },
    )
    expect(r.items.map((x) => [x.item.description, x.item.amount])).toEqual([
      ['RARO', 200],
      ['TRANSFERENCIA A PROVEEDOR EJEMPLO', -1_000],
    ])
    expect(r.items[0]?.issues.map((i) => i.code)).toEqual(['bank_both_sides'])
    expect(r.rowErrors.map((i) => [i.row, i.code])).toEqual([
      [3, 'bank_bad_amount'],
      [4, 'bank_bad_date'],
    ])
  })

  it('columna D/C: un valor ilegible va a revisión; una «Tipo» con nombres de operación no es D/C', () => {
    const dc = parseBankStatement(
      [
        ['Fecha', 'Concepto', 'Importe', 'D/C', 'Saldo'],
        ['01/10/2026', 'A', '5,00', 'D', '95,00'],
        ['01/10/2026', 'B', '5,00', 'H', '100,00'],
        ['01/10/2026', 'C', '5,00', 'Crédito', '105,00'],
        ['01/10/2026', 'D', '5,00', 'DB', '100,00'],
        ['01/10/2026', 'E', '5,00', '?', '95,00'],
      ],
      null,
      { treasuryAccountId: TREASURY_ID },
    )
    expect(dc.direction).toBe('dc')
    expect(amounts(dc.items)).toEqual([-500, 500, 500, -500, -500])
    expect(dc.items[4]?.item.direction).toBe('balance_diff')
    expect(dc.items[4]?.issues.map((i) => i.code)).toEqual(['bank_dc_unknown'])

    const tipo = parseBankStatement(
      [
        ['Fecha', 'Concepto', 'Tipo', 'Importe'],
        ['01/10/2026', 'X', 'Transferencia', '-5,00'],
        ['02/10/2026', 'Y', 'Débito automático', '7,00'],
      ],
      null,
      { treasuryAccountId: TREASURY_ID },
    )
    expect(tipo.direction).toBe('sign')
    expect(amounts(tipo.items)).toEqual([-500, 700])
    expect(tipo.items.every((x) => x.issues.length === 0)).toBe(true)
  })

  it('un saldo anterior negativo no cambia el modo', () => {
    const r = parseBankStatement(
      [
        ['Fecha', 'Concepto', 'Importe', 'Saldo'],
        ['01/10/2026', 'SALDO ANTERIOR', '-50,00', '-50,00'],
        ['01/10/2026', 'CR INTERB', '80,00', '30,00'],
        ['02/10/2026', 'COMISION', '10,00', '20,00'],
      ],
      null,
      { treasuryAccountId: TREASURY_ID },
    )
    expect(r.direction).toBe('balance_diff')
    expect(r.balanceCheck.opening).toBe(-5_000)
    expect(amounts(r.items)).toEqual([8_000, -1_000])
  })

  it('un extracto en dólares avisa', () => {
    const r = parseBankStatement(
      [['Cuenta en U$S 123456'], ['Fecha', 'Concepto', 'Importe'], ['01/10/2026', 'X', '-5,00']],
      null,
      { treasuryAccountId: TREASURY_ID },
    )
    expect(r.meta.currency).toBe('USD')
    expect(r.fileIssues.map((i) => i.code)).toEqual(['bank_foreign_currency'])
  })
})

describe('utilidades del extracto', () => {
  it('isValidCbu, findCuit y normalizeBankDescription', () => {
    expect(isValidCbu(OWN_CBU)).toBe(true)
    expect(isValidCbu(`${OWN_CBU.slice(0, 21)}${(Number(OWN_CBU[21]) + 1) % 10}`)).toBe(false)
    expect(isValidCbu('123')).toBe(false)
    expect(findCuit(`TRANSF DE 30-71234567-1 FAC 1`)).toBe(SAS_CUIT)
    expect(findCuit('DEBIN 30123456789')).toBeNull()
    expect(findCuit('sin cuit')).toBeNull()
    expect(normalizeBankDescription('  Depósito   en  efectivo ')).toBe('DEPOSITO EN EFECTIVO')
  })
})

// ─── Reglas ──────────────────────────────────────────────────────────────────

/** Las 53 descripciones de `banco-scripts/check-rules.mjs` con la regla en la que cayeron. */
const CHECK_RULES_SAMPLES: ReadonlyArray<readonly [string, 'D' | 'C', number]> = [
  ['IMP AL DEB/CRED', 'D', 1],
  ['GRAVAMEN LEY 25413 S/DEBITOS', 'D', 1],
  ['IMP LEY 25413', 'D', 1],
  ['IMPUESTO LEY 25.413 CREDITO 0,6%', 'D', 1],
  ['REG REC SIRCREB', 'D', 2],
  ['D SIRCREB', 'D', 2],
  ['REGIMEN DE RECAUDACION SIRCREB C', 'D', 2],
  ['DBSIR021', 'D', 2],
  ['RETEN. I.V.A. RG.2408', 'D', 3],
  ['PERCEPCION IVA RG 2408', 'D', 3],
  ['I.V.A. BASE', 'D', 4],
  ['IVA 21% REG DE TRANSFISC LEY27743', 'D', 4],
  ['INTERESES S/SALDO DEUDOR', 'D', 5],
  ['COMISION PAQUETES', 'D', 6],
  ['COMIS.TRANSF.NE24', 'D', 6],
  ['COMIS. CANJE O/BANCOS', 'D', 6],
  ['COMIS.DE COMPROMISO', 'D', 6],
  ['48HS. BANCOS', 'D', 7],
  ['48HS. CANJE ZONAL', 'C', 7],
  ['LIQ+PAGOS NACIO', 'C', 8],
  ['ACRED PR-ADEL+PAGOSNACION', 'C', 8],
  ['PAGO CON TRANSF', 'C', 9],
  ['ACREDITAMIENTO PRISMA COMERCIOS', 'C', 8],
  ['CREDITO TRANSFERENCIA COELSA', 'C', 18],
  ['DB PM/TOT RESUMEN TCORP', 'D', 11],
  ['DEB. LIQ VISA', 'D', 11],
  ['PAGO VEP AFIP', 'D', 12],
  ['INGR.BRUTOS/SELLOS BS.AS.', 'D', 13],
  ['PAGO HABERES', 'D', 14],
  ['DEBAUT EPEC', 'D', 15],
  ['DA NACION SE', 'D', 15],
  ['CR-DEPEF', 'C', 16],
  ['DEPOSITO EFECTIVO', 'C', 16],
  ['EXTCAJER', 'D', 17],
  ['CR.TRANF.INT.DIST', 'C', 18],
  ['TRANSF.INT.DIST', 'C', 18],
  ['DEBIN 30123456789', 'C', 18],
  ['DEBIN 30123456789', 'D', 19],
  ['DEB.TRAN.INTERB-LINK', 'D', 19],
  ['DB CREDIN TRANS-LINKCIA', 'D', 19],
  ['CR.AJ.LK.REC', 'C', 20],
  ['PRIVADA ALGO', 'D', 21],
  ['TRANSFERENCIA RECIBIDA', 'C', 18],
  ['TRANSF. A TERCEROS', 'D', 19],
  ['DB TRF/G NL', 'D', 19],
  ['CRTRABEE', 'C', 18],
  ['TRANSFERENCIA EMITIDA', 'D', 19],
  ['CR INTERB', 'C', 18],
  ['TRANSF MERCADOPAGO', 'C', 10],
  ['CREDITO TRANSFERENCIA COELSA', 'C', 18],
  ['SEGURO DE VIDA', 'D', 15],
  ['DEVOLUCION PCT', 'D', 20],
  ['CREDITO INTERESES PF', 'C', 21],
]

describe('DEFAULT_BANK_RULES (la tabla maestra de banco.md §2.10)', () => {
  it('son 21, en orden, y la última es «a identificar»', () => {
    expect(DEFAULT_BANK_RULES.map((r) => r.id)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
    expect(DEFAULT_BANK_RULES[20]).toMatchObject({ category: 'a_identificar', pattern: null })
  })

  it('las 53 descripciones de check-rules.mjs caen en su regla', () => {
    expect(CHECK_RULES_SAMPLES).toHaveLength(53)
    for (const [description, dc, expected] of CHECK_RULES_SAMPLES) {
      expect({ description, dc, rule: classifyDescription(description, dc).id }).toEqual({
        description,
        dc,
        rule: expected,
      })
      const viaItem = classifyBankItem({
        description,
        amount: dc === 'C' ? 100 : -100,
        counterpartyCuit: null,
      })
      expect(viaItem.ruleId).toBe(`default:${expected}`)
    }
  })

  it('el sentido sale del importe, nunca del texto', () => {
    expect(bankDirectionOf(-1)).toBe('D')
    expect(bankDirectionOf(1)).toBe('C')
    expect(
      classifyBankItem({
        description: 'IMPUESTO LEY 25.413 CREDITO 0,6%',
        amount: -5,
        counterpartyCuit: null,
      }).category,
    ).toBe('ley25413')
  })

  it('la contraparte también clasifica: la propia CUIT, Mercado Libre y ARCA', () => {
    const transfer = (amount: number, cuit: string) =>
      classifyBankItem(
        { description: 'TRANSFERENCIA', amount, counterpartyCuit: cuit },
        { ownCuit: SAS_CUIT },
      ).category
    expect(transfer(100, SAS_CUIT)).toBe('propias_mp')
    expect(transfer(100, MERCADOLIBRE_CUIT)).toBe('propias_mp')
    expect(transfer(-100, ARCA_CUIT)).toBe('arca')
    expect(transfer(100, makeCuit('30', 60_000_000))).toBe('transf_in')
  })
})

describe('reglas del bar', () => {
  const rule = (
    over: Partial<{ id: string; priority: number; label: string; match: unknown; action: unknown }>,
  ) =>
    compileBankRule({
      id: 'r1',
      priority: 100,
      label: 'Alquiler del local',
      match: { direction: 'D', pattern: 'TRANSF\\. A TERCEROS', amount_min: 100_000_000 },
      action: { kind: 'payment', party_id: 'p1' },
      ...over,
    }) as CustomBankRule

  it('van antes que las de fábrica, con sentido, expresión e importe mínimo', () => {
    const r = rule({})
    expect(r).toMatchObject({
      direction: 'D',
      amountMin: 100_000_000,
      amountMax: null,
      counterpartyCuit: null,
    })
    const item = { description: 'TRANSF. A TERCEROS', amount: -150_000_000, counterpartyCuit: null }
    expect(classifyBankItem(item, { custom: [r] })).toEqual({
      ruleId: 'r1',
      category: null,
      label: 'Alquiler del local',
      confidence: 'alta',
      custom: true,
      action: { kind: 'payment', party_id: 'p1' },
    })
    expect(classifyBankItem({ ...item, amount: -1_000 }, { custom: [r] }).ruleId).toBe('default:19')
    expect(classifyBankItem({ ...item, amount: 150_000_000 }, { custom: [r] }).ruleId).toBe(
      'default:18',
    )
  })

  it('prioridad, caja y CUIT de la contraparte', () => {
    const general = rule({ id: 'general', priority: 50, match: { pattern: 'TRANSF' } })
    const specific = rule({
      id: 'especifica',
      priority: 10,
      match: { pattern: 'TRANSF', counterparty_cuit: '30-71234567-1' },
    })
    const other = rule({
      id: 'otra-caja',
      priority: 1,
      match: { pattern: 'TRANSF', treasury_account_id: 'caja-x' },
    })
    const item = { description: 'TRANSF RECIBIDA', amount: 500, counterpartyCuit: SAS_CUIT }
    const opts = { custom: [general, specific, other], treasuryAccountId: TREASURY_ID }
    expect(classifyBankItem(item, opts).ruleId).toBe('especifica')
    expect(classifyBankItem({ ...item, counterpartyCuit: null }, opts).ruleId).toBe('general')
  })

  it('reglas inválidas no se compilan', () => {
    expect(
      compileBankRule({ id: 'x', priority: 1, label: 'x', match: { pattern: '(' }, action: {} }),
    ).toBeNull()
    expect(compileBankRule({ id: 'x', priority: 1, label: 'x', match: {}, action: {} })).toBeNull()
    expect(
      compileBankRule({
        id: 'x',
        priority: 1,
        label: 'x',
        match: { pattern: 'A'.repeat(201) },
        action: {},
      }),
    ).toBeNull()
    expect(
      compileBankRule({ id: 'x', priority: 1, label: 'x', match: null, action: {} }),
    ).toBeNull()
  })

  it('«Crear regla» propone la descripción sin números ni CUIT', () => {
    const description = 'TRANSF. A 30-71234567-1 FAC 123'
    const pattern = suggestRulePattern(description)
    expect(pattern).toBe('TRANSF\\..*A.*FAC')
    const compiled = rule({ match: { pattern } })
    expect(
      classifyBankItem(
        { description: 'TRANSF. A 30-99999999-9 FAC 9', amount: -5, counterpartyCuit: null },
        { custom: [compiled] },
      ).custom,
    ).toBe(true)
  })
})

// ─── Agrupación del día ──────────────────────────────────────────────────────

describe('groupDailyCharges', () => {
  it('la semana de BNA: comisión con IVA 21 % y percepción 3 %, intereses con IVA 10,5 % y Ley 25.413', async () => {
    const r = await parseFixture(IMPORT_FIXTURES.bankDc)
    const items = r.items.map((x) => x.item)
    const idx = (description: string, date: string) =>
      items.findIndex((it) => it.description === description && it.date === date)
    const g = groupDailyCharges(items)
    expect(g.unmatched).toEqual([])
    expect(g.groups).toEqual([
      {
        date: '2026-10-01',
        motherIndexes: [idx(`CR.TRANF.INT.DIST ${BANK_SENDER_CUIT}`, '2026-10-01')],
        children: [
          { index: idx('IMP AL DEB/CRED', '2026-10-01'), kind: 'ley25413', expectedCents: 90_000 },
        ],
      },
      {
        date: '2026-10-03',
        motherIndexes: [idx(`DEB.TRAN.INTERB-LINK ${BANK_SUPPLIER_CUIT}`, '2026-10-03')],
        children: [
          { index: idx('IMP AL DEB/CRED', '2026-10-03'), kind: 'ley25413', expectedCents: 51_000 },
        ],
      },
      {
        date: '2026-10-06',
        motherIndexes: [idx('COMISION PAQUETES', '2026-10-06')],
        children: [
          { index: idx('I.V.A. BASE', '2026-10-06'), kind: 'iva_21', expectedCents: 1_449_000 },
          {
            index: idx('RETEN. I.V.A. RG.2408', '2026-10-06'),
            kind: 'perc_iva_3',
            expectedCents: 207_000,
          },
        ],
      },
      {
        date: '2026-10-07',
        motherIndexes: [idx('INTERESES S/SALDO DEUDOR', '2026-10-07')],
        children: [
          { index: idx('I.V.A. BASE', '2026-10-07'), kind: 'iva_105', expectedCents: 10_500 },
        ],
      },
    ])
    expect(g.ivaRates).toEqual({
      [idx('I.V.A. BASE', '2026-10-06')]: 'iva_21',
      [idx('I.V.A. BASE', '2026-10-07')]: 'iva_105',
    })
  })

  it('el IVA de la suma de dos comisiones del día; lo que no calza queda suelto', () => {
    const day = (description: string, amount: number) => ({
      date: '2026-10-08',
      description,
      amount,
      counterpartyCuit: null,
    })
    const items = [
      day('COMIS.TRANSF.NE24', -10_000),
      day('COMISION PAQUETES', -20_000),
      day('I.V.A. BASE', -6_300),
      day('RETEN. I.V.A. RG.2408', -123),
    ]
    const g = groupDailyCharges(items)
    expect(g.groups).toEqual([
      {
        date: '2026-10-08',
        motherIndexes: [0, 1],
        children: [{ index: 2, kind: 'iva_21', expectedCents: 6_300 }],
      },
    ])
    expect(g.unmatched).toEqual([3])
  })

  it('acepta las categorías ya calculadas y la tolerancia es ±1 centavo o 0,5 %', () => {
    const cats: BankCategory[] = ['comisiones', 'iva_cf']
    const g = groupDailyCharges(
      [
        { date: '2026-10-08', description: 'X', amount: -1_000, counterpartyCuit: null },
        { date: '2026-10-08', description: 'Y', amount: -211, counterpartyCuit: null },
      ],
      cats,
    )
    expect(g.groups[0]?.children[0]?.kind).toBe('iva_21')
    expect(matchesRatio(1_449_000, 6_900_000, 2100)).toBe(true)
    expect(matchesRatio(1_456_000, 6_900_000, 2100)).toBe(true)
    expect(matchesRatio(1_457_000, 6_900_000, 2100)).toBe(false)
    expect(matchesRatio(0, 0, 2100)).toBe(false)
  })
})
