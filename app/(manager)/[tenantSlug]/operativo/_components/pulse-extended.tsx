'use client'

import { Cake, Keyboard, MousePointerClick, PartyPopper } from 'lucide-react'
import { useId } from 'react'
import { SEGMENT_TONE_CLASSES, SegmentBar } from '@/components/reservations/segment-meter'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { KbdShortcut } from '@/components/ui/kbd-shortcut'
import { formatNumber } from '@/lib/format/number-kind'
import type { DayHighlight } from '@/lib/salon/day-highlights'
import { zoneBreakdown } from '@/lib/salon/event-floor'
import type { NightPulse } from '@/lib/salon/operativo'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { type DaySegments, SEGMENT_KEYS, type SegmentKey } from '@/lib/salon/segments'
import {
  SEGMENT_WITH_ARTICLE,
  segmentAriaLabel,
  segmentHeadline,
  segmentStatusLine,
  segmentTone,
} from '@/lib/salon/segments-copy'
import { type DayCapacityBucket, describeCake, type ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * Lo que ocupa el aside de desktop cuando no hay una reserva elegida: el
 * "pulso extendido" — ocupación por servicio, eventos con su cupo, tortas a
 * preparar y cumpleaños. Es el pre-servicio del dueño, a un vistazo.
 *
 * La ocupación es POR SERVICIO (la misma cuenta que el calendario). Las
 * plantas van sin denominador: el tope por planta era del día entero y mezclaba
 * el almuerzo con la cena, el mismo defecto que el "171 de 130".
 *
 * Una sola tarjeta: adentro, bloques separados por aire y títulos chicos (sin
 * tarjetas anidadas).
 */
export function PulseExtended({
  pulse,
  reservations,
  capacity,
  segments,
  focus,
  events,
  highlights,
  isToday,
}: {
  pulse: NightPulse
  reservations: ReservationWithJoins[]
  /** Solo para las barras por evento (bucket event:*). */
  capacity: DayCapacityBucket[]
  segments: DaySegments
  /** El servicio en juego (el del reloj hoy; la cena si se mira otro día). */
  focus: SegmentKey
  events: ScheduledEventWithTemplate[]
  highlights: DayHighlight[]
  isToday: boolean
}) {
  // Una fila por servicio con algo, más el del reloj aunque esté vacío (dice
  // cuánto entra todavía).
  const services = SEGMENT_KEYS.filter((k) => k === focus || segments.segments[k].hasActivity).map(
    (k) => segments.segments[k],
  )
  const focusLoad = segments.segments[focus]
  // "En la cena: Planta Alta 44 · Planta Baja 26 · Sin ubicar 22". La gente
  // de un evento con planta elegida cuenta en su planta; el tercer grupo es
  // solo la de evento sin planta (antes decía "En eventos" y se leía como el
  // total de los eventos, que ya no es).
  const zoneLine = focusLoad.people > 0 ? zoneBreakdown(focusLoad.byZone) : null
  const cakes = highlights.filter((h) => h.kind !== 'event' && h.cakeCount > 0)
  const birthdays = highlights.filter((h) => h.kind === 'birthday')
  const withTable = reservations.filter(
    (r) => (r.status === 'arrived' || r.status === 'seated') && r.table_label,
  )
  const ids = useId()

  return (
    <Card className="gap-5">
      <div>
        <h2 className="type-label text-muted-foreground">{isToday ? 'La noche' : 'El día'}</h2>
        {/* Cifras en Inter tabular: cambian en vivo con Realtime. */}
        <p className="mt-1 type-body text-muted-foreground">
          <strong className="text-2xl font-semibold text-foreground type-amount">
            {formatNumber(pulse.reservations)}
          </strong>{' '}
          {pulse.reservations === 1 ? 'reserva' : 'reservas'} ·{' '}
          <strong className="font-semibold text-foreground type-amount">
            {formatNumber(pulse.covers)}
          </strong>{' '}
          cubiertos
        </p>
      </div>

      <section aria-label="Ocupación por servicio" className="flex flex-col gap-3">
        {services.map((s) => {
          const tone = segmentTone(s)
          const alert = tone === 'warn' || tone === 'over'
          return (
            <div key={s.key} title={segmentAriaLabel(s, '')}>
              <div className="flex items-baseline justify-between gap-2 type-body">
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    alert && SEGMENT_TONE_CLASSES[tone].text,
                  )}
                >
                  {segmentHeadline(s, 'long')}
                </span>
                {isToday && s.key === focus ? <Badge tone="brand">Ahora</Badge> : null}
              </div>
              <SegmentBar segment={s} size="sm" className="mt-1" />
              <p
                className={cn(
                  'mt-1 type-caption',
                  alert ? SEGMENT_TONE_CLASSES[tone].text : 'text-muted-foreground',
                  tone === 'over' && 'font-semibold',
                )}
              >
                {segmentStatusLine(s)}
              </p>
            </div>
          )
        })}
        {zoneLine ? (
          <p className="type-caption text-muted-foreground tabular-nums">
            {`En ${SEGMENT_WITH_ARTICLE[focus]}: ${zoneLine}`}
          </p>
        ) : null}
        {events.map((e) => {
          const bucket = capacity.find((b) => b.bucket === `event:${e.id}`)
          const used = bucket?.used ?? 0
          const pct = e.capacity > 0 ? Math.min(100, (used / e.capacity) * 100) : 0
          const full = e.capacity > 0 && used >= e.capacity
          const color = e.template?.color_hex ?? 'var(--primary)'
          return (
            <div key={e.id}>
              <div className="flex items-baseline justify-between gap-2 type-body">
                <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">
                    {e.name_override ?? e.template?.name ?? 'Evento'}
                  </span>
                  <span className="type-caption font-normal text-muted-foreground type-amount">
                    {e.starts_at_local.slice(0, 5)}
                  </span>
                </span>
                <span
                  className={cn(
                    'type-caption text-muted-foreground type-amount',
                    full && 'font-semibold text-warning-text',
                  )}
                >
                  {used}/{e.capacity}
                  {full ? ' · lleno' : ''}
                </span>
              </div>
              {/* El color del evento es un dato (la tinta de su plantilla), por eso
                  la barra es propia y no un `Progress` del kit. */}
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full w-full rounded-full transition-transform duration-220 ease-ui motion-reduce:transition-none"
                  style={{ transform: `translateX(-${100 - pct}%)`, backgroundColor: color }}
                />
              </div>
            </div>
          )
        })}
      </section>

      {cakes.length > 0 ? (
        <section aria-labelledby={`${ids}tortas`} className="flex flex-col gap-2">
          <h3
            id={`${ids}tortas`}
            className="flex items-center gap-1.5 type-label text-muted-foreground"
          >
            <Cake className="size-3.5 text-warning-text" aria-hidden="true" />
            Tortas
          </h3>
          <ul className="flex flex-col gap-1.5 type-body">
            {cakes.map((c) =>
              c.kind === 'event' ? null : (
                <li key={c.key} className="flex items-start gap-2">
                  <span className="w-11 shrink-0 pt-0.5 type-caption text-muted-foreground type-amount">
                    {c.time}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.title}</span>
                    <span
                      className={cn(
                        'block type-caption',
                        c.cake ? 'text-muted-foreground' : 'text-warning-text',
                      )}
                    >
                      {c.cakeCount > 1 ? `${c.cakeCount} × ` : ''}
                      {c.cake ? describeCake(c.cake) : 'falta elegir el sabor'}
                    </span>
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {birthdays.length > 0 ? (
        <section aria-labelledby={`${ids}cumples`} className="flex flex-col gap-2">
          <h3
            id={`${ids}cumples`}
            className="flex items-center gap-1.5 type-label text-muted-foreground"
          >
            <PartyPopper className="size-3.5 text-primary" aria-hidden="true" />
            Cumpleaños
          </h3>
          <ul className="flex flex-col gap-1 type-body">
            {birthdays.map((b) =>
              b.kind === 'event' ? null : (
                <li key={b.key} className="flex items-center gap-2">
                  <span className="w-11 shrink-0 type-caption text-muted-foreground type-amount">
                    {b.time}
                  </span>
                  <span className="truncate font-medium">{b.title}</span>
                  <span className="shrink-0 type-caption text-muted-foreground tabular-nums">
                    · {b.guests} pers · {b.zoneLabel}
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {withTable.length > 0 ? (
        <section aria-labelledby={`${ids}salon`} className="flex flex-col gap-2">
          <h3 id={`${ids}salon`} className="type-label text-muted-foreground">
            Salón armado
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {withTable
              .slice()
              .sort((a, b) =>
                (a.table_label ?? '').localeCompare(b.table_label ?? '', 'es-AR', {
                  numeric: true,
                }),
              )
              .map((r) => (
                <li key={r.id}>
                  <Badge tone="success" size="md" title={r.guest_name}>
                    <span className="font-semibold">{r.table_label}</span>
                    <span className="max-w-[7rem] truncate font-normal">
                      {r.guest_name.split(' ')[0]}
                    </span>
                  </Badge>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-1.5 rounded-lg bg-muted p-3 type-caption text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <MousePointerClick className="size-3.5 shrink-0" aria-hidden="true" />
          Tocá una reserva para ver su ficha acá.
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Keyboard className="size-3.5 shrink-0" aria-hidden="true" />
          <KbdShortcut keys={['/']} /> buscar
          <KbdShortcut keys={['up']} />
          <KbdShortcut keys={['down']} /> recorrer
          <KbdShortcut keys={['enter']} /> abrir
          <KbdShortcut keys={['esc']} /> cerrar
        </p>
      </div>
    </Card>
  )
}
