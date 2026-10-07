import Link from 'next/link'
import { StarRating } from '@/components/reviews/star-rating'
import { StatCard } from '@/components/ui/stat-card'
import type { ReviewInsights } from '@/lib/reviews/queries'
import { cn } from '@/lib/utils'
import { type RatingFilter, reviewsHref } from './reviews-filters'

// Fila de insights del panel de reseñas: promedio + total + % 5★ + distribución.
// Server component puro (recibe los datos por props). Las barras de distribución
// son links al filtro: ver "3 reseñas de 2★" y querer leerlas es el mismo gesto.

export function ReviewsInsights({
  tenantSlug,
  insights,
  active,
}: {
  tenantSlug: string
  insights: ReviewInsights
  active: RatingFilter
}): React.JSX.Element {
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
        <ul className="space-y-0.5">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = insights.distribution[star]
            const pct = (count / max) * 100
            const isActive = active === star
            return (
              <li key={star}>
                <Link
                  href={reviewsHref(tenantSlug, isActive ? undefined : star)}
                  scroll={false}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={`Ver las ${count} reseñas de ${star} ${star === 1 ? 'estrella' : 'estrellas'}`}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-1 py-1 text-xs transition-colors duration-[var(--duration-fast)]',
                    'hover:bg-(--cream-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    isActive && 'bg-secondary',
                  )}
                >
                  <span
                    className={cn(
                      'w-7 shrink-0 tabular-nums',
                      isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {star}★
                  </span>
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
                  <span
                    className={cn(
                      'w-6 shrink-0 text-right tabular-nums',
                      isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
