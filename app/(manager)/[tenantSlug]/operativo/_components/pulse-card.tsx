'use client'

import { Cake, PartyPopper, Sparkles, TrendingUp } from 'lucide-react'
import { useInView } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { NumberTicker } from '@/components/ui/number-ticker'
import { summarizeDayCovers } from '@/lib/salon/covers'
import type { DayHighlight } from '@/lib/salon/day-highlights'
import { type BoardFilter, type NightPulse, serviceMinutes } from '@/lib/salon/operativo'
import { coversOf, occupiesTable } from '@/lib/salon/services'
import type { DayCapacityBucket, ReservationWithJoins } from '@/lib/salon/types'
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
 * "Por llegar" acá es lo mismo que el chip de abajo.
 */
export function PulseCard({
  pulse,
  reservations,
  capacity,
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
  capacity: DayCapacityBucket[]
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
  const inView = useInView(ref, { margin: '-56px 0px 0px 0px' })
  useEffect(() => onInViewChange(inView), [inView, onInViewChange])

  const covers = useMemo(() => summarizeDayCovers(capacity), [capacity])
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
  const overCapacity = covers.total > 0 && covers.used > covers.total

  return (
    <section
      ref={ref}
      aria-label="Pulso de la noche"
      className="card-hairline relative overflow-hidden rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-end">
        {/* Héroe: cuánta gente ya entró. */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {isToday ? 'Adentro ahora' : 'Cubiertos'}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-serif text-5xl font-semibold leading-none tracking-tight tabular-nums sm:text-6xl">
              <NumberTicker value={isToday ? pulse.insideCovers : pulse.covers} durationMs={700} />
            </span>
            {isToday ? (
              <span className="font-serif text-2xl text-muted-foreground tabular-nums">
                / <NumberTicker value={pulse.covers} durationMs={700} />
              </span>
            ) : null}
            <span className="text-sm text-muted-foreground">
              {isToday ? 'cubiertos' : 'reservados'}
            </span>
          </div>
          {isToday && pulse.closedCovers > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
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

          <div className="mt-3 flex flex-wrap gap-1.5">
            <LegendPill
              active={filter === 'inside'}
              onClick={() => onFilter(filter === 'inside' ? 'all' : 'inside')}
              dot="bg-success"
              label="Adentro"
              count={pulse.inside}
              covers={pulse.insideCovers}
            />
            <LegendPill
              active={filter === 'waiting'}
              onClick={() => onFilter(filter === 'waiting' ? 'all' : 'waiting')}
              dot={pulse.late > 0 ? 'bg-warning' : 'bg-muted-foreground/40'}
              label="Por llegar"
              count={pulse.waiting}
              covers={pulse.waitingCovers}
              hint={pulse.late > 0 ? `${pulse.late} atrasada${pulse.late === 1 ? '' : 's'}` : null}
            />
            {pulse.noShow > 0 || pulse.closed > 0 ? (
              <LegendPill
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
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <TrendingUp className="size-3.5" aria-hidden />
              Pico
            </p>
            {covers.total > 0 ? (
              <p
                className={cn(
                  'text-[11px] tabular-nums text-muted-foreground',
                  overCapacity && 'font-semibold text-destructive',
                )}
              >
                {covers.used}/{covers.total} del salón
                {covers.eventos > 0 ? ` · ${covers.eventos} en eventos` : ''}
              </p>
            ) : null}
          </div>
          {peak ? (
            <p className="mt-1 text-sm">
              <strong className="font-mono font-semibold tabular-nums">
                {clockLabel(peak.start)}–{clockLabel(peak.start + 60)}
              </strong>{' '}
              <span className="text-muted-foreground">con</span>{' '}
              <strong className="tabular-nums">{peak.guests}</strong>{' '}
              <span className="text-muted-foreground">personas a la vez</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Sin reservas todavía.</p>
          )}
          <Sparkline slots={slots} now={isToday ? clock.minutes : null} />
        </div>
      </div>

      {/* Hitos: lo que no es una mesa más. */}
      {events.length > 0 || cakes.length > 0 || birthdays.length > 0 ? (
        <ul
          aria-label="Hitos del día"
          className="-mx-4 mt-4 flex snap-x gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:-mx-5 sm:px-5 [&::-webkit-scrollbar]:hidden"
        >
          {events.map((e) => {
            if (e.kind !== 'event') return null
            const active = eventFilter === e.id
            const full = e.capacity > 0 && e.used >= e.capacity
            return (
              <li key={e.key} className="shrink-0 snap-start">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onEventFilter(active ? null : e.id)}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border/70 bg-card hover:bg-(--cream-tint)',
                  )}
                  title={`${e.title} · ${e.time} · ${e.used}/${e.capacity} cubiertos${
                    full ? ' · lleno' : ''
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: e.colorHex }}
                  />
                  <span className="max-w-[10rem] truncate font-medium">{e.title}</span>
                  <span className="font-mono text-xs tabular-nums opacity-80">{e.time}</span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 font-mono text-[11px] tabular-nums',
                      active ? 'bg-background/20' : full ? 'bg-warning/20' : 'bg-secondary',
                    )}
                  >
                    {e.used}/{e.capacity}
                  </span>
                </button>
              </li>
            )
          })}
          {cakes.length > 0 ? (
            <li className="shrink-0 snap-start">
              <span
                className="flex h-11 items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 text-sm"
                title={cakes
                  .map((c) => (c.kind !== 'event' ? `${c.time} ${c.title}` : ''))
                  .join(' · ')}
              >
                <Cake className="size-4 text-warning" aria-hidden />
                <span className="font-medium tabular-nums">
                  {cakes.reduce((acc, c) => acc + (c.kind !== 'event' ? c.cakeCount : 0), 0)}{' '}
                  {cakes.length === 1 ? 'torta' : 'tortas'}
                </span>
                {cakes.some((c) => c.kind !== 'event' && !c.cakeOptionId) ? (
                  <span className="text-[11px] text-muted-foreground">· falta elegir</span>
                ) : null}
              </span>
            </li>
          ) : null}
          {birthdays.length > 0 ? (
            <li className="shrink-0 snap-start">
              <span
                className="flex h-11 items-center gap-2 rounded-full border border-border/70 bg-card px-3 text-sm"
                title={birthdays
                  .map((b) => (b.kind !== 'event' ? `${b.time} ${b.title}` : ''))
                  .join(' · ')}
              >
                <PartyPopper className="size-4 text-primary" aria-hidden />
                <span className="font-medium tabular-nums">
                  {birthdays.length} {birthdays.length === 1 ? 'cumple' : 'cumples'}
                </span>
              </span>
            </li>
          ) : null}
          {highlights.some((h) => h.kind === 'special') ? (
            <li className="shrink-0 snap-start">
              <span className="flex h-11 items-center gap-2 rounded-full border border-border/70 bg-card px-3 text-sm">
                <Sparkles className="size-4 text-primary" aria-hidden />
                <span className="font-medium">Reserva especial</span>
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
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
      aria-hidden
      className={cn(
        'h-full transition-[width] duration-(--duration-slower) ease-(--ease-out)',
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

function LegendPill({
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
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border/70 bg-card text-foreground hover:bg-(--cream-tint)',
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-full', active ? 'bg-background' : dot)} />
      <span className="font-medium">{label}</span>
      <span className="font-mono tabular-nums opacity-80">
        {count} · {covers}p
      </span>
      {hint ? (
        <span className={cn('font-medium', active ? 'opacity-80' : 'text-warning-text')}>
          · {hint}
        </span>
      ) : null}
    </button>
  )
}

function Sparkline({ slots, now }: { slots: Slot[]; now: number | null }) {
  if (slots.length === 0) {
    return <div className="mt-3 h-14 rounded-lg bg-secondary/50" aria-hidden />
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
              className="group relative flex h-full flex-1 items-end"
              title={`${s.label} · ${s.covers} personas`}
            >
              <div
                className={cn(
                  'w-full rounded-t-sm transition-[height] duration-(--duration-slower) ease-(--ease-out)',
                  s.peak ? 'bg-primary' : 'bg-primary/25',
                )}
                style={{ height: `${Math.max(4, (s.covers / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        {nowPct !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
            style={{ left: `${nowPct}%` }}
          >
            <span className="absolute -top-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-foreground" />
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
        {slots.map((s, i) => (
          <span key={s.start} className="flex-1 text-left">
            {i % labelEvery === 0 ? s.label : ''}
          </span>
        ))}
      </div>
    </figure>
  )
}
