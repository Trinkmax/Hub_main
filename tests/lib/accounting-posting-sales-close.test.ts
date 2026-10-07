import { describe, expect, it } from 'vitest'
import { buildSalesClose, summarizeSalesClose } from '@/lib/accounting/posting/sales-close'
import {
  assertGolden,
  E8,
  E8B,
  E8B_OVERRIDE,
  prepare,
  salesCloseInput,
} from './accounting-fixtures'

describe('cierre del día: los golden de E.5.6', () => {
  for (const fixture of [E8, E8B, E8B_OVERRIDE]) {
    it(`${fixture.id} · ${fixture.title}`, () => {
      const { r, ctx, meta } = prepare(fixture)
      assertGolden(buildSalesClose(fixture.input(r), ctx, meta), fixture, r)
    })
  }

  it('el resumen por canal de la pantalla usa las mismas cuentas que el asiento (E8b)', () => {
    const { r, ctx } = prepare(E8B)
    expect(summarizeSalesClose(E8B.input(r), ctx)).toEqual({
      soldCents: 70_100_000,
      channels: [
        {
          channel: 'salon',
          soldCents: 50_000_000,
          invoicedNetCents: 29_000_000,
          invoicedTotalCents: 35_090_000,
          uninvoicedCents: 14_910_000,
        },
        {
          channel: 'delivery',
          soldCents: 8_000_000,
          invoicedNetCents: 5_000_000,
          invoicedTotalCents: 6_050_000,
          uninvoicedCents: 1_950_000,
        },
        {
          channel: 'events',
          soldCents: 12_100_000,
          invoicedNetCents: 10_000_000,
          invoicedTotalCents: 12_100_000,
          uninvoicedCents: 0,
        },
      ],
    })
  })

  it('el orden de los medios es el de Ajustes (no el de carga): mismo asiento y mismo hash', () => {
    const { r, ctx, meta } = prepare(E8)
    const input = E8.input(r)
    const shuffled = { ...input, methods: [...input.methods].reverse() }
    const a = buildSalesClose(input, ctx, meta)
    const b = buildSalesClose(shuffled, ctx, meta)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(b.bundle.documents[0]?.lines).toEqual(a.bundle.documents[0]?.lines)
      expect(b.hash).toBe(a.hash)
    }
  })
})

describe('facturado de más (`invoiced_exceeds_sold`)', () => {
  it('sin aceptar: el asiento se arma igual (D sin factura) y vuelve el aviso con canal y montos', () => {
    const { r, ctx, meta } = prepare(E8B_OVERRIDE)
    const result = buildSalesClose(
      { ...E8B_OVERRIDE.input(r), warningsAck: [], overrideReason: null },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([
      {
        key: 'invoiced_exceeds_sold',
        document: 'd1',
        detail: { channel: 'delivery', invoiced_cents: 9_680_000, sold_cents: 8_000_000 },
      },
    ])
    expect(result.bundle.documents[0]?.overrideReason).toBeNull()
    expect(result.bundle.documents[0]?.warningsAck).toEqual([])
  })

  it('aceptado sin motivo → `reason_required`', () => {
    const { r, ctx, meta } = prepare(E8B_OVERRIDE)
    const result = buildSalesClose({ ...E8B_OVERRIDE.input(r), overrideReason: 'no' }, ctx, meta)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors).toEqual([{ key: 'reason_required', field: 'overrideReason' }])
  })
})

