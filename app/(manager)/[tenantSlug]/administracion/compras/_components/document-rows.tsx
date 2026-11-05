import Link from 'next/link'
import { categoryShortName, StatusPill } from '@/components/administracion/kit'
import { PRow, PTable, PTd, PTh, PTotalRow, ROW_ACTION } from '@/components/administracion/planilla'
import { ActionButton } from '@/components/administracion/quick-actions'
import { VoucherText } from '@/components/administracion/voucher-text'
import { isNotInvoicedVoucher, NOT_INVOICED_BADGE } from '@/lib/accounting/invoiced'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import { formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  type DocumentRowState,
  documentRowState,
  documentsTotal,
  paymentAppliedText,
  paymentMeansText,
} from '../_lib/libreta'
import { documentHref } from '../_lib/links'
import { NoAmount, ROW_ACTIONS_CELL, ROW_BUTTON, ROW_LINK } from './planilla-bits'

/** Las fechas de una lista: dd/MM si son todas del mismo año; si no, con el año. */
function dateWords(rows: readonly DocumentListRow[]): (iso: string) => string {
  const year = rows[0]?.accountingDate.slice(0, 4)
  return rows.every((row) => row.accountingDate.slice(0, 4) === year)
    ? formatDayMonth
    : formatIsoDay
}

// La tinta de un estado escrito chico: el rojo pelado no llega a AA a 12 px, así que va mezclado con
// la tinta del tema (la receta de `StatusPill`).
const STATE_INK = {
  late: 'text-[color-mix(in_oklch,var(--destructive)_75%,var(--foreground))]',
  warn: 'text-warning-text',
  muted: 'text-muted-foreground',
} as const
const STATE_DOT = { late: 'bg-destructive', warn: 'bg-warning' } as const

/**
 * El estado de un comprobante, en una línea. Lo que apura va como punto + palabra («● Vencida hace
 * 14 días»): veinte píldoras rojas iguales no dejan ver cuál apura. La píldora queda para lo que ya
 * está («Pagada») y para lo que hay a favor. Nunca color solo: siempre con su palabra.
 */
function StateLine({ state }: { state: DocumentRowState }) {
  if (!state.text) return <NoAmount />
  if (state.tone === 'ok' || state.tone === 'info') {
    return (
      <StatusPill tone={state.tone} className="h-5">
        {state.text}
      </StatusPill>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs whitespace-nowrap',
        STATE_INK[state.tone],
      )}
    >
      {state.tone === 'muted' ? null : (
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[state.tone])} />
      )}
      {state.text}
      {state.note ? <span className="text-muted-foreground">· {state.note}</span> : null}
    </span>
  )
}

/** Lo que falta pagar (factura, ND) o aplicar (NC); nada en gastos de contado. */
function pendingOf(row: DocumentListRow): number | null {
  if (row.status === 'voided' || row.kind === 'expense') return null
  return row.openCents !== null && row.openCents > 0 ? row.openCents : null
}

function dueOf(row: DocumentListRow): string | null {
  const owes = row.kind === 'purchase' || row.kind === 'purchase_debit_note'
  return row.status === 'posted' && owes ? row.dueDate : null
}

/**
 * Los comprobantes de compra: Fecha · Comprobante · Proveedor · Importe · Estado · Foto. Toda la fila lleva a
 * su ficha. [Pagarle] aparece al pasar por lo que queda por pagar y abre «Pago» con ese proveedor
 * (dice «Pagarle» y no «Pagar» a propósito: la hoja tilda lo más urgente de ese proveedor, que puede
 * no ser este papel).
 *
 * Con `detail` (la contadora siempre; quien carga, si lo pide) suma Imputación, Falta y Vence.
 */
