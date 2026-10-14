import type { ReactNode } from 'react'
import { Amount } from '@/components/administracion/amount'
import { LedgerList, LedgerRail, LedgerRow, StatusPill } from '@/components/administracion/kit'
import { categoryShortName } from '@/components/administracion/kit/category'
import { ActionButton } from '@/components/administracion/quick-actions'
import { VoucherText } from '@/components/administracion/voucher-text'
import { isNotInvoicedVoucher, NOT_INVOICED_BADGE } from '@/lib/accounting/invoiced'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import { formatDayMonth } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { dateRail, documentRowState, paymentAppliedText, paymentMeansText } from '../_lib/libreta'
import { documentHref } from '../_lib/links'

/** Con centavos solo si los tiene: «$ 120.000» y «$ 72.358,40». */
function RowAmount({ cents, struck }: { cents: number; struck: boolean }) {
  return (
    <Amount
      cents={cents}
      decimals={cents % 100 === 0 ? 0 : 2}
      className={cn('text-base', struck && 'line-through')}
    />
  )
}

/** El margen-fecha: el día grande y el mes; vacío si es el mismo día que el renglón de arriba. */
function dayRail(date: string, previous: string | undefined): ReactNode {
  if (date === previous) return undefined
  const rail = dateRail(date)
  return <LedgerRail label={rail.label} value={rail.value} />
}

function Bits({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">{children}</span>
}

/**
 * Los comprobantes de compra como renglones de libreta (lo que ve el dueño; la
 * contadora ve la tabla). En el margen, la fecha; en el medio, A QUIÉN y con
 * qué papel; a la derecha, el total y su estado en palabras («Vencida hace 3
 * días», «Falta pagar $ 40.000», «Pagada»).
 *
 * Todo el renglón lleva a la ficha del comprobante. [Pagarle] aparece en lo que
 * queda por pagar y solo para quien carga: abre «Pagar» con ese proveedor (dice
 * «Pagarle» y no «Pagar» a propósito: la hoja tilda lo más urgente de ese
 * proveedor, que puede no ser este papel).
 */
export function DocumentRows({
  tenantSlug,
  rows,
  today,
  canWrite,
  footer,
}: {
  tenantSlug: string
  rows: readonly DocumentListRow[]
  today: string
  canWrite: boolean
  footer?: ReactNode
}) {
  return (
    <LedgerList aria-label="Comprobantes de compra" footer={footer}>
      {rows.map((row, index) => {
        const state = documentRowState(row, today)
        // «Compras: alimentos» es el nombre del plan; el dueño dice «Alimentos».
        const category = row.imputation ? categoryShortName(row.imputation) : null
        // Un gasto sin proveedor no tiene «a quién»: se nombra por en qué se gastó.
        const who = row.partyName ?? category ?? row.title
        return (
          <LedgerRow
            key={row.id}
            rail={dayRail(row.accountingDate, rows[index - 1]?.accountingDate)}
            title={who}
            href={documentHref(tenantSlug, row.id)}
            muted={state.voided}
            meta={
              <Bits>
                <span className={cn('min-w-0', state.voided && 'line-through')}>
                  <VoucherText text={row.title} />
                </span>
                {category && row.partyName ? <span className="min-w-0">en {category}</span> : null}
                {row.issueDate !== row.accountingDate ? (
                  <span className="whitespace-nowrap tabular-nums">
                    del {formatDayMonth(row.issueDate)}
                  </span>
                ) : null}
                {isNotInvoicedVoucher(row.voucherType) ? (
                  <StatusPill tone="muted">{NOT_INVOICED_BADGE}</StatusPill>
                ) : null}
              </Bits>
            }
            amount={<RowAmount cents={row.totalCents} struck={state.voided} />}
            amountNote={
              state.text ? (
                <span className="flex flex-col items-end gap-0.5">
                  {state.tone === 'muted' ? (
                    <span>{state.text}</span>
                  ) : (
                    <StatusPill tone={state.tone}>{state.text}</StatusPill>
                  )}
                  {state.note ? <span className="whitespace-nowrap">{state.note}</span> : null}
                </span>
              ) : undefined
            }
          >
            {canWrite && state.payable && row.partyId ? (
              <div className="flex justify-end pb-1">
                <ActionButton
                  action="pagar"
                  params={{ proveedor: row.partyId }}
                  variant="outline"
                  className="h-11 rounded-full px-5 md:h-9"
                  aria-label={`Pagarle a ${who}`}
                >
                  Pagarle
                </ActionButton>
              </div>
            ) : null}
          </LedgerRow>
        )
      })}
    </LedgerList>
  )
}

/**
 * Los pagos como renglones: «Le pagaste a {proveedor}», con qué y qué pagó (o
 * «quedó a cuenta»). El renglón lleva al comprobante del pago, donde se anula.
 */
export function PaymentRows({
  tenantSlug,
  rows,
  footer,
}: {
  tenantSlug: string
  rows: readonly DocumentListRow[]
  footer?: ReactNode
}) {
  return (
    <LedgerList aria-label="Pagos" footer={footer}>
      {rows.map((row, index) => {
        const voided = row.status === 'voided'
        const means = voided ? null : paymentMeansText(row.means)
        const applied = voided ? null : paymentAppliedText(row.appliedTo)
        return (
          <LedgerRow
            key={row.id}
            rail={dayRail(row.accountingDate, rows[index - 1]?.accountingDate)}
            title={`Le pagaste a ${row.partyName ?? 'un proveedor'}`}
            href={documentHref(tenantSlug, row.id)}
            muted={voided}
            meta={
              means || applied ? (
                <Bits>
                  {means ? <span>{means}</span> : null}
                  {applied ? (
                    <span className="min-w-0">
                      <VoucherText text={applied} />
                    </span>
                  ) : null}
                </Bits>
              ) : undefined
            }
            amount={<RowAmount cents={row.totalCents} struck={voided} />}
            amountNote={voided ? 'Anulado' : undefined}
          />
        )
      })}
    </LedgerList>
  )
}
