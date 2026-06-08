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
      {/* Agenda vertical para mobile: la grilla 7-col deja celdas ilegibles en celular */}
      <div className="space-y-2 sm:hidden">
        {days.filter(
          (day) =>
            isSameMonth(day, monthStart) &&
            (eventsByDay.get(format(day, 'yyyy-MM-dd'))?.length ?? 0) > 0,
        ).length === 0 ? (
          <p className="rounded-lg border border-border/60 bg-background/50 px-3 py-4 text-center text-xs text-muted-foreground">
            No hay eventos este mes.
          </p>
        ) : (
          days
            .filter(
              (day) =>
                isSameMonth(day, monthStart) &&
                (eventsByDay.get(format(day, 'yyyy-MM-dd'))?.length ?? 0) > 0,
            )
            .map((day) => {
              const key = format(day, 'yyyy-MM-dd')
              const dayEvents = eventsByDay.get(key) ?? []
              const today = isSameDay(day, new Date())
              return (
                <div
                  key={key}
                  className={cn(
                    'rounded-lg border p-2',
                    today ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border/60',
                    'bg-background/50',
                  )}
                >
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="font-display text-sm font-semibold tabular-nums">
                      {format(day, 'd')}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {format(day, 'EEEE', { locale: es })}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {dayEvents.map((ev) => (
                      <Link
                        key={ev.id}
                        href={`/${tenantSlug}/eventos/${ev.id}`}
                        className="flex items-center gap-2 rounded bg-primary/15 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/25"
                      >
                        <span className="font-mono text-[11px] tabular-nums">
                          {format(new Date(ev.starts_at), 'HH:mm')}
                        </span>
                        <span className="truncate">{ev.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })
        )}
      </div>
      <div className="hidden grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 sm:grid">
        {weekHeader.map((d) => (
          <div key={d} className="py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="mt-1 hidden grid-cols-7 gap-1 sm:grid">
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
