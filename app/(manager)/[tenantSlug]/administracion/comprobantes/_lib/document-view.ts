import type { DocumentKind } from '@/lib/accounting/types'

/**
 * Qué se puede hacer con un comprobante (H.14) y a dónde vuelve su pantalla.
 * Puro: lo usan la página y los tests. La base vuelve a decidir todo
 * (`kind_not_voidable`, `cannot_void_closed_period`, `kind_not_reversible`).
 */

type DocLike = {
  kind: DocumentKind
  status: 'posted' | 'voided'
  partyId: string | null
  openCents: number | null
  period: { status: 'open' | 'closed' } | null
  reversedBy: { status: 'posted' | 'voided' } | null
}

/** Se deshacen reabriendo el mes o el ejercicio, no anulando (C.4.1). */
const NOT_VOIDABLE: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'iva_settlement',
  'fy_result',
  'fy_closing',
  'fy_opening',
])

/** Los que admite «Anular con fecha de hoy» (C.4.3). */
const REVERSIBLE: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_credit_note',
  'purchase_debit_note',
  'expense',
  'payment',
  'sales_close',
  'sales_invoice',
  'sales_credit_note',
  'sales_debit_note',
  'collection',
  'transfer',
  'bank_expense',
  'cash_movement',
  'treasury_adjustment',
  'manual',
])

/** Comprobantes que dejan deuda o crédito: lo aplicado sobre ellos es de otros (pagos, cobros, NC). */
const PAID_BY_OTHERS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_debit_note',
  'iva_settlement',
  'sales_invoice',
  'sales_debit_note',
  'sales_close',
  'opening',
])

const PAYABLE: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_debit_note',
  'iva_settlement',
])

const RECEIVABLE: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'sales_invoice',
  'sales_debit_note',
])

export type DocumentActions = {
  /** Mes abierto: «Anular». */
  void: boolean
  /** Mes cerrado: «Anular con fecha de hoy». */
  reverse: boolean
  /** Mes cerrado: «Cargar una nota de crédito» (compra o venta con su proveedor o cliente). */
  creditNote: 'purchase' | 'sales' | null
  /** Mes cerrado: «Armar asiento de ajuste». */
  adjustment: boolean
  /** Le queda algo por pagar o cobrar. */
  settle: 'pagar' | 'cobrar' | null
}

/** Lo que ve un dueño con acceso (la contadora no ve ninguna acción: H.19). */
export function documentActions(doc: DocLike, canWrite: boolean): DocumentActions {
  const none: DocumentActions = {
    void: false,
    reverse: false,
    creditNote: null,
    adjustment: false,
    settle: null,
  }
  if (!canWrite || doc.status !== 'posted') return none
  const reversed = doc.reversedBy !== null && doc.reversedBy.status === 'posted'
  const open = doc.period?.status === 'open'
  const closed = doc.period?.status === 'closed'
  const pending = (doc.openCents ?? 0) > 0
  return {
    void: open && !NOT_VOIDABLE.has(doc.kind),
    reverse: closed && !reversed && REVERSIBLE.has(doc.kind),
    creditNote:
      closed && !reversed && doc.partyId
        ? doc.kind === 'purchase' || doc.kind === 'purchase_debit_note'
          ? 'purchase'
          : doc.kind === 'sales_invoice' || doc.kind === 'sales_debit_note'
            ? 'sales'
            : null
        : null,
    adjustment: closed && !reversed && !NOT_VOIDABLE.has(doc.kind) && doc.kind !== 'reversal',
    settle:
      !reversed && pending && doc.partyId
        ? PAYABLE.has(doc.kind)
          ? 'pagar'
          : RECEIVABLE.has(doc.kind)
            ? 'cobrar'
            : null
        : null,
  }
}

/**
 * ¿Lo aplicado sobre sus partidas es de otros comprobantes? Entonces anularlo
 * deja esos pagos o cobros a cuenta (`unallocate`), y hay que decirlo antes.
 */
export function appliedByOthers(kind: DocumentKind): boolean {
  return PAID_BY_OTHERS.has(kind)
}

/** «Volver a …»: la lista donde vive cada tipo de comprobante. */
export function backLinkFor(
  kind: DocumentKind,
  base: string,
  accountingDate: string,
): { href: string; label: string } {
  switch (kind) {
    case 'purchase':
    case 'purchase_credit_note':
    case 'purchase_debit_note':
    case 'expense':
      return { href: `${base}/compras?tab=comprobantes`, label: 'Volver a comprobantes' }
    case 'payment':
      return { href: `${base}/compras?tab=pagos`, label: 'Volver a pagos' }
    case 'sales_close':
      return { href: `${base}/ventas?tab=cierres`, label: 'Volver a ventas' }
    case 'sales_invoice':
    case 'sales_credit_note':
    case 'sales_debit_note':
      return { href: `${base}/ventas?tab=facturas`, label: 'Volver a facturas' }
    case 'collection':
      return { href: `${base}/ventas?tab=cobros`, label: 'Volver a cobros' }
    case 'transfer':
    case 'bank_expense':
    case 'cash_movement':
    case 'treasury_adjustment':
      return { href: `${base}/cajas`, label: 'Volver a cajas y bancos' }
    default:
      return {
        href: `${base}/libros/diario?mes=${accountingDate.slice(0, 7)}`,
        label: 'Volver al libro diario',
      }
  }
}

/** El link de la nota de crédito que corrige una compra o una venta de un mes cerrado. */
export function creditNoteHref(
  type: 'purchase' | 'sales',
  base: string,
  doc: { id: string; partyId: string | null },
): string {
  const params = new URLSearchParams({ tipo: 'nc', relacionada: doc.id })
  if (doc.partyId) params.set(type === 'purchase' ? 'proveedor' : 'cliente', doc.partyId)
  return type === 'purchase'
    ? `${base}/compras/nueva?${params.toString()}`
    : `${base}/ventas/nueva-factura?${params.toString()}`
}
