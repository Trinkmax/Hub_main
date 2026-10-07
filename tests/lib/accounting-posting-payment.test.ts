import { describe, expect, it } from 'vitest'
import {
  buildPayment,
  compensationTaxKind,
  planCollectionAllocation,
  planPaymentAllocation,
} from '@/lib/accounting/posting/payment'
import {
  assertGolden,
  E7,
  E7_IIBB,
  E7_OVERPAY,
  E7_WITH_CREDIT,
  E7_WRITE_OFF,
  paymentInput,
  prepare,
} from './accounting-fixtures'

describe('orden de pago: los golden de E.5.5', () => {
  for (const fixture of [E7, E7_OVERPAY, E7_IIBB, E7_WRITE_OFF, E7_WITH_CREDIT]) {
    it(`${fixture.id} · ${fixture.title}`, () => {
      const { r, ctx, meta } = prepare(fixture)
      assertGolden(buildPayment(fixture.input(r), ctx, meta), fixture, r)
    })
  }

  it('sin facturas elegidas es un pago a cuenta contra la cuenta «le debemos» del proveedor', () => {
    const { r, ctx, meta } = prepare()
    const result = buildPayment(
      paymentInput({
        partyId: r.party('cocacola'),
        date: '2026-10-21',
        methods: [
          { type: 'treasury', treasuryAccountId: r.treasury('caja'), amountCents: 1_000_000 },
        ],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.documents[0]).toMatchObject({
      controlAccountId: r.account('payable_suppliers'),
      totalCents: 1_000_000,
    })
    expect(result.bundle.allocations).toEqual([])
  })

  it('el pago es determinista: dos corridas dan el mismo bundle y el mismo hash', () => {
    const a = prepare(E7)
    const b = prepare(E7)
    const first = buildPayment(E7.input(a.r), a.ctx, a.meta)
    const second = buildPayment(E7.input(b.r), b.ctx, b.meta)
    expect(first).toEqual(second)
  })
})

describe('errores de la ecuación y de las partidas', () => {
  it('aplicar más de lo que se paga → `allocation_exceeds_open`', () => {
    const { r, ctx, meta } = prepare(E7)
    const result = buildPayment(
      {
        ...E7.input(r),
        methods: [
          {
            type: 'treasury',
            treasuryAccountId: r.treasury('banco'),
            amountCents: 80_000_000,
            reference: null,
          },
        ],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        key: 'allocation_exceeds_open',
        field: 'applications',
        detail: { open_cents: 80_000_000 },
      })
    }
  })

  it('más que lo abierto de una factura → `allocation_exceeds_open` en esa fila', () => {
    const { r, ctx, meta } = prepare(E7)
    const input = E7.input(r)
    const result = buildPayment(
      {
        ...input,
        applications: [{ lineId: r.item('E7.F3'), amountCents: 80_000_000 }],
        methods: [
          {
            type: 'treasury',
            treasuryAccountId: r.treasury('banco'),
            amountCents: 80_000_000,
            reference: null,
          },
        ],
      },
      ctx,
      meta,
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          key: 'allocation_exceeds_open',
          field: 'applications.0.amountCents',
          detail: { open_cents: 79_950_000, label: 'Factura A 0003-00001290' },
        },
      ],
    })
  })

  it('una partida que el contexto no trae → `item_not_found`; de otro proveedor → `allocation_party_mismatch`', () => {
    const { r, ctx, meta } = prepare({ openItems: ['E7.IIBB'] })
    const missing = buildPayment(
      paymentInput({
        partyId: r.party('cocacola'),
        date: '2026-10-21',
        applications: [{ lineId: r.item('E7.F1'), amountCents: 1_000 }],
        methods: [{ type: 'treasury', treasuryAccountId: r.treasury('caja'), amountCents: 1_000 }],
      }),
      ctx,
      meta,
    )
    expect(missing.ok === false && missing.errors).toEqual([
      { key: 'item_not_found', field: 'applications.0.lineId' },
    ])
    const otherParty = buildPayment(
      paymentInput({
        partyId: r.party('cocacola'),
        date: '2026-10-31',
        applications: [{ lineId: r.item('E7.IIBB'), amountCents: 1_000 }],
        methods: [{ type: 'treasury', treasuryAccountId: r.treasury('caja'), amountCents: 1_000 }],
      }),
      ctx,
      meta,
    )
    expect(otherParty.ok === false && otherParty.errors).toEqual([
      { key: 'allocation_party_mismatch', field: 'applications.0' },
    ])
  })

  it('usar un saldo a favor como factura → `allocation_side_mismatch`', () => {
    const { r, ctx, meta } = prepare(E7_WITH_CREDIT)
    const result = buildPayment(
      paymentInput({
        partyId: r.party('cocacola'),
        date: '2026-10-21',
        applications: [{ lineId: r.item('E7.NC'), amountCents: 1_000 }],
        methods: [{ type: 'treasury', treasuryAccountId: r.treasury('caja'), amountCents: 1_000 }],
      }),
      ctx,
      meta,
    )
    expect(result.ok === false && result.errors).toEqual([
      { key: 'allocation_side_mismatch', field: 'applications.0' },
    ])
  })

  it('compensar con un proveedor que no es organismo → `compensation_not_allowed` (de la validación)', () => {
    const { r, ctx, meta } = prepare(E7)
    const result = buildPayment(
      paymentInput({
        partyId: r.party('cocacola'),
        date: '2026-10-21',
        applications: [{ lineId: r.item('E7.F1'), amountCents: 1_000_000 }],
        methods: [
          { type: 'compensation', accountId: r.account('iibb_sircupa'), amountCents: 1_000_000 },
        ],
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('compensation_not_allowed')
  })

  it('compensar más que el saldo disponible, si la página manda los saldos', () => {
    const { r, ctx } = prepare(E7_IIBB)
    const result = buildPayment(E7_IIBB.input(r), ctx, {
      clientRef: '00000000-0000-4000-8000-000000777777',
      validate: {
        compensationBalances: new Map([
          [r.account('iibb_sircupa'), 100_000_000],
          [r.account('iibb_withholdings'), 60_000_000],
        ]),
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors.map((e) => e.key)).toContain('compensation_exceeds_balance')
  })

  it('facturas de dos cuentas de control en un mismo pago → `mixed_control_accounts`', () => {
    const { r, ctx, meta } = prepare({ openItems: ['E7.F1', 'E7.IIBB'] })
    const rentasItem = ctx.openItems.get(r.item('E7.IIBB'))
    if (!rentasItem) throw new Error('falta la partida')
    // La misma partida de IIBB, pero a nombre de Coca-Cola (para aislar la regla de la cuenta).
    const items = new Map(ctx.openItems)
    items.set(rentasItem.lineId, { ...rentasItem, partyId: r.party('cocacola') })
    const result = buildPayment(
      paymentInput({
        partyId: r.party('cocacola'),
        date: '2026-10-31',
        applications: [
          { lineId: r.item('E7.F1'), amountCents: 1_000 },
          { lineId: r.item('E7.IIBB'), amountCents: 1_000 },
        ],
        methods: [{ type: 'treasury', treasuryAccountId: r.treasury('banco'), amountCents: 2_000 }],
      }),
      { ...ctx, openItems: items },
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('mixed_control_accounts')
  })

  it('un saldo a favor sin nada que cancelar → `credit_without_application`', () => {
    const { r, ctx, meta } = prepare(E7_WITH_CREDIT)
    const input = E7_WITH_CREDIT.input(r)
    const result = buildPayment({ ...input, applications: [] }, ctx, meta)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('credit_without_application')
  })
})

describe('plan de imputaciones (determinista)', () => {
  it('consume primero los saldos a favor, el más viejo primero, y después la partida propia', () => {
    const plan = planPaymentAllocation({
      own: { key: { doc: 'd1', lineNo: 1 }, amountCents: 500 },
      applications: [
        { key: { lineId: 'f1' }, amountCents: 700 },
        { key: { lineId: 'f2' }, amountCents: 400 },
      ],
      credits: [
        { key: { lineId: 'nc-nueva' }, amountCents: 300, entryDate: '2026-10-20' },
        { key: { lineId: 'nc-vieja' }, amountCents: 300, entryDate: '2026-10-05' },
      ],
    })
    expect(plan).toEqual([
      {
        debit: { lineId: 'nc-vieja' },
        credit: { lineId: 'f1' },
        amountCents: 300,
        kind: 'credit_note',
      },
      {
        debit: { lineId: 'nc-nueva' },
        credit: { lineId: 'f1' },
        amountCents: 300,
        kind: 'credit_note',
      },
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { lineId: 'f1' },
        amountCents: 100,
        kind: 'payment',
      },
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { lineId: 'f2' },
        amountCents: 400,
        kind: 'payment',
      },
    ])
  })

  it('en un cobro la partida propia es Haber y las ventas, Debe', () => {
    const plan = planCollectionAllocation({
      own: { key: { doc: 'd1', lineNo: 6 }, amountCents: 1_000 },
      applications: [{ key: { lineId: 'venta' }, amountCents: 1_000 }],
      credits: [],
    })
    expect(plan).toEqual([
      {
        debit: { lineId: 'venta' },
        credit: { doc: 'd1', lineNo: 6 },
        amountCents: 1_000,
        kind: 'payment',
      },
    ])
  })

  it('el tipo de impuesto de cada saldo compensable', () => {
    expect(compensationTaxKind('iibb_sircupa')).toBe('sircupa')
    expect(compensationTaxKind('iibb_withholdings')).toBe('ret_iibb')
    expect(compensationTaxKind('iibb_sircreb')).toBe('sircreb')
    expect(compensationTaxKind('income_tax_withholdings')).toBe('ret_ganancias')
    expect(compensationTaxKind('vat_free_balance')).toBe('iva')
    expect(compensationTaxKind('bank_tax_credit')).toBe('otro')
  })
})
