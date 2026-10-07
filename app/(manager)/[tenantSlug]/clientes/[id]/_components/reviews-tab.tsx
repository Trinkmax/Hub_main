import { MapPin, MessageSquareQuote } from 'lucide-react'
import { StarRating } from '@/components/reviews/star-rating'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime } from '@/lib/dates'
import type { CustomerReview } from '@/lib/reviews/queries'
import { isLowRating, reviewSourceLabel } from '@/lib/reviews/summary'
import { cn } from '@/lib/utils'

// Reseñas del cliente en su ficha. Server component puro: el protagonista es el
// comentario (es lo que el dueño quiere leer), no el rating. Por eso es una
// lista de lectura y no una tabla: el comentario necesita el ancho entero.

export function ReviewsTab({ reviews }: { reviews: CustomerReview[] }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareQuote}
        title="Todavía no dejó ninguna reseña"
        description="Cuando puntúe desde su wallet o escaneando el QR, el comentario aparece acá."
      />
    )
  }

  return (
    <Card padding="none" className="gap-0 overflow-hidden">
      <ul className="divide-y divide-border">
        {reviews.map((review) => {
          const comment = review.comment?.trim()
          const low = isLowRating(review.rating)
          return (
            <li
              key={review.id}
              className={cn(
                'flex flex-col gap-2 px-4 py-4 sm:px-5',
                // Sin comentario no hay nada que leer: la fila se achica a un dato.
                !comment && 'gap-0 py-3',
                // Las malas son las que el dueño viene a buscar: fondo suave, sin alarma.
                low && 'bg-warning-soft/60',
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StarRating rating={review.rating} />
                <Badge appearance="outline">{reviewSourceLabel(review.source)}</Badge>
                {review.redirectedToMaps ? (
                  <Badge tone="success" icon={MapPin}>
                    Fue a Google Maps
                  </Badge>
                ) : null}
                <time
                  dateTime={review.createdAt}
                  className="ms-auto shrink-0 type-small type-amount text-muted-foreground"
                >
                  {formatDateTime(review.createdAt)}
                </time>
              </div>
              {comment ? (
                <p className="max-w-prose whitespace-pre-line text-pretty type-body text-foreground">
                  “{comment}”
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
