import { formatInTimeZone } from 'date-fns-tz'
import { MapPin, MessageSquareQuote } from 'lucide-react'
import { StarRating } from '@/components/reviews/star-rating'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { CustomerReview } from '@/lib/reviews/queries'
import { isLowRating, reviewSourceLabel } from '@/lib/reviews/summary'
import { cn } from '@/lib/utils'

// Reseñas del cliente en su ficha. Server component puro: el protagonista es el
// comentario (es lo que el dueño quiere leer), no el rating.

const TZ = 'America/Argentina/Cordoba'

function formatReviewDate(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, 'dd/MM/yyyy HH:mm')
}

export function ReviewsTab({ reviews }: { reviews: CustomerReview[] }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareQuote}
        title="Todavía no dejó ninguna reseña"
        description="Cuando puntúe desde su wallet o escaneando el QR, el comentario va a aparecer acá."
      />
    )
  }

  return (
    <div className="card-hairline overflow-hidden rounded-xl border bg-card">
      <ul className="divide-y divide-border/60">
        {reviews.map((review) => {
          const comment = review.comment?.trim()
          const low = isLowRating(review.rating)
          return (
            <li
              key={review.id}
              className={cn(
                'flex flex-col gap-2 px-4 py-4 sm:px-5',
                // Sin comentario no hay nada que leer: la fila se achica a un dato.
                !comment && 'gap-0 py-2.5',
                // Las malas son las que el dueño viene a buscar: acento sobrio, sin alarma.
                low && 'border-l-2 border-warning bg-warning/5',
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StarRating rating={review.rating} />
                <Badge variant="outline" className="text-[10px]">
                  {reviewSourceLabel(review.source)}
                </Badge>
                {review.redirectedToMaps ? (
                  <Badge variant="success" className="gap-1 text-[10px]">
                    <MapPin className="size-3" aria-hidden="true" />
                    Maps
                  </Badge>
                ) : null}
                <time
                  dateTime={review.createdAt}
                  className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {formatReviewDate(review.createdAt)}
                </time>
              </div>
              {comment ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground text-pretty">
                  “{comment}”
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