export function DocumentRows({
  tenantSlug,
  rows,
  today,
  canWrite,
  detail = false,
  totalLabel = 'Total',
  caption,
}: {
  tenantSlug: string
  rows: readonly DocumentListRow[]
  today: string
  canWrite: boolean
  detail?: boolean
  /** Lo que dice la fila del total: «Total de esta página» si la lista sigue. */
  totalLabel?: string
  caption?: string
}) {
  const dateOf = dateWords(rows)
  // Fecha, Comprobante y Proveedor van antes del importe.
  const leading = detail ? 4 : 3
  return (
    <PTable label={caption ?? 'Comprobantes de compra'} minWidth={detail ? 1040 : 780}>
      <thead>
        <tr>
          <PTh>Fecha</PTh>
          <PTh>Comprobante</PTh>
          <PTh>Proveedor</PTh>
          {detail ? <PTh>Imputación</PTh> : null}
          <PTh align="right">Importe</PTh>
          {detail ? <PTh align="right">Falta</PTh> : null}
          {detail ? <PTh>Vence</PTh> : null}
          <PTh>Estado</PTh>
          <PTh>Foto</PTh>
          {canWrite ? (
            <PTh>
              <span className="sr-only">Acciones</span>
            </PTh>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const state = documentRowState(row, today)
          const voided = state.voided
          // «Compras: alimentos» es el nombre del plan; el dueño dice «Alimentos».
          const category = row.imputation ? categoryShortName(row.imputation) : null
          // Un gasto sin proveedor no tiene «a quién»: se nombra por en qué se gastó.
          const who = row.partyName ?? category
          const pending = pendingOf(row)
          const due = dueOf(row)
          const negative = row.kind === 'purchase_credit_note'
          return (
            <PRow key={row.id} className={cn('relative', voided && 'text-muted-foreground')}>
              <PTd className="whitespace-nowrap text-muted-foreground">
                {dateOf(row.accountingDate)}
              </PTd>
              <PTd>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Link
                    href={documentHref(tenantSlug, row.id)}
                    className={cn(ROW_LINK, voided && 'line-through')}
                  >
                    <VoucherText text={row.title} />
                  </Link>
                  {isNotInvoicedVoucher(row.voucherType) ? (
                    <StatusPill tone="muted" className="h-5">
                      {NOT_INVOICED_BADGE}
                    </StatusPill>
                  ) : null}
                  {detail ? (
                    <span className="text-[11px] text-muted-foreground">
                      #{row.seq}
                      {row.issueDate !== row.accountingDate
                        ? ` · emitido el ${formatIsoDay(row.issueDate)}`
                        : ''}
                    </span>
                  ) : row.issueDate !== row.accountingDate ? (
                    <span className="text-[11px] whitespace-nowrap text-muted-foreground">
                      del {formatDayMonth(row.issueDate)}
                    </span>
                  ) : null}
                </span>
              </PTd>
              <PTd className="max-w-[16rem] truncate">{who ?? <NoAmount />}</PTd>
              {detail ? (
                <PTd className="max-w-[14rem] truncate text-muted-foreground">
                  {row.imputation ?? <NoAmount />}
                </PTd>
              ) : null}
              <PTd align="right" className={cn('font-medium', voided && 'line-through')}>
                {formatCentsShort(negative ? -row.totalCents : row.totalCents)}
              </PTd>
              {detail ? (
                <PTd align="right">
                  {pending !== null ? formatCentsShort(pending) : <NoAmount />}
                </PTd>
              ) : null}
              {detail ? (
                <PTd className="whitespace-nowrap text-muted-foreground">
                  {due ? formatIsoDay(due) : <NoAmount />}
                </PTd>
              ) : null}
              <PTd>
                <StateLine state={state} />
              </PTd>
              <PTd className="whitespace-nowrap text-xs">
                {voided ? (
                  <NoAmount />
                ) : row.attachmentCount > 0 ? (
                  <span className="text-muted-foreground">Sí</span>
                ) : (
                  <span className="text-warning-text">Falta</span>
                )}
              </PTd>
              {canWrite ? (
                <PTd className={ROW_ACTIONS_CELL}>
                  {state.payable && row.partyId ? (
                    <span className={cn('inline-flex', ROW_ACTION)}>
                      <ActionButton
                        action="pagar"
                        params={{ proveedor: row.partyId }}
                        variant="outline"
                        size="sm"
                        className={ROW_BUTTON}
                        aria-label={`Pagarle a ${who ?? 'este proveedor'}`}
                      >
                        Pagarle
                      </ActionButton>
                    </span>
                  ) : null}
                </PTd>
              ) : null}
            </PRow>
          )
        })}
      </tbody>
      <tfoot>
        <PTotalRow>
          <PTd colSpan={leading}>{totalLabel}</PTd>
          <PTd align="right">{formatCentsShort(documentsTotal(rows))}</PTd>
          <PTd colSpan={(detail ? 4 : 2) + (canWrite ? 1 : 0)} />
        </PTotalRow>
      </tfoot>
    </PTable>
  )
}

/**
 * Los pagos: Fecha · Proveedor · Salió de · Pagó · Importe. Toda la fila lleva al comprobante del pago,
 * donde se anula.
 */
export function PaymentRows({
  tenantSlug,
  rows,
  totalLabel = 'Total',
  caption,
}: {
  tenantSlug: string
  rows: readonly DocumentListRow[]
  /** Lo que dice la fila del total: «Total de esta página» si la lista sigue. */
  totalLabel?: string
  caption?: string
}) {
  const dateOf = dateWords(rows)
  return (
    <PTable label={caption ?? 'Pagos'} minWidth={720}>
      <thead>
        <tr>
          <PTh>Fecha</PTh>
          <PTh>Proveedor</PTh>
          <PTh>Salió de</PTh>
          <PTh>Pagó</PTh>
          <PTh align="right">Importe</PTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const voided = row.status === 'voided'
          const means = voided ? null : paymentMeansText(row.means)
          const applied = voided ? null : paymentAppliedText(row.appliedTo)
          return (
            <PRow key={row.id} className={cn('relative', voided && 'text-muted-foreground')}>
              <PTd className="whitespace-nowrap text-muted-foreground">
                {dateOf(row.accountingDate)}
              </PTd>
              <PTd>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Link
                    href={documentHref(tenantSlug, row.id)}
                    className={cn(ROW_LINK, voided && 'line-through')}
                  >
                    {row.partyName ?? 'Sin proveedor'}
                  </Link>
                  {voided ? (
                    <StatusPill tone="muted" className="h-5">
                      Anulado
                    </StatusPill>
                  ) : null}
                </span>
              </PTd>
              <PTd className="max-w-[12rem] truncate text-muted-foreground">
                {means ?? <NoAmount />}
              </PTd>
              <PTd className="text-muted-foreground">
                {applied ? <VoucherText text={applied} /> : <NoAmount />}
              </PTd>
              <PTd align="right" className={cn('font-medium', voided && 'line-through')}>
                {formatCentsShort(row.totalCents)}
              </PTd>
            </PRow>
          )
        })}
      </tbody>
      <tfoot>
        <PTotalRow>
          <PTd colSpan={4}>{totalLabel}</PTd>
          <PTd align="right">{formatCentsShort(documentsTotal(rows))}</PTd>
        </PTotalRow>
      </tfoot>
    </PTable>
  )
}
