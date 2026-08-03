import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Receipt, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { VisitListEntry } from '@/lib/points/queries'

export function VisitsTab({
  visits,
  /** visitId → rating de la reseña que dejó esa visita. Sale de las reseñas que
   *  la ficha ya trajo: conecta las dos pestañas sin otra ida a la DB. */
  reviewedVisits = {},
}: {
  visits: VisitListEntry[]
  reviewedVisits?: Record<string, number>
}) {
  if (visits.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="Sin visitas registradas"
        description="Cuando le cierres una mesa, las visitas van a aparecer acá con detalle."
      />
    )
  }

  return (
    <div className="card-hairline overflow-hidden rounded-xl border bg-card">
      <ul className="divide-y divide-border/60">
        {visits.map((v) => {
          const rating = reviewedVisits[v.id]
          return (
            <li
              key={v.id}
              className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-secondary/30"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                <Receipt className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {format(new Date(v.visited_at), "d 'de' MMM yyyy · HH:mm", { locale: es })}
                  {rating !== undefined ? (
                    <span
                      className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-500 tabular-nums"
                      title={`Dejó una reseña de ${rating} de 5 estrellas`}
                    >
                      <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                      <span className="sr-only">Dejó una reseña de </span>
                      {rating}
                      <span className="sr-only"> de 5 estrellas</span>
                    </span>
                  ) : null}
                </p>
                {v.notes ? (
                  <p className="truncate text-xs text-muted-foreground">{v.notes}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin notas</p>
                )}
              </div>
              <div className="text-right">
                <p className="font-display text-sm font-semibold tabular-nums">
                  ${(v.total_amount_cents / 100).toLocaleString('es-AR')}
                </p>
                <Badge variant="outline" className="mt-0.5 text-[10px] capitalize">
                  {v.source}
                </Badge>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
