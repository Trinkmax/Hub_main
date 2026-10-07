import { describe, expect, it } from 'vitest'
import {
  buildQuickExpense,
  invoiceLetterFor,
  quickExpensePath,
} from '@/lib/accounting/posting/quick-expense'
import { assertGolden, E4_QUICK, E5, prepare, quickExpenseInput } from './accounting-fixtures'

describe('«Nuevo gasto» (H.5, E.5.3 y E.5.4)', () => {
  it('E4 · sin comprobante → un solo `expense`', () => {
    const { r, ctx, meta } = prepare(E4_QUICK)
    assertGolden(buildQuickExpense(E4_QUICK.input(r), ctx, meta), E4_QUICK, r)
  })

  it('E5 · con Factura A → [purchase, payment] con la imputación del 100 %', () => {
    const { r, ctx, meta } = prepare(E5)
    assertGolden(buildQuickExpense(E5.input(r), ctx, meta), E5, r)
  })

  it('E5 · $ 3.600 con Factura A: neto 297.521, IVA 62.479 (vatFromNet del neto = 62.479)', () => {
    const { r, ctx, meta } = prepare(E5)
    const result = buildQuickExpense({ ...E5.input(r), amountCents: 360_000 }, ctx, meta)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [purchase, payment] = result.bundle.documents
    expect(purchase?.lines.map((l) => [l.role, l.amountCents, l.vatComputedCents])).toEqual([
      ['net', 297_521, null],
      ['vat', 62_479, 62_479],
      ['control', 360_000, null],
    ])
    expect(payment?.totalCents).toBe(360_000)
  })

  it('±1¢ en el IVA de la factura mueve el neto (el total no cambia)', () => {
    const { r, ctx, meta } = prepare(E5)
    const result = buildQuickExpense({ ...E5.input(r), vatAdjustCents: 1 }, ctx, meta)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.documents[0]?.lines.map((l) => [l.role, l.amountCents])).toEqual([
      ['net', 999_999],
      ['vat', 210_001],
      ['control', 1_210_000],
    ])
    expect(result.warnings).toEqual([])
  })

  it('«Factura B o C»: B de un responsable inscripto (con aviso), C de un monotributista', () => {
    expect(invoiceLetterFor('responsable_inscripto')).toBe('factura_b')
    expect(invoiceLetterFor('monotributo')).toBe('factura_c')
    expect(invoiceLetterFor('exento')).toBe('factura_c')

    const { r, ctx, meta } = prepare()
    const plumber = buildQuickExpense(
      quickExpenseInput({
        amountCents: 4_500_000,
        target: { type: 'party', partyId: r.party('plomero'), accountId: r.account('maintenance') },
        treasuryAccountId: r.treasury('banco'),
        voucher: 'bc',
        pointOfSale: 2,
        number: 46,
        date: '2026-10-09',
      }),
      ctx,
      meta,
    )
    expect(plumber.ok).toBe(true)
    if (plumber.ok) {
      const purchase = plumber.bundle.documents[0]
      expect(purchase?.voucherType).toBe('factura_c')
      expect(purchase?.lines.map((l) => [l.role, l.amountCents])).toEqual([
        ['gross', 4_500_000],
        ['control', 4_500_000],
      ])
      expect(purchase?.fiscalVouchers[0]?.amounts).toEqual({
        undiscriminated_cents: 4_500_000,
        total_cents: 4_500_000,
      })
      expect(plumber.warnings).toEqual([])
    }

    const corralon = buildQuickExpense(
      quickExpenseInput({
        amountCents: 2_420_000,
        target: {
          type: 'party',
          partyId: r.party('corralon'),
          accountId: r.account('maintenance'),
        },
        treasuryAccountId: r.treasury('caja'),
        voucher: 'bc',
        pointOfSale: 7,
        number: 3302,
        date: '2026-10-09',
      }),
      ctx,
      meta,
    )
    expect(corralon.ok).toBe(true)
    if (corralon.ok) {
      expect(corralon.bundle.documents[0]?.voucherType).toBe('factura_b')
      expect(corralon.warnings.map((w) => w.key)).toEqual(['voucher_condition'])
    }
  })

  it('un tique sin número (aunque tenga proveedor) es un gasto; con proveedor y número, una compra', () => {
    const { r, ctx, meta } = prepare()
    const base = {
      amountCents: 360_000,
      target: {
        type: 'party',
        partyId: r.party('cocacola'),
        accountId: r.account('purchases_soft_drinks'),
      },
      treasuryAccountId: r.treasury('caja'),
      voucher: 'ticket',
      date: '2026-10-09',
    } as const
    expect(quickExpensePath(quickExpenseInput(base), ctx)).toEqual({
      kind: 'expense',
      voucherType: 'tique',
    })
    const asExpense = buildQuickExpense(quickExpenseInput(base), ctx, meta)
    expect(asExpense.ok && asExpense.bundle.documents.map((d) => [d.kind, d.voucherType])).toEqual([
      ['expense', 'tique'],
    ])

    const numbered = quickExpenseInput({ ...base, pointOfSale: 8, number: 5521 })
    expect(quickExpensePath(numbered, ctx)).toEqual({ kind: 'purchase', voucherType: 'tique' })
    const asPurchase = buildQuickExpense(numbered, ctx, meta)
    expect(asPurchase.ok).toBe(true)
    if (asPurchase.ok) {
      expect(asPurchase.bundle.documents.map((d) => [d.kind, d.voucherType])).toEqual([
        ['purchase', 'tique'],
        ['payment', null],
      ])
      // El tique de un RI no computa IVA (aviso) y va como «no discriminado».
      expect(asPurchase.warnings.map((w) => w.key)).toEqual(['voucher_condition'])
      expect(asPurchase.bundle.documents[0]?.fiscalVouchers[0]?.amounts).toEqual({
        undiscriminated_cents: 360_000,
        total_cents: 360_000,
      })
    }
  })

  it('proveedor nuevo con factura: se crea en el mismo envío con la cuenta del gasto como habitual', () => {
    const { r, ctx, meta } = prepare()
    const result = buildQuickExpense(
      quickExpenseInput({
        amountCents: 121_000,
        target: { type: 'account', accountId: r.account('cleaning') },
        newParty: { name: 'Limpieza Total SRL', taxId: '30830166137' },
        treasuryAccountId: r.treasury('caja'),
        voucher: 'a',
        pointOfSale: 1,
        number: 77,
        date: '2026-10-09',
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.newParties).toMatchObject([
      {
        ref: 'p1',
        name: 'Limpieza Total SRL',
        taxId: '30830166137',
        defaultAccountId: r.account('cleaning'),
      },
    ])
    expect(result.bundle.documents.map((d) => d.party)).toEqual([{ ref: 'p1' }, { ref: 'p1' }])
    expect(result.bundle.allocations).toEqual([
      {
        debit: { doc: 'd2', lineNo: 1 },
        credit: { doc: 'd1', lineNo: 3 },
        amountCents: 121_000,
        kind: 'payment',
      },
    ])
  })

  it('con el mes cerrado, la compra y el pago van al primer día abierto (la emisión queda)', () => {
    const { r, ctx } = prepare(E5)
    const result = buildQuickExpense({ ...E5.input(r), date: '2026-10-03' }, ctx, {
      clientRef: '00000000-0000-4000-8000-000000777777',
      validate: { firstOpenDate: '2026-10-04' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.documents.map((d) => [d.kind, d.issueDate, d.accountingDate])).toEqual([
      ['purchase', '2026-10-03', '2026-10-04'],
      ['payment', '2026-10-04', '2026-10-04'],
    ])
  })
})
