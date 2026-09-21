'use client'

import { Cake, Keyboard, MousePointerClick, PartyPopper } from 'lucide-react'
import { SEGMENT_TONE_CLASSES, SegmentBar } from '@/components/reservations/segment-meter'
import { Kbd } from '@/components/ui/kbd'
import type { DayHighlight } from '@/lib/salon/day-highlights'
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
import {
  type DayCapacityBucket,
  describeCake,
  type ReservationWithJoins,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/** Cómo se nombra cada zona física en la línea "En la cena: …" (sin denominador). */
const ZONE_LINE_LABELS = {
  planta_alta: ZONE_LABELS.planta_alta,
  planta_baja: ZONE_LABELS.planta_baja,
  event_floating: 'En eventos',
} as const

/**
 * Lo que ocupa el aside de desktop cuando no hay una reserva elegida: el
 * "pulso extendido" — ocupación por servicio, eventos con su cupo, tortas a
 * preparar y cumpleaños. Es el pre-servicio del dueño, a un vistazo.
 *
 * La ocupación es POR SERVICIO (la misma cuenta que el calendario). Las
 * plantas van sin denominador: el tope por planta era del día entero y mezclaba
 * el almuerzo con la cena, el mismo defecto que el "171 de 130".
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
  // "En la cena: Planta Alta 44 · Planta Baja 26 · En eventos 22". Las dos
  // plantas siempre (que abajo haya 0 también sirve para sentar); los eventos
  // solo si tienen gente.
  const zoneLine =
    focusLoad.people > 0
      ? (['planta_alta', 'planta_baja', 'event_floating'] as const)
          .filter((z) => z !== 'event_floating' || focusLoad.byZone[z] > 0)
          .map((z) => `${ZONE_LINE_LABELS[z]} ${focusLoad.byZone[z]}`)
          .join(' · ')
      : null
  const cakes = highlights.filter((h) => h.kind !== 'event' && h.cakeCount > 0)
  const birthdays = highlights.filter((h) => h.kind === 'birthday')
  const withTable = reservations.filter(
    (r) => (r.status === 'arrived' || r.status === 'seated') && r.table_label,
  )

  return (
    <div className="card-hairline space-y-5 rounded-2xl border bg-card p-5 shadow-xs">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {isToday ? 'La noche' : 'El día'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <strong className="font-serif text-2xl font-semibold text-foreground tabular-nums">
            {pulse.reservations}
          </strong>{' '}
          {pulse.reservations === 1 ? 'reserva' : 'reservas'} ·{' '}
          <strong className="font-semibold text-foreground tabular-nums">{pulse.covers}</strong>{' '}
          cubiertos
        </p>
      </div>

      <section aria-label="Ocupación por servicio" className="space-y-2.5">
        {services.map((s) => {
          const tone = segmentTone(s)
          const alert = tone === 'warn' || tone === 'over'
          return (
            <div key={s.key} title={segmentAriaLabel(s, '')}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    alert && SEGMENT_TONE_CLASSES[tone].text,
                  )}
                >
                  {segmentHeadline(s, 'long')}
                </span>
                {isToday && s.key === focus ? (
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Ahora
                  </span>
                ) : null}
              </div>
              <SegmentBar segment={s} size="sm" className="mt-1" />
              <p
                className={cn(
                  'mt-1 text-xs',
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
          <p className="text-xs tabular-nums text-muted-foreground">
            {`En ${SEGMENT_WITH_ARTICLE[focus]}: ${zoneLine}`}
          </p>
        ) : null}
        {events.map((e) => {
          const bucket = capacity.find((b) => b.bucket === `event:${e.id}`)
          const used = bucket?.used ?? 0
          const pct = e.capacity > 0 ? Math.min(100, (used / e.capacity) * 100) : 0
          const full = e.capacity > 0 && used >= e.capacity
          return (
            <div key={e.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: e.template?.color_hex ?? 'var(--primary)' }}
                  />
                  <span className="truncate">
                    {e.name_override ?? e.template?.name ?? 'Evento'}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {e.starts_at_local.slice(0, 5)}
                  </span>
                </span>
                <span
                  className={cn(
                    'font-mono text-xs tabular-nums text-muted-foreground',
                    full && 'font-semibold text-warning-text',
                  )}
                >
                  {used}/{e.capacity}
                  {full ? ' · lleno' : ''}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full transition-[width] duration-(--duration-slower) ease-(--ease-out)"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: e.template?.color_hex ?? 'var(--primary)',
                  }}
                />
              </div>
            </div>
          )
        })}
      </section>

      {cakes.length > 0 ? (
        <section aria-label="Tortas a preparar">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <Cake className="size-3.5 text-warning" aria-hidden />
            Tortas
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {cakes.map((c) =>
              c.kind === 'event' ? null : (
                <li key={c.key} className="flex items-start gap-2">
                  <span className="w-11 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {c.time}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.title}</span>
                    <span className="block text-xs text-muted-foreground">
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
        <section aria-label="Cumpleaños">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <PartyPopper className="size-3.5 text-primary" aria-hidden />
            Cumpleaños
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {birthdays.map((b) =>
              b.kind === 'event' ? null : (
                <li key={b.key} className="flex items-center gap-2">
                  <span className="w-11 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {b.time}
                  </span>
                  <span className="truncate font-medium">{b.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    · {b.guests} pers · {b.zoneLabel}
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {withTable.length > 0 ? (
        <section aria-label="Mesas ocupadas">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Salón armado
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {withTable
              .slice()
              .sort((a, b) =>
                (a.table_label ?? '').localeCompare(b.table_label ?? '', 'es-AR', {
                  numeric: true,
                }),
              )
              .map((r) => (
                <li
                  key={r.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/8 px-2.5 py-1 text-xs"
                  title={r.guest_name}
                >
                  <span className="font-serif text-sm font-semibold">{r.table_label}</span>
                  <span className="max-w-[7rem] truncate text-muted-foreground">
                    {r.guest_name.split(' ')[0]}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <div className="rounded-xl bg-secondary/50 p-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <MousePointerClick className="size-3.5" aria-hidden />
          Tocá una reserva para ver su ficha acá.
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Keyboard className="size-3.5" aria-hidden />
          <Kbd>/</Kbd> buscar <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> recorrer <Kbd>↵</Kbd> abrir <Kbd>Esc</Kbd> cerrar
        </p>
      </div>
    </div>
  )
}
