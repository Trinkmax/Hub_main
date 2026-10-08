/**
 * Extracto bancario → comprobantes (diseño §4.3.4, WP6): gastos bancarios del
 * día (comisión + IVA + RG 2408, Ley 25.413, SIRCREB, intereses), movimientos
 * entre cuentas, pagos y acreditaciones a confirmar, lo demás a revisar. Las
 * reglas del bar se evalúan con el subconjunto seguro (nunca un `RegExp` del
 * bar en el servidor). Cada propuesta lista pasa por zod, su `build*` y cuadra.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { suggestRulePattern } from '@/lib/imports/bank/rules'
import { parseBankStatement } from '@/lib/imports/bank/statement'
import { openTable } from '@/lib/imports/detect'
import {
  bankRulesFrom,
  buildBankDrafts,
  estimateDeductions,
  matchBankRule,
} from '@/lib/imports/server/proposals/bank'
import {
  batchTag,
  OpenItemPool,
  type ProposalDraft,
  type StagedItem,
} from '@/lib/imports/server/proposals/common'
import type { PostedTransfer } from '@/lib/imports/server/proposals/mp'
import {
  compileSafePattern,
  isSafePattern,
  normalizeForMatch,
  safePatternTest,
} from '@/lib/imports/server/safe-pattern'
import type { ProposalDecisions } from '@/lib/imports/server/types'
import type { BankItem } from '@/lib/imports/types'
import { IMPORT_FIXTURES, importFixture } from '@/tests/fixtures/imports/fixtures'
import { BANK_SUPPLIER_CUIT } from '@/tests/fixtures/imports/synth'
import { fixedUuid } from './accounting-core-context'
import {
  byKey,
  evaluateAll,
  expectPostable,
  KIT_BATCH,
  type Kit,
  makeKit,
  openPayable,
} from './imports-kit'

const TAG = batchTag(KIT_BATCH)

function kitFor(extra: Parameters<typeof makeKit>[0] = {}): Kit {
  return makeKit({
    suppliers: [{ cuit: BANK_SUPPLIER_CUIT, name: 'PROVEEDOR DEL BANCO SA' }],
    ...extra,
  })
}

let kit: Kit
let items: StagedItem<BankItem>[] = []
let bankId = ''

beforeAll(async () => {
  kit = kitFor()
  bankId = kit.f.treasury('banco').id
  const opened = await openTable({ bytes: importFixture(IMPORT_FIXTURES.bankDc) })
  if (!opened.ok) throw new Error(opened.issue.code)
  const parsed = parseBankStatement(opened.table.rows, null, {
    treasuryAccountId: bankId,
    delimiter: opened.table.signatureDelimiter,
  })
  expect(parsed.items).toHaveLength(17)
  items = parsed.items.map((r, i) => ({
    id: fixedUuid(970_000 + i),
    rowNo: r.row,
    key: r.key,
    status: 'new',
    item: r.item,
    issues: [...r.issues],
  }))
})

function run(
  o: {
    k?: Kit
    rules?: Parameters<typeof bankRulesFrom>[0]
    decisions?: Record<string, ProposalDecisions>
    manualExpenses?: string[]
    postedTransfers?: PostedTransfer[]
    rows?: StagedItem<BankItem>[]
  } = {},
) {
  const k = o.k ?? kit
  const { rules, skipped } = bankRulesFrom(o.rules ?? [])
  const drafts = buildBankDrafts({
    batchId: KIT_BATCH,
    treasuryId: k.f.treasury('banco').id,
    items: o.rows ?? items,
    catalog: k.imp,
    rules,
    pool: new OpenItemPool(k.ctx.openItems.values()),
    manualExpenses: new Set(o.manualExpenses ?? []),
    postedTransfers: o.postedTransfers ?? [],
    mpTreasuryId: k.f.treasury('mp').id,
    decisions: (key) => o.decisions?.[key] ?? {},
  })
  return { k, drafts, proposals: evaluateAll(drafts, k.ctx), skipped }
}

const expenseKey = (day: string) =>
  `bank:${bankId.replace(/-/g, '').slice(0, 8)}:${day}:gastos:${TAG}`
const rowKey = (description: string) => {
  const s = items.find((x) => x.item.description === description)
  if (!s) throw new Error(`Falta la fila ${description}`)
  return s.key
}
const valuesOf = (drafts: readonly ProposalDraft[], key: string) => {
  const d = drafts.find((x) => x.key === key)
  if (!d) throw new Error(`Falta ${key}: ${drafts.map((x) => x.key).join(', ')}`)
  return d.values as Record<string, unknown>
}

describe('gastos bancarios del día', () => {
  it('comisión con su IVA al 21 % y la percepción RG 2408: un solo gasto bancario', () => {
    const { drafts, proposals } = run()
    const key = expenseKey('2026-10-06')
    expectPostable(byKey(proposals, key), kit.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      treasuryAccountId: bankId,
      date: '2026-10-06',
      includeInIvaBook: false,
      voucher: null,
      feesNetCents: 6_900_000,
      vatRateBp: 2100,
      vatAdjustCents: 0,
      vatPerceptionCents: 207_000,
      feesNoVatCents: 0,
      ley25413CreditCents: 0,
      ley25413DebitCents: 0,
      sircrebCents: 0,
      interestCents: 0,
      others: [],
    })
    expect(byKey(proposals, key).summary).toMatchObject({
      kind: 'bank_expense',
      label: 'Gastos bancarios del 06/10',
      total_cents: 8_556_000,
      item_count: 3,
    })
  })

  it('Ley 25.413 sobre un crédito y sobre un débito (por el movimiento que la generó)', () => {
    const { drafts, proposals } = run()
    expectPostable(byKey(proposals, expenseKey('2026-10-01')), kit.ctx)
    expect(valuesOf(drafts, expenseKey('2026-10-01'))).toMatchObject({
      ley25413CreditCents: 90_000,
      ley25413DebitCents: 0,
    })
    expectPostable(byKey(proposals, expenseKey('2026-10-03')), kit.ctx)
    expect(valuesOf(drafts, expenseKey('2026-10-03'))).toMatchObject({
      ley25413CreditCents: 0,
      ley25413DebitCents: 51_000,
    })
  })

  it('SIRCREB, e intereses con su IVA al 10,5 % (el IVA va con el interés)', () => {
    const { drafts, proposals } = run()
    expectPostable(byKey(proposals, expenseKey('2026-10-02')), kit.ctx)
    expect(valuesOf(drafts, expenseKey('2026-10-02')).sircrebCents).toBe(145_500)
    expectPostable(byKey(proposals, expenseKey('2026-10-07')), kit.ctx)
    expect(valuesOf(drafts, expenseKey('2026-10-07'))).toMatchObject({
      interestCents: 100_000,
      others: [{ accountId: kit.sys('interest_expense'), amountCents: 10_500 }],
    })
  })

  it('el mismo día y total ya cargado a mano: «Ya está cargado»', () => {
    const { proposals } = run({ manualExpenses: ['2026-10-06:8556000'] })
    const p = byKey(proposals, expenseKey('2026-10-06'))
    expect(p.status).toBe('skipped')
    expect(p.error).toEqual({ reason: 'already_loaded', date: '2026-10-06' })
  })
})

describe('movimientos entre cuentas', () => {
  it('crédito desde Mercado Pago: transferencia de la billetera al banco', () => {
    const { drafts, proposals } = run()
    const key = `${rowKey('TRANSF MERCADOPAGO')}:transfer`
    expectPostable(byKey(proposals, key), kit.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      fromTreasuryId: kit.f.treasury('mp').id,
      toTreasuryId: bankId,
      amountCents: 10_000_000,
      date: '2026-10-02',
      reference: '558812',
    })
  })

  it('si Mercado Pago ya la cargó (±3 días), se saltea', () => {
    const doc = fixedUuid(31)
    const { proposals } = run({
      postedTransfers: [
        {
          documentId: doc,
          date: '2026-10-01',
          amountCents: 10_000_000,
          fromTreasuryId: kit.f.treasury('mp').id,
          toTreasuryId: bankId,
          label: 'Movimiento entre cuentas',
        },
      ],
    })
    const p = byKey(proposals, `${rowKey('TRANSF MERCADOPAGO')}:transfer`)
    expect(p.status).toBe('skipped')
    expect(p.error).toMatchObject({ reason: 'already_loaded', document_id: doc })
  })

  it('depósito de efectivo: de la caja al banco', () => {
    const { drafts, proposals } = run()
    const key = `${rowKey('CR-DEPEF')}:transfer`
    expectPostable(byKey(proposals, key), kit.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      fromTreasuryId: kit.f.treasury('caja').id,
      toTreasuryId: bankId,
      amountCents: 3_000_000,
    })
  })
})

describe('pagos y acreditaciones (se sugiere; la persona confirma)', () => {
  it('transferencia a un proveedor reconocido por CUIT, VEP de ARCA y sueldos', () => {
    const { proposals } = run()
    expect(
      byKey(proposals, `${rowKey(`DEB.TRAN.INTERB-LINK ${BANK_SUPPLIER_CUIT}`)}:pago`).needs,
    ).toEqual([
      {
        key: 'pick_party',
        role: 'supplier',
        suggested_party_id: kit.supplier(BANK_SUPPLIER_CUIT).id,
      },
    ])
    expect(byKey(proposals, `${rowKey('PAGO VEP AFIP')}:pago`).needs).toEqual([
      { key: 'pick_party', role: 'tax_agency', suggested_party_id: kit.f.party('arca').id },
    ])
    expect(byKey(proposals, `${rowKey('PAGO HABERES')}:pago`).needs).toEqual([
      { key: 'pick_party', role: 'payroll', suggested_party_id: kit.f.party('personal').id },
    ])
  })

  it('elegido el proveedor, el pago cancela sus facturas abiertas (la más vieja primero)', () => {
    const base = kitFor()
    const supplier = base.supplier(BANK_SUPPLIER_CUIT)
    const k = kitFor({
      openItems: [
        openPayable(base, {
          n: 1,
          partyId: supplier.id,
          payableAccountId: supplier.payableAccountId,
          day: '2026-10-01',
          cents: 5_000_000,
        }),
        openPayable(base, {
          n: 2,
          partyId: supplier.id,
          payableAccountId: supplier.payableAccountId,
          day: '2026-10-02',
          cents: 6_000_000,
        }),
      ],
    })
    const key = `${rowKey(`DEB.TRAN.INTERB-LINK ${BANK_SUPPLIER_CUIT}`)}:pago`
    const { drafts, proposals } = run({ k, decisions: { [key]: { party_id: supplier.id } } })
    expectPostable(byKey(proposals, key), k.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      partyId: supplier.id,
      applications: [
        { lineId: fixedUuid(620_001), amountCents: 5_000_000 },
        { lineId: fixedUuid(620_002), amountCents: 3_500_000 },
      ],
      methods: [
        { type: 'treasury', treasuryAccountId: k.f.treasury('banco').id, amountCents: 8_500_000 },
      ],
    })
  })

  it('acreditación de tarjetas: el procesador y los descuentos estimados (a confirmar)', () => {
    const { proposals } = run()
    const key = `${rowKey('LIQ+PAGOS NACIO')}:cobro`
    expect(byKey(proposals, key).needs).toEqual([
      { key: 'pick_party', role: 'card_processor', suggested_party_id: null },
    ])
    const credito = kit.f.party('posnetCredito').id
    const picked = run({ decisions: { [key]: { party_id: credito } } })
    // Sin tasas cargadas no hay nada que estimar: se acredita el neto.
    expectPostable(byKey(picked.proposals, key), kit.ctx)
  })

  it('el bruto que, menos los descuentos estimados, da el neto del banco', () => {
    const rates = {
      commissionBp: 180,
      iibbWithholdingBp: 120,
      vatWithholdingBp: 0,
      incomeTaxWithholdingBp: 0,
      sircupaBp: 0,
    }
    const { grossCents, deductions } = estimateDeductions(4_850_000, { rates })
    const total = deductions.reduce((a, d) => a + d.amountCents, 0)
    expect(grossCents).toBe(4_850_000 + total)
    expect(deductions.map((d) => d.taxKind)).toEqual(['comision', 'iva_comision', 'ret_iibb'])
    // ≈ 3,38 % de descuento total.
    expect(Math.abs(total / grossCents - 0.03378)).toBeLessThan(0.0005)
  })
})

describe('lo que va a revisar', () => {
  it('cobros a identificar, débitos automáticos y cheques', () => {
    const { proposals } = run()
    expect(byKey(proposals, `${rowKey(items[0]?.item.description ?? '')}:revisar`).needs).toEqual([
      { key: 'counterpart_account', direction: 'in' },
    ])
    expect(byKey(proposals, `${rowKey('DEBAUT SERVICIO LUZ')}:revisar`).needs).toEqual([
      { key: 'counterpart_account', direction: 'out' },
    ])
    expect(byKey(proposals, `${rowKey('48HS. CANJE ZONAL')}:revisar`).needs).toEqual([
      { key: 'manual', reason: 'cheque' },
    ])
  })

  it('todas las listas del extracto pasan por zod, su build* y cuadran', () => {
    const { proposals } = run()
    const ready = proposals.filter((p) => p.status === 'ready')
    // 5 días con gastos, el retiro de Mercado Pago y el depósito de efectivo.
    expect(ready).toHaveLength(7)
    for (const p of ready) expectPostable(p, kit.ctx)
    expect(proposals.filter((p) => p.status === 'needs_input')).toHaveLength(7)
  })
})

describe('reglas del bar (subconjunto seguro)', () => {
  const energy = () => {
    const a = kit.catalog.accounts.find((x) => x.name === 'Energía eléctrica')
    if (!a) throw new Error('falta la cuenta')
    return a.id
  }

  it('una regla con su cuenta deja listo el movimiento (y lo dice)', () => {
    const { proposals, skipped } = run({
      rules: [
        {
          id: fixedUuid(11),
          priority: 10,
          label: 'Luz',
          match: { pattern: suggestRulePattern('DEBAUT SERVICIO LUZ 123'), direction: 'debit' },
          action: { kind: 'movement', account_id: energy() },
        },
      ],
    })
    expect(skipped).toBe(0)
    const p = byKey(proposals, `${rowKey('DEBAUT SERVICIO LUZ')}:revisar`)
    expectPostable(p, kit.ctx)
    expect(p.summary.notes).toContain('rule_applied')
  })

  it('una regla con un patrón catastrófico no se evalúa (se saltea y se cuenta)', () => {
    const { proposals, skipped } = run({
      rules: [
        {
          id: fixedUuid(12),
          priority: 1,
          label: 'Mala',
          match: { pattern: '(a+)+$' },
          action: { kind: 'ignore' },
        },
      ],
    })
    expect(skipped).toBe(1)
    expect(proposals.some((p) => p.error?.reason === 'rule_ignore')).toBe(false)
  })

  it('ignorar, mandar a gastos sin IVA o a otra caja', () => {
    const k = kit
    const { proposals, drafts } = run({
      rules: [
        {
          id: fixedUuid(13),
          priority: 1,
          label: 'Canje',
          match: { pattern: '^48HS' },
          action: { kind: 'ignore' },
        },
        {
          id: fixedUuid(14),
          priority: 2,
          label: 'Débito de luz como gasto bancario',
          match: { pattern: 'DEBAUT', amount_max: 2_000_000 },
          action: { kind: 'expense_component', component: 'gastos_sin_iva' },
        },
        {
          id: fixedUuid(15),
          priority: 3,
          label: 'Transferencias del distribuidor a la caja',
          match: { pattern: 'CR\\.TRANF\\.INT' },
          action: { kind: 'transfer', treasury_account_id: k.f.treasury('caja').id },
        },
      ],
    })
    const canje = byKey(proposals, `${rowKey('48HS. CANJE ZONAL')}:regla`)
    expect(canje.status).toBe('skipped')
    expect(canje.error).toEqual({ reason: 'rule_ignore' })
    expect(valuesOf(drafts, expenseKey('2026-10-07')).feesNoVatCents).toBe(1_830_000)
    const transfer = byKey(proposals, `${rowKey(items[0]?.item.description ?? '')}:transfer`)
    expectPostable(transfer, k.ctx)
  })

  it('una regla sin ningún criterio (calzaría con todo) no se aplica', () => {
    const { rules, skipped } = bankRulesFrom([
      {
        id: 'x',
        priority: 1,
        label: 'Todo',
        match: { direction: 'debit' },
        action: { kind: 'ignore' },
      },
    ])
    expect(rules).toEqual([])
    expect(skipped).toBe(1)
  })

  it('el orden de prioridad, el sentido, la caja y el rango de importe', () => {
    const { rules } = bankRulesFrom([
      {
        id: 'b',
        priority: 20,
        label: 'B',
        match: { pattern: 'COMISION' },
        action: { kind: 'review' },
      },
      {
        id: 'a',
        priority: 10,
        label: 'A',
        match: { pattern: 'COMISION', direction: 'credit' },
        action: { kind: 'ignore' },
      },
      {
        id: 'c',
        priority: 5,
        label: 'C',
        match: { pattern: 'COMISION', amount_min: 10_000_000 },
        action: { kind: 'ignore' },
      },
    ])
    const it0 = { description: 'COMISION PAQUETES', amount: -6_900_000, counterpartyCuit: null }
    expect(matchBankRule(it0, rules, bankId)?.id).toBe('b')
  })
})

describe('el subconjunto seguro de patrones', () => {
  it('literal, «.*», «.», \\d, \\s, escapes, anclas y alternativas', () => {
    const t = (pattern: string, text: string) => {
      const p = compileSafePattern(pattern)
      if (!p) throw new Error(`no compila: ${pattern}`)
      return safePatternTest(p, text)
    }
    expect(t('TRANSF\\..*A.*FAC', 'TRANSF. A 30-71234567-1 FAC 123')).toBe(true)
    expect(t('transf.*fac', 'Transf. a proveedor, fac 1')).toBe(true)
    expect(t('^DEB', 'DEBAUT LUZ')).toBe(true)
    expect(t('^DEB', 'IMP DEB')).toBe(false)
    expect(t('LUZ$', 'DEBAUT LUZ')).toBe(true)
    expect(t('^DEBAUT LUZ$', 'DEBAUT  LUZ')).toBe(true)
    expect(t('VEP\\s+AFIP', 'PAGO VEP   AFIP')).toBe(true)
    expect(t('F\\d\\d\\d', 'F931 SUELDOS')).toBe(true)
    expect(t('F\\d\\d\\d', 'FXYZ')).toBe(false)
    expect(t('A.C', 'XABCX')).toBe(true)
    expect(t('VISA|MASTER', 'LIQ MASTER')).toBe(true)
    expect(t('CAFÉ', 'cafe del centro')).toBe(true)
    expect(t('SEÑA', 'SENA DE CLIENTE')).toBe(true)
    expect(t('^.*$', '')).toBe(true)
  })

  it('rechaza lo que no entra (y no arma nunca un RegExp)', () => {
    for (const bad of [
      '(a+)+$',
      '[abc]',
      'a{3}',
      'a+',
      'COMIS?ION',
      'x*',
      '\\w+',
      'IMP\\s*DEB',
      '|A',
      'A||B',
      'A^B',
      'a'.repeat(201),
      '',
      'A|B|C|D|E|F|G|H|I',
    ]) {
      expect(isSafePattern(bad), bad).toBe(false)
    }
  })

  it('tarda lo mismo con el peor patrón y la peor descripción', () => {
    const pattern = compileSafePattern(`${'A.*'.repeat(60)}B`)
    if (!pattern) throw new Error('no compila')
    const text = 'A'.repeat(240)
    const start = performance.now()
    for (let i = 0; i < 200; i++) safePatternTest(pattern, text)
    expect(performance.now() - start).toBeLessThan(1_000)
    expect(safePatternTest(pattern, text)).toBe(false)
  })

  it('la normalización es la de la descripción del banco', () => {
    expect(normalizeForMatch('  Débito  automático LUZ ')).toBe('DEBITO AUTOMATICO LUZ')
  })
})
