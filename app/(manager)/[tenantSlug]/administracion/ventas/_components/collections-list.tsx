import { Amount } from '@/components/administracion/amount'
import { LedgerList, LedgerRail, LedgerRow, StatusPill } from '@/components/administracion/kit'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import { MONTH_NAMES_SHORT, WEEKDAY_NAMES_SHORT, weekdayOf } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { joinNames } from '../_lib/almanac'

/** El margen de un renglón con fecha: el mes arriba, el día grande, el día de la semana abajo. */
export function DateRail({ date }: { date: string }) {
  return (
    <LedgerRail
      label={MONTH_NAMES_SHORT[Number(date.slice(5, 7)) - 1] ?? ''}
      value={date.slice(8, 10)}
      unit={WEEKDAY_NAMES_SHORT[weekdayOf(date)] ?? ''}
    />
  )
}

/**
 * «Cobros»: lo que ya te depositaron, un renglón por cobro. En el margen, el
 * día; en el centro, quién pagó y a qué caja entró; a la derecha, lo que entró
 * y, si le descontaron, de cuánto era la liquidación. Cada renglón lleva a su
 * comprobante (ahí se anula si quedó mal).
 */
export function CollectionsList({
  rows,
  base,
}: {
  rows: readonly DocumentListRow[]
  /** `/<bar>/administracion`. */
  base: string
}) {
  return (
    <LedgerList aria-label="Cobros" bare>
      {rows.map((row) => {
        const voided = row.status === 'voided'
        const means = row.means ?? []
        const received = means.reduce((sum, item) => sum + item.amountCents, 0)
        const shown = means.length > 0 ? received : row.totalCents
        const discount = row.totalCents - received
        const where = means.length > 0 ? `Entró a ${joinNames(means.map((m) => m.label))}` : null
        return (
          <LedgerRow
            key={row.id}
            href={`${base}/comprobantes/${row.id}`}
            title={row.partyName ?? row.title}
            muted={voided}
            rail={<DateRail date={row.accountingDate} />}
            meta={
              voided ? (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StatusPill tone="muted">Anulado</StatusPill>
                  {where}
                </span>
              ) : (
                where
              )
            }
            amount={
              <Amount
                cents={shown}
                decimals={0}
                className={voided ? 'line-through' : 'font-serif text-lg font-semibold'}
              />
            }
            amountNote={
              !voided && means.length > 0 && discount > 0
                ? `de ${formatCentsShort(row.totalCents)} · te descontaron ${formatCentsShort(discount)}`
                : null
            }
          />
        )
      })}
    </LedgerList>
  )
}
