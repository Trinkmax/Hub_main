import { MapPin } from 'lucide-react'
import Link from 'next/link'
import { StarRating } from '@/components/reviews/star-rating'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatDateTime } from '@/lib/dates'
import type { ReviewListItem } from '@/lib/reviews/queries'

// Lista de reseñas del manager. Server component puro. Fecha en el reloj del bar.
// Es una lista de lectura y no una tabla: el comentario es el protagonista y
// necesita el ancho entero.

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
    <Card padding="none" className="gap-0 overflow-hidden">
      <ul className="divide-y divide-border">
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
                    className="group -mx-1 flex min-h-9 items-center gap-2 rounded-md px-1 outline-offset-2 outline-(--ring) hover:bg-hover focus-visible:outline-2"
                  >
                    <Avatar size="sm">
                      <AvatarFallback className="font-semibold">{initialsOf(name)}</AvatarFallback>
                    </Avatar>
                    <span className="type-body font-medium underline-offset-2 group-hover:underline">
                      {name}
                    </span>
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 type-body text-muted-foreground">
                    <Avatar size="sm">
                      <AvatarFallback className="font-semibold">?</AvatarFallback>
                    </Avatar>
                    Anónimo
                  </span>
                )}

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
              {review.comment ? (
                <p className="max-w-prose whitespace-pre-line text-pretty type-body text-muted-foreground">
                  “{review.comment}”
                </p>
              ) : (
                <p className="type-small text-subtle-foreground">Sin comentario</p>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
