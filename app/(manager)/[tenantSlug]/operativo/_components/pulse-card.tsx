'use client'

import { Cake, PartyPopper, Sparkles, TrendingUp } from 'lucide-react'
import { useInView } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { SEGMENT_TONE_CLASSES, SegmentChip } from '@/components/reservations/segment-meter'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { FilterChip } from '@/components/ui/filter-chip'
import { formatNumber } from '@/lib/format/number-kind'
import type { DayHighlight } from '@/lib/salon/day-highlights'
import { type BoardFilter, type NightPulse, serviceMinutes } from '@/lib/salon/operativo'
import { type DaySegments, SEGMENT_KEYS, type SegmentKey } from '@/lib/salon/segments'
import {
  SEGMENT_SHORT_LABELS,
  segmentAriaLabel,
  segmentStatusLine,
  segmentTone,
} from '@/lib/salon/segments-copy'
import { coversOf, occupiesTable } from '@/lib/salon/services'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const SLOT_MINUTES = 30
const ASSUMED_STAY = 90

type Slot = { start: number; label: string; covers: number; peak: boolean }

/** Minutos del reloj del servicio → 'HH:MM' legible (1470 → "00:30"). */
function clockLabel(minutes: number): string {
  const h = Math.floor((minutes % (24 * 60)) / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * La hora pico: la franja de 60′ con más gente a la vez, leída de la misma
 * ocupación por 30′ que dibuja el sparkline (así los dos cuentan lo mismo).
 */
function peakFromSlots(slots: Slot[]): { start: number; guests: number } | null {
  if (slots.length === 0) return null
  let best: { start: number; guests: number } | null = null
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i]?.covers ?? 0
    const b = slots[i + 1]?.covers ?? 0
    const guests = Math.max(a, b)
    if (!best || guests > best.guests) best = { start: slots[i]?.start ?? 0, guests }
  }
  return best
}

/**
 * Ocupación estimada cada 30 minutos, con la misma suposición que el pico
 * (cada mesa se queda 90'): es lo que dibuja el sparkline.
 */
function occupancySlots(rows: ReservationWithJoins[], peakStart: number | null): Slot[] {
  const active = rows.filter((r) => occupiesTable(r))
  if (active.length === 0) return []
  const starts = active.map((r) => serviceMinutes(r.reservation_time_local))
  const from = Math.floor(Math.min(...starts) / SLOT_MINUTES) * SLOT_MINUTES
  const to = Math.max(...starts) + ASSUMED_STAY
  const slots: Slot[] = []
  for (let t = from; t < to; t += SLOT_MINUTES) {
    let covers = 0
    for (const r of active) {
      const s = serviceMinutes(r.reservation_time_local)
      if (s <= t && s + ASSUMED_STAY > t) covers += coversOf(r)
    }
    const hh = Math.floor((t % (24 * 60)) / 60)
    const mm = t % 60
    slots.push({
      start: t,
      label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      covers,
      peak: peakStart !== null && t >= peakStart && t < peakStart + 60,
    })
  }
  return slots
}

/**
 * "¿Cómo viene la noche?" en una sola lectura: cuánta gente ya entró sobre la
 * que reservó, en qué momento se llena, y qué hay que preparar (eventos,
 * tortas, cumples). Todo sale del array vivo, así que late con el salón.
 *
 * Las píldoras de la leyenda son el alias de los filtros de la lista: tocar
 * "Por llegar" acá es lo mismo que el filtro de abajo.
 *
 * Los números NO se animan (kit: quieto por defecto) y van en Inter tabular:
 * cambian en vivo con Realtime, y las cifras proporcionales de Fraunces
 * bailarían a cada llegada.
 *
 * El cupo se lee POR SERVICIO (el del reloj adelante: "Cena 119/120"), nunca
 * "usado/total del salón": sumar el almuerzo y la cena contra PA + PB daba
 * "171 de 130" en rojo una noche que no tuvo sobrecupo.
 */
