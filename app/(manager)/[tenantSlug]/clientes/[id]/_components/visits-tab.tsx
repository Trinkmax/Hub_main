import { Receipt, Star } from 'lucide-react'
import { Amount } from '@/components/ui/amount'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime } from '@/lib/dates'
import type { VisitListEntry } from '@/lib/points/queries'
import { visitSourceLabel } from '../../_components/customer-meta'

export function VisitsTab({
  visits,
  /** visitId → rating de la reseña que dejó esa visita. Sale de las reseñas que
   *  la ficha ya trajo: conecta las dos pestañas sin otra ida a la DB. */
  reviewedVisits = {},
}: {
  visits: VisitListEntry[]
  reviewedVisits?: Record<string, number>
}) {
  return (
    <DataTable<VisitListEntry>
      caption="Visitas del cliente"
      rows={visits}
      getRowId={(v) => v.id}
      empty={
        <EmptyState
          size="sm"
          icon={Receipt}
          title="Sin visitas registradas"
          description="Cuando le cierres una mesa, cada visita aparece acá con su total."
        />
      }
      columns={[
        {
          id: 'fecha',
          header: 'Fecha',
          mobile: 'primary',
          cell: (v) => {
            const rating = reviewedVisits[v.id]
            return (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="type-amount">{formatDateTime(v.visited_at)}</span>
                {rating !== undefined ? (
                  <span
                    className="inline-flex items-center gap-0.5 type-caption font-semibold type-amount text-warning-text"
                    title={`Dejó una reseña de ${rating} de 5 estrellas`}
                  >
                    <Star className="size-3 fill-warning text-warning" aria-hidden="true" />
                    <span className="sr-only">Dejó una reseña de </span>
                    {rating}
                    <span className="sr-only"> de 5 estrellas</span>
                  </span>
                ) : null}
              </span>
            )
          },
        },
        {
          id: 'notas',
          header: 'Notas',
          mobile: 'secondary',
          cell: (v) =>
            v.notes ? (
              <span className="line-clamp-2 text-muted-foreground">{v.notes}</span>
            ) : (
              <span className="text-subtle-foreground">Sin notas</span>
            ),
        },
        {
          id: 'origen',
          header: 'Origen',
          mobile: 'meta',
          hideBelow: 'lg',
          cell: (v) => <span className="text-muted-foreground">{visitSourceLabel(v.source)}</span>,
        },
        {
          id: 'total',
          header: 'Total $',
          numeric: true,
          width: '8rem',
          cell: (v) => (
            <Amount
              cents={v.total_amount_cents}
              decimals={0}
              currency={false}
              className="font-medium"
            />
          ),
        },
      ]}
    />
  )
}
