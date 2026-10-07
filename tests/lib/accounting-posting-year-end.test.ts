import { describe, expect, it } from 'vitest'
import {
  buildFiscalYearClose,
  compareAccountCodes,
  computeFiscalYearResult,
} from '@/lib/accounting/posting/year-end'
import { assertGolden, E20_CLOSE, prepare } from './accounting-fixtures'

describe('cierre de ejercicio (E.5.18)', () => {
  it('E20 · refundición, cierre patrimonial y apertura espejo', () => {
    const { r, ctx, meta } = prepare(E20_CLOSE)
    assertGolden(buildFiscalYearClose(E20_CLOSE.input(r), ctx, meta), E20_CLOSE, r)
  })

  it('el resultado del ejercicio es ingresos − egresos (lo que compara la RPC)', () => {
    const { r, ctx } = prepare(E20_CLOSE)
    expect(computeFiscalYearResult(E20_CLOSE.input(r).balances, ctx)).toBe(32_090_865)
  })

  it('con pérdida, «Resultado del ejercicio» va al Debe en la refundición', () => {
    const { r, ctx, meta } = prepare(E20_CLOSE)
    const result = buildFiscalYearClose(
      {
        endDate: '2026-12-31',
        balances: [
          { accountId: r.account('sales_salon_invoiced'), balanceCents: -1_000_000 },
          { accountId: r.account('purchases_food'), balanceCents: 1_500_000 },
          { accountId: r.treasuryAccount('caja'), balanceCents: -500_000 },
        ],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [refund, closing, opening] = result.bundle.documents
    expect(refund?.lines.map((l) => [l.accountId, l.side, l.amountCents])).toEqual([
      [r.account('sales_salon_invoiced'), 'debit', 1_000_000],
      [r.account('purchases_food'), 'credit', 1_500_000],
      [r.account('current_year_result'), 'debit', 500_000],
    ])
    expect(closing?.lines.map((l) => [l.accountId, l.side, l.amountCents])).toEqual([
      [r.treasuryAccount('caja'), 'debit', 500_000],
      [r.account('current_year_result'), 'credit', 500_000],
    ])
    expect(opening?.accountingDate).toBe('2027-01-01')
    expect(opening?.lines.map((l) => [l.accountId, l.side, l.amountCents])).toEqual([
      [r.treasuryAccount('caja'), 'credit', 500_000],
      [r.account('current_year_result'), 'debit', 500_000],
    ])
  })

  it('saldos que no balancean (un balance incompleto) → `entry_not_balanced` en el cierre', () => {
    const { r, ctx, meta } = prepare(E20_CLOSE)
    const input = E20_CLOSE.input(r)
    const result = buildFiscalYearClose(
      { ...input, balances: input.balances.slice(0, 4) },
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('entry_not_balanced')
  })

  it('los códigos se ordenan por segmento numérico', () => {
    expect(['1.1.10', '1.1.9', '1.2', '1.1.01.02'].sort(compareAccountCodes)).toEqual([
      '1.1.01.02',
      '1.1.9',
      '1.1.10',
      '1.2',
    ])
  })
})
