import { Star } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { ReviewInsights } from '@/lib/reviews/queries'

// Filtro por estrellas: un `SegmentedControl` en modo link (kit HUB §3.3). Son
// <Link> (no botones con router.push) para que el filtro sea copiable,
// compartible y sobreviva al refresh sin JS.

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
  const items = [
    {
      value: 'todas',
      label: 'Todas',
      count: insights.total,
      href: reviewsHref(tenantSlug, undefined),
    },
    ...([5, 4, 3, 2, 1] as const).map((star) => ({
      value: String(star),
      label: (
        <span className="inline-flex items-center gap-1 type-amount">
          {star}
          <Star aria-hidden="true" className="size-3.5 fill-warning text-warning" />
          <span className="sr-only">{star === 1 ? 'estrella' : 'estrellas'}</span>
        </span>
      ),
      count: insights.distribution[star],
      href: reviewsHref(tenantSlug, star),
    })),
  ]

  // Con seis opciones y sus cuentas no siempre entra en un celular: la fila scrollea.
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      <SegmentedControl
        aria-label="Filtrar reseñas por estrellas"
        value={active ? String(active) : 'todas'}
        items={items}
        className="max-w-none"
      />
    </div>
  )
}