export function PulseCard({
  pulse,
  reservations,
  segments,
  focus,
  highlights,
  clock,
  isToday,
  filter,
  onFilter,
  eventFilter,
  onEventFilter,
  onInViewChange,
}: {
  pulse: NightPulse
  reservations: ReservationWithJoins[]
  segments: DaySegments
  /** El servicio en juego (el del reloj hoy; la cena si se mira otro día). */
  focus: SegmentKey
  highlights: DayHighlight[]
  clock: { minutes: number | null; hhmm: string | null }
  isToday: boolean
  filter: BoardFilter
  onFilter: (f: BoardFilter) => void
  eventFilter: string | null
  onEventFilter: (id: string | null) => void
  onInViewChange: (inView: boolean) => void
}) {
  const ref = useRef<HTMLElement>(null)
  // El margen es el alto del topbar (`--topbar-h`, 56 px): lo que queda abajo
  // de él ya no se ve, aunque esté en el viewport.
  const inView = useInView(ref, { margin: '-56px 0px 0px 0px' })
  useEffect(() => onInViewChange(inView), [inView, onInViewChange])

  // El pico sale de la misma ocupación que dibuja el sparkline, en el reloj
  // del servicio: una reserva a las 00:30 se solapa con las de las 23, no con
  // las del desayuno.
  const rawSlots = useMemo(() => occupancySlots(reservations, null), [reservations])
  const peak = useMemo(() => peakFromSlots(rawSlots), [rawSlots])
  const slots = useMemo(
    () =>
      rawSlots.map((sl) => ({
        ...sl,
        peak: peak !== null && sl.start >= peak.start && sl.start < peak.start + 60,
      })),
    [rawSlots, peak],
  )

  const total = pulse.covers + pulse.noShowCovers
  const vinieron = pulse.insideCovers + pulse.closedCovers
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%')
  const lateCovers = useMemo(
    () =>
      reservations
        .filter(
          (r) =>
            r.status === 'pending' &&
            clock.minutes !== null &&
            serviceMinutes(r.reservation_time_local) < clock.minutes - 15,
        )
        .reduce((acc, r) => acc + coversOf(r), 0),
    [reservations, clock.minutes],
  )
  const onTimeWaiting = Math.max(0, pulse.waitingCovers - lateCovers)

  const events = highlights.filter((h) => h.kind === 'event')
  const cakes = highlights.filter((h) => h.kind !== 'event' && h.cakeCount > 0)
  const birthdays = highlights.filter((h) => h.kind === 'birthday')
  const cakeTotal = cakes.reduce((acc, c) => acc + (c.kind !== 'event' ? c.cakeCount : 0), 0)
  // Como `CakeChip`: ámbar mientras falte elegir alguna (es una tarea del bar).
  const pendingCakes = cakes.some((c) => c.kind !== 'event' && !c.cakeOptionId)
  const hasSpecial = highlights.some((h) => h.kind === 'special')

  // El servicio en foco va siempre (aunque esté vacío dice cuánto entra); los
  // otros solo si tienen algo, en chico: "Alm 19 · Mer 33".
  const focusLoad = segments.segments[focus]
  const showFocus = focusLoad.hasActivity || focusLoad.capacity !== null
  const others = SEGMENT_KEYS.filter((k) => k !== focus && segments.segments[k].hasActivity).map(
    (k) => segments.segments[k],
  )
  const focusTone = segmentTone(focusLoad)
  const overCapacity = focusLoad.status === 'over'
  // En ámbar o rojo, el porqué ("Queda 1 lugar", "Te pasaste por 13") va a la
  // vista: en el celu no hay hover para leer el title del chip.
  const focusAlert = focusTone === 'warn' || focusTone === 'over'

  return (
    <Card asChild padding="none" className="relative gap-0 overflow-hidden p-4 sm:p-5">
      <section ref={ref} aria-label="Pulso de la noche">
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-end">
          {/* Héroe: cuánta gente ya entró. */}
          <div>
            <p className="type-label text-muted-foreground">
              {isToday ? 'Adentro ahora' : 'Cubiertos'}
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl leading-none font-semibold tracking-tight type-amount sm:text-6xl">
                {formatNumber(isToday ? pulse.insideCovers : pulse.covers)}
              </span>
              {isToday ? (
                <span className="text-2xl font-medium text-muted-foreground type-amount">
                  / {formatNumber(pulse.covers)}
                </span>
              ) : null}
              <span className="type-body text-muted-foreground">
                {isToday ? 'cubiertos' : 'reservados'}
              </span>
            </div>
            {isToday && pulse.closedCovers > 0 ? (
              <p className="mt-1 type-caption text-muted-foreground tabular-nums">
                {vinieron} vinieron en total · {pulse.closedCovers} ya se fueron
              </p>
            ) : null}

            {/* Barra apilada en cubiertos: adentro · atrasados · por llegar · no vinieron. */}
            <div
              className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-secondary"
              role="img"
              aria-label={`${pulse.insideCovers} adentro, ${pulse.closedCovers} ya se fueron, ${
                pulse.waitingCovers
              } por llegar${lateCovers > 0 ? ` (${lateCovers} atrasados)` : ''}, ${
                pulse.noShowCovers
              } no vinieron`}
            >
              <Segment width={pct(pulse.insideCovers)} className="bg-success" />
              <Segment width={pct(pulse.closedCovers)} className="bg-success/45" />
              <Segment width={pct(lateCovers)} className="bg-warning" hatched />
              <Segment width={pct(onTimeWaiting)} className="bg-muted-foreground/25" />
              <Segment width={pct(pulse.noShowCovers)} className="bg-destructive/70" />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <LegendChip
                active={filter === 'inside'}
                onClick={() => onFilter(filter === 'inside' ? 'all' : 'inside')}
                dot="bg-success"
                label="Adentro"
                count={pulse.inside}
                covers={pulse.insideCovers}
              />
              <LegendChip
                active={filter === 'waiting'}
                onClick={() => onFilter(filter === 'waiting' ? 'all' : 'waiting')}
                dot={pulse.late > 0 ? 'bg-warning' : 'bg-muted-foreground/40'}
                label="Por llegar"
                count={pulse.waiting}
                covers={pulse.waitingCovers}
                hint={
                  pulse.late > 0 ? `${pulse.late} atrasada${pulse.late === 1 ? '' : 's'}` : null
                }
              />
              {pulse.noShow > 0 || pulse.closed > 0 ? (
                <LegendChip
                  active={filter === 'done'}
                  onClick={() => onFilter(filter === 'done' ? 'all' : 'done')}
                  dot="bg-destructive/70"
                  label={pulse.noShow > 0 && pulse.closed === 0 ? 'No vinieron' : 'Terminadas'}
                  count={pulse.noShow + pulse.closed}
                  covers={pulse.noShowCovers + pulse.closedCovers}
                />
              ) : null}
            </div>
          </div>

          {/* Pico + sparkline. */}
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex items-center gap-1.5 type-label text-muted-foreground">
                <TrendingUp className="size-3.5" aria-hidden="true" />
                Pico
              </p>
              {showFocus ? (
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                  <SegmentChip segment={focusLoad} label="short" emphasized />
                  {others.length > 0 ? (
                    <p className="type-caption text-muted-foreground tabular-nums">
                      {others.map((s, i) => {
                        const tone = segmentTone(s)
                        return (
                          <Fragment key={s.key}>
                            {i > 0 ? ' · ' : null}
                            <span
                              title={segmentAriaLabel(s, '')}
                              className={
                                tone === 'warn' || tone === 'over'
                                  ? SEGMENT_TONE_CLASSES[tone].text
                                  : undefined
                              }
                            >
                              {`${SEGMENT_SHORT_LABELS[s.key]} ${s.people}`}
                            </span>
                          </Fragment>
                        )
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {showFocus && focusAlert ? (
              <p
                className={cn(
                  'mt-1 text-right type-caption',
                  SEGMENT_TONE_CLASSES[focusTone].text,
                  overCapacity && 'font-semibold',
                )}
              >
                {segmentStatusLine(focusLoad)}
              </p>
            ) : null}
            {peak ? (
              <p className="mt-1 type-body">
                <strong className="font-semibold type-amount">
                  {clockLabel(peak.start)}–{clockLabel(peak.start + 60)}
                </strong>{' '}
                <span className="text-muted-foreground">con</span>{' '}
                <strong className="font-semibold type-amount">{peak.guests}</strong>{' '}
                <span className="text-muted-foreground">personas a la vez</span>
              </p>
            ) : (
              <p className="mt-1 type-body text-muted-foreground">Sin reservas todavía.</p>
            )}
            <Sparkline slots={slots} now={isToday ? clock.minutes : null} />
          </div>
        </div>

        {/* Hitos: lo que no es una mesa más. Los eventos filtran la lista (chips);
            tortas, cumples y especiales son datos (etiquetas, no se tocan). */}
        {events.length > 0 || cakes.length > 0 || birthdays.length > 0 || hasSpecial ? (
          <ul
            aria-label="Hitos del día"
            className="-mx-4 mt-4 flex snap-x items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:-mx-5 sm:px-5 [&::-webkit-scrollbar]:hidden"
          >
            {events.map((e) => {
              if (e.kind !== 'event') return null
              const active = eventFilter === e.id
              const full = e.capacity > 0 && e.used >= e.capacity
              return (
                <li key={e.key} className="shrink-0 snap-start">
                  <FilterChip
                    size="md"
                    pressed={active}
                    onPressedChange={() => onEventFilter(active ? null : e.id)}
                    title={`${e.title} · ${e.time} · ${e.used}/${e.capacity} cubiertos${
                      full ? ' · lleno' : ''
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: e.colorHex }}
                    />
                    <span className="max-w-[10rem] truncate">{e.title}</span>
                    <span className="type-amount text-muted-foreground">{e.time}</span>
                    <span
                      className={cn(
                        'type-caption type-amount',
                        full ? 'font-medium text-warning-text' : 'text-muted-foreground',
                      )}
                    >
                      {e.used}/{e.capacity}
                      {full ? ' · lleno' : ''}
                    </span>
                  </FilterChip>
                </li>
              )
            })}
            {cakes.length > 0 ? (
              <li className="shrink-0 snap-start">
                <Badge
                  tone={pendingCakes ? 'warning' : 'brand'}
                  size="md"
                  icon={Cake}
                  title={cakes
                    .map((c) => (c.kind !== 'event' ? `${c.time} ${c.title}` : ''))
                    .join(' · ')}
                >
                  <span className="type-amount">{formatNumber(cakeTotal)}</span>
                  {cakeTotal === 1 ? 'torta' : 'tortas'}
                  {pendingCakes ? ' · falta elegir' : null}
                </Badge>
              </li>
            ) : null}
            {birthdays.length > 0 ? (
              <li className="shrink-0 snap-start">
                <Badge
                  tone="brand"
                  size="md"
                  icon={PartyPopper}
                  title={birthdays
                    .map((b) => (b.kind !== 'event' ? `${b.time} ${b.title}` : ''))
                    .join(' · ')}
                >
                  <span className="type-amount">{formatNumber(birthdays.length)}</span>
                  {birthdays.length === 1 ? 'cumple' : 'cumples'}
                </Badge>
              </li>
            ) : null}
            {hasSpecial ? (
              <li className="shrink-0 snap-start">
                <Badge tone="info" size="md" icon={Sparkles}>
                  Reserva especial
                </Badge>
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>
    </Card>
  )
}

function Segment({
  width,
  className,
  hatched = false,
}: {
  width: string
  className: string
  hatched?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'h-full transition-[width] duration-220 ease-ui motion-reduce:transition-none',
        className,
      )}
      style={{
        width,
        ...(hatched
          ? {
              backgroundImage:
                'repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklch, var(--foreground) 22%, transparent) 3px 5px)',
            }
          : {}),
      }}
    />
  )
}

/**
 * Una entrada de la leyenda que además filtra la lista (es el alias del
 * filtro de estado de la barra): el chip del kit, con el punto del color de su
 * tramo de la barra.
 */
function LegendChip({
  active,
  onClick,
  dot,
  label,
  count,
  covers,
  hint,
}: {
  active: boolean
  onClick: () => void
  dot: string
  label: string
  count: number
  covers: number
  hint?: string | null
}) {
  return (
    <FilterChip pressed={active} onPressedChange={onClick}>
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', dot)} />
      {label}
      <span className="type-amount text-muted-foreground">
        {count} · {covers}p
      </span>
      {hint ? <span className="text-warning-text">· {hint}</span> : null}
    </FilterChip>
  )
}

function Sparkline({ slots, now }: { slots: Slot[]; now: number | null }) {
  if (slots.length === 0) {
    return <div className="mt-3 h-14 rounded-lg bg-secondary" aria-hidden="true" />
  }
  const max = Math.max(1, ...slots.map((s) => s.covers))
  const first = slots[0]?.start ?? 0
  const last = (slots[slots.length - 1]?.start ?? 0) + SLOT_MINUTES
  const span = Math.max(1, last - first)
  const nowPct = now !== null && now >= first && now <= last ? ((now - first) / span) * 100 : null
  const labelEvery = slots.length > 12 ? 4 : 2

  return (
    <figure className="mt-3" aria-label="Ocupación estimada a lo largo de la noche">
      <div className="relative h-14">
        <div className="absolute inset-0 flex items-end gap-px">
          {slots.map((s) => (
            <div
              key={s.start}
              className="relative flex h-full flex-1 items-end"
              title={`${s.label} · ${s.covers} personas`}
            >
              <div
                className={cn(
                  'w-full rounded-t-sm transition-[height] duration-220 ease-ui motion-reduce:transition-none',
                  s.peak ? 'bg-primary' : 'bg-primary/25',
                )}
                style={{ height: `${Math.max(4, (s.covers / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        {nowPct !== null ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
            style={{ left: `${nowPct}%` }}
          >
            <span className="absolute -top-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-foreground" />
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex justify-between type-caption text-muted-foreground tabular-nums">
        {slots.map((s, i) => (
          <span key={s.start} className="flex-1 text-left">
            {i % labelEvery === 0 ? s.label : ''}
          </span>
        ))}
      </div>
    </figure>
  )
}
