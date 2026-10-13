import { describe, expect, it } from 'vitest'
import {
  INVOICE_FILTER_OPTIONS,
  invoiceFilterSuffix,
  isNotInvoicedVoucher,
  matchesInvoiceFilter,
  NOT_INVOICED_VOUCHER_TYPES,
  parseInvoiceFilter,
  withInvoiceFilter,
} from '@/lib/accounting/invoiced'
import { VOUCHER_TYPE_KEYS } from '@/lib/accounting/types'
import { VOUCHER_CATALOG } from '@/lib/accounting/voucher-types'

describe('«se factura / no se factura» (12/10/2026)', () => {
  it('sin factura = el remito; todo lo demás es con factura (también «Otro comprobante», que va al Libro IVA)', () => {
    expect([...NOT_INVOICED_VOUCHER_TYPES]).toEqual(['sin_comprobante'])
    expect(isNotInvoicedVoucher('sin_comprobante')).toBe(true)
    expect(isNotInvoicedVoucher('otro_comprobante')).toBe(false)
    for (const type of VOUCHER_TYPE_KEYS) {
      if (type === 'sin_comprobante') continue
      expect(isNotInvoicedVoucher(type), type).toBe(false)
    }
  })

  it('sin tipo (un pago, un asiento) no es ni una cosa ni la otra', () => {
    expect(isNotInvoicedVoucher(null)).toBe(false)
    expect(isNotInvoicedVoucher(undefined)).toBe(false)
    expect(isNotInvoicedVoucher('')).toBe(false)
    expect(matchesInvoiceFilter(null, 'todos')).toBe(true)
    expect(matchesInvoiceFilter(null, 'con')).toBe(false)
    expect(matchesInvoiceFilter(null, 'sin')).toBe(false)
    expect(matchesInvoiceFilter('', 'con')).toBe(false)
  })

  it('el filtro de la lista: todos, con factura, sin factura', () => {
    expect(INVOICE_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      'Todos',
      'Con factura',
      'Sin factura',
    ])
    expect(matchesInvoiceFilter('factura_a', 'con')).toBe(true)
    expect(matchesInvoiceFilter('tique', 'con')).toBe(true)
    expect(matchesInvoiceFilter('nota_credito_a', 'con')).toBe(true)
    expect(matchesInvoiceFilter('factura_a', 'sin')).toBe(false)
    expect(matchesInvoiceFilter('sin_comprobante', 'sin')).toBe(true)
    expect(matchesInvoiceFilter('otro_comprobante', 'sin')).toBe(false)
    expect(matchesInvoiceFilter('otro_comprobante', 'con')).toBe(true)
    expect(matchesInvoiceFilter('sin_comprobante', 'con')).toBe(false)
    expect(matchesInvoiceFilter('sin_comprobante', 'todos')).toBe(true)
  })

  it('lo que venga en la URL: solo `con` y `sin`; cualquier otra cosa, todos', () => {
    expect(parseInvoiceFilter('con')).toBe('con')
    expect(parseInvoiceFilter('sin')).toBe('sin')
    expect(parseInvoiceFilter('todos')).toBe('todos')
    expect(parseInvoiceFilter('')).toBe('todos')
    expect(parseInvoiceFilter(null)).toBe('todos')
    expect(parseInvoiceFilter(undefined)).toBe('todos')
    expect(parseInvoiceFilter('sin_comprobante')).toBe('todos')
  })

  it('el link y el nombre del exporte llevan el filtro (sin filtro, quedan igual)', () => {
    const href = '/api/administracion/export?slug=hub&libro=subdiario-compras&desde=2026-10-01'
    expect(withInvoiceFilter(href, 'todos')).toBe(href)
    expect(withInvoiceFilter(href, 'sin')).toBe(`${href}&factura=sin`)
    expect(withInvoiceFilter('/algo', 'con')).toBe('/algo?factura=con')
    expect(invoiceFilterSuffix('todos')).toBe('')
    expect(invoiceFilterSuffix('con')).toBe('-con-factura')
    expect(invoiceFilterSuffix('sin')).toBe('-sin-factura')
  })

  it('en pantalla ya no existe «Sin comprobante»: la clave se queda, el nombre es el remito', () => {
    expect(VOUCHER_TYPE_KEYS).toContain('sin_comprobante')
    expect(VOUCHER_CATALOG.sin_comprobante.label).toBe('Remito u otro comprobante (sin factura)')
    expect(VOUCHER_CATALOG.sin_comprobante.shortLabel).toBe('Remito u otro')
    for (const type of VOUCHER_TYPE_KEYS) {
      expect(VOUCHER_CATALOG[type].label.toLowerCase(), type).not.toContain('sin comprobante')
      expect(VOUCHER_CATALOG[type].shortLabel.toLowerCase(), type).not.toContain('sin comp')
    }
    // Lo que significa no cambió: no lleva número ni entra al Libro IVA.
    expect(VOUCHER_CATALOG.sin_comprobante.numbered).toBe(false)
    expect(VOUCHER_CATALOG.sin_comprobante.ivaBook).toBe(false)
  })
})
