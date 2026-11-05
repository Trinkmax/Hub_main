import Link from 'next/link'
import { StatusPill } from '@/components/administracion/kit'
import { PRow, PTable, PTd, PTh, PTotalRow } from '@/components/administracion/planilla'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import { formatDayLabel } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { collectionAmounts } from '../_lib/net-view'

const NAME_LINK =
  'rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * «Cobros»: lo que ya te depositaron, un renglón por cobro: el día, quién pagó, a qué caja entró, lo
 * que entró y lo que te descontaron. Cada renglón lleva a su comprobante (ahí se anula si quedó mal).
 * El total va solo si la lista está entera: con más páginas, sumaría solo lo que se ve.
 */
export function CollectionsList({
  rows,
  base,
  total,
}: {
  rows: readonly DocumentListRow[]
  /** `/<bar>/administracion`. */
  base: string
  /** Lo que entró y lo descontado de todo el período; `null` si la lista sigue en otra página. */
  total: { receivedCents: number; discountCents: number } | null
}) {
  return (
    <PTable minWidth={640} label="Cobros">
      <thead>
        <tr>
          <PTh>Día</PTh>
          <PTh>Quién</PTh>
          <PTh>Entró a</PTh>
          <PTh align="right">Entró</PTh>
          <PTh align="right">Te descontaron</PTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const voided = row.status === 'voided'
          const { shown, discount, where } = collectionAmounts(row)
          return (
            <PRow key={row.id} className={voided ? 'text-muted-foreground' : undefined}>
              <PTd className="whitespace-nowrap">{formatDayLabel(row.accountingDate)}</PTd>
              <PTd>
                <Link href={`${base}/comprobantes/${row.id}`} className={NAME_LINK}>
                  {row.partyName ?? row.title}
                </Link>
                {voided ? (
                  <StatusPill tone="muted" className="ml-2">
                    Anulado
                  </StatusPill>
                ) : null}
              </PTd>
              <PTd className="text-muted-foreground">{where || '—'}</PTd>
              <PTd align="right" className={cn('font-medium', voided && 'line-through')}>
                {formatCentsShort(shown)}
              </PTd>
              <PTd align="right">
                {!voided && discount > 0 ? (
                  formatCentsShort(discount)
                ) : (
                  <span className="text-muted-foreground/60">—</span>
                )}
              </PTd>
            </PRow>
          )
        })}
      </tbody>
      {total ? (
        <tfoot>
          <PTotalRow>
            <PTd colSpan={3}>Total</PTd>
            <PTd align="right">{formatCentsShort(total.receivedCents)}</PTd>
            <PTd align="right">
              {total.discountCents > 0 ? formatCentsShort(total.discountCents) : '—'}
            </PTd>
          </PTotalRow>
        </tfoot>
      ) : null}
    </PTable>
  )
}
