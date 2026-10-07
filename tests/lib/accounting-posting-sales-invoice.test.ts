import { describe, expect, it } from 'vitest'
import { buildSalesCreditNote, buildSalesInvoice } from '@/lib/accounting/posting/sales-invoice'
import { assertGolden, E16_INVOICE, prepare, salesInvoiceInput } from './accounting-fixtures'

describe('factura de venta suelta (E.5.9)', () => {
  it('E16 · Factura A a Empresa X: D Deudores / H Ventas eventos / H IVA débito', () => {
    const { r, ctx, meta } = prepare(E16_INVOICE)
    assertGolden(buildSalesInvoice(E16_INVOICE.input(r), ctx, meta), E16_INVOICE, r)
  })

  it('NC de venta: el espejo (ventas e IVA al Debe, el cliente al Haber) y la imputación la hace la RPC', () => {
    const { r, ctx, meta } = prepare()
    const result = buildSalesCreditNote(
      salesInvoiceInput({
        docKind: 'sales_credit_note',
        partyId: r.party('empresaX'),
        voucherType: 'nota_credito_a',
        pointOfSale: 3,
        number: 12,
        issueDate: '2026-10-22',
        aliquots: [{ vatRateBp: 2100, netCents: 5_000_000 }],
        relatedDocumentId: '00000000-0000-4000-8000-000000910003',
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.bundle.documents[0]
    expect(doc).toMatchObject({
      kind: 'sales_credit_note',
      dueDate: null,
      relatedDocument: { id: '00000000-0000-4000-8000-000000910003' },
      totalCents: 6_050_000,
    })
    expect(doc?.lines.map((l) => [l.lineNo, l.role, l.side, l.accountId, l.amountCents])).toEqual([
      [1, 'sales_invoiced', 'debit', r.account('sales_events_invoiced'), 5_000_000],
      [2, 'vat', 'debit', r.account('vat_debit'), 1_050_000],
      [3, 'control', 'credit', r.account('receivable_customers'), 6_050_000],
    ])
    expect(doc?.fiscalVouchers[0]).toMatchObject({
      isCreditNote: true,
      numberFrom: 12,
      numberTo: 12,
    })
    expect(result.bundle.allocations).toEqual([])
  })

  it('«Ya la cobraste»: [sales_invoice, collection] con la imputación de lo cobrado', () => {
    const { r, ctx, meta } = prepare(E16_INVOICE)
    const result = buildSalesInvoice(
      {
        ...E16_INVOICE.input(r),
        collectNow: {
          treasuryAccountId: r.treasury('banco'),
          amountCents: null,
          date: '2026-10-21',
          reference: null,
        },
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [invoice, collection] = result.bundle.documents
    expect(invoice?.kind).toBe('sales_invoice')
    expect(collection).toMatchObject({
      ref: 'd2',
      kind: 'collection',
      accountingDate: '2026-10-21',
      totalCents: 72_600_000,
    })
    expect(collection?.lines.map((l) => [l.role, l.side, l.amountCents])).toEqual([
      ['treasury', 'debit', 72_600_000],
      ['control', 'credit', 72_600_000],
    ])
    expect(result.bundle.allocations).toEqual([
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { doc: 'd2', lineNo: 2 },
        amountCents: 72_600_000,
        kind: 'payment',
      },
    ])
  })

  it('no gravado y exento van a ventas facturadas y al libro, sin IVA', () => {
    const { r, ctx, meta } = prepare()
    const result = buildSalesInvoice(
      salesInvoiceInput({
        partyId: r.party('empresaX'),
        voucherType: 'factura_a',
        pointOfSale: 3,
        number: 90,
        issueDate: '2026-10-22',
        channel: 'salon',
        aliquots: [{ vatRateBp: 1050, netCents: 1_000_000 }],
        exemptCents: 200_000,
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.bundle.documents[0]
    expect(doc?.lines.map((l) => [l.role, l.amountCents, l.channel])).toEqual([
      ['control', 1_305_000, null],
      ['sales_invoiced', 1_200_000, 'salon'],
      ['vat', 105_000, null],
    ])
    expect(doc?.fiscalVouchers[0]?.amounts).toEqual({
      net_105_cents: 1_000_000,
      vat_105_cents: 105_000,
      exempt_cents: 200_000,
      total_cents: 1_305_000,
    })
  })

  it('un cliente que es proveedor no puede recibir una factura de venta (`party_kind_mismatch`)', () => {
    const { r, ctx, meta } = prepare(E16_INVOICE)
    const result = buildSalesInvoice(
      { ...E16_INVOICE.input(r), partyId: r.party('cocacola') },
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('party_kind_mismatch')
  })
})
