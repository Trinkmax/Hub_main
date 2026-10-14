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
import {
  type DocumentRowState,
  dateRail,
  documentRowState,
  paymentAppliedText,
  paymentMeansText,
} from '../_lib/libreta'
import { documentHref } from '../_lib/links'

/**
 * El importe de un renglón, en pesos: es una lista del dueño. Los centavos
 * están en la ficha del comprobante y en la tabla de la contadora.
 */
function RowAmount({ cents, struck }: { cents: number; struck: boolean }) {
  return <Amount cents={cents} decimals={0} className={cn('text-base', struck && 'line-through')} />
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
 * El ancho de [Pagarle] más su separación del importe: lo que se corre el
 * importe de un renglón SIN botón para quedar en columna con los que lo tienen.
 */
const PAY_BUTTON = 'w-[5.75rem] px-0'
const PAY_GUTTER = '@[28rem]/ledger:pr-[6.5rem]'

// La tinta de un estado escrito chico: el rojo pelado no llega a AA a 12 px, así que va
// mezclado con la tinta del tema (la receta de `StatusPill` y del margen de la libreta).
const STATE_INK = {
  late: 'text-[color-mix(in_oklch,var(--destructive)_75%,var(--foreground))]',
  warn: 'text-warning-text',
  muted: 'text-muted-foreground',
} as const
const STATE_DOT = { late: 'bg-destructive', warn: 'bg-warning' } as const

/**
 * El estado de un comprobante, en una línea. Lo que apura va como punto +
 * palabra («● Vencida hace 14 días»): veinte píldoras rojas iguales son ruido y
 * no dejan ver cuál apura. La píldora queda para lo que ya está («Pagada») y
 * para lo que hay a favor. Nunca color solo: siempre con su palabra.
 */
function StateLine({ state, className }: { state: DocumentRowState; className?: string }) {
  if (!state.text) return null
  if (state.tone === 'ok' || state.tone === 'info') {
    return (
      <StatusPill tone={state.tone} className={className}>
        {state.text}
      </StatusPill>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-xs leading-snug',
        STATE_INK[state.tone],
        className,
      )}
    >
      {state.tone === 'muted' ? null : (
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[state.tone])} />
      )}
      <span className="min-w-0 text-pretty">
        {state.text}
        {state.note ? <span className="text-muted-foreground"> · {state.note}</span> : null}
      </span>
    </span>
  )
}

/**
 * Los comprobantes de compra como renglones de libreta (lo que ve el dueño; la
 * contadora ve la tabla). En el margen, la fecha; en el medio, A QUIÉN y con
 * qué papel; a la derecha, el total y, al lado, [Pagarle]. El estado va en
 * palabras debajo del total («● Vencida hace 3 días», «Falta pagar · vence el
 * 21/10», «Pagada»); «falta $ X» solo se dice cuando ya se pagó una parte.
 *
 * En una hoja angosta (el celular) a la derecha queda SOLO el total, así todos
 * los importes van al lado del nombre, en columna; el estado baja a la línea de
 * [Pagarle] (o debajo del papel, si no hay nada que pagar).
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
        const pays = canWrite && state.payable && row.partyId !== null
        // Quien carga: los importes de los renglones sin botón se corren lo que mide el botón.
        const gutter = canWrite && !pays ? PAY_GUTTER : undefined
        return (
          <LedgerRow
            key={row.id}
            rail={dayRail(row.accountingDate, rows[index - 1]?.accountingDate)}
            title={who}
            href={documentHref(tenantSlug, row.id)}
            muted={state.voided}
            // En el celular el nombre cede lugar antes de mandar el importe abajo: el total
            // queda al lado del nombre en TODOS los renglones, también con siete cifras.
            className="@max-[28rem]/ledger:[&>div:last-child>div:first-child]:basis-24"
            meta={
              <>
                <Bits>
                  <span className={cn('min-w-0', state.voided && 'line-through')}>
                    <VoucherText text={row.title} />
                  </span>
                  {category && row.partyName ? (
                    <span className="min-w-0">en {category}</span>
                  ) : null}
                  {row.issueDate !== row.accountingDate ? (
                    <span className="whitespace-nowrap tabular-nums">
                      del {formatDayMonth(row.issueDate)}
                    </span>
                  ) : null}
                  {isNotInvoicedVoucher(row.voucherType) ? (
                    <StatusPill tone="muted">{NOT_INVOICED_BADGE}</StatusPill>
                  ) : null}
                </Bits>
                {/* Hoja angosta y sin [Pagarle]: el estado va acá, debajo del papel. */}
                {state.text && !pays ? (
                  <span className="mt-1.5 flex @[28rem]/ledger:hidden">
                    <StateLine state={state} />
                  </span>
                ) : null}
              </>
            }
            amount={
              <span className={cn('block', gutter)}>
                <RowAmount cents={row.totalCents} struck={state.voided} />
              </span>
            }
            // Hoja ancha: el estado, debajo del total.
            amountNote={
              state.text ? (
                <span className={cn('flex justify-end @max-[28rem]/ledger:hidden', gutter)}>
                  <StateLine state={state} />
                </span>
              ) : undefined
            }
            action={
              pays && row.partyId ? (
                <ActionButton
                  action="pagar"
                  params={{ proveedor: row.partyId }}
                  variant="outline"
                  className={cn('h-11 rounded-full md:h-9', PAY_BUTTON)}
                  aria-label={`Pagarle a ${who}`}
                >
                  Pagarle
                </ActionButton>
              ) : undefined
            }
            // Hoja angosta: el estado comparte la línea con [Pagarle] (estado a la izquierda,
            // botón contra el borde). En la ancha no se dibuja: ya está debajo del total.
            menu={
              pays && state.text ? (
                <span className="mr-auto flex min-w-0 @[28rem]/ledger:hidden">
                  <StateLine state={state} />
                </span>
              ) : undefined
            }
          />
        )
      })}
    </LedgerList>
  )
}

/**
 * Los pagos como renglones: A QUIÉN (su nombre es el título: es lo que
 * identifica el renglón y no se puede cortar detrás de «Le pagaste a…»), con
 * qué y qué pagó (o «quedó a cuenta»). El renglón lleva al comprobante del
 * pago, donde se anula.
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
            title={row.partyName ?? 'Sin proveedor'}
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
