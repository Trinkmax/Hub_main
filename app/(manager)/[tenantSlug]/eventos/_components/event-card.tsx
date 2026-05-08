import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarDays, Users } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { EventListEntry } from '@/lib/events/queries'

const statusLabel: Record<
  EventListEntry['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  draft: { label: 'Borrador', variant: 'secondary' },
  published: { label: 'Publicado', variant: 'default' },
  finished: { label: 'Finalizado', variant: 'outline' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
}

export function EventCard({ tenantSlug, event }: { tenantSlug: string; event: EventListEntry }) {
  const occupancy =
    event.capacity !== null
      ? `${event.confirmed_seats}/${event.capacity}`
      : `${event.confirmed_seats}`
  const ratio = event.capacity ? Math.min(1, event.confirmed_seats / event.capacity) : 0
  const status = statusLabel[event.status]

  return (
    <Link
      href={`/${tenantSlug}/eventos/${event.id}`}
      className="card-hairline group flex flex-col overflow-hidden rounded-xl border bg-card transition-all hover:border-primary/40"
    >
      <div className="relative h-36 w-full overflow-hidden">
        {event.cover_image_url ? (
          // biome-ignore lint/performance/noImgElement: cover viene del bucket público
          <img
            src={event.cover_image_url}
            alt={event.name}
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="size-full bg-gradient-to-br from-primary/30 via-primary/10 to-secondary" />
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white">
            <CalendarDays className="size-3.5" />
            {format(new Date(event.starts_at), "EEE d 'de' MMM · HH:mm", { locale: es })}
          </div>
          <Badge variant={status.variant} className="shrink-0 text-[10px] uppercase tracking-wider">
            {status.label}
          </Badge>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="font-display text-base font-semibold tracking-tight line-clamp-2 group-hover:text-primary">
          {event.name}
        </h3>
        <div className="mt-auto space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 overflow-hidden rounded-full bg-secondary/60">
              <div
                className="h-1.5 rounded-full bg-primary transition-all"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </div>
            <span className="flex items-center gap-1 text-xs font-medium tabular-nums">
              <Users className="size-3 text-muted-foreground" />
              {occupancy}
            </span>
          </div>
          {event.waitlist_count > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              +{event.waitlist_count} en lista de espera
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  )
}
