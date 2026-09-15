'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { eventInk } from '@/lib/salon/event-ink'
import type { EventMarketingRow, MarketingPhase } from '@/lib/salon/event-marketing'
import type { ReportBlock } from '@/lib/salon/events-report'
import { cn } from '@/lib/utils'
import { EventMarketingSection } from './event-marketing-section'
import { TablesWall } from './tables-wall'

/** Lo que la ficha necesita para dibujar «Pauta en Meta». Sin esto, no hay sección. */
export type NightCardMarketing = {
  tenantSlug: string
  /** `YYYY-MM-DD` de la edición. */
  eventDate: string
  phase: MarketingPhase
  row: EventMarketingRow | null
  lastUsdArsRate: { rate: number; loadedAt: string } | null
}

/**
 * La ficha de un bloque de la noche: el evento, o las reservas normales.
 *
 * Los tres números que pidió el dueño, del tamaño que merecen, y todo lo demás
 * en gris y chico. La jerarquía sale de su propio pedido: escribió cuatro datos
 * para el evento y dos para las reservas normales, así que el evento es ficha
 * protagonista y "Sin evento" pesa menos — salvo cuando no hay evento, y ahí la
 * franja se promueve.
 */

const nf = new Intl.NumberFormat('es-AR')

function avgText(avg: number | null): string {
  if (avg === null) return '—'
  return avg.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** `21:00:00` → `21:00`. */
function hhmm(time: string | null): string | null {
  return time ? time.slice(0, 5) : null
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/**
 * Qué se sabe de la gente que realmente vino.
 *
 * `actual_guests` en NULL no es un campo que alguien se olvidó de llenar: es
 * una mesa que nunca se cerró. La copy lo dice con esas palabras, y el número
 * de mesas sin cerrar va en ámbar para que salte sin gritar. Nunca un
 * porcentaje: el numerador está casi siempre incompleto y el ratio real se
 * pasa de 100 (hubo noches en que se sentó más gente de la reservada).
 */
function AttendanceLine({ block }: { block: ReportBlock }) {
  const { reservations, countedTables, attendedGuests, guests } = block
  if (reservations === 0) return null

  if (countedTables === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Ninguna mesa se cerró, así que todavía no hay nada contado.
      </p>
    )
  }

  if (countedTables < reservations) {
    const faltan = reservations - countedTables
    return (
      <p className="text-xs text-muted-foreground">
        Contamos <span className="font-medium text-foreground">{nf.format(attendedGuests)}</span>{' '}
        {plural(attendedGuests, 'persona', 'personas')} en {countedTables} de {reservations} mesas.
        Las otras <span className="text-warning-text">{faltan}</span> quedaron sin cerrar.
      </p>
    )
  }

  // Cobertura completa: recién acá el delta contra lo reservado significa algo,
  // y va como diferencia absoluta, nunca como porcentaje.
  const diff = attendedGuests - guests
  return (
    <p className="text-xs text-muted-foreground">
      Vinieron <span className="font-medium text-foreground">{nf.format(attendedGuests)}</span>
      {diff === 0
        ? ', los que estaban reservados.'
        : diff > 0
          ? ` · ${diff} ${plural(diff, 'más de la reservada', 'más de las reservadas')}.`
          : ` · ${Math.abs(diff)} ${plural(Math.abs(diff), 'menos de la reservada', 'menos de las reservadas')}.`}
    </p>
  )
}

function Metric({
  value,
  label,
  hint,
  big,
  muted,
}: {
  value: string
  label: string
  hint?: ReactNode
  big: boolean
  muted?: boolean
}) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <div
        className={cn(
          'font-serif font-semibold leading-none tracking-tight tabular-nums',
          big ? 'text-4xl sm:text-5xl' : 'text-2xl sm:text-3xl',
          muted && 'text-muted-foreground',
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      {hint ? (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  )
}

export function NightCard({
  block,
  tone,
  eyebrow,
  dayShare,
  eventHref,
  linkLabel = 'Ver todas sus fechas',
  emptyText,
  marketing,
  className,
}: {
  block: ReportBlock
  /** `event` es ficha protagonista; `plain`, la franja de reservas normales. */
  tone: 'event' | 'plain'
  eyebrow?: ReactNode
  /** "53 de las 65 personas de la noche" — solo cuando hay más de un bloque. */
  dayShare?: string
  /** Link a la vista del evento, cuando este bloque es un evento. */
  eventHref?: string
  linkLabel?: string
  /**
   * Qué decir cuando el bloque quedó sin ninguna reserva. Lo decide quien
   * arma la noche: "toda la noche fue del evento" es falso si el evento
   * tampoco vendió nada.
   */
  emptyText?: string
  /**
   * «Pauta en Meta». Solo se dibuja en bloques de evento: "Sin evento" nunca
   * tiene pauta, ni siquiera cuando se promueve a ficha protagonista.
   */
  marketing?: NightCardMarketing
  className?: string
}) {
  const big = tone === 'event'
  const hora = hhmm(block.startsAtLocal)
  const cayoEntera = block.reservations === 0 && block.cancelled + block.noShow > 0
  const vacio = block.reservations === 0 && block.cancelled + block.noShow === 0

  const caidasTexto =
    block.cancelled > 0 && block.noShow > 0
      ? `${block.cancelled} ${plural(block.cancelled, 'cancelada', 'canceladas')} · ${block.noShow} no ${plural(block.noShow, 'vino', 'vinieron')} (${block.fallenGuests} personas)`
      : block.cancelled > 0
        ? `${block.cancelled} ${plural(block.cancelled, 'cancelada', 'canceladas')} (${block.fallenGuests} ${plural(block.fallenGuests, 'persona', 'personas')})`
        : block.noShow > 0
          ? `${block.noShow} no ${plural(block.noShow, 'vino', 'vinieron')} (${block.fallenGuests} ${plural(block.fallenGuests, 'persona', 'personas')})`
          : null

  const cupoTexto = block.capacity
    ? block.guests > block.capacity
      ? `${block.guests} de ${block.capacity} lugares · se pasó`
      : `de ${block.capacity} lugares`
    : dayShare

  const promedioHint =
    block.reservations === 1
      ? 'una sola mesa'
      : block.minParty !== null && block.maxParty !== null && block.minParty !== block.maxParty
        ? `de ${block.minParty} a ${block.maxParty} por mesa`
        : block.minParty !== null
          ? `todas de ${block.minParty}`
          : undefined

  // La tinta del evento: su tono, domado para que se lea sobre la ficha en los
  // dos temas. Sin color (o "Sin evento") no hay variables y `.ev-ink` cae al
  // verde de la casa.
  const ink = eventInk(block.colorHex)

  return (
    <section
      style={ink ? ({ '--ev-l': ink.light, '--ev-d': ink.dark } as CSSProperties) : undefined}
      className={cn(
        'ev-ink relative overflow-hidden rounded-xl border',
        big
          ? 'card-hairline border-primary/50 bg-primary/5 p-5 sm:p-6'
          : 'border-border/70 bg-card/60 p-4 sm:p-5',
        className,
      )}
    >
      {/* Franja del color del evento: continuidad con el calendario, sin
          inventar una paleta nueva. Va inline porque el hex es dato. */}
      {block.colorHex ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: block.colorHex }}
        />
      ) : null}

      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          {eyebrow}
          <h3
            className={cn(
              'min-w-0 truncate font-serif font-semibold tracking-tight',
              big ? 'text-lg' : 'text-base',
            )}
          >
            {block.title}
          </h3>
          {hora ? (
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {hora}
            </span>
          ) : null}
        </div>
        {eventHref ? (
          <Link
            href={eventHref}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {linkLabel}
            <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </header>

      {vacio ? (
        <p className="text-sm text-muted-foreground">
          {emptyText ??
            (block.kind === 'plain'
              ? 'No hubo ninguna reserva normal esa noche.'
              : 'Nadie reservó para este evento.')}
        </p>
      ) : cayoEntera ? (
        <p className="text-sm text-muted-foreground">
          Se cayó entera: {caidasTexto}. No quedó ninguna reserva en pie.
        </p>
      ) : (
        <>
          <div className="flex divide-x divide-border/60">
            <Metric big={big} value={nf.format(block.guests)} label="Personas" hint={cupoTexto} />
            <Metric
              big={big}
              value={nf.format(block.reservations)}
              label="Reservas"
              hint={caidasTexto}
            />
            <Metric
              big={big}
              value={avgText(block.avg)}
              label="Por reserva"
              hint={promedioHint}
              // Un promedio de una sola mesa no es un promedio, y la tipografía
              // tiene que decirlo antes que el texto chico.
              muted={block.reservations === 1}
            />
          </div>

          <div className="mt-5 space-y-2 border-t border-border/50 pt-4">
            <TablesWall
              key={block.key}
              tables={block.tables}
              title={block.kind === 'plain' ? 'las reservas sin evento' : block.title}
            />
            <AttendanceLine block={block} />
          </div>
        </>
      )}

      {/* Después del muro, o del párrafo de "vacío" / "se cayó entera": una fecha
          sin reservas en pie puede haber tenido pauta, y es justo la que más
          importa ver. `key` por edición: el borrador del form no pasa de un
          evento a otro. */}
      {marketing && block.kind === 'event' && block.eventId ? (
        <EventMarketingSection
          key={block.eventId}
          tenantSlug={marketing.tenantSlug}
          scheduledEventId={block.eventId}
          eventTitle={block.title}
          eventDate={marketing.eventDate}
          phase={marketing.phase}
          block={{ reservations: block.reservations, guests: block.guests }}
          row={marketing.row}
          lastUsdArsRate={marketing.lastUsdArsRate}
        />
      ) : null}
    </section>
  )
}
