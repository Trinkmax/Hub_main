import { Star } from 'lucide-react'
import Link from 'next/link'
import { StarRating } from '@/components/reviews/star-rating'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { formatNumber, formatNumberKind } from '@/lib/format/number-kind'
import type { ReviewInsights } from '@/lib/reviews/queries'
import { cn } from '@/lib/utils'
import { type RatingFilter, reviewsHref } from './reviews-filters'

// Los números de las reseñas: promedio, total y % de 5★ en un `KPIGroup` (una
// tarjeta, sin animar), y al lado la distribución. Server component puro (recibe
// los datos por props). Las barras son links al filtro: ver "3 reseñas de 2★" y
// querer leerlas es el mismo gesto.

const BAR_TONE: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = {
  5: 'bg-success',
  4: 'bg-warning',
  3: 'bg-warning',
  2: 'bg-subtle-foreground',
  1: 'bg-subtle-foreground',
}

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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
      <KPIGroup columns={3}>
        <KPI
          label="Promedio"
          value={formatNumber(insights.average, 1)}
          unit="de 5"
          status={<StarRating rating={Math.round(insights.average)} />}
        />
        <KPI label="Reseñas" value={formatNumber(insights.total)} />
        <KPI
          label="5 estrellas"
          value={formatNumberKind(insights.fiveStarPct, 'percent-100')}
          hint="del total"
        />
      </KPIGroup>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle className="type-label font-medium text-muted-foreground">
            <h2>Distribución</h2>
          </CardTitle>
        </CardHeader>
        <ul className="flex flex-col">
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
                  aria-label={
                    isActive
                      ? `Ver todas las reseñas (ahora: ${star} ${star === 1 ? 'estrella' : 'estrellas'})`
                      : `Ver las ${count} reseñas de ${star} ${star === 1 ? 'estrella' : 'estrellas'}`
                  }
                  className={cn(
                    'flex min-h-8 items-center gap-2 rounded-md border border-transparent px-2 type-small',
                    'outline-offset-2 outline-(--ring) hover:bg-hover focus-visible:outline-2 pointer-coarse:min-h-11',
                    isActive && 'border-primary bg-card',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex w-8 shrink-0 items-center gap-0.5 type-amount',
                      isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {star}
                    <Star aria-hidden="true" className="size-3 fill-warning text-warning" />
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <span
                      className={cn('block h-full rounded-full', BAR_TONE[star])}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      'w-8 shrink-0 text-right type-amount',
                      isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {formatNumber(count)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
