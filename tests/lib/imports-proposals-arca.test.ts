/**
 * Mis Comprobantes (Recibidos) → compras (diseño §4.1, WP6): cada propuesta
 * pasa por el zod del formulario de compra, por `buildPurchase` y cuadra; las
 * que no se pueden armar dicen qué falta, en palabras simples.
 */

import { describe, expect, it } from 'vitest'
import { mcNaturalKey, parseMisComprobantes } from '@/lib/imports/arca/mis-comprobantes'
import { MERCADOLIBRE_CUIT } from '@/lib/imports/bank/rules'
import { openTable } from '@/lib/imports/detect'
import { importClientRef } from '@/lib/imports/hash'
import {
  buildArcaDrafts,
  conditionFromLetter,
  MC_CODE_TO_VOUCHER,
  newSuppliersOf,
  otherTaxesRulesFrom,
  type PurchaseMatch,
  purchaseMatchRows,
  suggestPurchaseAccount,
} from '@/lib/imports/server/proposals/arca'
import {
  type ProposalDraft,
  type StagedItem,
  systemAccountId,
} from '@/lib/imports/server/proposals/common'
import type { ProposalDecisions } from '@/lib/imports/server/types'
import type { ImportIssue, McItem } from '@/lib/imports/types'
import { IMPORT_FIXTURES, importFixture } from '@/tests/fixtures/imports/fixtures'
import { makeCuit, SAS_CUIT } from '@/tests/fixtures/imports/synth'
import { fixedUuid } from './accounting-core-context'
import {
  byKey,
  evaluateAll,
  expectPostable,
  KIT_TENANT,
  type KitOptions,
  type KitSupplier,
  makeKit,
} from './imports-kit'

const COCA = makeCuit('30', 50_123_456)
const MONO = makeCuit('20', 30_111_222)
const NEWCO = makeCuit('30', 60_999_888)

const SUPPLIERS: KitSupplier[] = [
  { cuit: COCA, name: 'DISTRIBUIDORA DE BEBIDAS SA', account: 'purchases_soft_drinks' },
  { cuit: MONO, name: 'GOMEZ ANA', ivaCondition: 'monotributo', account: 'maintenance' },
]

const ZERO_NET = { r0: 0, r25: 0, r5: 0, r105: 0, r21: 0, r27: 0 }
const ZERO_VAT = { r25: 0, r5: 0, r105: 0, r21: 0, r27: 0 }

/** Un comprobante como lo deja el parser (G3, en pesos). */
function mc(o: Partial<McItem> & Pick<McItem, 'code' | 'issuerCuit'>): McItem {
  const number = o.number ?? 110_266
  return {
    kind: 'mc',
    issueDate: '2026-10-05',
    pointOfSale: 3,
    number,
    numberTo: number,
    authCode: '76412345678901',
    issuerName: 'DISTRIBUIDORA DE BEBIDAS SA',
    receiverDocType: 80,
    receiverDoc: SAS_CUIT,
    currency: 'ARS',
    fxRate: '1',
    net: { ...ZERO_NET },
    vat: { ...ZERO_VAT },
    netTotal: 0,
    nonTaxed: 0,
    exempt: 0,
    otherTaxes: 0,
    vatTotal: 0,
    total: 0,
    generation: 'g3',
    ...o,
  }
}

/** Factura A al 21 % (o la alícuota pedida) con el total que diga ARCA. */
function facturaA(
  issuerCuit: string,
  net21: number,
  o: Partial<McItem> & { roundingCents?: number } = {},
): McItem {
  const { roundingCents = 0, ...rest } = o
  const vat21 = Math.round((net21 * 21) / 100)
  const otherTaxes = rest.otherTaxes ?? 0
  return mc({
    code: 1,
    issuerCuit,
    net: { ...ZERO_NET, r21: net21 },
    vat: { ...ZERO_VAT, r21: vat21 },
    netTotal: net21,
    vatTotal: vat21,
    total: net21 + vat21 + otherTaxes + roundingCents,
    ...rest,
  })
}

let seq = 0
function staged(item: McItem, issues: ImportIssue[] = []): StagedItem<McItem> {
  seq += 1
  return {
    id: fixedUuid(950_000 + seq),
    rowNo: seq,
    key: mcNaturalKey('recibidos', item),
    status: 'new',
    item,
    issues,
  }
}

