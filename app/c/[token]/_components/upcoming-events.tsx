import { CalendarDays } from 'lucide-react'
import type { WalletData } from '@/lib/wallet/queries'
import { formatEventDate } from './wallet-format'

// Próximos eventos publicados. Se oculta si no hay ninguno.

type Event = WalletData['events'][number]

export function UpcomingEvents({ events }: { events: Event[] }): React.JSX.Element | null {
  if (events.length === 0) return null

  return (
    <section aria-labelledby="events-heading" className="space-y-3">
      <h2 id="events-heading" className="font-display text-lg font-semibold tracking-tight">
        Próximos eventos
      </h2>
      <div className="card-hairline overflow-hidden rounded-2xl border bg-card">
        <ul className="divide-y divide-border/60">
          {events.map((event) => (
            <li key={event.id} className="flex items-center gap-3 px-4 py-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[--cream-tint] text-[--brand-accent,var(--primary)]">
                <CalendarDays className="size-4.5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">{event.name}</p>
                <time
                  dateTime={event.startsAt}
                  className="text-xs capitalize text-muted-foreground tabular-nums"
                >
                  {formatEventDate(event.startsAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
