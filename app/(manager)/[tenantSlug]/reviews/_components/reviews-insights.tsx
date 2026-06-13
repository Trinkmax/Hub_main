import { StatCard } from '@/components/ui/stat-card'
import type { ReviewInsights } from '@/lib/reviews/queries'
import { cn } from '@/lib/utils'
import { StarRating } from './star-rating'

// Fila de insights del panel de reseñas: promedio + total + % 5★ + distribución.
// Server component puro (recibe los datos por props).

export function ReviewsInsights({ insights }: { insights: ReviewInsights }): React.JSX.Element {
  const max = Math.max(1, ...Object.values(insights.distribution))

  return (
    <div className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_1.4fr]">
      <div className="card-hairline flex flex-col justify-center gap-1.5 rounded-xl border bg-card p-5">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Promedio
        </span>
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-3xl font-semibold tabular-nums tracking-tight">
            {insights.average.toLocaleString('es-AR', { minimumFractionDigits: 1 })}
          </span>
          <span className="text-sm text-muted-foreground">/ 5</span>
        </div>
        <StarRating rating={Math.round(insights.average)} />
      </div>

      <StatCard label="Reseñas" numberValue={insights.total} />

      <StatCard label="5 estrellas" value={`${insights.fiveStarPct}%`} hint="del total" />

      <div className="card-hairline flex flex-col justify-center gap-1.5 rounded-xl border bg-card p-5">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Distribución
        </span>
        <ul className="space-y-1">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = insights.distribution[star]
            const pct = (count / max) * 100
            return (
              <li key={star} className="flex items-center gap-2 text-xs">
                <span className="w-7 shrink-0 tabular-nums text-muted-foreground">{star}★</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      star === 5
                        ? 'bg-success'
                        : star >= 3
                          ? 'bg-amber-400'
                          : 'bg-muted-foreground/50',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
                  {count}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
