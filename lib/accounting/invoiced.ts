/**
 * «Se factura / no se factura» (pedido de los socios, 12/10/2026). Puro: lo
 * usan las cargas de Compras, la lista de comprobantes y su exporte.
 *
 * No hay una marca nueva en la base: un egreso «sin factura» es el que se
 * guardó con `sin_comprobante` («Remito u otro»), que no entra al Libro IVA.
 * Todo lo demás (facturas, tiques, recibos, notas, DDJJ y «Otro comprobante»,
 * que lleva número y sí entra al Libro IVA) es «con factura».
 * Los libros no cambian: todo sigue yendo al mismo diario.
 */

import type { VoucherType } from './types'

/** Los tipos de comprobante que cuentan como «sin factura». */
export const NOT_INVOICED_VOUCHER_TYPES = [
  'sin_comprobante',
] as const satisfies readonly VoucherType[]

/** ¿Es un egreso sin factura? Sin tipo (un pago, un asiento) no es ni una cosa ni la otra. */
export function isNotInvoicedVoucher(type: string | null | undefined): boolean {
  return (
    typeof type === 'string' && (NOT_INVOICED_VOUCHER_TYPES as readonly string[]).includes(type)
  )
}

/** El filtro de la lista: `?factura=con` · `?factura=sin` (sin parámetro: todos). */
export const INVOICE_FILTERS = ['todos', 'con', 'sin'] as const
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number]

export const INVOICE_FILTER_PARAM = 'factura'

export const INVOICE_FILTER_OPTIONS: ReadonlyArray<{ value: InvoiceFilter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'con', label: 'Con factura' },
  { value: 'sin', label: 'Sin factura' },
]

/** La marca chica de las filas sin factura. */
export const NOT_INVOICED_BADGE = 'Sin factura'

/** Lo que venga en la URL → un filtro válido (cualquier otra cosa: todos). */
export function parseInvoiceFilter(raw: string | null | undefined): InvoiceFilter {
  return raw === 'con' || raw === 'sin' ? raw : 'todos'
}

/** ¿El comprobante entra en el filtro? Sin tipo solo entra en «Todos». */
export function matchesInvoiceFilter(
  type: string | null | undefined,
  filter: InvoiceFilter,
): boolean {
  if (filter === 'todos') return true
  if (typeof type !== 'string' || type === '') return false
  return filter === 'sin' ? isNotInvoicedVoucher(type) : !isNotInvoicedVoucher(type)
}

/** Suma `&factura=` a un link (el del exporte) si el filtro no es «Todos». */
export function withInvoiceFilter(href: string, filter: InvoiceFilter): string {
  if (filter === 'todos') return href
  return `${href}${href.includes('?') ? '&' : '?'}${INVOICE_FILTER_PARAM}=${filter}`
}

/** «-con-factura» / «-sin-factura» para el nombre del archivo exportado. */
export function invoiceFilterSuffix(filter: InvoiceFilter): string {
  return filter === 'todos' ? '' : `-${filter}-factura`
}