function run(
  items: readonly StagedItem<McItem>[],
  o: {
    kit?: KitOptions
    decisions?: Record<string, ProposalDecisions>
    matches?: Map<string, PurchaseMatch>
    rules?: Parameters<typeof otherTaxesRulesFrom>[0]
  } = {},
) {
  const kit = makeKit({ suppliers: SUPPLIERS, ...o.kit })
  const drafts = buildArcaDrafts({
    items,
    catalog: kit.imp,
    rules: otherTaxesRulesFrom(o.rules ?? []),
    matches: o.matches ?? new Map(),
    decisions: (key) => o.decisions?.[key] ?? {},
  })
  return { kit, drafts, proposals: evaluateAll(drafts, kit.ctx) }
}

const values = (d: ProposalDraft) => d.values as Record<string, unknown>

describe('una factura A de un proveedor conocido', () => {
  it('queda lista: neto por alícuota a su cuenta habitual, el IVA de la factura y el total de control', () => {
    const it0 = staged(facturaA(COCA, 7_107_438))
    const { kit, drafts, proposals } = run([it0])
    const p = byKey(proposals, it0.key)
    expectPostable(p, kit.ctx)
    expect(p.form).toBe('purchase')
    expect(p.key).toBe(`mc:R:${COCA}:1:3:110266`)
    const v = values(drafts[0] as ProposalDraft)
    expect(v).toMatchObject({
      docKind: 'purchase',
      partyId: kit.supplier(COCA).id,
      voucherType: 'factura_a',
      pointOfSale: 3,
      number: 110_266,
      issueDate: '2026-10-05',
      amountMode: 'detail',
      controlTotalCents: 8_600_000,
      settlesCommissions: false,
      payNow: null,
    })
    expect(v.lines).toEqual([
      {
        role: 'net',
        accountId: kit.sys('purchases_soft_drinks'),
        amountCents: 7_107_438,
        vatRateBp: 2100,
      },
    ])
    expect(v.vat).toEqual([{ vatRateBp: 2100, adjustCents: 0, givenCents: 1_492_562 }])
    expect(p.summary).toMatchObject({
      kind: 'purchase',
      date: '2026-10-05',
      month: '2026-10',
      label: 'Factura A 0003-00110266',
      counterparty: 'DISTRIBUIDORA DE BEBIDAS SA',
      total_cents: 8_600_000,
      item_count: 1,
    })
    expect(p.itemIds).toEqual([it0.id])
  })

  it('el client_ref es determinístico por bar, clave e intento', () => {
    const key = `mc:R:${COCA}:1:3:110266`
    const a = importClientRef(KIT_TENANT, key, 1)
    expect(importClientRef(KIT_TENANT, key, 1)).toBe(a)
    expect(importClientRef(KIT_TENANT, key, 2)).not.toBe(a)
    expect(importClientRef(KIT_TENANT, `${key}x`, 1)).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('dos alícuotas, no gravado y exento: un renglón por concepto', () => {
    const item = mc({
      code: 1,
      issuerCuit: COCA,
      number: 5,
      net: { ...ZERO_NET, r21: 1_000_000, r105: 500_000 },
      vat: { ...ZERO_VAT, r21: 210_000, r105: 52_500 },
      netTotal: 1_500_000,
      vatTotal: 262_500,
      nonTaxed: 30_000,
      exempt: 20_000,
      total: 1_812_500,
    })
    const { kit, drafts, proposals } = run([staged(item)])
    expectPostable(proposals[0] as (typeof proposals)[number], kit.ctx)
    const v = values(drafts[0] as ProposalDraft)
    expect((v.lines as Array<{ role: string }>).map((l) => l.role)).toEqual([
      'net',
      'net',
      'non_taxed',
      'exempt',
    ])
    expect(v.vat).toEqual([
      { vatRateBp: 1050, adjustCents: 0, givenCents: 52_500 },
      { vatRateBp: 2100, adjustCents: 0, givenCents: 210_000 },
    ])
  })
})

describe('redondeo de ARCA y diferencias del total', () => {
  it('hasta $ 1: va al neto más grande y cierra exacto', () => {
    const it0 = staged(facturaA(COCA, 1_000_000, { roundingCents: 37 }))
    const { kit, drafts, proposals } = run([it0])
    const p = byKey(proposals, it0.key)
    expectPostable(p, kit.ctx)
    expect(p.summary.notes).toEqual(['rounding_absorbed'])
    const lines = values(drafts[0] as ProposalDraft).lines as Array<{ amountCents: number }>
    expect(lines[0]?.amountCents).toBe(1_000_037)
    expect(values(drafts[0] as ProposalDraft).controlTotalCents).toBe(1_210_037)
  })

  it('un redondeo negativo también va al neto', () => {
    const it0 = staged(facturaA(COCA, 1_000_000, { roundingCents: -12 }))
    const { kit, proposals } = run([it0])
    expectPostable(byKey(proposals, it0.key), kit.ctx)
  })

  it('más de $ 1 de más: a «Otros tributos» y pide cómo cargarlos', () => {
    const it0 = staged(facturaA(COCA, 1_000_000, { roundingCents: 30_000 }))
    const { proposals } = run([it0])
    const p = byKey(proposals, it0.key)
    expect(p.status).toBe('needs_input')
    expect(p.needs).toEqual([
      { key: 'other_taxes_as', party_id: expect.any(String), amount_cents: 30_000 },
    ])
    expect(p.previewHash).toBeNull()
    expect(p.summary.notes).toEqual(['gap_to_other_taxes'])
  })

  it('con la decisión «percepción de IIBB» queda lista, con la jurisdicción de la SAS', () => {
    const it0 = staged(facturaA(COCA, 1_000_000, { roundingCents: 30_000 }))
    const { kit, drafts, proposals } = run([it0], {
      decisions: { [it0.key]: { other_taxes_as: 'perc_iibb' } },
    })
    expectPostable(byKey(proposals, it0.key), kit.ctx)
    expect(values(drafts[0] as ProposalDraft).perceptions).toEqual([
      { taxKind: 'iibb', amountCents: 30_000, jurisdictionCode: 904 },
    ])
  })

  it('más de $ 1 de menos: a mano', () => {
    const it0 = staged(facturaA(COCA, 1_000_000, { roundingCents: -500 }))
    const { proposals } = run([it0])
    expect(byKey(proposals, it0.key).needs).toEqual([{ key: 'total_gap', cents: -500 }])
  })
})

describe('«Otros tributos»', () => {
  const withOthers = () => staged(facturaA(COCA, 2_000_000, { otherTaxes: 60_000, number: 77 }))

  it('percepción de IVA, impuestos internos u otra cuenta, según la decisión', () => {
    const it0 = withOthers()
    const iva = run([it0], { decisions: { [it0.key]: { other_taxes_as: 'perc_iva' } } })
    expectPostable(byKey(iva.proposals, it0.key), iva.kit.ctx)
    expect(values(iva.drafts[0] as ProposalDraft).perceptions).toEqual([
      { taxKind: 'iva', amountCents: 60_000, jurisdictionCode: null },
    ])

    const internal = run([it0], { decisions: { [it0.key]: { other_taxes_as: 'internal' } } })
    expectPostable(byKey(internal.proposals, it0.key), internal.kit.ctx)
    expect(
      (values(internal.drafts[0] as ProposalDraft).lines as Array<{ role: string }>).map(
        (l) => l.role,
      ),
    ).toEqual(['net', 'internal_tax'])

    const kit = makeKit({ suppliers: SUPPLIERS })
    const account = systemAccountId(kit.imp, 'other_taxes_expense') as string
    const other = run([it0], {
      decisions: { [it0.key]: { other_taxes_as: 'account', other_taxes_account_id: account } },
    })
    expectPostable(byKey(other.proposals, it0.key), other.kit.ctx)
    expect(values(other.drafts[0] as ProposalDraft).otherTaxes).toEqual([
      { accountId: account, amountCents: 60_000 },
    ])
  })

  it('una regla «Recordar para este proveedor» decide sola (y lo dice)', () => {
    const it0 = withOthers()
    const kit = makeKit({ suppliers: SUPPLIERS })
    const party = kit.supplier(COCA).id
    const r = run([it0], {
      rules: [
        {
          id: fixedUuid(1),
          priority: 100,
          match: { party_id: party },
          action: { kind: 'other_taxes', other_taxes_as: 'perc_iibb', jurisdiction_code: 901 },
        },
      ],
    })
    const p = byKey(r.proposals, it0.key)
    expectPostable(p, r.kit.ctx)
    expect(p.summary.notes).toEqual(['rule_applied'])
    expect(values(r.drafts[0] as ProposalDraft).perceptions).toEqual([
      { taxKind: 'iibb', amountCents: 60_000, jurisdictionCode: 901 },
    ])
  })
})

describe('moneda extranjera', () => {
  const usd = () =>
    staged(
      mc({
        code: 1,
        issuerCuit: COCA,
        number: 900,
        currency: 'USD',
        fxRate: '1475.006',
        net: { ...ZERO_NET, r21: 10_000 },
        vat: { ...ZERO_VAT, r21: 2_100 },
        netTotal: 10_000,
        vatTotal: 2_100,
        total: 12_100,
      }),
    )

  it('cada columna × el tipo de cambio y siempre para revisar', () => {
    const it0 = usd()
    const { drafts, proposals } = run([it0])
    const p = byKey(proposals, it0.key)
    expect(p.status).toBe('needs_input')
    expect(p.needs).toEqual([
      {
        key: 'foreign_currency',
        currency: 'USD',
        fx_rate: '1475.006',
        original_total_cents: 12_100,
      },
    ])
    // Se arma igual (se muestra el asiento en pesos) y el hash queda listo para cuando se confirme.
    expect(p.previewHash).toMatch(/^[0-9a-f]{64}$/)
    const v = values(drafts[0] as ProposalDraft)
    expect(v.controlTotalCents).toBe(17_847_573)
    expect(p.summary.notes).toEqual(['converted'])
    expect(p.summary.detail).toMatchObject({ currency: 'USD', original_total_cents: 12_100 })
  })

  it('confirmada la conversión, queda lista', () => {
    const it0 = usd()
    const { kit, proposals } = run([it0], {
      decisions: { [it0.key]: { confirmed: ['foreign_currency'] } },
    })
    expectPostable(byKey(proposals, it0.key), kit.ctx)
  })
})

describe('lo que falta para poder cargarla', () => {
  it('proveedor nuevo: la razón social de ARCA y la condición que sugiere la letra', () => {
    const it0 = staged(facturaA(NEWCO, 1_000_000, { issuerName: 'CERVECERIA DEL SUR SRL' }))
    const { proposals } = run([it0])
    const p = byKey(proposals, it0.key)
    expect(p.status).toBe('needs_input')
    expect(p.needs).toEqual([
      {
        key: 'new_supplier',
        cuit: NEWCO,
        name: 'CERVECERIA DEL SUR SRL',
        suggested_condition: 'responsable_inscripto',
      },
    ])
    expect(p.formValues).toEqual({})
  })

  it('sin cuenta habitual, la pide', () => {
    const it0 = staged(facturaA(COCA, 1_000_000))
    const { kit, proposals } = run([it0], {
      kit: { suppliers: [{ cuit: COCA, name: 'DISTRIBUIDORA', account: null }] },
    })
    expect(byKey(proposals, it0.key).needs).toEqual([
      { key: 'supplier_account', party_id: kit.supplier(COCA).id },
    ])
  })

  it('una A de alguien cargado como monotributista: actualizar el proveedor', () => {
    const it0 = staged(facturaA(MONO, 1_000_000, { issuerName: 'GOMEZ ANA' }))
    const { kit, proposals } = run([it0])
    expect(byKey(proposals, it0.key).needs).toEqual([
      {
        key: 'condition_mismatch',
        party_id: kit.supplier(MONO).id,
        condition: 'monotributo',
        suggested_condition: 'responsable_inscripto',
      },
    ])
  })

  it('proveedor desactivado', () => {
    const it0 = staged(facturaA(COCA, 1_000_000))
    const { kit, proposals } = run([it0], {
      kit: { suppliers: [{ cuit: COCA, name: 'DISTRIBUIDORA', active: false }] },
    })
    expect(byKey(proposals, it0.key).needs).toEqual([
      { key: 'supplier_inactive', party_id: kit.supplier(COCA).id },
    ])
  })

  it('recibos, FCE y rangos no se cargan solos', () => {
    const recibo = staged(mc({ code: 15, issuerCuit: MONO, number: 11, total: 50_000 }))
    const fce = staged(mc({ code: 201, issuerCuit: COCA, number: 12, total: 50_000 }))
    const range = staged(mc({ code: 1, issuerCuit: COCA, number: 13, numberTo: 15, total: 50_000 }))
    const { proposals } = run([recibo, fce, range])
    expect(byKey(proposals, recibo.key).needs).toEqual([{ key: 'receipt', code: 15 }])
    expect(byKey(proposals, fce.key).needs).toEqual([{ key: 'unsupported_voucher', code: 201 }])
    expect(byKey(proposals, range.key).needs).toEqual([{ key: 'unsupported_voucher', code: 1 }])
  })

  it('a nombre de un DNI (no es de la SAS) o con un importe negativo: a revisar', () => {
    const dni = staged(facturaA(COCA, 1_000, { number: 21 }), [
      { level: 'review', code: 'mc_receiver_mismatch', row: 2, field: 'nro_doc_receptor' },
    ])
    const neg = staged(facturaA(COCA, 1_000, { number: 22 }), [
      { level: 'review', code: 'mc_negative_amount', row: 3 },
    ])
    const { proposals } = run([dni, neg])
    expect(byKey(proposals, dni.key).needs).toEqual([{ key: 'manual', reason: 'not_ours' }])
    expect(byKey(proposals, neg.key).needs).toEqual([{ key: 'manual', reason: 'check_row' }])
  })

  it('G1/G2 sin alícuota deducible: a mano', () => {
    const it0 = staged(
      mc({ code: 1, issuerCuit: COCA, netTotal: 1_000_000, vatTotal: 160_000, total: 1_160_000 }),
    )
    const { proposals } = run([it0])
    expect(byKey(proposals, it0.key).needs).toEqual([{ key: 'vat_rate' }])
  })
})

describe('otros tipos', () => {
  it('nota de crédito A: el formulario de NC, a favor si no se vincula', () => {
    const it0 = staged(facturaA(COCA, 100_000, { code: 3, number: 44 }))
    const { kit, drafts, proposals } = run([it0])
    const p = byKey(proposals, it0.key)
    expectPostable(p, kit.ctx)
    expect(p.form).toBe('purchase_credit_note')
    expect(p.summary.kind).toBe('credit_note')
    expect(values(drafts[0] as ProposalDraft)).toMatchObject({
      docKind: 'purchase_credit_note',
      voucherType: 'nota_credito_a',
      relatedDocumentId: null,
    })
  })

  it('factura B de un responsable inscripto: todo al costo, con el aviso que se acepta en el lote', () => {
    const it0 = staged(mc({ code: 6, issuerCuit: COCA, number: 66, total: 121_000 }))
    const { kit, drafts, proposals } = run([it0])
    const p = byKey(proposals, it0.key)
    expect(p.status).toBe('ready')
    expect(p.summary.warnings).toEqual(['voucher_condition'])
    expectPostable(p, kit.ctx, { acceptWarnings: ['voucher_condition'] })
    expect(values(drafts[0] as ProposalDraft).lines).toEqual([
      {
        role: 'gross',
        accountId: kit.sys('purchases_soft_drinks'),
        amountCents: 121_000,
        vatRateBp: null,
      },
    ])
  })

  it('factura C de un monotributista', () => {
    const it0 = staged(mc({ code: 11, issuerCuit: MONO, number: 9, total: 45_000 }))
    const { kit, proposals } = run([it0])
    expectPostable(byKey(proposals, it0.key), kit.ctx)
  })

  it('la tabla de códigos del diseño', () => {
    expect(MC_CODE_TO_VOUCHER[51]).toBe('factura_m')
    expect(MC_CODE_TO_VOUCHER[81]).toBe('tique_factura_a')
    expect(MC_CODE_TO_VOUCHER[111]).toBe('tique_factura_c')
    expect(MC_CODE_TO_VOUCHER[4]).toBeUndefined()
    expect(conditionFromLetter('factura_c')).toBe('monotributo')
    expect(conditionFromLetter('factura_a')).toBe('responsable_inscripto')
  })
})

describe('contra lo cargado a mano', () => {
  it('mismo número: «Ya está cargado» (se saltea)', () => {
    const it0 = staged(facturaA(COCA, 1_000_000))
    const doc = fixedUuid(42)
    const { proposals } = run([it0], {
      matches: new Map([
        [it0.key, { match: 'number', documentId: doc, label: 'FA 0003-00110266' }],
      ]),
    })
    const p = byKey(proposals, it0.key)
    expect(p.status).toBe('skipped')
    expect(p.error).toEqual({
      reason: 'already_loaded',
      document_id: doc,
      label: 'FA 0003-00110266',
    })
  })

  it('mismo total ±3 días: «¿Es otro?» hasta que se confirma', () => {
    const it0 = staged(facturaA(COCA, 1_000_000))
    const doc = fixedUuid(43)
    const matches = new Map<string, PurchaseMatch>([
      [it0.key, { match: 'amount', documentId: doc, label: 'FA 0003-00000001' }],
    ])
    const asked = run([it0], { matches })
    expect(byKey(asked.proposals, it0.key).needs).toEqual([
      { key: 'possible_duplicate', document_id: doc, label: 'FA 0003-00000001' },
    ])
    const confirmed = run([it0], {
      matches,
      decisions: { [it0.key]: { confirmed: ['possible_duplicate'] } },
    })
    expectPostable(byKey(confirmed.proposals, it0.key), confirmed.kit.ctx)
  })

  it('las filas para acc_import_match_purchases (solo de proveedores conocidos, en pesos)', () => {
    const known = staged(facturaA(COCA, 1_000_000))
    const unknown = staged(facturaA(NEWCO, 1_000_000, { number: 2 }))
    const nc = staged(facturaA(COCA, 50_000, { code: 3, number: 3 }))
    const kit = makeKit({ suppliers: SUPPLIERS })
    expect(purchaseMatchRows([known, unknown, nc], kit.imp)).toEqual([
      {
        key: known.key,
        party_id: kit.supplier(COCA).id,
        voucher_type: 'factura_a',
        point_of_sale: 3,
        number: 110_266,
        total_cents: 1_210_000,
        issue_date: '2026-10-05',
        credit: false,
      },
      {
        key: nc.key,
        party_id: kit.supplier(COCA).id,
        voucher_type: 'nota_credito_a',
        point_of_sale: 3,
        number: 3,
        total_cents: 60_500,
        issue_date: '2026-10-05',
        credit: true,
      },
    ])
  })
})

describe('la factura mensual de Mercado Pago', () => {
  const mpInvoice = () =>
    staged(facturaA(MERCADOLIBRE_CUIT, 300_000, { issuerName: 'MERCADOLIBRE SRL', number: 990 }))

  it('pregunta si es la de comisiones', () => {
    const it0 = mpInvoice()
    const { proposals } = run([it0])
    expect(byKey(proposals, it0.key).needs).toEqual([{ key: 'mp_invoice' }])
  })

  it('si lo es: compra del partícipe de Mercado Pago que solo mueve el IVA', () => {
    const it0 = mpInvoice()
    const { kit, drafts, proposals } = run([it0], {
      decisions: { [it0.key]: { settles_commissions: true } },
    })
    const p = byKey(proposals, it0.key)
    expectPostable(p, kit.ctx)
    expect(values(drafts[0] as ProposalDraft)).toMatchObject({
      partyId: kit.f.party('mercadopago').id,
      settlesCommissions: true,
    })
  })

  it('si no lo es: una compra común del partícipe de esa CUIT (le falta la cuenta habitual)', () => {
    const it0 = mpInvoice()
    const { kit, proposals } = run([it0], {
      decisions: { [it0.key]: { settles_commissions: false } },
    })
    expect(byKey(proposals, it0.key).needs).toEqual([
      { key: 'supplier_account', party_id: kit.f.party('mercadopago').id },
    ])
  })
})

describe('proveedores nuevos y la cuenta sugerida', () => {
  it('se agrupan por CUIT, con la sugerencia por la razón social (que nunca se aplica sola)', () => {
    const a = staged(facturaA(NEWCO, 100_000, { issuerName: 'CERVECERIA DEL SUR SRL', number: 1 }))
    const b = staged(facturaA(NEWCO, 200_000, { issuerName: 'CERVECERIA DEL SUR SRL', number: 2 }))
    const epec = makeCuit('30', 54_321_987)
    const c = staged(facturaA(epec, 50_000, { issuerName: 'EPEC', number: 3 }))
    const { kit, proposals } = run([a, b, c])
    const rows = newSuppliersOf(
      proposals.map((p) => ({ needs: p.needs, totalCents: p.summary.total_cents })),
      kit.imp,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      cuit: NEWCO,
      vouchers: 2,
      totalCents: 363_000,
      suggestedAccountId: kit.sys('purchases_alcohol'),
    })
    const energy = kit.catalog.accounts.find((x) => x.name === 'Energía eléctrica')
    expect(rows[1]?.suggestedAccountId).toBe(energy?.id ?? null)
  })

  it('sugerencias por palabras de la razón social', () => {
    const kit = makeKit()
    expect(suggestPurchaseAccount('GASEOSAS DEL CENTRO SA', kit.imp)).toBe(
      kit.sys('purchases_soft_drinks'),
    )
    expect(suggestPurchaseAccount('Tostadero Café SRL', kit.imp)).toBe(kit.sys('purchases_coffee'))
    expect(suggestPurchaseAccount('PANADERIA LA ESQUINA', kit.imp)).toBe(
      kit.sys('purchases_bakery'),
    )
    expect(suggestPurchaseAccount('FUMIGACIONES NORTE', kit.imp)).toBe(kit.sys('cleaning'))
    expect(suggestPurchaseAccount('ALGO SIN PISTAS SA', kit.imp)).toBeNull()
  })
})

describe('con el parser de punta a punta (Mis Comprobantes de diciembre, sintético)', () => {
  it('todas las filas se arman o dicen qué falta; las listas cuadran', async () => {
    const opened = await openTable({ bytes: importFixture(IMPORT_FIXTURES.mcG3Dic) })
    if (!opened.ok) throw new Error(opened.issue.code)
    const parsed = parseMisComprobantes(opened.table.rows, {
      sasCuit: SAS_CUIT,
      container: opened.table.cellKind,
    })
    expect(parsed.ok).toBe(true)
    // Proveedores dados de alta con la condición que dice su letra.
    const conditions = new Map<string, KitSupplier>()
    for (const r of parsed.items) {
      const type = MC_CODE_TO_VOUCHER[r.item.code]
      const mono = type ? conditionFromLetter(type) === 'monotributo' : false
      if (!conditions.has(r.item.issuerCuit) || mono) {
        conditions.set(r.item.issuerCuit, {
          cuit: r.item.issuerCuit,
          name: r.item.issuerName.slice(0, 120) || 'PROVEEDOR',
          ivaCondition: mono ? 'monotributo' : 'responsable_inscripto',
          account: 'purchases_food',
        })
      }
    }
    const kit = makeKit({
      suppliers: [...conditions.values()],
      booksStartDate: '2025-01-01',
      today: '2026-01-31',
    })
    const items: StagedItem<McItem>[] = parsed.items.map((r, i) => ({
      id: fixedUuid(980_000 + i),
      rowNo: r.row,
      key: r.key,
      status: 'new',
      item: r.item,
      issues: [...r.issues],
    }))
    const drafts = buildArcaDrafts({
      items,
      catalog: kit.imp,
      rules: [],
      matches: new Map(),
      decisions: () => ({ confirmed: ['foreign_currency'], other_taxes_as: 'perc_iibb' }),
    })
    const proposals = evaluateAll(drafts, kit.ctx)
    expect(proposals).toHaveLength(parsed.items.length)
    const ready = proposals.filter((p) => p.status === 'ready')
    for (const p of ready) {
      expectPostable(p, kit.ctx, { acceptWarnings: ['voucher_condition', 'vat_diff'] })
    }
    const blocked = proposals.filter((p) => p.status !== 'ready')
    // Solo los recibos (4 y 15) quedan para revisar en este archivo.
    expect(new Set(blocked.flatMap((p) => p.needs.map((n) => n.key)))).toEqual(new Set(['receipt']))
    expect(blocked).toHaveLength(5)
    expect(ready.length).toBe(parsed.items.length - 5)
  })
})
