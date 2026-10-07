import { describe, expect, it } from 'vitest'
import * as posting from '@/lib/accounting/posting'
import {
  ackList,
  assertBalanced,
  DocLineBuilder,
  dayOfNextMonth,
  dedupeIssues,
  descriptionFor,
  memoFor,
  nextDayOfMonthOnOrAfter,
  toRpcPayload,
} from '@/lib/accounting/posting/common'
import { buildPurchase } from '@/lib/accounting/posting/purchase'
import { buildQuickExpense } from '@/lib/accounting/posting/quick-expense'
import { canonicalize, hashProposalSync } from '@/lib/accounting/preview'
import type { PostingBuilder } from '@/lib/accounting/types'
import * as fx from './accounting-fixtures'
import { E1, E5, prepare } from './accounting-fixtures'

describe('DocLineBuilder (E.1)', () => {
  it('descarta los ceros, numera 1..n y da vuelta el lado de un importe negativo', () => {
    const built = new DocLineBuilder()
      .add({
        role: 'net',
        accountId: 'a',
        side: 'debit',
        amountCents: 100,
        vatRateBp: 2100,
        baseCents: 100,
      })
      .add({ role: 'exempt', accountId: 'b', side: 'debit', amountCents: 0 })
      .addSigned({ role: 'sales_uninvoiced', accountId: 'c', channel: 'salon' }, -40, 'credit')
      .add({ role: 'control', accountId: 'd', side: 'credit', amountCents: 60, tag: 'control' })
      .build()
    expect(built.lines.map((l) => [l.lineNo, l.role, l.side, l.amountCents])).toEqual([
      [1, 'net', 'debit', 100],
      [2, 'sales_uninvoiced', 'debit', 40],
      [3, 'control', 'credit', 60],
    ])
    expect(built.lineNoOf('control')).toBe(3)
    expect(built.lineNoOf('nada')).toBeNull()
    expect(built.lines[0]).toMatchObject({ partyRef: null, dueDate: null, memo: '' })
  })

  it('con `debitFirst` ordena el Debe antes que el Haber y conserva el orden de carga en cada lado', () => {
    const built = new DocLineBuilder()
      .add({ role: 'net', accountId: 'a', side: 'credit', amountCents: 5, tag: 'neto' })
      .add({ role: 'vat', accountId: 'b', side: 'credit', amountCents: 1 })
      .add({ role: 'control', accountId: 'c', side: 'debit', amountCents: 6, tag: 'control' })
      .build({ debitFirst: true })
    expect(built.lines.map((l) => [l.lineNo, l.role])).toEqual([
      [1, 'control'],
      [2, 'net'],
      [3, 'vat'],
    ])
    expect(built.lineNoOf('neto')).toBe(2)
  })

  it('un importe negativo o con decimales es un error del motor', () => {
    expect(() =>
      new DocLineBuilder().add({ role: 'net', accountId: 'a', side: 'debit', amountCents: -1 }),
    ).toThrow(RangeError)
    expect(() =>
      new DocLineBuilder().add({ role: 'net', accountId: 'a', side: 'debit', amountCents: 1.5 }),
    ).toThrow(RangeError)
  })

  it('assertBalanced devuelve `entry_not_balanced` con los dos totales', () => {
    const lines = new DocLineBuilder()
      .add({ role: 'manual', accountId: 'a', side: 'debit', amountCents: 10 })
      .add({ role: 'manual', accountId: 'b', side: 'credit', amountCents: 7 })
      .build().lines
    expect(assertBalanced({ lines })).toEqual({
      key: 'entry_not_balanced',
      field: 'lines',
      detail: { debit_cents: 10, credit_cents: 7 },
    })
  })
})

