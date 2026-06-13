import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ReviewListItem } from '@/lib/reviews/queries'
import { StarRating } from './star-rating'

// Lista de reseñas del manager. Server component puro. Fecha en es-AR.

function formatReviewDate(iso: string): string {
  return format(new Date(iso), "d 'de' MMM yyyy · HH:mm", { locale: es })
}

export function ReviewsList({ reviews }: { reviews: ReviewListItem[] }): React.JSX.Element {
  return (
    <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
      {reviews.map((review) => (
        <li key={review.id} className="flex flex-col gap-2 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StarRating rating={review.rating} />
            <span className="text-sm font-medium">{review.customerName ?? 'Anónimo'}</span>
            {review.redirectedToMaps ? (
              <Badge variant="success" className="gap-1">
                <MapPin className="size-3" aria-hidden="true" />
                Maps
              </Badge>
            ) : null}
            <time
              dateTime={review.createdAt}
              className="ml-auto shrink-0 text-xs capitalize text-muted-foreground tabular-nums"
            >
              {formatReviewDate(review.createdAt)}
            </time>
          </div>
          {review.comment ? (
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              “{review.comment}”
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
