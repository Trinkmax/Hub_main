import { ArrowRight, CalendarDays } from 'lucide-react'
import Link from 'next/link'
import type { UpcomingEvent } from '@/lib/stats/pulse-queries'
import { cn } from '@/lib/utils'

function dayWords(date: string, today: string): string {
  if (date === today) return 'Hoy'
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const text = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * «Lo que viene»: los eventos de los próximos días con cuánta gente tienen anotada. De un vistazo se
 * ve cuál está lleno y cuál hay que empujar. Cada renglón abre el evento en el calendario.
 */
export function UpcomingEventsCard({
  tenantSlug,
  events,
  today,
}: {
  tenantSlug: string
  events: UpcomingEvent[]
  today: string
}) {
  return (
    <section
      aria-label="Lo que viene"
      className="card-hairline flex flex-col overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="font-serif text-lg font-semibold tracking-tight">Lo que viene</h2>
          <p className="text-xs text-muted-foreground">Los eventos de los próximos 7 días.</p>
        </div>
        <Link
          href={`/${tenantSlug}/eventos/programados`}
          className="group inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Calendario
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </header>

      {events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 pb-8 text-center">
          <CalendarDays className="size-6 text-muted-foreground/60" aria-hidden />
          <p className="text-sm text-muted-foreground text-pretty">
            No hay eventos en el calendario para esta semana.
          </p>
          <Link
            href={`/${tenantSlug}/eventos/programados/nuevo`}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Programar uno
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border/50 border-t border-border/50">
          {events.map((event) => {
            const ratio = event.capacity > 0 ? event.reserved / event.capacity : 0
            const full = event.capacity > 0 && event.reserved >= event.capacity
            return (
              <li key={event.id}>
                <Link
                  href={`/${tenantSlug}/eventos/programados/${event.id}`}
                  className="block px-5 py-2.5 transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full bg-primary"
                        style={event.color ? { backgroundColor: event.color } : undefined}
                      />
                      <span className="truncate text-sm font-medium">{event.name}</span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">
                      <span className={cn('font-semibold', full && 'text-success')}>
                        {event.reserved}
                      </span>
                      <span className="text-muted-foreground"> / {event.capacity}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3 pl-4 text-xs text-muted-foreground">
                    <span>
                      {dayWords(event.date, today)} · {event.time}
                      {event.privateGroup ? ' · Grupo privado' : ''}
                    </span>
                    {full ? <span className="font-medium text-success">Completo</span> : null}
                  </div>
                  <div
                    className="mt-1.5 ml-4 h-1 overflow-hidden rounded-full bg-secondary"
                    aria-hidden
                  >
                    <div
                      className={cn('h-full rounded-full', full ? 'bg-success' : 'bg-primary/70')}
                      style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                    />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