describe('textos, fechas y avisos', () => {
  it('descripción con partes vacías salteadas y tope de 200 caracteres', () => {
    expect(descriptionFor('purchase', 'Factura A 0003-00001290', null, 'Coca-Cola')).toBe(
      'Factura A 0003-00001290 · Coca-Cola',
    )
    expect(descriptionFor('opening')).toBe('Asiento de apertura')
    expect(descriptionFor('manual', 'x'.repeat(300))).toHaveLength(200)
    expect(memoFor('net', { rateBp: 1050 })).toBe('Neto 10,5\u00a0%')
    expect(memoFor('perception', { taxKind: 'iibb', jurisdictionCode: 904 })).toBe(
      'Percepción de IIBB (904)',
    )
  })

  it('vencimientos: el próximo día N del mes y el día N del mes siguiente', () => {
    expect(nextDayOfMonthOnOrAfter('2026-10-31', 15)).toBe('2026-11-15')
    expect(nextDayOfMonthOnOrAfter('2026-11-10', 15)).toBe('2026-11-15')
    expect(nextDayOfMonthOnOrAfter('2026-12-20', 15)).toBe('2027-01-15')
    expect(nextDayOfMonthOnOrAfter('2026-02-01', 31)).toBe('2026-02-28')
    expect(dayOfNextMonth('2026-10-31', 20)).toBe('2026-11-20')
    expect(dayOfNextMonth('2026-12-31', 20)).toBe('2027-01-20')
    expect(dayOfNextMonth('2027-01-31', 31)).toBe('2027-02-28')
  })

  it('los avisos aceptados se filtran y no se repiten', () => {
    expect(ackList(['vat_diff', 'otra_cosa', 'vat_diff', 'write_off'])).toEqual([
      'vat_diff',
      'write_off',
    ])
    expect(ackList(undefined)).toEqual([])
  })

  it('errores y avisos sin repetir, con el orden de aparición', () => {
    expect(
      dedupeIssues([
        { key: 'amount_required', field: 'lines' },
        { key: 'total_mismatch', detail: { control_cents: 1, computed_cents: 2 } },
        { key: 'amount_required', field: 'lines' },
        { key: 'total_mismatch', detail: { computed_cents: 2, control_cents: 1 } },
      ]),
    ).toEqual([
      { key: 'amount_required', field: 'lines' },
      { key: 'total_mismatch', detail: { control_cents: 1, computed_cents: 2 } },
    ])
  })
})

describe('determinismo y hash (E.7)', () => {
  it('misma entrada y mismo contexto → exactamente el mismo resultado', () => {
    const a = prepare(E5)
    const b = prepare(E5)
    expect(buildQuickExpense(E5.input(a.r), a.ctx, a.meta)).toEqual(
      buildQuickExpense(E5.input(b.r), b.ctx, b.meta),
    )
  })

  it('el hash es el de la forma canónica, no depende del clientRef ni de los textos, y cambia con un centavo', () => {
    const { r, ctx, meta } = prepare(E1)
    const base = buildPurchase(E1.input(r), ctx, meta)
    const otherRef = buildPurchase(E1.input(r), ctx, {
      clientRef: '00000000-0000-4000-8000-000000000123',
    })
    const otherNotes = buildPurchase({ ...E1.input(r), notes: 'otra nota' }, ctx, meta)
    const oneCent = buildPurchase(
      {
        ...E1.input(r),
        lines: [
          {
            role: 'net',
            accountId: r.account('purchases_soft_drinks'),
            amountCents: 71_074_381,
            vatRateBp: 2100,
          },
        ],
      },
      ctx,
      meta,
    )
    if (!base.ok || !otherRef.ok || !otherNotes.ok || !oneCent.ok) throw new Error('no se armó')
    expect(base.hash).toBe(hashProposalSync(base.bundle))
    expect(otherRef.hash).toBe(base.hash)
    expect(otherNotes.hash).toBe(base.hash)
    expect(oneCent.hash).not.toBe(base.hash)
    expect(canonicalize(base.bundle)).not.toContain('Coca-Cola (distribuidor)')
  })
})

