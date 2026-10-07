import { describe, expect, it } from 'vitest'
import { buildOpening } from '@/lib/accounting/posting/opening'
import { assertGolden, E14, openingInput, prepare } from './accounting-fixtures'

describe('asiento de apertura (E.5.16)', () => {
  it('E14 · la diferencia (71.000.000) a «Saldo de apertura a asignar», al Haber', () => {
    const { r, ctx, meta } = prepare(E14)
    assertGolden(buildOpening(E14.input(r), ctx, meta), E14, r)
  })

  it('si el pasivo y el capital superan al activo, el saldo de apertura va al Debe', () => {
    const { r, ctx, meta } = prepare()
    const result = buildOpening(
      openingInput({
        treasuries: [{ treasuryAccountId: r.treasury('caja'), balanceCents: 1_000_000 }],
        payables: [{ partyId: r.party('cocacola'), amountCents: 3_000_000, dueDate: '2026-10-21' }],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.bundle.documents[0]?.lines.map((l) => [l.side, l.accountId, l.amountCents]),
    ).toEqual([
      ['debit', r.treasuryAccount('caja'), 1_000_000],
      ['credit', r.account('payable_suppliers'), 3_000_000],
      ['debit', r.account('opening_equity'), 2_000_000],
    ])
    expect(result.bundle.documents[0]?.totalCents).toBe(3_000_000)
  })

  it('las cajas en cero no generan renglones', () => {
    const { r, ctx, meta } = prepare(E14)
    const input = E14.input(r)
    const result = buildOpening(
      {
        ...input,
        treasuries: [
          ...input.treasuries,
          { treasuryAccountId: r.treasury('banco'), balanceCents: 0 },
        ],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bundle.documents[0]?.lines).toHaveLength(7)
  })

  it('no entra a los libros IVA y lleva la fecha de inicio de los libros', () => {
    const { r, ctx, meta } = prepare(E14)
    const result = buildOpening(E14.input(r), { ...ctx, settings: { ...ctx.settings } }, meta)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.documents[0]).toMatchObject({
        kind: 'opening',
        entryKind: 'opening',
        accountingDate: ctx.settings.booksStartDate,
        fiscalVouchers: [],
      })
    }
  })
})
