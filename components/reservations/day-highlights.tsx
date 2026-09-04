import { Cake, CalendarPlus, PartyPopper, Sparkles, Users } from 'lucide-react'
import Link from 'next/link'
import { CakeChip } from '@/components/reservations/cake-chip'
import { CelebrationChip, ChampagneChip } from '@/components/reservations/celebration-chip'
import { StatusPill } from '@/components/reservations/status-pill'
import type { CelebrationHighlight, DayHighlight, EventHighlight } from '@/lib/salon/day-highlights'
import { cn } from '@/lib/utils'

/**
 * Lo que hay que preparar de este día, en un solo renglón: los eventos
 * programados Y los cumpleaños, al mismo nivel.
 *
 * El dueño lo pidió textual: "debería ser cumpleaños y eventos como si fueran lo
 * mismo, no el cumpleaños dentro del evento". El 21/09 hay Pizza libre y adentro
 * entró un cumple de 15 con torta; como la reserva colgaba del evento, la agenda
 * decía "Pizza libre" y la torta no aparecía en ningún lado. La torta la hace el
 * bar: enterarse el mismo lunes es un moco caro.
 *
 * Sin estado ni handlers: se renderiza igual en un Server Component (la página
 * de Reservas) que dentro del diálogo del calendario.
 */
export function DayHighlights({
  tenantSlug,
  date,
  highlights,
  canBook = true,
  className,
}: {
  tenantSlug: string
  /** yyyy-MM-dd — para el atajo "Reservar" de cada evento. */
  date: string
  highlights: DayHighlight[]
  /** El botón "Reservar" de cada evento. Se apaga donde no corresponde. */
  canBook?: boolean
  className?: string
}) {
  if (highlights.length === 0) return null

  const celebrations = highlights.filter((h) => h.kind !== 'event').length
  const events = highlights.length - celebrations

  return (
    <section className={cn('space-y-2', className)} aria-label="Lo que pasa este día">
      <header className="flex items-baseline justify-between gap-2 px-0.5">
        <h3 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Sparkles className="size-3" aria-hidden />
          Lo que pasa este día
        </h3>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {[
            events > 0 ? `${events} ${events === 1 ? 'evento' : 'eventos'}` : null,
            celebrations > 0
              ? `${celebrations} ${celebrations === 1 ? 'festejo' : 'festejos'}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </header>

      <ul className="space-y-1.5">
        {highlights.map((h) =>
          h.kind === 'event' ? (
            <li key={h.key}>
              <EventCard tenantSlug={tenantSlug} date={date} event={h} canBook={canBook} />
            </li>
          ) : (
            <li key={h.key}>
              <CelebrationCard tenantSlug={tenantSlug} celebration={h} />
            </li>
          ),
        )}
      </ul>
    </section>
  )
}

function EventCard({
  tenantSlug,
  date,
  event,
  canBook,
}: {
  tenantSlug: string
  date: string
  event: EventHighlight
  canBook: boolean
}) {
  const full = event.capacity > 0 && event.used >= event.capacity
  return (
    <div
      className="card-hairline flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 py-2 pl-3 pr-2"
      // La franja del color del formato: es como el dueño reconoce sus eventos
      // en el calendario, así que acá tiene que ser la misma pista.
      style={{ boxShadow: `inset 3px 0 0 ${event.colorHex}` }}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: event.colorHex }}
      />
      <Link
        href={`/${tenantSlug}/eventos/programados/${event.id}`}
        className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline"
      >
        {event.title}
      </Link>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {event.time}
      </span>
      <span
        className={cn(
          'shrink-0 font-mono text-[11px] tabular-nums',
          // `text-warning` pelado sobre la card no llega a AA en claro: el
          // patrón de la casa es el token de texto sobre su propio fondo.
          full
            ? 'rounded-full bg-warning/15 px-1.5 font-semibold text-warning-foreground'
            : 'text-muted-foreground',
        )}
      >
        {event.used}/{event.capacity}
      </span>
      {canBook ? (
        <Link
          href={`/${tenantSlug}/reservas/nuevo?date=${date}&event=${event.id}`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs font-medium transition-colors hover:bg-secondary"
        >
          <CalendarPlus className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Reservar</span>
        </Link>
      ) : null}
    </div>
  )
}

function CelebrationCard({
  tenantSlug,
  celebration: c,
}: {
  tenantSlug: string
  celebration: CelebrationHighlight
}) {
  const isBirthday = c.kind === 'birthday'
  const Icon = isBirthday ? Cake : PartyPopper

  return (
    <Link
      href={`/${tenantSlug}/reservas/${c.id}`}
      className={cn(
        'card-hairline block rounded-xl border p-3 transition-colors duration-[var(--duration-fast)]',
        // Más presencia que un evento a propósito: es lo que hoy se pasa por alto.
        isBirthday
          ? 'border-primary/35 bg-primary/[0.06] hover:bg-primary/10'
          : 'border-info/35 bg-info/[0.06] hover:bg-info/10',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            'mt-px flex size-7 shrink-0 items-center justify-center rounded-lg',
            isBirthday ? 'bg-primary/15 text-primary' : 'bg-info/15 text-info',
          )}
        >
          <Icon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <CelebrationChip kind={isBirthday ? 'birthday' : 'special'} />
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {c.time}
            </span>
          </div>
          <p className="truncate font-medium leading-snug">{c.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" aria-hidden />
              <span className="font-mono tabular-nums">{c.guests}</span>
            </span>
            <span aria-hidden>·</span>
            <span>{c.zoneLabel}</span>
            {/* El dato que se perdía: viene al evento, pero ES un cumpleaños. */}
            {c.eventName ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  {c.eventColorHex ? (
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: c.eventColorHex }}
                    />
                  ) : null}
                  en {c.eventName}
                </span>
              </>
            ) : null}
          </p>
          {c.cakeCount > 0 || c.champagneCount > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <CakeChip count={c.cakeCount} option={c.cake} />
              <ChampagneChip count={c.champagneCount} />
            </div>
          ) : null}
        </div>

        <StatusPill status={c.status} />
      </div>
    </Link>
  )
}