describe('payload de `acc_post_bundle` (C.3.1)', () => {
  it('E1 en snake_case, con el hash, y los renglones sin las claves en null', () => {
    const { r, ctx, meta } = prepare(E1)
    const result = buildPurchase(E1.input(r), ctx, meta)
    if (!result.ok) throw new Error('no se armó')
    const payload = toRpcPayload(result.bundle, result.hash)
    expect(payload.preview_hash).toBe(result.hash)
    expect(payload.new_parties).toEqual([])
    expect(payload.allocations).toEqual([])
    const [doc] = payload.documents
    expect(doc).toMatchObject({
      ref: 'd1',
      kind: 'purchase',
      entry_kind: 'standard',
      voucher_type: 'factura_a',
      afip_voucher_code: 1,
      party: { id: r.party('cocacola') },
      issue_date: '2026-10-03',
      accounting_date: '2026-10-03',
      due_date: '2026-10-24',
      point_of_sale: 3,
      number: 1290,
      shift: null,
      total_cents: 86_000_000,
      control_account_id: r.account('payable_suppliers'),
      related_document: null,
      replaces_document_id: null,
      corrects_document_id: null,
      recurring_expense_id: null,
      settles_commissions: false,
      counted_cents: null,
      expected_book_cents: null,
      warnings_ack: [],
      override_reason: null,
    })
    expect(doc?.lines).toEqual([
      {
        line_no: 1,
        role: 'net',
        account_id: r.account('purchases_soft_drinks'),
        side: 'debit',
        amount_cents: 71_074_380,
        vat_rate_bp: 2100,
        base_cents: 71_074_380,
        memo: 'Neto 21 %',
      },
      {
        line_no: 2,
        role: 'vat',
        account_id: r.account('vat_credit'),
        side: 'debit',
        amount_cents: 14_925_620,
        vat_rate_bp: 2100,
        base_cents: 71_074_380,
        vat_computed_cents: 14_925_620,
        tax_kind: 'iva',
        memo: 'IVA 21 %',
      },
      {
        line_no: 3,
        role: 'control',
        account_id: r.account('payable_suppliers'),
        side: 'credit',
        amount_cents: 86_000_000,
        party: { id: r.party('cocacola') },
        due_date: '2026-10-24',
        memo: 'Factura A 0003-00001290',
      },
    ])
    expect(doc?.fiscal_vouchers).toEqual([
      {
        book: 'purchases',
        voucher_type: 'factura_a',
        afip_voucher_code: 1,
        is_credit_note: false,
        voucher_date: '2026-10-03',
        point_of_sale: 3,
        number_from: 1290,
        number_to: null,
        channel: null,
        counterparty: {
          party: { id: r.party('cocacola') },
          name: 'Coca-Cola (distribuidor)',
          doc_type: 80,
          doc_number: r.counterparty('cocacola').docNumber,
          iva_condition: 'responsable_inscripto',
        },
        amounts: {
          net_21_cents: 71_074_380,
          vat_21_cents: 14_925_620,
          total_cents: 86_000_000,
          vat_computable_cents: 14_925_620,
        },
      },
    ])
  })

  it('las imputaciones del bundle apuntan a renglones (`doc` + `line_no`) o a partidas (`line_id`)', () => {
    const { r, ctx, meta } = prepare(E5)
    const result = buildQuickExpense(E5.input(r), ctx, meta)
    if (!result.ok) throw new Error('no se armó')
    expect(toRpcPayload(result.bundle, result.hash).allocations).toEqual([
      {
        debit: { doc: 'd2', line_no: 1 },
        credit: { doc: 'd1', line_no: 3 },
        amount_cents: 1_210_000,
        kind: 'payment',
      },
    ])
  })
})

