'use client'

import { ArrowRight, Lock } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/lib/format/number-kind'
import { eventInk } from '@/lib/salon/event-ink'
import type { EventMarketingRow, MarketingPhase } from '@/lib/salon/event-marketing'
import type { ReportBlock } from '@/lib/salon/events-report'
import { PRIVATE_BLOCK_NOTE, PRIVATE_GROUP_CHIP } from '@/lib/salon/private-groups'
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
 * protagonista (tarjeta del kit) y "Sin evento" pesa menos (solo el pelo, sobre
 * el papel) — salvo cuando no hay evento, y ahí la franja se promueve.
 *
 * El color del evento va en un punto al lado del nombre (continuidad con el
 * calendario) y en la tinta del muro (`.ev-ink`), no en un borde de color a la
 * izquierda (kit §1.3).
 */

function avgText(avg: number | null): string {
  if (avg === null) return '—'
  return formatNumber(avg, 1)
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
      <p className="type-caption text-muted-foreground">
        Ninguna mesa se cerró, así que todavía no hay nada contado.
      </p>
    )
  }

  if (countedTables < reservations) {
    const faltan = reservations - countedTables
    return (
      <p className="type-caption text-muted-foreground">
        Contamos <span className="font-medium text-foreground">{formatNumber(attendedGuests)}</span>{' '}
        {plural(attendedGuests, 'persona', 'personas')} en {countedTables} de {reservations} mesas.
        Las otras <span className="text-warning-text">{faltan}</span> quedaron sin cerrar.
      </p>
    )
  }

  // Cobertura completa: recién acá el delta contra lo reservado significa algo,
  // y va como diferencia absoluta, nunca como porcentaje.
  const diff = attendedGuests - guests
  return (
    <p className="type-caption text-muted-foreground">
      Vinieron <span className="font-medium text-foreground">{formatNumber(attendedGuests)}</span>
      {diff === 0
        ? ', los que estaban reservados.'
        : diff > 0
          ? ` · ${diff} ${plural(diff, 'más de la reservada', 'más de las reservadas')}.`
          : ` · ${Math.abs(diff)} ${plural(Math.abs(diff), 'menos de la reservada', 'menos de las reservadas')}.`}
    </p>
  )
}

/**
 * Un número de la ficha: un par `<dt>`/`<dd>` (el lector oye rótulo, valor y
 * pista; a la vista va primero el número). Tres en fila también en el celular:
 * el `KPIGroup` del kit los apila de a uno debajo de `md`, y acá son tres
 * cifras cortas que se comparan entre sí.
 */
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
    <div className="flex min-w-0 flex-col px-3 first:pl-0 last:pr-0">
      <dt className="order-2 mt-2 type-label text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'order-1',
          // Fraunces a 520 (el peso de los números del kit), del tamaño que pidió
          // el dueño: la ficha protagonista más grande que la franja.
          'font-display leading-none font-[520] tracking-[-0.01em]',
          big ? 'text-4xl sm:text-5xl' : 'text-2xl sm:text-3xl',
          muted && 'text-muted-foreground',
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="order-3 mt-1 type-caption text-muted-foreground">{hint}</dd> : null}
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
        'ev-ink relative min-w-0 rounded-xl border border-border text-card-foreground',
        big ? 'bg-card p-4 sm:p-6' : 'bg-transparent p-4 sm:p-5',
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          {eyebrow}
          {/* El color del evento, como en el calendario. Inline porque el hex es dato. */}
          {block.colorHex ? (
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: block.colorHex }}
            />
          ) : null}
          <h3 className={cn('min-w-0 truncate', big ? 'type-subtitle' : 'type-body font-semibold')}>
            {block.title}
          </h3>
          {hora ? (
            <span className="shrink-0 type-small type-amount text-muted-foreground">{hora}</span>
          ) : null}
          {/* Grupo privado (C1): su gente es de la noche, pero no es un evento.
              Etiqueta gris con candado, sin link a «Por evento», sin pauta ni cuenta. */}
          {block.kind === 'private' ? (
            <Badge icon={Lock} className="shrink-0">
              {PRIVATE_GROUP_CHIP}
            </Badge>
          ) : null}
        </div>
        {eventHref ? (
          <Link
            href={eventHref}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm type-small font-medium text-muted-foreground underline-offset-[3px] outline-offset-2 outline-(--ring) hover:text-foreground hover:underline focus-visible:outline-2 pointer-fine:min-h-0"
          >
            {linkLabel}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </header>

      {block.kind === 'private' ? (
        <p className="-mt-3 mb-4 type-caption text-muted-foreground">{PRIVATE_BLOCK_NOTE}</p>
      ) : null}

      {vacio ? (
        <p className="type-body text-muted-foreground">
          {emptyText ??
            (block.kind === 'plain'
              ? 'No hubo ninguna reserva normal esa noche.'
              : 'Nadie reservó para este evento.')}
        </p>
      ) : cayoEntera ? (
        <p className="type-body text-muted-foreground">
          Se cayó entera: {caidasTexto}. No quedó ninguna reserva en pie.
        </p>
      ) : (
        <>
          <dl className="flex divide-x divide-border">
            <Metric
              big={big}
              value={formatNumber(block.guests)}
              label="Personas"
              hint={cupoTexto}
            />
            <Metric
              big={big}
              value={formatNumber(block.reservations)}
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
          </dl>

          <div className="mt-5 space-y-2 border-t border-border pt-4">
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
          // `billableGuests` y `attendedGuests` son con lo que se multiplica la
          // plata de la noche (lo contado al cerrar cada mesa, y lo reservado en
          // las que quedaron sin cerrar): viajan desde el mismo agregador que
          // los tres números de arriba, no se recalculan acá.
          block={{
            reservations: block.reservations,
            guests: block.guests,
            billableGuests: block.billableGuests,
            attendedGuests: block.attendedGuests,
          }}
          row={marketing.row}
          lastUsdArsRate={marketing.lastUsdArsRate}
        />
      ) : null}
    </section>
  )
}
