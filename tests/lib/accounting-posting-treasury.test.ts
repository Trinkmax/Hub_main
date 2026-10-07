import { describe, expect, it } from 'vitest'
import {
  buildBankExpense,
  buildCashMovement,
  buildTransfer,
  splitBankTax,
} from '@/lib/accounting/posting/treasury'
import {
  assertGolden,
  bankExpenseInput,
  cashMovementInput,
  E11,
  E12,
  E21,
  prepare,
} from './accounting-fixtures'

describe('mover plata (E.5.10)', () => {
  it('E11 · depósito del efectivo: D Banco / H Caja', () => {
    const { r, ctx, meta } = prepare(E11)
    assertGolden(buildTransfer(E11.input(r), ctx, meta), E11, r)
  })

  it('si la caja de origen queda en negativo (el contexto tiene $ 150.000) avisa `treasury_negative`', () => {
    const { r, ctx, meta } = prepare(E11)
    const result = buildTransfer(E11.input(r), ctx, meta)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings).toEqual([
        {
          key: 'treasury_negative',
          detail: {
            treasury_id: r.treasury('caja'),
            treasury_name: 'Caja',
            balance_after_cents: -35_000_000,
          },
        },
      ])
    }
  })

  it('la misma caja de los dos lados → `same_treasury`', () => {
    const { r, ctx, meta } = prepare(E11)
    const result = buildTransfer({ ...E11.input(r), toTreasuryId: r.treasury('caja') }, ctx, meta)
    expect(result).toEqual({ ok: false, errors: [{ key: 'same_treasury', field: 'toTreasuryId' }] })
  })
})

describe('gasto bancario (E.5.11)', () => {
  it('E12 · resumen del Banco Nación con Ley 25.413 y SIRCREB, en el libro IVA', () => {
    const { r, ctx, meta } = prepare(E12)
    assertGolden(buildBankExpense(E12.input(r), ctx, meta), E12, r)
  })

  it('Ley 25.413: la parte computable con redondeo a la mitad hacia arriba y el resto al gasto', () => {
    expect(splitBankTax(180_000, 3300)).toEqual({ computable: 59_400, expense: 120_600 })
    expect(splitBankTax(120_000, 3300)).toEqual({ computable: 39_600, expense: 80_400 })
    expect(splitBankTax(15, 3300)).toEqual({ computable: 5, expense: 10 })
  })

  it('sin «Incluir en el libro IVA»: el IVA va a gastos bancarios y no hay comprobante fiscal', () => {
    const { r, ctx, meta } = prepare()
    const result = buildBankExpense(
      bankExpenseInput({
        treasuryAccountId: r.treasury('banco'),
        date: '2026-10-31',
        feesNetCents: 800_000,
        vatPerceptionCents: 24_000,
        feesNoVatCents: 50_000,
        interestCents: 12_000,
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.bundle.documents[0]
    expect(doc).toMatchObject({ voucherType: null, party: null, totalCents: 1_054_000 })
    expect(doc?.lines.map((l) => [l.role, l.accountId, l.amountCents, l.taxKind])).toEqual([
      ['net', r.account('bank_fees'), 800_000, null],
      ['vat', r.account('bank_fees'), 168_000, 'iva'],
      ['perception', r.account('vat_perceptions'), 24_000, 'iva'],
      ['gross', r.account('bank_fees'), 50_000, null],
      ['other_tax', r.account('interest_expense'), 12_000, 'interes'],
      ['treasury', r.treasuryAccount('banco'), 1_054_000, null],
    ])
    expect(doc?.fiscalVouchers).toEqual([])
  })

  it('para el libro IVA hace falta el banco como partícipe (con su CUIT)', () => {
    const { r, ctx, meta } = prepare(E12)
    const banco = ctx.treasuries.get(r.treasury('banco'))
    if (!banco) throw new Error('falta el banco')
    const treasuries = new Map(ctx.treasuries)
    treasuries.set(banco.id, { ...banco, bankPartyId: null })
    const result = buildBankExpense(E12.input(r), { ...ctx, treasuries }, meta)
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          key: 'party_tax_id_required',
          field: 'includeInIvaBook',
          detail: { party_name: 'Banco Nación' },
        },
      ],
    })
  })
})

describe('otro ingreso o egreso (E.5.12)', () => {
  it('E21 · Máximo retira $ 100.000: D Cuentas particulares [Máximo] / H Caja', () => {
    const { r, ctx, meta } = prepare(E21)
    assertGolden(buildCashMovement(E21.input(r), ctx, meta), E21, r)
  })

  it('un ingreso pone la caja primero (Debe) y la contrapartida al Haber', () => {
    const { r, ctx, meta } = prepare()
    const result = buildCashMovement(
      cashMovementInput({
        treasuryAccountId: r.treasury('mp'),
        direction: 'in',
        counterpartAccountId: r.account('interest_income'),
        amountCents: 35_000,
        date: '2026-10-31',
        shortcut: 'mp_yield',
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.bundle.documents[0]?.lines.map((l) => [l.role, l.side, l.accountId, l.amountCents]),
    ).toEqual([
      ['treasury', 'debit', r.treasuryAccount('mp'), 35_000],
      ['counterpart', 'credit', r.account('interest_income'), 35_000],
    ])
  })

  it('una contrapartida de IVA no se admite (`line_account_invalid`); una de control pide partícipe', () => {
    const { r, ctx, meta } = prepare()
    const vat = buildCashMovement(
      cashMovementInput({
        treasuryAccountId: r.treasury('caja'),
        direction: 'out',
        counterpartAccountId: r.account('vat_credit'),
        amountCents: 1_000,
        date: '2026-10-31',
      }),
      ctx,
      meta,
    )
    expect(vat.ok).toBe(false)
    if (!vat.ok) expect(vat.errors.map((e) => e.key)).toContain('line_account_invalid')
    const noPartner = buildCashMovement(
      cashMovementInput({
        treasuryAccountId: r.treasury('caja'),
        direction: 'out',
        counterpartAccountId: r.account('partners_current'),
        amountCents: 1_000,
        date: '2026-10-31',
        shortcut: 'partner_withdrawal',
      }),
      ctx,
      meta,
    )
    expect(noPartner.ok).toBe(false)
    if (!noPartner.ok)
      expect(noPartner.errors.map((e) => e.key)).toContain('account_requires_party')
  })
})
