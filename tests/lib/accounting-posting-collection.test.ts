import { describe, expect, it } from 'vitest'
import {
  buildCollection,
  buildWalletCheck,
  prefillDeductions,
} from '@/lib/accounting/posting/collection'
import {
  assertGolden,
  collectionInput,
  E9,
  E10,
  E10B,
  E10C,
  E16_ADVANCE,
  E17,
  prepare,
  walletCheckInput,
} from './accounting-fixtures'

describe('cobranzas y acreditaciones: los golden de E.5.7', () => {
  for (const fixture of [E9, E10, E10C, E10B, E16_ADVANCE]) {
    it(`${fixture.id} · ${fixture.title}`, () => {
      const { r, ctx, meta } = prepare(fixture)
      assertGolden(buildCollection(fixture.input(r), ctx, meta), fixture, r)
    })
  }

  it('precarga de descuentos con las tasas del partícipe: los números de E9', () => {
    expect(
      prefillDeductions(33_000_000, {
        commissionBp: 180,
        iibbWithholdingBp: 120,
        vatWithholdingBp: null,
        incomeTaxWithholdingBp: 100,
        sircupaBp: null,
      }),
    ).toEqual([
      { taxKind: 'comision', amountCents: 594_000 },
      { taxKind: 'iva_comision', amountCents: 124_740 },
      { taxKind: 'ret_iibb', amountCents: 396_000 },
      { taxKind: 'ret_ganancias', amountCents: 330_000 },
    ])
  })

  it('«no factura»: el IVA de la comisión va a la cuenta de la comisión y no hay libro IVA', () => {
    const { r, ctx, meta } = prepare(E10)
    const result = buildCollection(
      { ...E10.input(r), commissionVoucher: { mode: 'none' } },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.bundle.documents[0]
    expect(doc?.lines[2]).toMatchObject({
      role: 'deduction',
      accountId: r.account('fees_platforms'),
      taxKind: 'iva_comision',
      partyRef: null,
      amountCents: 5_250_000,
    })
    expect(doc?.fiscalVouchers).toEqual([])
  })

  it('el bruto liquidado que no da lo cargado → `total_mismatch`', () => {
    const { r, ctx, meta } = prepare(E9)
    const result = buildCollection({ ...E9.input(r), grossCents: 33_000_100 }, ctx, meta)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        key: 'total_mismatch',
        field: 'grossCents',
        detail: { computed_cents: 33_000_000, control_cents: 33_000_100 },
      })
    }
  })

  it('la liquidación en el libro IVA exige el CUIT del procesador (`party_tax_id_required`)', () => {
    const { r, ctx, meta } = prepare(E9)
    const posnet = ctx.parties.get(r.party('posnetCredito'))
    if (!posnet) throw new Error('falta Posnet')
    const parties = new Map(ctx.parties)
    parties.set(posnet.id, { ...posnet, taxIdType: 'none', taxId: null })
    const result = buildCollection(E9.input(r), { ...ctx, parties }, meta)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('party_tax_id_required')
  })

  it('aplicar más de lo cobrado → `allocation_exceeds_open`', () => {
    const { r, ctx, meta } = prepare(E9)
    const result = buildCollection(
      collectionInput({
        partyId: r.party('posnetCredito'),
        date: '2026-10-15',
        applications: [{ lineId: r.item('E8.credit'), amountCents: 33_000_000 }],
        received: [{ treasuryAccountId: r.treasury('banco'), amountCents: 33_000_000 }],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    const short = buildCollection(
      {
        ...E9.input(r),
        received: [
          { treasuryAccountId: r.treasury('banco'), amountCents: 1_000_000, reference: null },
        ],
        grossCents: null,
      },
      ctx,
      meta,
    )
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.errors.map((e) => e.key)).toContain('allocation_exceeds_open')
  })
})

