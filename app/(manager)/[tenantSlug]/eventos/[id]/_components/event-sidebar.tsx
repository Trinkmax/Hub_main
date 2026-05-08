import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarClock, ListPlus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { EventStatus } from '@/types/database'

const statusLabel: Record<
  EventStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  draft: { label: 'Borrador', variant: 'secondary' },
  published: { label: 'Publicado', variant: 'default' },
  finished: { label: 'Finalizado', variant: 'outline' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
}

export function EventSidebar({
  event,
  confirmedSeats,
  waitlistCount,
}: {
  event: {
    name: string
    description: string | null
    starts_at: string
    ends_at: string
    capacity: number | null
    waitlist_enabled: boolean
    status: EventStatus
    cover_image_url: string | null
  }
  confirmedSeats: number
  waitlistCount: number
}) {
  const status = statusLabel[event.status]
  const occupancyPct =
    event.capacity !== null && event.capacity > 0
      ? Math.round((confirmedSeats / event.capacity) * 100)
      : 0

  return (
    <div className="card-hairline overflow-hidden rounded-xl border bg-card">
      <div className="relative h-40 w-full overflow-hidden">
        {event.cover_image_url ? (
          // biome-ignore lint/performance/noImgElement: cover viene del bucket público
          <img src={event.cover_image_url} alt={event.name} className="size-full object-cover" />
        ) : (
          <div className="size-full bg-gradient-to-br from-primary/30 via-primary/10 to-secondary" />
        )}
        <div className="absolute right-3 top-3">
          <Badge variant={status.variant} className="text-[10px] uppercase tracking-wider">
            {status.label}
          </Badge>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <h2 className="font-display text-xl font-semibold tracking-tight">{event.name}</h2>

        <dl className="grid gap-3 text-sm">
          <SidebarRow
            icon={CalendarClock}
            label="Cuándo"
            value={
              <>
                <span className="block">
                  {format(new Date(event.starts_at), "EEE d 'de' MMM · HH:mm", { locale: es })}
                </span>
                <span className="block text-xs text-muted-foreground">
                  hasta {format(new Date(event.ends_at), 'HH:mm', { locale: es })}
                </span>
              </>
            }
          />
          <SidebarRow
            icon={Users}
            label="Cupo"
            value={
              event.capacity === null ? (
                <span>{confirmedSeats} confirmadas · ilimitado</span>
              ) : (
                <div className="space-y-1">
                  <span className="font-medium tabular-nums">
                    {confirmedSeats}/{event.capacity}
                  </span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary/60">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${occupancyPct}%` }}
                    />
                  </div>
                </div>
              )
            }
          />
          <SidebarRow
            icon={ListPlus}
            label="Waitlist"
            value={
              event.waitlist_enabled ? `Habilitada · ${waitlistCount} en cola` : 'Deshabilitada'
            }
          />
        </dl>

        {event.description ? (
          <div className="border-t border-border/60 pt-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Descripción</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-pretty">{event.description}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SidebarRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarClock
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-sm">{value}</dd>
      </div>
    </div>
  )
}
