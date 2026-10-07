import { formatInTimeZone } from 'date-fns-tz'
import { MapPin } from 'lucide-react'
import Link from 'next/link'
import { StarRating } from '@/components/reviews/star-rating'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { ReviewListItem } from '@/lib/reviews/queries'

// Lista de reseñas del manager. Server component puro. Fecha en el reloj del bar.

const TZ = 'America/Argentina/Cordoba'

function formatReviewDate(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, 'dd/MM/yyyy HH:mm')
}

function initialsOf(name: string): string {
  const [first = '', last = ''] = name.split(' ')
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '?'
}

export function ReviewsList({
  tenantSlug,
  reviews,
}: {
  tenantSlug: string
  reviews: ReviewListItem[]
}): React.JSX.Element {
  return (
    <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
      {reviews.map((review) => {
        const name = review.customerName?.trim()
        return (
          <li key={review.id} className="flex flex-col gap-2 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StarRating rating={review.rating} />

              {/* Si la reseña tiene cliente asociado, es puerta a su ficha del CRM:
                  leer un "3★" sin poder ver quién es no sirve para nada. */}
              {review.customerId && name ? (
                <Link
                  href={`/${tenantSlug}/clientes/${review.customerId}`}
                  className="group flex min-h-9 items-center gap-2 rounded-md px-1 -mx-1 transition-colors hover:bg-(--cream-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-secondary text-[10px] font-semibold">
                      {initialsOf(name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium group-hover:underline">{name}</span>
                </Link>
              ) : (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-secondary/50 text-[10px] font-semibold text-muted-foreground">
                      ?
                    </AvatarFallback>
                  </Avatar>
                  Anónimo
                </span>
              )}

              {review.redirectedToMaps ? (
                <Badge variant="success" className="gap-1">
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
            {review.comment ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground text-pretty">
                “{review.comment}”
              </p>
            ) : (
              <p className="text-sm italic text-muted-foreground/60">Sin comentario</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
