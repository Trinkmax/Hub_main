import { documentKindLabel } from '@/lib/accounting/queries/labels'
import { formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'

/**
 * El comprobante interno: lo que respalda un movimiento que no tiene factura. Silvia, reunión del
 * 29/10: «tenés que hacer un comprobante interno que justifique el pago a ese proveedor». El número es
 * el interno del comprobante (`seq`). Puro: lo usan la ficha, la página de imprimir y los tests.
 */

type InternalDoc = { voucherType: string | null; seq: number }

/** Su número, si es un comprobante sin factura; `null` si tiene otro papel que lo respalde. */
export function internalVoucherNumber(doc: InternalDoc): number | null {
  return doc.voucherType === 'sin_comprobante' ? doc.seq : null
}

export type InternalVoucherModel = {
  title: string
  rows: ReadonlyArray<{ label: string; value: string }>
  /** Con qué caja se pagó, si se pagó en el momento. */
  means: readonly string[]
  totalText: string
  notes: string | null
  voided: boolean
}

/** Lo que va en el papel. `null` si el comprobante no es de los que llevan número interno. */
export function internalVoucherModel(doc: {
  voucherType: string | null
  seq: number
  kind: string
  accountingDate: string
  issueDate: string
  partyName: string | null
  description: string
  notes: string | null
  totalCents: number
  status: 'posted' | 'voided'
  lines: ReadonlyArray<{ treasuryName: string | null; amountCents: number }>
}): InternalVoucherModel | null {
  const number = internalVoucherNumber(doc)
  if (number === null) return null
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Fecha', value: formatIsoDay(doc.issueDate) },
    { label: 'Qué es', value: documentKindLabel(doc.kind) },
  ]
  if (doc.partyName) rows.push({ label: 'A nombre de', value: doc.partyName })
  if (doc.description.trim()) rows.push({ label: 'Concepto', value: doc.description.trim() })
  return {
    title: `Comprobante interno N.º ${number}`,
    rows,
    means: doc.lines.flatMap((line) =>
      line.treasuryName ? [`${line.treasuryName}: ${formatCents(line.amountCents)}`] : [],
    ),
    totalText: formatCents(doc.totalCents),
    notes: doc.notes?.trim() || null,
    voided: doc.status === 'voided',
  }
}