describe('caja, cuenta corriente, tolerancias y acreditaciones en el acto', () => {
  it('sobrante de caja: la caja va por lo contado y la diferencia a «Sobrantes de caja» (Haber)', () => {
    const { r, ctx, meta } = prepare()
    const result = buildSalesClose(
      salesCloseInput({
        date: '2026-10-07',
        methods: [{ salesMethodId: r.method('cash'), amountCents: 1_000_000 }],
        cashCountedCents: 1_020_000,
      }),
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.bundle.documents[0]?.lines.map((l) => [l.role, l.side, l.accountId, l.amountCents]),
    ).toEqual([
      ['treasury', 'debit', r.treasuryAccount('caja'), 1_020_000],
      ['cash_diff', 'credit', r.account('cash_over'), 20_000],
      ['sales_uninvoiced', 'credit', r.account('sales_salon_uninvoiced'), 1_000_000],
    ])
  })

  it('contado sin medio efectivo → `cash_count_invalid`', () => {
    const { r, ctx, meta } = prepare()
    const result = buildSalesClose(
      salesCloseInput({
        date: '2026-10-07',
        methods: [{ salesMethodId: r.method('debit'), amountCents: 1_000_000 }],
        cashCountedCents: 0,
      }),
      ctx,
      meta,
    )
    expect(result).toEqual({
      ok: false,
      errors: [{ key: 'cash_count_invalid', field: 'cashCountedCents' }],
    })
  })

  it('cuenta corriente sin cliente → `party_required`', () => {
    const { r, ctx, meta } = prepare()
    const result = buildSalesClose(
      {
        ...salesCloseInput({
          date: '2026-10-07',
          methods: [{ salesMethodId: r.method('cash'), amountCents: 1_000 }],
        }),
        methods: [
          { salesMethodId: r.method('customerAccount'), amountCents: 500_000, customers: [] },
        ],
      },
      ctx,
      meta,
    )
    expect(result).toEqual({
      ok: false,
      errors: [{ key: 'party_required', field: 'methods.0.customers' }],
    })
  })

  it('una Factura A sin cliente con CUIT → `party_tax_id_required`', () => {
    const { r, ctx, meta } = prepare(E8B)
    const input = E8B.input(r)
    const result = buildSalesClose(
      { ...input, invoiced: input.invoiced.map((row) => ({ ...row, partyId: null })) },
      ctx,
      meta,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.key)).toContain('party_tax_id_required')
  })

  it('rango en detalle: el IVA impreso con la tolerancia del rango (N tiques, hasta 50) pasa sin aviso', () => {
    const { r, ctx, meta } = prepare()
    const withVat = (vatCents: number) =>
      buildSalesClose(
        salesCloseInput({
          date: '2026-10-07',
          methods: [{ salesMethodId: r.method('cash'), amountCents: 1_000_000 + vatCents }],
          invoiced: [
            {
              voucherType: 'factura_b',
              pointOfSale: 3,
              numberFrom: 15_001,
              numberTo: 15_100,
              channel: 'salon',
              amountMode: 'detail',
              aliquots: [{ vatRateBp: 2100, netCents: 1_000_000, vatCents }],
            },
          ],
        }),
        ctx,
        meta,
      )
    const within = withVat(210_040)
    expect(within.ok && within.warnings).toEqual([])
    const beyond = withVat(210_090)
    expect(beyond.ok).toBe(true)
    if (beyond.ok) expect(beyond.warnings.map((w) => w.key)).toEqual(['vat_diff'])
  })

  it('el total según Thinkeon distinto de lo vendido → `total_mismatch`', () => {
    const { r, ctx, meta } = prepare(E8)
    const result = buildSalesClose({ ...E8.input(r), controlTotalCents: 169_999_000 }, ctx, meta)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([
        {
          key: 'total_mismatch',
          field: 'controlTotalCents',
          detail: { computed_cents: 170_000_000, control_cents: 169_999_000 },
        },
      ])
    }
  })

  it('acreditación en el acto: [sales_close, collection] y el cobro aplica solo las partidas de su partícipe', () => {
    const { r, ctx, meta } = prepare(E8)
    const input = E8.input(r)
    const result = buildSalesClose(
      {
        ...input,
        instantSettlements: [
          {
            partyId: r.party('mercadopago'),
            date: '2026-10-05',
            applications: [],
            creditsUsed: [],
            grossCents: null,
            deductions: [
              {
                taxKind: 'sircupa',
                amountCents: 1_400_000,
                accountId: null,
                certificateNumber: null,
                salesMethodId: null,
              },
            ],
            received: [
              { treasuryAccountId: r.treasury('mp'), amountCents: 38_600_000, reference: null },
            ],
            writeOffCents: 0,
            commissionVoucher: { mode: 'none' },
            notes: null,
          },
        ],
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.documents.map((d) => [d.ref, d.kind, d.totalCents])).toEqual([
      ['d1', 'sales_close', 170_000_000],
      ['d2', 'collection', 40_000_000],
    ])
    // Las dos partidas de Mercado Pago del cierre (transferencias y QR), en el orden del asiento.
    expect(result.bundle.allocations).toEqual([
      {
        debit: { doc: 'd1', lineNo: 3 },
        credit: { doc: 'd2', lineNo: 3 },
        amountCents: 18_000_000,
        kind: 'payment',
      },
      {
        debit: { doc: 'd1', lineNo: 4 },
        credit: { doc: 'd2', lineNo: 3 },
        amountCents: 22_000_000,
        kind: 'payment',
      },
    ])
  })
})
