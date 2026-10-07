import { describe, expect, it } from 'vitest'
import { buildPurchase, buildPurchaseCreditNote } from '@/lib/accounting/posting/purchase'
import {
  assertGolden,
  DDJJ_IIBB,
  E1,
  E1_TOTAL,
  E2,
  E3,
  E3B,
  E6,
  E10_INVOICE,
  prepare,
  purchaseInput,
} from './accounting-fixtures'

describe('compras: los golden de E.5.1 (renglón por renglón)', () => {
  for (const fixture of [E1, E1_TOTAL, E2, E3, E3B, DDJJ_IIBB, E10_INVOICE]) {
    it(`${fixture.id} · ${fixture.title}`, () => {
      const { r, ctx, meta } = prepare(fixture)
      assertGolden(buildPurchase(fixture.input(r), ctx, meta), fixture, r)
    })
  }

  it('E1 con el detalle y con el total dan el mismo asiento y el mismo hash', () => {
    const a = prepare(E1)
    const b = prepare(E1_TOTAL)
    const byDetail = buildPurchase(E1.input(a.r), a.ctx, a.meta)
    const byTotal = buildPurchase(E1_TOTAL.input(b.r), b.ctx, b.meta)
    expect(byDetail.ok && byTotal.ok).toBe(true)
    if (!byDetail.ok || !byTotal.ok) return
    expect(byTotal.bundle.documents[0]?.lines).toEqual(byDetail.bundle.documents[0]?.lines)
    expect(byTotal.hash).toBe(byDetail.hash)
  })
})

describe('nota de crédito de proveedor (E.5.2)', () => {
  it('E6 · lados invertidos, el proveedor primero y sin imputación en el bundle', () => {
    const { r, ctx, meta } = prepare(E6)
    assertGolden(buildPurchase(E6.input(r), ctx, meta), E6, r)
  })

  it('buildPurchaseCreditNote fuerza el tipo de documento', () => {
    const { r, ctx, meta } = prepare(E6)
    const result = buildPurchaseCreditNote({ ...E6.input(r), docKind: 'purchase' }, ctx, meta)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bundle.documents[0]?.kind).toBe('purchase_credit_note')
  })
})

