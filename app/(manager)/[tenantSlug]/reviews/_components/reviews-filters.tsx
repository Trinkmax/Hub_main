import { Star } from 'lucide-react'
import Link from 'next/link'
import type { ReviewInsights } from '@/lib/reviews/queries'
import { cn } from '@/lib/utils'

// Chips de filtro por estrellas. Son <Link> (no botones con router.push) para
// que el filtro sea copiable, compartible y sobreviva al refresh sin JS.

export type RatingFilter = 1 | 2 | 3 | 4 | 5 | undefined

/** `?rating=N`, o la ruta pelada cuando se vuelve a "Todas". */
export function reviewsHref(tenantSlug: string, rating: RatingFilter): string {
  return rating ? `/${tenantSlug}/reviews?rating=${rating}` : `/${tenantSlug}/reviews`
}

export function ReviewsFilters({
  tenantSlug,
  insights,
  active,
}: {
  tenantSlug: string
  insights: ReviewInsights
  active: RatingFilter
}): React.JSX.Element {
  const chips: { value: RatingFilter; label: string; count: number }[] = [
    { value: undefined, label: 'Todas', count: insights.total },
    ...([5, 4, 3, 2, 1] as const).map((star) => ({
      value: star as RatingFilter,
      label: `${star}★`,
      count: insights.distribution[star],
    })),
  ]

  // Son links entre vistas filtradas, no controles de formulario: <nav>.
  return (
    <nav
      className="card-hairline flex w-full flex-wrap gap-1 rounded-xl border bg-card/60 p-1"
      aria-label="Filtrar reseñas por estrellas"
    >
      {chips.map((chip) => {
        const isActive = chip.value === active
        return (
          <Link
            key={chip.label}
            href={reviewsHref(tenantSlug, chip.value)}
            scroll={false}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-(--cream-tint) hover:text-foreground',
            )}
          >
            {chip.value ? (
              <span className="flex items-center gap-1 tabular-nums">
                {chip.value}
                <Star
                  className={cn(
                    'size-3.5',
                    isActive ? 'fill-amber-400 text-amber-400' : 'fill-current opacity-60',
                  )}
                  aria-hidden="true"
                />
                <span className="sr-only">{chip.value === 1 ? 'estrella' : 'estrellas'}</span>
              </span>
            ) : (
              chip.label
            )}
            <span
              className={cn(
                'inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                isActive ? 'bg-primary/15 text-primary' : 'bg-secondary/60 text-muted-foreground',
              )}
            >
              {chip.count.toLocaleString('es-AR')}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
