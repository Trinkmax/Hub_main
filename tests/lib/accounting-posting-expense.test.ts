import { describe, expect, it } from 'vitest'
import { buildExpense } from '@/lib/accounting/posting/expense'
import { assertGolden, E4, prepare } from './accounting-fixtures'

describe('gasto de contado sin factura (E.5.3)', () => {
  it('E4 · D gasto / H caja, sin comprobante fiscal', () => {
    const { r, ctx, meta } = prepare(E4)
    assertGolden(buildExpense(E4.input(r), ctx, meta), E4, r)
  })

  it('un tique sin comercio con proveedor (solo estadísticas): el proveedor va en la cabecera, no en los renglones', () => {
    const { r, ctx, meta } = prepare(E4)
    const result = buildExpense(
      { ...E4.input(r), voucherType: 'tique', partyId: r.party('kiosco') },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.bundle.documents[0]
    expect(doc).toMatchObject({
      kind: 'expense',
      voucherType: 'tique',
      party: { id: r.party('kiosco') },
    })
    expect(doc?.lines.every((l) => l.partyRef === null)).toBe(true)
    expect(doc?.fiscalVouchers).toEqual([])
  })

  it('varias imputaciones contra una sola caja; los importes en cero se descartan', () => {
    const { r, ctx, meta } = prepare(E4)
    const result = buildExpense(
      {
        ...E4.input(r),
        lines: [
          { accountId: r.account('purchases_soft_drinks'), amountCents: 300_000 },
          { accountId: r.account('cleaning'), amountCents: 0 },
          { accountId: r.account('purchases_food'), amountCents: 150_000 },
        ],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.bundle.documents[0]?.lines.map((l) => [l.lineNo, l.role, l.side, l.amountCents]),
    ).toEqual([
      [1, 'gross', 'debit', 300_000],
      [2, 'gross', 'debit', 150_000],
      [3, 'treasury', 'credit', 450_000],
    ])
  })

  it('una caja que no está en el contexto corta antes de armar nada', () => {
    const { r, ctx, meta } = prepare(E4)
    const result = buildExpense(
      { ...E4.input(r), treasuryAccountId: '00000000-0000-4000-8000-000000444444' },
      ctx,
      meta,
    )
    expect(result).toEqual({
      ok: false,
      errors: [{ key: 'treasury_mismatch', field: 'treasuryAccountId' }],
    })
  })

  it('todo en cero → `amount_required`', () => {
    const { r, ctx, meta } = prepare(E4)
    const result = buildExpense(
      {
        ...E4.input(r),
        lines: [{ accountId: r.account('purchases_soft_drinks'), amountCents: 0 }],
      },
      ctx,
      meta,
    )
    expect(result).toEqual({ ok: false, errors: [{ key: 'amount_required', field: 'lines' }] })
  })

  it('la caja que quedaría en negativo avisa `treasury_negative`', () => {
    const { r, ctx, meta } = prepare(E4)
    const result = buildExpense(
      {
        ...E4.input(r),
        lines: [{ accountId: r.account('purchases_soft_drinks'), amountCents: 16_000_000 }],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings).toEqual([
        {
          key: 'treasury_negative',
          detail: {
            treasury_id: r.treasury('caja'),
            treasury_name: 'Caja',
            balance_after_cents: -1_000_000,
          },
        },
      ])
    }
  })
})
