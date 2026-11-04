import Link from 'next/link'
import { DueStatus } from '@/components/administracion/due-status'
import { StatusPill } from '@/components/administracion/kit'
import { PRow, PTable, PTd, PTh } from '@/components/administracion/planilla'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import { COLLECTION_STATUS_LABELS } from '@/lib/accounting/queries/labels'
import { formatDayLabel } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'

/** Una nota de crédito resta: se muestra con su signo (es un movimiento, no un saldo). */
function signedTotal(row: DocumentListRow): number {
  return row.kind === 'sales_credit_note' ? -row.totalCents : row.totalCents
}

const NAME_LINK =
  'rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * «Facturas aparte»: las facturas, notas de crédito y de débito de venta que se hicieron fuera del
 * cierre del día, un renglón por comprobante: el día, qué es, a quién, cómo está (cuándo vence, si ya
 * se cobró, cuánto falta) y el total. Cada renglón lleva a su comprobante.
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
    <PTable minWidth={680} label="Facturas aparte">
      <thead>
        <tr>
          <PTh>Día</PTh>
          <PTh>Comprobante</PTh>
          <PTh>Cliente</PTh>
          <PTh>Estado</PTh>
          <PTh align="right">Total</PTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const voided = row.status === 'voided'
          const credit = row.kind === 'sales_credit_note'
          const paid = row.paymentStatus === 'paid'
          const pending = !voided && row.openCents !== null && row.openCents > 0
          return (
            <PRow key={row.id} className={voided ? 'text-muted-foreground' : undefined}>
              <PTd className="whitespace-nowrap">{formatDayLabel(row.accountingDate)}</PTd>
              <PTd>
                <Link href={`${base}/comprobantes/${row.id}`} className={NAME_LINK}>
                  {row.title}
                </Link>
              </PTd>
              <PTd className="text-muted-foreground">{row.partyName ?? '—'}</PTd>
              <PTd>
                {voided ? (
                  <StatusPill tone="muted">Anulado</StatusPill>
                ) : credit ? (
                  <span className="text-xs text-muted-foreground">Nota de crédito</span>
                ) : paid ? (
                  <StatusPill tone="ok">{COLLECTION_STATUS_LABELS.paid}</StatusPill>
                ) : (
                  <DueStatus dueDate={row.dueDate} today={today} group="receivables" showDate />
                )}
              </PTd>
              <PTd align="right" className={cn('font-medium', voided && 'line-through')}>
                {formatCentsShort(signedTotal(row))}
                {pending && !credit ? (
                  <small className="block text-xs font-normal text-muted-foreground">
                    Pendiente {formatCentsShort(row.openCents)}
                  </small>
                ) : null}
              </PTd>
            </PRow>
          )
        })}
      </tbody>
    </PTable>
  )
}
