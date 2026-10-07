/**
 * Estado de cuenta de un proveedor (F.7) → filas de `StatementTable`. Puro.
 *
 * La base manda cada movimiento con lo que AUMENTA la deuda (facturas, ND) y
 * lo que la DISMINUYE (pagos, NC), y el saldo acumulado leído del lado de la
 * deuda (positivo = le debés). En `StatementTable` con `balanceMode="payable"`
 * el Haber aumenta la deuda: Haber = «Facturas», Debe = «Pagos».
 */

import type { StatementRow } from '@/components/administracion/statement-table'
import type { PartyStatementRow } from '@/lib/accounting/queries/parties'
import { addDays, formatIsoDay } from '@/lib/dates'
import { documentHref } from './links'

export type StatementView = {
  rows: StatementRow[]
  opening: { balanceCents: number; label: string } | null
  totals: { debitCents: number; creditCents: number } | null
  closing: { label: string; balanceCents: number } | null
}

export function toStatementView(input: {
  slug: string
  rows: readonly PartyStatementRow[]
  from: string
  to: string
  /** Saldo al empezar el período (`null` en las páginas siguientes a la primera). */
  openingCents: number | null
  /** Hay más páginas: los totales y el saldo final todavía no se pueden mostrar. */
  hasMore: boolean
}): StatementView {
  const lines = input.rows.filter((r) => r.rowKind === 'line')
  const rows: StatementRow[] = lines.map((r, index) => {
    const increase = r.increaseCents > 0 ? r.increaseCents : null
    const decrease = r.decreaseCents > 0 ? r.decreaseCents : null
    return {
      id: r.lineId ?? `${r.entryId ?? 'fila'}-${index}`,
      date: r.entryDate ?? input.from,
      voucher: r.documentLabel ?? 'Comprobante',
      href: r.documentId ? documentHref(input.slug, r.documentId) : null,
      detail: r.documentSeq ? `#${r.documentSeq}` : null,
      // Solo las facturas (lo que aumenta la deuda) tienen vencimiento y estado.
      dueDate: increase ? r.dueDate : null,
      settled: increase !== null && r.openCents !== null && r.openCents <= 0,
      debitCents: decrease,
      creditCents: increase,
      balanceCents: r.runningBalanceCents,
    }
  })

  const opening =
    input.openingCents === null
      ? null
      : {
          balanceCents: input.openingCents,
          label: `Saldo al ${formatIsoDay(addDays(input.from, -1))}`,
        }

  if (input.hasMore) return { rows, opening, totals: null, closing: null }

  const totals = rows.reduce(
    (acc, r) => ({
      debitCents: acc.debitCents + (r.debitCents ?? 0),
      creditCents: acc.creditCents + (r.creditCents ?? 0),
    }),
    { debitCents: 0, creditCents: 0 },
  )
  const last = rows.at(-1)
  const closingCents = last ? last.balanceCents : (input.openingCents ?? 0)
  return {
    rows,
    opening,
    totals: rows.length > 0 ? totals : null,
    closing: { label: `Saldo al ${formatIsoDay(input.to)}`, balanceCents: closingCents },
  }
}
