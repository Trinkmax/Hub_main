import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { es } from 'date-fns/locale'
import Link from 'next/link'
import type { EventListEntry } from '@/lib/events/queries'
import { cn } from '@/lib/utils'

export function CalendarMonth({
  tenantSlug,
  events,
}: {
  tenantSlug: string
  events: EventListEntry[]
}) {
  const anchor = events[0] ? new Date(events[0].starts_at) : new Date()
  const monthStart = startOfMonth(anchor)
  const monthEnd = endOfMonth(monthStart)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const eventsByDay = new Map<string, EventListEntry[]>()
  for (const ev of events) {
    const key = format(new Date(ev.starts_at), 'yyyy-MM-dd')
    if (!eventsByDay.has(key)) eventsByDay.set(key, [])
    eventsByDay.get(key)?.push(ev)
  }

  const weekHeader = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold capitalize tracking-tight">
          {format(monthStart, 'LLLL yyyy', { locale: es })}
        </h3>
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {events.length} evento{events.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        {weekHeader.map((d) => (
          <div key={d} className="py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const dayEvents = eventsByDay.get(key) ?? []
          const inMonth = isSameMonth(day, monthStart)
          const today = isSameDay(day, new Date())
          return (
            <div
              key={key}
              className={cn(
                'min-h-20 rounded-lg border p-1.5 text-xs transition-colors',
                inMonth ? 'bg-background/50' : 'bg-secondary/20 text-muted-foreground/60',
                today && 'border-primary/60 ring-1 ring-primary/30',
                !today && 'border-border/60',
              )}
            >
              <div
                className={cn(
                  'flex items-center justify-end',
                  today &&
                    'mb-0.5 [&_span]:flex [&_span]:size-5 [&_span]:items-center [&_span]:justify-center [&_span]:rounded-full [&_span]:bg-primary [&_span]:text-[10px] [&_span]:font-semibold [&_span]:text-primary-foreground',
                )}
              >
                <span className="font-medium tabular-nums">{format(day, 'd')}</span>
              </div>
              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 2).map((ev) => (
                  <Link
                    key={ev.id}
                    href={`/${tenantSlug}/eventos/${ev.id}`}
                    className="block truncate rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-primary hover:bg-primary/25"
                    title={ev.name}
                  >
                    <span className="font-mono">{format(new Date(ev.starts_at), 'HH:mm')}</span>{' '}
                    {ev.name}
                  </Link>
                ))}
                {dayEvents.length > 2 ? (
                  <div className="px-1.5 text-[10px] text-muted-foreground">
                    +{dayEvents.length - 2} más
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
