import { describe, expect, it } from 'vitest'
import { buildSalesClose } from '@/lib/accounting/posting/sales-close'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { E8, prepare } from './accounting-fixtures'

/**
 * La pantalla del cierre del día (`/ventas/cierre`) manda TODOS los medios
 * activos (los vacíos en 0, sin clientes), las filas facturadas en modo
 * «total» y nulos explícitos en lo que no se cargó. Ese envío tiene que dar el
 * mismo asiento (y el mismo hash) que el golden E8.
 */
describe('cierre del día: lo que manda la pantalla', () => {
  it('con todos los medios (los vacíos en 0) da el asiento y el hash del golden E8', () => {
    const { r, ctx, meta } = prepare(E8)
    const golden = buildSalesClose(E8.input(r), ctx, meta)
    expect(golden.ok).toBe(true)

    const loaded = new Map([
      [r.method('cash'), 35_000_000],
      [r.method('transfer'), 18_000_000],
      [r.method('qr'), 22_000_000],
      [r.method('debit'), 41_000_000],
      [r.method('credit'), 33_000_000],
      [r.method('pedidosya'), 15_000_000],
      [r.method('rappi'), 6_000_000],
    ])
    const methods = [...ctx.methods.values()]
      .sort((a, b) => a.sort - b.sort)
      .map((m) => ({ salesMethodId: m.id, amountCents: loaded.get(m.id) ?? 0, customers: [] }))
    expect(methods.length).toBeGreaterThan(loaded.size)

    const row = (
      pointOfSale: number,
      from: number,
      to: number,
      channel: string,
      total: number,
    ) => ({
      voucherType: 'factura_b',
      pointOfSale,
      numberFrom: from,
      numberTo: to,
      channel,
      partyId: null,
      amountMode: 'total',
      totalCents: total,
      vatRateBp: 2100,
      aliquots: [],
      nonTaxedCents: 0,
      exemptCents: 0,
    })
    const state = previewDocumentForm(
      'sales_close',
      {
        date: '2026-10-05',
        shift: null,
        methods,
        invoiced: [
          row(3, 14_501, 14_662, 'salon', 121_000_000),
          row(4, 2_101, 2_130, 'delivery', 18_150_000),
        ],
        cashCountedCents: 34_950_000,
        controlTotalCents: 170_000_000,
        overrideReason: null,
        instantSettlements: [],
      },
      ctx,
    )
    expect(state.ok).toBe(true)
    if (state.ok && golden.ok) expect(state.hash).toBe(golden.hash)
  })

  it('sin ningún medio con ventas avisa en «methods» (se ve arriba de la lista)', () => {
    const { ctx } = prepare(E8)
    const methods = [...ctx.methods.values()].map((m) => ({
      salesMethodId: m.id,
      amountCents: 0,
      customers: [],
    }))
    const state = previewDocumentForm(
      'sales_close',
      {
        date: '2026-10-05',
        shift: null,
        methods,
        invoiced: [],
        cashCountedCents: null,
        controlTotalCents: null,
        overrideReason: null,
        instantSettlements: [],
      },
      ctx,
    )
    expect(state.ok).toBe(false)
    if (!state.ok) expect(state.fieldErrors?.methods).toBe('Cargá al menos un medio con ventas.')
  })
})
