import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Receipt } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { VisitListEntry } from '@/lib/points/queries'

export function VisitsTab({ visits }: { visits: VisitListEntry[] }) {
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
        {visits.map((v) => (
          <li
            key={v.id}
            className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-secondary/30"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <Receipt className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {format(new Date(v.visited_at), "d 'de' MMM yyyy · HH:mm", { locale: es })}
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
        ))}
      </ul>
    </div>
  )
}