describe('«Ajustar saldo de Mercado Pago» (E.5.8)', () => {
  it('E17 · entró 38.200.000 contra 40.000.000 a acreditar; 700 sin explicar a diferencias', () => {
    const { r, ctx, meta } = prepare(E17)
    assertGolden(buildWalletCheck(E17.input(r), ctx, meta), E17, r)
  })

  it('sin partícipe se toma la billetera de la caja', () => {
    const { r, ctx, meta } = prepare(E17)
    const result = buildWalletCheck({ ...E17.input(r), partyId: null }, ctx, meta)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bundle.documents[0]?.party).toEqual({ id: r.party('mercadopago') })
  })

  it('si entró más que lo pendiente: [collection, treasury_adjustment] con el excedente a rendimientos y el chequeo encadenado', () => {
    const { r, ctx, meta } = prepare(E17)
    const result = buildWalletCheck(
      walletCheckInput({
        treasuryAccountId: r.treasury('mp'),
        partyId: r.party('mercadopago'),
        date: '2026-10-12',
        countedCents: 90_100_000,
        expectedBookCents: 50_000_000,
        items: [
          { lineId: r.item('E8.transfer'), amountCents: 18_000_000 },
          { lineId: r.item('E8.qr'), amountCents: 22_000_000 },
        ],
        breakdown: [
          { taxKind: 'sircupa', amountCents: 630_000, salesMethodId: r.method('transfer') },
        ],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [collection, adjustment] = result.bundle.documents
    expect(collection).toMatchObject({
      kind: 'collection',
      expectedBookCents: 50_000_000,
      countedCents: 89_370_000,
      totalCents: 40_000_000,
    })
    expect(collection?.lines.map((l) => [l.role, l.side, l.amountCents])).toEqual([
      ['treasury', 'debit', 39_370_000],
      ['deduction', 'debit', 630_000],
      ['control', 'credit', 40_000_000],
    ])
    expect(adjustment).toMatchObject({
      kind: 'treasury_adjustment',
      expectedBookCents: 89_370_000,
      countedCents: 90_100_000,
      totalCents: 730_000,
    })
    expect(
      adjustment?.lines.map((l) => [l.role, l.side, l.accountId, l.amountCents, l.taxKind]),
    ).toEqual([
      ['treasury', 'debit', r.treasuryAccount('mp'), 730_000, null],
      ['adjustment_split', 'credit', r.account('interest_income'), 730_000, 'rendimiento'],
    ])
    expect(result.bundle.allocations.map((a) => a.amountCents)).toEqual([18_000_000, 22_000_000])
  })

  it('sin partidas: un arqueo de la billetera (desglose a comisiones y lo demás a diferencias)', () => {
    const { r, ctx, meta } = prepare()
    const result = buildWalletCheck(
      walletCheckInput({
        treasuryAccountId: r.treasury('mp'),
        date: '2026-10-12',
        countedCents: 49_000_000,
        expectedBookCents: 50_000_000,
        breakdown: [{ taxKind: 'comision', amountCents: 600_000 }],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.bundle.documents[0]
    expect(doc).toMatchObject({
      kind: 'treasury_adjustment',
      countedCents: 49_000_000,
      totalCents: 1_000_000,
    })
    expect(doc?.lines.map((l) => [l.role, l.side, l.accountId, l.amountCents, l.taxKind])).toEqual([
      ['adjustment_split', 'debit', r.account('fees_wallets'), 600_000, 'comision'],
      ['adjustment_split', 'debit', r.account('reconciliation_differences'), 400_000, 'diferencia'],
      ['treasury', 'credit', r.treasuryAccount('mp'), 1_000_000, null],
    ])
  })

  it('un desglose que explica más que los descuentos y no deja nada para acreditar → `balance_check_mismatch`', () => {
    const { r, ctx, meta } = prepare(E17)
    const result = buildWalletCheck(
      {
        ...E17.input(r),
        breakdown: [
          {
            taxKind: 'comision',
            amountCents: 41_000_000,
            accountId: null,
            certificateNumber: null,
            salesMethodId: null,
          },
        ],
      },
      ctx,
      meta,
    )
    expect(result).toEqual({
      ok: false,
      errors: [{ key: 'balance_check_mismatch', field: 'breakdown' }],
    })
  })
})
