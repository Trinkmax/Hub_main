/**
 * Mercado Pago (reporte de Liquidaciones) → comprobantes (diseño §4.2.3, WP6):
 * cobros por día y medio con comisión, IVA a documentar, SIRTAC y SIRCUPA; la
 * Ley 25.413 aparte; retiros, rendimientos, IIBB cobrado después y lo que va a
 * revisar. Cada propuesta lista pasa por zod, su `build*` y cuadra.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { netFromGross } from '@/lib/accounting/iva'
import { openTable } from '@/lib/imports/detect'
import { type MpReleaseContext, parseReleaseReport } from '@/lib/imports/mercadopago/release'
import {
  batchTag,
  OpenItemPool,
  type ProposalDraft,
  type StagedItem,
} from '@/lib/imports/server/proposals/common'
import {
  buildMpDrafts,
  classifyMpTax,
  findPostedTransfer,
  type MpSettings,
  type MpTaxRule,
  mpTaxRulesFrom,
  type PostedTransfer,
} from '@/lib/imports/server/proposals/mp'
import { mpSettingsFor } from '@/lib/imports/server/propose'
import { compileSafePattern } from '@/lib/imports/server/safe-pattern'
import type { ProposalDecisions } from '@/lib/imports/server/types'
import type { MpItem } from '@/lib/imports/types'
import { IMPORT_FIXTURES, importFixture } from '@/tests/fixtures/imports/fixtures'
import { OWN_CBU, OWN_CVU, SAS_CUIT } from '@/tests/fixtures/imports/synth'
import { fixedUuid } from './accounting-core-context'
import {
  byKey,
  evaluateAll,
  expectPostable,
  KIT_BATCH,
  type Kit,
  makeKit,
  openReceivable,
  stagedFrom,
} from './imports-kit'

const CTX: MpReleaseContext = { sasCuit: SAS_CUIT, ownCbus: [OWN_CBU, OWN_CVU], cutoffHour: 0 }
const TAG = batchTag(KIT_BATCH)

let items: StagedItem<MpItem>[] = []

beforeAll(async () => {
  const opened = await openTable({ bytes: importFixture(IMPORT_FIXTURES.mpRelease) })
  if (!opened.ok) throw new Error(opened.issue.code)
  const parsed = parseReleaseReport(opened.table.rows, CTX)
  expect(parsed.items).toHaveLength(19)
  items = stagedFrom(parsed.items)
})

function kitWithCloses(): Kit {
  const base = makeKit({ cbu: { banco: OWN_CBU, mp: OWN_CVU } })
  return makeKit({
    cbu: { banco: OWN_CBU, mp: OWN_CVU },
    openItems: [
      openReceivable(base, {
        n: 1,
        party: 'mercadopago',
        method: 'qr',
        day: '2026-10-01',
        cents: 9_000_000,
      }),
      openReceivable(base, {
        n: 2,
        party: 'mercadopago',
        method: 'transfer',
        day: '2026-10-01',
        cents: 4_000_000,
      }),
    ],
  })
}

function settingsOf(kit: Kit, channels: MpSettings['channelMethods'] = {}): MpSettings {
  return {
    treasuryId: kit.f.treasury('mp').id,
    partyId: kit.f.party('mercadopago').id,
    channelMethods: {
      qr: kit.f.method('qr').id,
      transfer_in: kit.f.method('transfer').id,
      ...channels,
    },
    inferred: new Set(),
  }
}

function run(
  o: {
    kit?: Kit
    settings?: MpSettings
    manualDays?: string[]
    postedTransfers?: PostedTransfer[]
    taxRules?: MpTaxRule[]
    decisions?: Record<string, ProposalDecisions>
    frozen?: string[]
    rows?: StagedItem<MpItem>[]
  } = {},
) {
  const kit = o.kit ?? kitWithCloses()
  const drafts = buildMpDrafts({
    batchId: KIT_BATCH,
    items: o.rows ?? items,
    catalog: kit.imp,
    settings: o.settings ?? settingsOf(kit),
    pool: new OpenItemPool(kit.ctx.openItems.values()),
    manualDays: new Set(o.manualDays ?? []),
    postedTransfers: o.postedTransfers ?? [],
    taxRules: o.taxRules ?? [],
    decisions: (key) => o.decisions?.[key] ?? {},
    frozen: (key) => o.frozen?.includes(key) ?? false,
  })
  return { kit, drafts, proposals: evaluateAll(drafts, kit.ctx) }
}

const rowKeyOf = (sourceId: string, description: string) => {
  const s = items.find((x) => x.item.sourceId === sourceId && x.item.description === description)
  if (!s) throw new Error(`Falta la fila ${sourceId} ${description}`)
  return s.key
}

const valuesOf = (drafts: readonly ProposalDraft[], key: string) => {
  const d = drafts.find((x) => x.key === key)
  if (!d) throw new Error(`Falta ${key}`)
  return d.values as Record<string, unknown>
}

describe('cobros por día y medio', () => {
  it('QR del 01/10: comisión ÷ 1,21, su IVA a documentar, SIRTAC y la billetera por neto + Ley 25.413', () => {
    const { kit, drafts, proposals } = run()
    const key = `mp:2026-10-01:cobro:${kit.f.method('qr').id}:${TAG}`
    const p = byKey(proposals, key)
    expectPostable(p, kit.ctx)
    expect(p.form).toBe('collection')
    const fees = 65_766 + 24_250
    const commission = netFromGross(fees, 2100)
    const qr = kit.f.method('qr').id
    expect(valuesOf(drafts, key)).toEqual({
      partyId: kit.f.party('mercadopago').id,
      date: '2026-10-01',
      applications: [{ lineId: fixedUuid(600_001), amountCents: 9_000_000 }],
      creditsUsed: [],
      grossCents: null,
      deductions: [
        { taxKind: 'comision', amountCents: commission, salesMethodId: qr },
        { taxKind: 'iva_comision', amountCents: fees - commission, salesMethodId: qr },
        { taxKind: 'ret_iibb', amountCents: 25_000, salesMethodId: qr },
      ],
      received: [
        {
          treasuryAccountId: kit.f.treasury('mp').id,
          amountCents: 9_109_304 + 55_680,
          reference: null,
        },
      ],
      writeOffCents: 0,
      commissionVoucher: { mode: 'later' },
      notes: 'Importado de Mercado Pago (reporte de Liquidaciones)',
    })
    expect(p.summary).toMatchObject({
      kind: 'mp_collection',
      date: '2026-10-01',
      label: 'Cobros con QR del 01/10',
      total_cents: 9_280_000,
      item_count: 2,
      detail: {
        gross_cents: 9_280_000,
        commission_cents: commission,
        commission_vat_cents: fees - commission,
        sirtac_cents: 25_000,
        sircupa_cents: 0,
        ley25413_cents: 55_680,
        net_cents: 9_109_304,
        close_cents: 9_000_000,
        applied_cents: 9_000_000,
        difference_cents: 280_000,
      },
    })
    expect(p.itemIds).toHaveLength(2)
  })

  it('transferencias de un tercero: SIRCUPA y lo que no cubre el cierre queda a favor', () => {
    const { kit, drafts, proposals } = run()
    const key = `mp:2026-10-01:cobro:${kit.f.method('transfer').id}:${TAG}`
    expectPostable(byKey(proposals, key), kit.ctx)
    const v = valuesOf(drafts, key)
    expect(v.deductions).toEqual([
      { taxKind: 'sircupa', amountCents: 15_000, salesMethodId: kit.f.method('transfer').id },
    ])
    expect(v.received).toEqual([
      { treasuryAccountId: kit.f.treasury('mp').id, amountCents: 4_985_000, reference: null },
    ])
    expect(v.applications).toEqual([{ lineId: fixedUuid(600_002), amountCents: 4_000_000 }])
    expect(v.commissionVoucher).toEqual({ mode: 'none' })
  })

  it('un canal sin medio del cierre pide elegirlo (y se recuerda en la configuración)', () => {
    const { proposals } = run()
    const p = byKey(proposals, `mp:2026-10-01:cobro:point:${TAG}`)
    expect(p.status).toBe('needs_input')
    expect(p.needs).toEqual([{ key: 'channel_method', channel: 'point' }])
    expect(p.formValues).toEqual({})
  })

  it('con el medio de Point elegido, queda lista', () => {
    const kit = kitWithCloses()
    const { proposals } = run({
      kit,
      settings: settingsOf(kit, { point: kit.f.method('qr').id }),
    })
    // Point y QR van al mismo medio: un solo cobro por día y medio.
    const p = byKey(proposals, `mp:2026-10-01:cobro:${kit.f.method('qr').id}:${TAG}`)
    expectPostable(p, kit.ctx)
    expect(p.summary.item_count).toBe(3)
  })

  it('el cobro de madrugada cae en su día; sin cierre ese día, queda a favor con el aviso', () => {
    const { kit, drafts, proposals } = run()
    const key = `mp:2026-10-02:cobro:${kit.f.method('qr').id}:${TAG}`
    const p = byKey(proposals, key)
    expectPostable(p, kit.ctx)
    expect(p.summary.notes).toEqual(['missing_close'])
    expect(valuesOf(drafts, key).applications).toEqual([])
  })

  it('una propuesta ya contabilizada no consume las partidas de las demás', () => {
    const kit = kitWithCloses()
    const qrKey = `mp:2026-10-01:cobro:${kit.f.method('qr').id}:${TAG}`
    const { drafts } = run({ kit, frozen: [qrKey] })
    expect(valuesOf(drafts, qrKey).applications).toEqual([])
  })
})

describe('la Ley 25.413, aparte', () => {
  it('un gasto bancario por día sobre la billetera: créditos (cobros) y débitos (pagos)', () => {
    const { kit, drafts, proposals } = run()
    const day1 = `mp:2026-10-01:ley25413:${TAG}`
    const day2 = `mp:2026-10-02:ley25413:${TAG}`
    expectPostable(byKey(proposals, day1), kit.ctx)
    expectPostable(byKey(proposals, day2), kit.ctx)
    expect(valuesOf(drafts, day1)).toMatchObject({
      treasuryAccountId: kit.f.treasury('mp').id,
      ley25413CreditCents: 40_680 + 15_000 + 10_800 + 30_000,
      ley25413DebitCents: 0,
      includeInIvaBook: false,
    })
    expect(valuesOf(drafts, day2)).toMatchObject({
      ley25413CreditCents: 5_400,
      ley25413DebitCents: 21_000,
    })
  })
})

describe('otros movimientos', () => {
  it('retiro a una cuenta propia: transferencia al banco de ese CBU', () => {
    const { kit, drafts, proposals } = run()
    const key = `${rowKeyOf('92000000001', 'payout')}:transfer`
    expectPostable(byKey(proposals, key), kit.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      fromTreasuryId: kit.f.treasury('mp').id,
      toTreasuryId: kit.f.treasury('banco').id,
      amountCents: 10_000_000,
      date: '2026-10-02',
      reference: 'COELSA-SYN-0001',
    })
  })

  it('si el retiro ya está cargado (±3 días, por ejemplo desde el banco), se saltea', () => {
    const kit = kitWithCloses()
    const doc = fixedUuid(77)
    const posted: PostedTransfer = {
      documentId: doc,
      date: '2026-10-03',
      amountCents: 10_000_000,
      fromTreasuryId: kit.f.treasury('mp').id,
      toTreasuryId: kit.f.treasury('banco').id,
      label: 'Movimiento entre cuentas',
    }
    const { proposals } = run({ kit, postedTransfers: [posted] })
    const p = byKey(proposals, `${rowKeyOf('92000000001', 'payout')}:transfer`)
    expect(p.status).toBe('skipped')
    expect(p.error).toMatchObject({ reason: 'already_loaded', document_id: doc })
    expect(
      findPostedTransfer(
        [posted],
        posted.fromTreasuryId,
        posted.toTreasuryId,
        10_000_000,
        '2026-10-07',
      ),
    ).toBeNull()
  })

  it('retiro a un tercero: pago, después de elegir a quién (cancela sus facturas, la más vieja primero)', () => {
    const asked = run()
    const key = `${rowKeyOf('92000000002', 'payout')}:pago`
    expect(byKey(asked.proposals, key).needs).toEqual([
      { key: 'pick_party', role: 'supplier', suggested_party_id: null },
    ])
    const kit = kitWithCloses()
    const { proposals, drafts } = run({
      kit,
      decisions: { [key]: { party_id: kit.f.party('cocacola').id } },
    })
    expectPostable(byKey(proposals, key), kit.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      partyId: kit.f.party('cocacola').id,
      methods: [
        {
          type: 'treasury',
          treasuryAccountId: kit.f.treasury('mp').id,
          amountCents: 3_500_000,
          reference: null,
        },
      ],
    })
  })

  it('transferencia desde la propia CUIT: de qué cuenta propia vino (se sugiere el banco)', () => {
    const asked = run()
    const key = `${rowKeyOf('91000000005', 'payment')}:transfer`
    expect(byKey(asked.proposals, key).needs).toEqual([
      { key: 'pick_treasury', suggested_treasury_id: asked.kit.f.treasury('banco').id },
    ])
    const kit = kitWithCloses()
    const { proposals } = run({
      kit,
      decisions: { [key]: { treasury_id: kit.f.treasury('banco').id } },
    })
    expectPostable(byKey(proposals, key), kit.ctx)
  })

  it('rendimientos: uno por mes, con la fecha del último día del lote', () => {
    const { kit, drafts, proposals } = run()
    const key = `mp:2026-10:rendimientos:${TAG}`
    expectPostable(byKey(proposals, key), kit.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      direction: 'in',
      counterpartAccountId: kit.sys('interest_income'),
      amountCents: 4_512 + 5_130 + 3_877,
      date: '2026-10-03',
      shortcut: 'mp_yield',
    })
  })

  it('IIBB que se cobró después: sale de la billetera contra SIRTAC', () => {
    const { kit, drafts, proposals } = run()
    const key = `mp:2026-10-03:iibb-sirtac:${TAG}`
    expectPostable(byKey(proposals, key), kit.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      direction: 'out',
      counterpartAccountId: kit.sys('iibb_withholdings'),
      amountCents: 12_000,
    })
  })

  it('débito de percepciones: pago a Mercado Pago (a cuenta si todavía no está la factura)', () => {
    const { kit, drafts, proposals } = run()
    const key = `mp:2026-10-03:pago-mp:${TAG}`
    expectPostable(byKey(proposals, key), kit.ctx)
    expect(valuesOf(drafts, key)).toMatchObject({
      partyId: kit.f.party('mercadopago').id,
      applications: [],
      methods: [{ type: 'treasury', amountCents: 320_000 }],
    })
  })

  it('propina, devolución y lo desconocido van a revisar: la persona elige la cuenta', () => {
    const { kit, proposals } = run()
    for (const [source, description] of [
      ['91000000007', 'tip'],
      ['91000000001', 'refund'],
      ['96000000001', 'promo_bonus'],
    ] as const) {
      const key = `${rowKeyOf(source, description)}:revisar`
      const p = byKey(proposals, key)
      expect(p.form).toBe('cash_movement')
      expect(p.needs[0]?.key).toBe('counterpart_account')
    }
    const tipKey = `${rowKeyOf('91000000007', 'tip')}:revisar`
    const decided = run({
      kit,
      decisions: { [tipKey]: { counterpart_account_id: kit.sys('other_income') } },
    })
    expectPostable(byKey(decided.proposals, tipKey), decided.kit.ctx)
  })

  it('las reservas que se compensan no se cargan', () => {
    const { proposals } = run()
    const p = byKey(proposals, `mp:reservas:${TAG}`)
    expect(p.status).toBe('skipped')
    expect(p.error).toEqual({ reason: 'reserve' })
    expect(p.itemIds).toHaveLength(2)
  })
})

describe('contra lo cargado a mano', () => {
  it('un día con cobros o «Ajustar saldo» cargados a mano no se propone', () => {
    const { kit, proposals } = run({ manualDays: ['2026-10-01'] })
    const manual = byKey(proposals, `mp:2026-10-01:manual:${TAG}`)
    expect(manual.status).toBe('skipped')
    expect(manual.error).toEqual({ reason: 'manual_overlap', date: '2026-10-01' })
    expect(
      proposals.some((p) => p.key === `mp:2026-10-01:cobro:${kit.f.method('qr').id}:${TAG}`),
    ).toBe(false)
    expect(proposals.some((p) => p.key === `mp:2026-10-01:ley25413:${TAG}`)).toBe(false)
  })
})

describe('impuestos de cada cobro', () => {
  const tax = (entity: string, detail: string) => ({ entity, detail, amount: -100 })

  it('Ley 25.413, SIRTAC, SIRCUPA e IIBB por canal; lo desconocido, desconocido', () => {
    expect(
      classifyMpTax(tax('debitos_creditos', 'tax_withholding_collector'), 'qr', []),
    ).toMatchObject({
      component: 'ley25413',
      side: 'credit',
    })
    expect(
      classifyMpTax(tax('debitos_creditos', 'tax_withholding_payer'), 'payout_third', []).side,
    ).toBe('debit')
    expect(classifyMpTax(tax('cordoba', 'tax_withholding_sirtac'), 'qr', []).component).toBe(
      'ret_iibb',
    )
    expect(
      classifyMpTax(tax('cordoba', 'tax_withholding_sircupa'), 'transfer_in', []).component,
    ).toBe('sircupa')
    expect(classifyMpTax(tax('iibb_cordoba', 'tax_withholding'), 'transfer_in', []).component).toBe(
      'sircupa',
    )
    expect(classifyMpTax(tax('iibb_cordoba', 'tax_withholding'), 'point', []).component).toBe(
      'ret_iibb',
    )
    expect(classifyMpTax(tax('impuesto_raro', 'x'), 'qr', []).component).toBe('unknown')
  })

  it('un impuesto desconocido pide la cuenta; una regla del bar o la decisión lo resuelven', () => {
    const kit = kitWithCloses()
    const row = items.find(
      (s) => s.item.sourceId === '91000000001' && s.item.description === 'payment',
    )
    if (!row) throw new Error('falta la fila')
    const odd: StagedItem<MpItem> = {
      ...row,
      item: {
        ...row.item,
        netCredit: row.item.netCredit - 1_000,
        taxes: row.item.taxes - 1_000,
        taxesDetail: [
          ...row.item.taxesDetail,
          { entity: 'impuesto_raro', detail: 'municipal', amount: -1_000 },
        ],
      },
    }
    const key = `mp:2026-10-01:cobro:${kit.f.method('qr').id}:${TAG}`
    const asked = run({ kit, rows: [odd] })
    expect(byKey(asked.proposals, key).needs).toEqual([
      { key: 'unknown_tax', tax: 'IMPUESTO_RARO MUNICIPAL', amount_cents: 1_000 },
    ])
    const account = kit.sys('municipal_tax_expense')
    const decided = run({
      kit,
      rows: [odd],
      decisions: { [key]: { tax_accounts: { 'IMPUESTO_RARO MUNICIPAL': account } } },
    })
    expectPostable(byKey(decided.proposals, key), decided.kit.ctx)
    expect((valuesOf(decided.drafts, key).deductions as unknown[]).at(-1)).toEqual({
      taxKind: 'otro',
      amountCents: 1_000,
      accountId: account,
      salesMethodId: kit.f.method('qr').id,
    })
    const pattern = compileSafePattern('IMPUESTO_RARO')
    if (!pattern) throw new Error('patrón')
    const ruled = run({
      kit,
      rows: [odd],
      taxRules: [{ id: fixedUuid(5), pattern, component: 'otro', accountId: account }],
    })
    const p = byKey(ruled.proposals, key)
    expectPostable(p, ruled.kit.ctx)
    expect(p.summary.notes).toContain('rule_applied')
  })

  it('las reglas de impuestos con un patrón inseguro se saltean (nunca un RegExp del bar)', () => {
    const { rules, skipped } = mpTaxRulesFrom([
      {
        id: 'a',
        priority: 1,
        match: { pattern: '(a+)+$' },
        action: { kind: 'mp_tax', component: 'otro' },
      },
      {
        id: 'b',
        priority: 2,
        match: { pattern: 'SIRTAC.*CORDOBA' },
        action: { kind: 'mp_tax', component: 'ret_iibb' },
      },
      { id: 'c', priority: 3, match: { pattern: 'X' }, action: { kind: 'other_taxes' } },
    ])
    expect(skipped).toBe(1)
    expect(rules.map((r) => r.id)).toEqual(['b'])
  })
})

describe('la configuración de Mercado Pago', () => {
  it('sin configurar: la billetera de Mercado Pago y los medios que se deducen por el nombre', () => {
    const kit = makeKit()
    const s = mpSettingsFor(null, kit.imp, null)
    expect(s).not.toBeNull()
    expect(s?.treasuryId).toBe(kit.f.treasury('mp').id)
    expect(s?.partyId).toBe(kit.f.party('mercadopago').id)
    expect(s?.channelMethods).toEqual({
      qr: kit.f.method('qr').id,
      transfer_in: kit.f.method('transfer').id,
    })
    expect([...(s?.inferred ?? [])].sort()).toEqual(['qr', 'transfer_in'])
  })

  it('lo configurado manda (y deja de ser deducido)', () => {
    const kit = makeKit()
    const s = mpSettingsFor(
      {
        id: fixedUuid(1),
        treasuryAccountId: kit.f.treasury('mp').id,
        partyId: kit.f.party('mercadopago').id,
        status: 'csv_only',
        channelMethods: { qr: kit.f.method('transfer').id, point: kit.f.method('qr').id },
        dayCutoffHour: 0,
        updatedAt: null,
      },
      kit.imp,
      null,
    )
    expect(s?.channelMethods.qr).toBe(kit.f.method('transfer').id)
    expect(s?.channelMethods.point).toBe(kit.f.method('qr').id)
    expect(s?.inferred.has('qr')).toBe(false)
    expect(s?.inferred.has('transfer_in')).toBe(true)
  })
})

describe('todas las propuestas listas del reporte', () => {
  it('pasan por zod, su build* y cuadran', () => {
    const kit = kitWithCloses()
    const { proposals } = run({ kit, settings: settingsOf(kit, { point: kit.f.method('qr').id }) })
    const ready = proposals.filter((p) => p.status === 'ready')
    // QR (con Point) y transferencias del 01/10, QR del 02/10, Ley 25.413 de dos días, el retiro
    // propio, los rendimientos, el IIBB cobrado después y el pago a Mercado Pago.
    expect(ready).toHaveLength(9)
    for (const p of ready) expectPostable(p, kit.ctx)
    // Lo que queda: a quién se le pagó, de qué cuenta vino la transferencia propia y lo de revisar.
    const pending = proposals.filter((p) => p.status === 'needs_input').map((p) => p.needs[0]?.key)
    expect(pending.sort()).toEqual([
      'counterpart_account',
      'counterpart_account',
      'counterpart_account',
      'pick_party',
      'pick_treasury',
    ])
  })
})