describe('la vista previa nunca explota con un dato raro', () => {
  it('centavos negativos, con decimales o NaN → `{ ok: false }`, nunca una excepción', () => {
    const rejects = (
      fixture: { openItems?: readonly fx.ItemKey[] },
      build: (p: ReturnType<typeof prepare>) => { ok: boolean },
    ) => {
      expect(build(prepare(fixture)).ok).toBe(false)
    }
    for (const bad of [-1, 1.5, Number.NaN]) {
      rejects(fx.E1, ({ r, ctx, meta }) =>
        posting.buildPurchase(
          {
            ...fx.E1.input(r),
            lines: [
              {
                role: 'net',
                accountId: r.account('purchases_food'),
                amountCents: bad,
                vatRateBp: 2100,
              },
            ],
          },
          ctx,
          meta,
        ),
      )
      rejects(fx.E4, ({ r, ctx, meta }) =>
        posting.buildExpense(
          { ...fx.E4.input(r), lines: [{ accountId: r.account('cleaning'), amountCents: bad }] },
          ctx,
          meta,
        ),
      )
      rejects(fx.E5, ({ r, ctx, meta }) =>
        posting.buildQuickExpense({ ...fx.E5.input(r), amountCents: bad }, ctx, meta),
      )
      rejects(fx.E4_QUICK, ({ r, ctx, meta }) =>
        posting.buildQuickExpense({ ...fx.E4_QUICK.input(r), amountCents: bad }, ctx, meta),
      )
      rejects(fx.E7, ({ r, ctx, meta }) =>
        posting.buildPayment(
          {
            ...fx.E7.input(r),
            methods: [
              {
                type: 'treasury',
                treasuryAccountId: r.treasury('banco'),
                amountCents: bad,
                reference: null,
              },
            ],
          },
          ctx,
          meta,
        ),
      )
      rejects(fx.E8, ({ r, ctx, meta }) => {
        const input = fx.E8.input(r)
        const first = input.invoiced[0]
        if (!first) throw new Error('falta la fila')
        return posting.buildSalesClose(
          {
            ...input,
            invoiced: [
              {
                ...first,
                amountMode: 'detail',
                aliquots: [{ vatRateBp: 2100, netCents: 1_000, vatCents: bad }],
              },
            ],
          },
          ctx,
          meta,
        )
      })
      rejects(fx.E8, ({ r, ctx, meta }) =>
        posting.buildSalesClose({ ...fx.E8.input(r), cashCountedCents: bad }, ctx, meta),
      )
      {
        const { r, ctx } = prepare(fx.E8)
        const input = fx.E8.input(r)
        const first = input.invoiced[0]
        if (!first) throw new Error('falta la fila')
        expect(() =>
          posting.summarizeSalesClose(
            { ...input, invoiced: [{ ...first, nonTaxedCents: bad }] },
            ctx,
          ),
        ).not.toThrow()
      }
      rejects(fx.E9, ({ r, ctx, meta }) =>
        posting.buildCollection(
          {
            ...fx.E9.input(r),
            received: [
              { treasuryAccountId: r.treasury('banco'), amountCents: bad, reference: null },
            ],
          },
          ctx,
          meta,
        ),
      )
      rejects(fx.E17, ({ r, ctx, meta }) =>
        posting.buildWalletCheck({ ...fx.E17.input(r), countedCents: bad }, ctx, meta),
      )
      rejects(fx.E16_INVOICE, ({ r, ctx, meta }) =>
        posting.buildSalesInvoice(
          {
            ...fx.E16_INVOICE.input(r),
            aliquots: [{ vatRateBp: 2100, netCents: bad, vatAdjustCents: 0 }],
          },
          ctx,
          meta,
        ),
      )
      rejects(fx.E11, ({ r, ctx, meta }) =>
        posting.buildTransfer({ ...fx.E11.input(r), amountCents: bad }, ctx, meta),
      )
      rejects(fx.E12, ({ r, ctx, meta }) =>
        posting.buildBankExpense({ ...fx.E12.input(r), feesNetCents: bad }, ctx, meta),
      )
      rejects(fx.E21, ({ r, ctx, meta }) =>
        posting.buildCashMovement({ ...fx.E21.input(r), amountCents: bad }, ctx, meta),
      )
      rejects(fx.E18, ({ r, ctx, meta }) =>
        posting.buildTreasuryAdjustment({ ...fx.E18.input(r), countedCents: bad }, ctx, meta),
      )
      rejects(fx.E13_MANUAL, ({ r, ctx, meta }) => {
        const input = fx.E13_MANUAL.input(r)
        return posting.buildManualEntry(
          { ...input, lines: input.lines.map((l, i) => (i === 0 ? { ...l, debitCents: bad } : l)) },
          ctx,
          meta,
        )
      })
      rejects(fx.E13, ({ r, ctx, meta }) =>
        posting.buildPayrollEntry({ ...fx.E13.input(r), grossSalariesCents: bad }, ctx, meta),
      )
      rejects(fx.E14, ({ r, ctx, meta }) =>
        posting.buildOpening(
          {
            ...fx.E14.input(r),
            treasuries: [{ treasuryAccountId: r.treasury('caja'), balanceCents: bad }],
          },
          ctx,
          meta,
        ),
      )
      // Las cifras de IVA y los saldos del cierre llevan signo: ahí lo raro es un decimal o NaN.
      if (bad !== -1) {
        rejects(fx.E15A, ({ r, ctx, meta }) => {
          const input = fx.E15A.input(r)
          return posting.buildIvaSettlement(
            { ...input, figures: { ...input.figures, df: bad } },
            ctx,
            meta,
          )
        })
        rejects(fx.E20_CLOSE, ({ r, ctx, meta }) => {
          const input = fx.E20_CLOSE.input(r)
          return posting.buildFiscalYearClose(
            { ...input, balances: [{ accountId: r.account('depreciation'), balanceCents: bad }] },
            ctx,
            meta,
          )
        })
      }
    }
  })
})

describe('firma de E.2', () => {
  it('todo `build*` es un `PostingBuilder` (entrada, contexto, `{ clientRef }`) y está en el índice', () => {
    // La asignación la chequea tsc: un builder con otra firma no compila.
    const builders: Record<string, PostingBuilder<never>> = {
      buildExpense: posting.buildExpense,
      buildPurchase: posting.buildPurchase,
      buildPurchaseCreditNote: posting.buildPurchaseCreditNote,
      buildQuickExpense: posting.buildQuickExpense,
      buildPayment: posting.buildPayment,
      buildSalesClose: posting.buildSalesClose,
      buildCollection: posting.buildCollection,
      buildWalletCheck: posting.buildWalletCheck,
      buildSalesInvoice: posting.buildSalesInvoice,
      buildSalesCreditNote: posting.buildSalesCreditNote,
      buildTransfer: posting.buildTransfer,
      buildBankExpense: posting.buildBankExpense,
      buildCashMovement: posting.buildCashMovement,
      buildTreasuryAdjustment: posting.buildTreasuryAdjustment,
      buildReversal: posting.buildReversal,
      buildManualEntry: posting.buildManualEntry,
      buildPayrollEntry: posting.buildPayrollEntry,
      buildOpening: posting.buildOpening,
      buildIvaSettlement: posting.buildIvaSettlement,
      buildFiscalYearClose: posting.buildFiscalYearClose,
    }
    for (const [name, build] of Object.entries(builders)) {
      expect(typeof build, name).toBe('function')
      expect(build.length, name).toBe(3)
    }
  })
})
