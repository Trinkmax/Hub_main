import { describe, expect, it } from 'vitest'
import {
  asksIfInvoiced,
  defaultVoucherFor,
  notInvoicedDefault,
  PURCHASE_VOUCHER_OPTIONS,
  rememberedVoucherType,
  splitByInvoice,
  voucherOptionsFor,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/vouchers'
import { voucherTypesForKind } from '@/lib/accounting/voucher-types'

describe('«¿Se factura?» en la factura de proveedor (12/10/2026)', () => {
  it('el motor admite una compra en cuenta corriente sin factura (remito u otro comprobante)', () => {
    const allowed = voucherTypesForKind('purchase').types
    expect(allowed).toContain('sin_comprobante')
    expect(allowed).toContain('otro_comprobante')
  })

  it('«Sí» y «No» parten los tipos del proveedor, cada grupo en el orden del selector', () => {
    const ri = voucherOptionsFor({ family: 'factura', condition: 'responsable_inscripto' })
    const split = splitByInvoice(ri)
    expect(split.notInvoiced).toEqual(['sin_comprobante'])
    expect(split.invoiced).not.toContain('sin_comprobante')
    // «Otro comprobante» lleva número y entra al Libro IVA: va con los que se facturan.
    expect(split.invoiced).toContain('otro_comprobante')
    expect(split.invoiced[0]).toBe('factura_a')
    expect([...split.invoiced, ...split.notInvoiced]).toHaveLength(ri.length)
  })

  it('se pregunta solo al cargar una factura o un tique; en las notas y con un organismo, no', () => {
    for (const condition of [
      'responsable_inscripto',
      'monotributo',
      'exento',
      'consumidor_final',
      null,
    ] as const) {
      const options = voucherOptionsFor({ family: 'factura', condition })
      expect(asksIfInvoiced({ family: 'factura', options }), String(condition)).toBe(true)
      expect(
        asksIfInvoiced({ family: 'nc', options: voucherOptionsFor({ family: 'nc', condition }) }),
      ).toBe(false)
      expect(
        asksIfInvoiced({ family: 'nd', options: voucherOptionsFor({ family: 'nd', condition }) }),
      ).toBe(false)
    }
    // Una DDJJ o una boleta de impuesto no «se facturan»: con un organismo se elige el tipo.
    expect(
      asksIfInvoiced({
        family: 'factura',
        options: voucherOptionsFor({
          family: 'factura',
          condition: 'no_alcanzado',
          isTaxAgency: true,
        }),
        isTaxAgency: true,
      }),
    ).toBe(false)
    // Con una sola respuesta posible no hay nada que preguntar.
    expect(asksIfInvoiced({ family: 'factura', options: ['factura_a', 'tique'] })).toBe(false)
    expect(asksIfInvoiced({ family: 'factura', options: ['sin_comprobante'] })).toBe(false)
  })

  it('al contestar «No» queda el remito (no lleva número); si no se puede, lo que haya', () => {
    expect(
      notInvoicedDefault(voucherOptionsFor({ family: 'factura', condition: 'monotributo' })),
    ).toBe('sin_comprobante')
    expect(notInvoicedDefault(['factura_a', 'otro_comprobante'])).toBeNull()
    expect(notInvoicedDefault(['factura_a'])).toBeNull()
  })

  it('al contestar «Sí» queda la factura que corresponde, aunque lo recordado sea el remito', () => {
    const options = voucherOptionsFor({ family: 'factura', condition: 'responsable_inscripto' })
    expect(
      defaultVoucherFor({
        family: 'factura',
        options: splitByInvoice(options).invoiced,
        remembered: 'sin_comprobante',
        condition: 'responsable_inscripto',
      }),
    ).toBe('factura_a')
    expect(
      defaultVoucherFor({
        family: 'factura',
        options: splitByInvoice(options).invoiced,
        remembered: 'factura_b',
        condition: 'responsable_inscripto',
      }),
    ).toBe('factura_b')
  })

  it('la ficha propone: el «Comprobante habitual» le gana al último cargado y al del gasto fijo', () => {
    expect(
      rememberedVoucherType({
        habitual: 'sin_comprobante',
        lastUsed: 'factura_a',
        recurring: 'factura_b',
      }),
    ).toBe('sin_comprobante')
    expect(
      rememberedVoucherType({ habitual: null, lastUsed: 'factura_a', recurring: 'tique' }),
    ).toBe('factura_a')
    expect(rememberedVoucherType({ habitual: null, lastUsed: null, recurring: 'tique' })).toBe(
      'tique',
    )
    expect(rememberedVoucherType({})).toBeNull()

    // Un proveedor que no factura: la carga arranca en «No» (remito).
    const options = voucherOptionsFor({ family: 'factura', condition: 'responsable_inscripto' })
    expect(
      defaultVoucherFor({
        family: 'factura',
        options,
        remembered: rememberedVoucherType({ habitual: 'sin_comprobante', lastUsed: 'factura_a' }),
        condition: 'responsable_inscripto',
      }),
    ).toBe('sin_comprobante')
  })

  it('«Comprobante habitual» de la ficha ofrece el de un proveedor que no factura, con su nombre nuevo', () => {
    const option = PURCHASE_VOUCHER_OPTIONS.find((o) => o.value === 'sin_comprobante')
    expect(option?.label).toBe('Remito u otro comprobante (sin factura)')
    expect(PURCHASE_VOUCHER_OPTIONS.some((o) => /sin comprobante/i.test(o.label))).toBe(false)
  })
})