describe('importes y alícuotas', () => {
  it('el detalle junta las filas de la misma cuenta y alícuota en un solo neto', () => {
    const { r, ctx, meta } = prepare()
    const result = buildPurchase(
      purchaseInput({
        partyId: r.party('cocacola'),
        voucherType: 'factura_a',
        pointOfSale: 3,
        number: 1400,
        issueDate: '2026-10-05',
        lines: [
          {
            role: 'net',
            accountId: r.account('purchases_soft_drinks'),
            amountCents: 1_000_000,
            vatRateBp: 2100,
          },
          {
            role: 'net',
            accountId: r.account('purchases_alcohol'),
            amountCents: 500_000,
            vatRateBp: 2100,
          },
          {
            role: 'net',
            accountId: r.account('purchases_soft_drinks'),
            amountCents: 250_000,
            vatRateBp: 2100,
          },
          {
            role: 'net',
            accountId: r.account('purchases_food'),
            amountCents: 400_000,
            vatRateBp: 1050,
          },
          { role: 'exempt', accountId: r.account('purchases_food'), amountCents: 30_000 },
        ],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.bundle.documents[0]
    const lines = doc?.lines.map((l) => [l.lineNo, l.role, l.amountCents, l.vatRateBp]) ?? []
    // Imputaciones en el orden de carga (la tercera fila se sumó a la primera), IVA por alícuota ascendente.
    expect(lines).toEqual([
      [1, 'net', 1_250_000, 2100],
      [2, 'net', 500_000, 2100],
      [3, 'net', 400_000, 1050],
      [4, 'exempt', 30_000, null],
      [5, 'vat', 42_000, 1050],
      [6, 'vat', 367_500, 2100],
      [7, 'control', 2_589_500, null],
    ])
    expect(doc?.lines[5]).toMatchObject({ baseCents: 1_750_000, vatComputedCents: 367_500 })
    expect(doc?.fiscalVouchers[0]?.amounts).toEqual({
      net_105_cents: 400_000,
      vat_105_cents: 42_000,
      net_21_cents: 1_750_000,
      vat_21_cents: 367_500,
      exempt_cents: 30_000,
      total_cents: 2_589_500,
      vat_computable_cents: 409_500,
    })
  })

  it('desde el total de $ 3.600 al 21 %: neto 297.521 e IVA 62.479 (E5)', () => {
    const { r, ctx, meta } = prepare()
    const result = buildPurchase(
      purchaseInput({
        partyId: r.party('mayorista'),
        voucherType: 'factura_a',
        pointOfSale: 3,
        number: 4522,
        issueDate: '2026-10-03',
        amountMode: 'total',
        total: { totalCents: 360_000, vatRateBp: 2100, accountId: r.account('cleaning') },
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.documents[0]?.lines.map((l) => [l.role, l.amountCents])).toEqual([
      ['net', 297_521],
      ['vat', 62_479],
      ['control', 360_000],
    ])
  })

  it('en modo total las percepciones salen del total de la factura antes de separar neto e IVA', () => {
    const { r, ctx, meta } = prepare()
    const result = buildPurchase(
      purchaseInput({
        partyId: r.party('carniceria'),
        voucherType: 'factura_a',
        pointOfSale: 5,
        number: 778,
        issueDate: '2026-10-03',
        amountMode: 'total',
        total: { totalCents: 23_100_000, vatRateBp: 1050, accountId: r.account('purchases_food') },
        perceptions: [
          { taxKind: 'iibb', amountCents: 400_000, jurisdictionCode: 904 },
          { taxKind: 'iva', amountCents: 600_000 },
        ],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.documents[0]?.lines.map((l) => [l.role, l.amountCents])).toEqual([
      ['net', 20_000_000],
      ['vat', 2_100_000],
      ['perception', 400_000],
      ['perception', 600_000],
      ['control', 23_100_000],
    ])
  })

  it('±1¢ pasa sin aviso; más, con `vat_diff`; muy lejos, `vat_out_of_tolerance`', () => {
    const { r, ctx, meta } = prepare()
    const withVat = (vat: Array<Record<string, unknown>>) =>
      buildPurchase(
        purchaseInput({
          partyId: r.party('cocacola'),
          voucherType: 'factura_a',
          pointOfSale: 3,
          number: 1500,
          issueDate: '2026-10-05',
          lines: [
            {
              role: 'net',
              accountId: r.account('purchases_soft_drinks'),
              amountCents: 1_000_000,
              vatRateBp: 2100,
            },
          ],
          vat,
        }),
        ctx,
        meta,
      )
    const silent = withVat([{ vatRateBp: 2100, adjustCents: 1 }])
    expect(silent.ok && silent.warnings).toEqual([])
    const warned = withVat([{ vatRateBp: 2100, givenCents: 210_037 }])
    expect(warned.ok).toBe(true)
    if (warned.ok) {
      expect(warned.warnings).toEqual([
        { key: 'vat_diff', document: 'd1', detail: { rate_bp: 2100, diff_cents: 37 } },
      ])
      expect(warned.bundle.documents[0]?.lines[1]).toMatchObject({
        amountCents: 210_037,
        vatComputedCents: 210_000,
      })
    }
    const rejected = withVat([{ vatRateBp: 2100, givenCents: 250_000 }])
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.errors.map((e) => e.key)).toContain('vat_out_of_tolerance')
  })

  it('el total según la factura que no coincide → `total_mismatch` con los dos números', () => {
    const { r, ctx, meta } = prepare(E1)
    const result = buildPurchase({ ...E1.input(r), controlTotalCents: 86_000_001 }, ctx, meta)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        key: 'total_mismatch',
        field: 'controlTotalCents',
        detail: { computed_cents: 86_000_000, control_cents: 86_000_001 },
      })
    }
  })

  it('el IVA que no computa (la SAS monotributista) va al costo de cada imputación, repartido por su neto', () => {
    const { r, ctx, meta } = prepare()
    const mono = { ...ctx, settings: { ...ctx.settings, ivaCondition: 'monotributo' as const } }
    const result = buildPurchase(
      purchaseInput({
        partyId: r.party('cocacola'),
        voucherType: 'factura_a',
        pointOfSale: 3,
        number: 1600,
        issueDate: '2026-10-05',
        lines: [
          {
            role: 'net',
            accountId: r.account('purchases_soft_drinks'),
            amountCents: 1_000_000,
            vatRateBp: 2100,
          },
          {
            role: 'net',
            accountId: r.account('purchases_alcohol'),
            amountCents: 3_000_000,
            vatRateBp: 2100,
          },
        ],
      }),
      mono,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.bundle.documents[0]
    expect(doc?.lines.map((l) => [l.role, l.accountId, l.amountCents])).toEqual([
      ['net', r.account('purchases_soft_drinks'), 1_000_000],
      ['net', r.account('purchases_alcohol'), 3_000_000],
      ['vat', r.account('purchases_soft_drinks'), 210_000],
      ['vat', r.account('purchases_alcohol'), 630_000],
      ['control', r.account('payable_suppliers'), 4_840_000],
    ])
    expect(doc?.fiscalVouchers[0]?.amounts.vat_computable_cents).toBeUndefined()
  })
})

describe('proveedor nuevo, vencimiento y «Guardar y pagar»', () => {
  it('un proveedor nuevo viaja en el bundle con su ref y la partida lo usa', () => {
    const { r, ctx, meta } = prepare()
    const result = buildPurchase(
      purchaseInput({
        newParty: {
          name: 'Distribuidora Norte SRL',
          taxId: '30-83016613-7',
          paymentTermDays: 21,
        },
        voucherType: 'factura_a',
        pointOfSale: 2,
        number: 10,
        issueDate: '2026-10-05',
        amountMode: 'total',
        total: { totalCents: 121_000, vatRateBp: 2100, accountId: r.account('purchases_other') },
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.newParties).toEqual([
      {
        ref: 'p1',
        kind: 'supplier',
        name: 'Distribuidora Norte SRL',
        tradeName: null,
        taxIdType: 'cuit',
        taxId: '30830166137',
        ivaCondition: 'responsable_inscripto',
        paymentTermDays: 21,
        defaultAccountId: r.account('purchases_other'),
      },
    ])
    const doc = result.bundle.documents[0]
    expect(doc?.party).toEqual({ ref: 'p1' })
    expect(doc?.dueDate).toBe('2026-10-26')
    expect(doc?.lines.at(-1)).toMatchObject({
      role: 'control',
      partyRef: { ref: 'p1' },
      dueDate: '2026-10-26',
    })
    expect(doc?.fiscalVouchers[0]?.counterparty).toEqual({
      party: { ref: 'p1' },
      name: 'Distribuidora Norte SRL',
      docType: 80,
      docNumber: '30830166137',
      ivaCondition: 'responsable_inscripto',
    })
  })

  it('«Guardar y pagar» arma [purchase, payment] y aplica el pago a la partida nueva', () => {
    const { r, ctx, meta } = prepare(E1)
    const result = buildPurchase(
      {
        ...E1.input(r),
        payNow: {
          treasuryAccountId: r.treasury('banco'),
          amountCents: null,
          date: '2026-10-20',
          reference: 'TRF 991',
        },
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [purchase, payment] = result.bundle.documents
    expect(purchase?.kind).toBe('purchase')
    expect(payment).toMatchObject({
      ref: 'd2',
      kind: 'payment',
      accountingDate: '2026-10-20',
      totalCents: 86_000_000,
    })
    expect(payment?.lines.map((l) => [l.role, l.side, l.amountCents, l.reference])).toEqual([
      ['control', 'debit', 86_000_000, null],
      ['treasury', 'credit', 86_000_000, 'TRF 991'],
    ])
    expect(result.bundle.allocations).toEqual([
      {
        debit: { doc: 'd2', lineNo: 1 },
        credit: { doc: 'd1', lineNo: 3 },
        amountCents: 86_000_000,
        kind: 'payment',
      },
    ])
  })

  it('un pago parcial imputa solo lo pagado; una NC no se paga', () => {
    const { r, ctx, meta } = prepare(E1)
    const partial = buildPurchase(
      {
        ...E1.input(r),
        payNow: {
          treasuryAccountId: r.treasury('banco'),
          amountCents: 30_000_000,
          date: null,
          reference: null,
        },
      },
      ctx,
      meta,
    )
    expect(partial.ok).toBe(true)
    if (partial.ok) expect(partial.bundle.allocations[0]?.amountCents).toBe(30_000_000)

    const nc = buildPurchase(
      {
        ...E6.input(r),
        payNow: {
          treasuryAccountId: r.treasury('banco'),
          amountCents: null,
          date: null,
          reference: null,
        },
      },
      ctx,
      meta,
    )
    expect(nc.ok).toBe(false)
  })
})

describe('reglas que vienen de la validación compartida', () => {
  it('una C de un responsable inscripto → `invalid_voucher_for_condition`', () => {
    const { r, ctx, meta } = prepare()
    const result = buildPurchase(
      purchaseInput({
        partyId: r.party('cocacola'),
        voucherType: 'factura_c',
        pointOfSale: 3,
        number: 9,
        issueDate: '2026-10-05',
        amountMode: 'total',
        total: {
          totalCents: 100_000,
          vatRateBp: null,
          accountId: r.account('purchases_soft_drinks'),
        },
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors.map((e) => e.key)).toContain('invalid_voucher_for_condition')
  })

  it('una DDJJ a nombre de un proveedor que no es organismo → `ddjj_requires_tax_agency`', () => {
    const { r, ctx, meta } = prepare(DDJJ_IIBB)
    const result = buildPurchase({ ...DDJJ_IIBB.input(r), partyId: r.party('cocacola') }, ctx, meta)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('ddjj_requires_tax_agency')
  })

  it('un proveedor que no está en el contexto → `party_not_found`', () => {
    const { r, ctx, meta } = prepare(E1)
    const result = buildPurchase(
      { ...E1.input(r), partyId: '00000000-0000-4000-8000-000000555555' },
      ctx,
      meta,
    )
    expect(result).toEqual({ ok: false, errors: [{ key: 'party_not_found', field: 'partyId' }] })
  })

  it('una compra con emisión de hace más de 60 días avisa `late_registration`', () => {
    const { r, ctx, meta } = prepare(E1)
    const result = buildPurchase(
      { ...E1.input(r), issueDate: '2026-10-01', accountingDate: '2026-12-15' },
      { ...ctx, today: '2026-12-20' },
      meta,
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings.map((w) => w.key)).toContain('late_registration')
  })

  it('con el mes cerrado, la fecha contable pasa al primer día abierto', () => {
    const { r, ctx } = prepare(E1)
    const result = buildPurchase(E1.input(r), ctx, {
      clientRef: '00000000-0000-4000-8000-000000777777',
      validate: { firstOpenDate: '2026-10-05' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.documents[0]).toMatchObject({
        issueDate: '2026-10-03',
        accountingDate: '2026-10-05',
      })
    }
  })
})
