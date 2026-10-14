import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { LedgerList, LedgerRow, StatusPill } from '@/components/administracion/kit'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import { COLLECTION_STATUS_LABELS } from '@/lib/accounting/queries/labels'
import { formatCentsShort } from '@/lib/money'
import { DateRail } from './collections-list'

/** Una nota de crédito resta: se muestra con su signo (es un movimiento, no un saldo). */
function signedTotal(row: DocumentListRow): number {
  return row.kind === 'sales_credit_note' ? -row.totalCents : row.totalCents
}

/**
 * «Facturas aparte»: las facturas, notas de crédito y de débito de venta que se
 * hicieron fuera del cierre del día, un renglón por comprobante. En el margen,
 * el día; en el centro, qué es y a quién; a la derecha, el total y cómo está
 * (cuándo vence, si ya se cobró, cuánto falta). Cada renglón lleva a su
 * comprobante.
 */
export function SalesInvoicesList({
  rows,
  base,
  today,
}: {
  rows: readonly DocumentListRow[]
  /** `/<bar>/administracion`. */
  base: string
  today: string
}) {
  return (
    <LedgerList aria-label="Facturas aparte" bare>
      {rows.map((row) => {
        const voided = row.status === 'voided'
        const credit = row.kind === 'sales_credit_note'
        const paid = row.paymentStatus === 'paid'
        const pending = !voided && row.openCents !== null && row.openCents > 0
        const status = voided ? (
          <StatusPill tone="muted">Anulado</StatusPill>
        ) : credit ? (
          <span className="text-xs text-muted-foreground">Nota de crédito</span>
        ) : paid ? (
          <StatusPill tone="ok">{COLLECTION_STATUS_LABELS.paid}</StatusPill>
        ) : (
          <DueStatus dueDate={row.dueDate} today={today} group="receivables" showDate />
        )
        return (
          <LedgerRow
            key={row.id}
            href={`${base}/comprobantes/${row.id}`}
            title={row.title}
            muted={voided}
            rail={<DateRail date={row.accountingDate} />}
            meta={
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                {row.partyName ? <span>{row.partyName}</span> : null}
                {status}
              </span>
            }
            amount={
              <Amount
                cents={signedTotal(row)}
                decimals={0}
                className={voided ? 'line-through' : 'font-serif text-lg font-semibold'}
              />
            }
            amountNote={pending && !credit ? `Pendiente ${formatCentsShort(row.openCents)}` : null}
          />
        )
      })}
    </LedgerList>
  )
}
