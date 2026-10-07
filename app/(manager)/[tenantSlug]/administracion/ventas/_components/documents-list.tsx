import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { Badge } from '@/components/ui/badge'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import { COLLECTION_STATUS_LABELS } from '@/lib/accounting/queries/labels'
import { formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'

type Mode = 'collections' | 'invoices'

/** Una nota de crédito resta: se muestra con su signo (es un movimiento, no un saldo). */
function signedTotal(row: DocumentListRow): number {
  return row.kind === 'sales_credit_note' ? -row.totalCents : row.totalCents
}

function Voided() {
  return (
    <Badge variant="muted" className="ml-2 align-middle text-[10px] uppercase tracking-wide">
      Anulado
    </Badge>
  )
}

/**
 * «Cobros» y «Facturas» de Ventas (H.9): el comprobante (link a su detalle),
 * quién, cuándo y cuánto; en las facturas, el vencimiento y si se cobró.
 * Tabla en la compu, tarjetas en el celular. Server-safe.
 */
export function SalesDocumentsList({
  mode,
  rows,
  total,
  base,
  today,
}: {
  mode: Mode
  rows: readonly DocumentListRow[]
  total: number
  base: string
  today: string
}) {
  const caption = mode === 'collections' ? 'Cobros y acreditaciones' : 'Facturas de venta sueltas'
  return (
    <>
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">{caption}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader className="w-28">Fecha</DataTableHeader>
                <DataTableHeader>Comprobante</DataTableHeader>
                <DataTableHeader>
                  {mode === 'collections' ? 'Cobrado a' : 'Cliente'}
                </DataTableHeader>
                {mode === 'invoices' ? <DataTableHeader>Estado</DataTableHeader> : null}
                <DataTableHeader className="text-right">
                  {mode === 'collections' ? 'Liquidado' : 'Total'}
                </DataTableHeader>
                {mode === 'invoices' ? (
                  <DataTableHeader className="text-right">Pendiente</DataTableHeader>
                ) : null}
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const voided = row.status === 'voided'
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint',
                      voided && 'text-muted-foreground',
                    )}
                  >
                    <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatIsoDay(row.accountingDate)}
                    </DataTableCell>
                    <DataTableCell className="font-medium">
                      <Link
                        href={`${base}/comprobantes/${row.id}`}
                        className="rounded-sm underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.title}
                      </Link>
                      {voided ? <Voided /> : null}
                    </DataTableCell>
                    <DataTableCell className="max-w-[260px]">
                      <span className="line-clamp-1">{row.partyName ?? '—'}</span>
                    </DataTableCell>
                    {mode === 'invoices' ? (
                      <DataTableCell>
                        {voided ? null : row.paymentStatus === 'paid' ||
                          row.kind === 'sales_credit_note' ? (
                          <span className="text-xs text-muted-foreground">
                            {row.kind === 'sales_credit_note'
                              ? 'Nota de crédito'
                              : COLLECTION_STATUS_LABELS.paid}
                          </span>
                        ) : (
                          <DueStatus
                            dueDate={row.dueDate}
                            today={today}
                            group="receivables"
                            showDate
                          />
                        )}
                      </DataTableCell>
                    ) : null}
                    <DataTableCell className={cn('text-right', voided && 'line-through')}>
                      <Amount cents={signedTotal(row)} />
                    </DataTableCell>
                    {mode === 'invoices' ? (
                      <DataTableCell className="text-right">
                        {!voided && row.openCents !== null && row.openCents > 0 ? (
                          <Amount cents={row.openCents} />
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </DataTableCell>
                    ) : null}
                  </tr>
                )
              })}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
        <DataTableFooter>
          <span>
            Mostrando <strong className="tabular-nums text-foreground">{rows.length}</strong> de{' '}
            <strong className="tabular-nums text-foreground">{total}</strong>
          </span>
        </DataTableFooter>
      </DataTableShell>

      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        <ul aria-label={caption} className="divide-y divide-border/60">
          {rows.map((row) => {
            const voided = row.status === 'voided'
            return (
              <li key={row.id}>
                <Link
                  href={`${base}/comprobantes/${row.id}`}
                  className={cn(
                    'flex items-start justify-between gap-3 px-4 py-3 outline-none hover:bg-cream-tint focus-visible:bg-cream-tint',
                    voided && 'opacity-70',
                  )}
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {formatIsoDay(row.accountingDate)}
                    </span>
                    <span className="block truncate text-sm font-medium">
                      {row.title}
                      {voided ? <Voided /> : null}
                    </span>
                    {row.partyName ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.partyName}
                      </span>
                    ) : null}
                    {mode === 'invoices' &&
                    !voided &&
                    row.kind !== 'sales_credit_note' &&
                    row.paymentStatus !== 'paid' ? (
                      <DueStatus dueDate={row.dueDate} today={today} group="receivables" />
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <Amount
                      cents={signedTotal(row)}
                      className={cn('text-sm font-medium', voided && 'line-through')}
                    />
                    {mode === 'invoices' &&
                    !voided &&
                    row.openCents !== null &&
                    row.openCents > 0 ? (
                      <span className="block text-[11px] tabular-nums text-muted-foreground">
                        Pendiente <Amount cents={row.openCents} />
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="border-t border-border/60 bg-secondary/30 px-4 py-2.5 text-xs text-muted-foreground">
          Mostrando <strong className="tabular-nums text-foreground">{rows.length}</strong> de{' '}
          <strong className="tabular-nums text-foreground">{total}</strong>
        </div>
      </div>
    </>
  )
}
