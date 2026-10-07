import { Cake, CalendarPlus, PartyPopper, Users } from 'lucide-react'
import Link from 'next/link'
import { CakeChip } from '@/components/reservations/cake-chip'
import { CelebrationChip, ChampagneChip } from '@/components/reservations/celebration-chip'
import { StatusPill } from '@/components/reservations/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { editReservationHref, newReservationHref } from '@/lib/salon/calendar-links'
import type { CelebrationHighlight, DayHighlight, EventHighlight } from '@/lib/salon/day-highlights'
import { cn } from '@/lib/utils'

/** Solo hex: el color viene de la DB y va a un `style`. */
function safeColor(colorHex: string | null | undefined): string {
  return colorHex && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colorHex)
    ? colorHex
    : 'var(--muted-foreground)'
}

/**
 * Lo que hay que preparar de este día, en un solo bloque: los eventos
 * programados Y los cumpleaños, al mismo nivel.
 *
 * El dueño lo pidió textual: "debería ser cumpleaños y eventos como si fueran lo
 * mismo, no el cumpleaños dentro del evento". El 21/09 hay Pizza libre y adentro
 * entró un cumple de 15 con torta; como la reserva colgaba del evento, la agenda
 * decía "Pizza libre" y la torta no aparecía en ningún lado. La torta la hace el
 * bar: enterarse el mismo lunes es un moco caro.
 *
 * Una `Section` del kit con una sola caja y filas (no una tarjeta por ítem).
 * Sin estado ni handlers: es un Server Component de la lista de Reservas. Los
 * links (reservar en el evento, abrir el festejo) no llevan ?volver: al guardar
 * se vuelve a la lista.
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
    <Section
      title="Lo que pasa este día"
      description={[
        events > 0 ? `${events} ${events === 1 ? 'evento' : 'eventos'}` : null,
        celebrations > 0 ? `${celebrations} ${celebrations === 1 ? 'festejo' : 'festejos'}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      className={className}
    >
      <ul className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card">
        {highlights.map((h) =>
          h.kind === 'event' ? (
            <li key={h.key}>
              <EventRow tenantSlug={tenantSlug} date={date} event={h} canBook={canBook} />
            </li>
          ) : (
            <li key={h.key}>
              <CelebrationRow tenantSlug={tenantSlug} celebration={h} />
            </li>
          ),
        )}
      </ul>
    </Section>
  )
}

function EventRow({
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
    <div className="flex min-h-12 items-center gap-3 px-4 py-2">
      {/* El color del formato: es como el dueño reconoce sus eventos en el
          calendario, así que acá tiene que ser la misma pista. */}
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: safeColor(event.colorHex) }}
      />
      <Link
        href={`/${tenantSlug}/eventos/programados/${event.id}`}
        className="min-w-0 flex-1 truncate type-body font-medium underline-offset-[3px] hover:underline"
      >
        {event.title}
      </Link>
      <span className="shrink-0 type-caption tabular-nums text-muted-foreground">{event.time}</span>
      {full ? (
        <Badge tone="warning" title="Evento lleno" className="tabular-nums">
          {event.used}/{event.capacity}
        </Badge>
      ) : (
        <span className="shrink-0 type-caption tabular-nums text-muted-foreground">
          {event.used}/{event.capacity}
        </span>
      )}
      {canBook ? (
        <Button asChild variant="secondary" size="sm" className="shrink-0">
          <Link
            href={newReservationHref(tenantSlug, { date, eventId: event.id })}
            aria-label={`Reservar en ${event.title}`}
          >
            <CalendarPlus aria-hidden />
            <span className="max-sm:sr-only">Reservar</span>
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

function CelebrationRow({
  tenantSlug,
  celebration: c,
}: {
  tenantSlug: string
  celebration: CelebrationHighlight
}) {
  const isSpecial = c.kind === 'special'
  const Icon = isSpecial ? PartyPopper : Cake

  return (
    <Link
      href={editReservationHref(tenantSlug, c.id)}
      className="flex items-start gap-3 px-4 py-3 outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2 active:bg-active"
    >
      <span
        aria-hidden
        className={cn(
          'mt-px flex size-8 shrink-0 items-center justify-center rounded-lg',
          // Más presencia que un evento a propósito: es lo que hoy se pasa por alto.
          isSpecial ? 'bg-info-soft text-info-text' : 'bg-brand-soft text-brand-text',
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CelebrationChip kind={c.kind} />
          <span className="type-caption tabular-nums text-muted-foreground">{c.time}</span>
        </div>
        <p className="mt-0.5 truncate type-body font-medium text-foreground">{c.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 type-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" aria-hidden />
            <span className="tabular-nums">{c.guests}</span>
            <span className="sr-only">{c.guests === 1 ? 'persona' : 'personas'}</span>
          </span>
          <span aria-hidden>·</span>
          <span>{c.zoneLabel}</span>
          {/* El dato que se perdía: viene al evento, pero ES un cumpleaños.
              Sin planta elegida (zona flotante) `zoneLabel` ya ES el nombre
              del evento: repetirlo decía "Pizza libre · en Pizza libre". */}
          {c.eventName && c.eventName !== c.zoneLabel ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                {c.eventColorHex ? (
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: safeColor(c.eventColorHex) }}
                  />
                ) : null}
                en {c.eventName}
              </span>
            </>
          ) : null}
        </p>
        {c.cakeCount > 0 || c.champagneCount > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <CakeChip count={c.cakeCount} option={c.cake} optionId={c.cakeOptionId} />
            <ChampagneChip count={c.champagneCount} />
          </div>
        ) : null}
      </div>

      <StatusPill status={c.status} className="mt-1" />
    </Link>
  )
}
