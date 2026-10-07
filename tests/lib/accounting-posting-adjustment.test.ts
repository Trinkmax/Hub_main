import { describe, expect, it } from 'vitest'
import { buildReversal, buildTreasuryAdjustment } from '@/lib/accounting/posting/adjustment'
import { buildPurchase } from '@/lib/accounting/posting/purchase'
import { assertGolden, E1, E18, E19, prepare, treasuryAdjustmentInput } from './accounting-fixtures'

describe('arqueo de una caja o un banco (E.5.13)', () => {
  it('E18 · caja con faltante: D Faltantes de caja / H Caja', () => {
    const { r, ctx, meta } = prepare(E18)
    assertGolden(buildTreasuryAdjustment(E18.input(r), ctx, meta), E18, r)
  })

  it('caja con sobrante: D Caja / H Sobrantes de caja', () => {
    const { r, ctx, meta } = prepare()
    const result = buildTreasuryAdjustment(
      treasuryAdjustmentInput({
        treasuryAccountId: r.treasury('caja'),
        date: '2026-10-31',
        countedCents: 45_040_000,
        expectedBookCents: 45_000_000,
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.bundle.documents[0]?.lines.map((l) => [l.role, l.side, l.accountId, l.amountCents]),
    ).toEqual([
      ['treasury', 'debit', r.treasuryAccount('caja'), 40_000],
      ['adjustment_split', 'credit', r.account('cash_over'), 40_000],
    ])
  })

  it('banco sin reparto: la diferencia va a «Diferencias de cobro a conciliar», nunca a faltante de caja', () => {
    const { r, ctx, meta } = prepare()
    const result = buildTreasuryAdjustment(
      treasuryAdjustmentInput({
        treasuryAccountId: r.treasury('banco'),
        date: '2026-10-31',
        countedCents: 99_990_000,
        expectedBookCents: 100_000_000,
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.bundle.documents[0]?.lines.map((l) => [l.role, l.side, l.accountId, l.amountCents]),
    ).toEqual([
      ['adjustment_split', 'debit', r.account('reconciliation_differences'), 10_000],
      ['treasury', 'credit', r.treasuryAccount('banco'), 10_000],
    ])
  })

  it('un banco explicado con faltante de caja → `adjustment_account_invalid`', () => {
    const { r, ctx, meta } = prepare()
    const result = buildTreasuryAdjustment(
      treasuryAdjustmentInput({
        treasuryAccountId: r.treasury('banco'),
        date: '2026-10-31',
        countedCents: 99_990_000,
        expectedBookCents: 100_000_000,
        splits: [{ accountId: r.account('cash_short'), amountCents: 10_000 }],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('adjustment_account_invalid')
  })

  it('un reparto que no suma la diferencia → `total_mismatch`', () => {
    const { r, ctx, meta } = prepare()
    const result = buildTreasuryAdjustment(
      {
        ...treasuryAdjustmentInput({
          treasuryAccountId: r.treasury('banco'),
          date: '2026-10-31',
          countedCents: 99_990_000,
          expectedBookCents: 100_000_000,
        }),
        splits: [
          {
            accountId: r.account('bank_fees'),
            amountCents: 9_000,
            taxKind: 'comision',
            partyId: null,
          },
        ],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        key: 'total_mismatch',
        field: 'splits',
        detail: { computed_cents: 9_000, control_cents: 10_000 },
      })
    }
  })
})

describe('anulación con fecha de hoy (E.5.17)', () => {
  it('E19 · el espejo exacto de E1 con los mismos `line_no`', () => {
    const { r, ctx, meta } = prepare(E19)
    assertGolden(buildReversal(E19.input(r), ctx, meta), E19, r)
  })

  it('anula lo que armó el builder de compras: cada renglón con el lado contrario', () => {
    const { r, ctx, meta } = prepare(E1)
    const original = buildPurchase(E1.input(r), ctx, meta)
    if (!original.ok) throw new Error('E1 no se armó')
    const doc = original.bundle.documents[0]
    if (!doc) throw new Error('falta el documento')
    const reversal = buildReversal(
      {
        original: {
          id: r.document('E1.copy'),
          kind: doc.kind,
          description: doc.description,
          party: doc.party,
          accountingDate: doc.accountingDate,
          totalCents: doc.totalCents,
          lines: doc.lines,
        },
        reversalDate: '2026-11-12',
        reason: 'Error de carga: la factura estaba duplicada',
      },
      ctx,
      meta,
    )
    expect(reversal.ok).toBe(true)
    if (!reversal.ok) return
    const mirror = reversal.bundle.documents[0]
    expect(mirror?.description).toBe(`Anulación de ${doc.description}`)
    expect(mirror?.lines.map((l) => [l.lineNo, l.accountId, l.side, l.amountCents])).toEqual(
      doc.lines.map((l) => [
        l.lineNo,
        l.accountId,
        l.side === 'debit' ? 'credit' : 'debit',
        l.amountCents,
      ]),
    )
    // Como el diario: primero el Debe (el proveedor) y después el Haber.
    expect(reversal.preview[0]?.lines.map((l) => l.lineNo)).toEqual([3, 1, 2])
  })

  it('una apertura no se anula así, la fecha no puede ser anterior y el motivo es obligatorio', () => {
    const { r, ctx, meta } = prepare(E19)
    const input = E19.input(r)
    const opening = buildReversal(
      { ...input, original: { ...input.original, kind: 'opening' } },
      ctx,
      meta,
    )
    expect(opening.ok === false && opening.errors.map((e) => e.key)).toEqual([
      'kind_not_reversible',
    ])
    const early = buildReversal({ ...input, reversalDate: '2026-10-02' }, ctx, meta)
    expect(early.ok === false && early.errors.map((e) => e.key)).toEqual(['reversal_date_invalid'])
    const noReason = buildReversal({ ...input, reason: 'mal' }, ctx, meta)
    expect(noReason.ok === false && noReason.errors.map((e) => e.key)).toEqual(['reason_required'])
  })
})
