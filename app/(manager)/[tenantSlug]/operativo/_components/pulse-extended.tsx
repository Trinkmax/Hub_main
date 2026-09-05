'use client'

import { Cake, Keyboard, MousePointerClick, PartyPopper } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { summarizeDayCovers } from '@/lib/salon/covers'
import type { DayHighlight } from '@/lib/salon/day-highlights'
import type { NightPulse } from '@/lib/salon/operativo'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import {
  type DayCapacityBucket,
  describeCake,
  type ReservationWithJoins,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * Lo que ocupa el aside de desktop cuando no hay una reserva elegida: el
 * "pulso extendido" — ocupación por zona, eventos con su cupo, tortas a
 * preparar y cumpleaños. Es el pre-servicio del dueño, a un vistazo.
 */
export function PulseExtended({
  pulse,
  reservations,
  capacity,
  events,
  highlights,
  isToday,
}: {
  pulse: NightPulse
  reservations: ReservationWithJoins[]
  capacity: DayCapacityBucket[]
  events: ScheduledEventWithTemplate[]
  highlights: DayHighlight[]
  isToday: boolean
}) {
  const covers = summarizeDayCovers(capacity)
  const zones = (['planta_alta', 'planta_baja'] as const).map((z) => {
    const bucket = capacity.find((b) => b.bucket === `zone:${z}`)
    return {
      zone: z,
      label: ZONE_LABELS[z],
      used: bucket?.used ?? 0,
      capacity: bucket?.capacity ?? 0,
    }
  })
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
          {covers.total > 0 ? (
            <>
              {' '}
              sobre{' '}
              <span
                className={cn(
                  'tabular-nums',
                  covers.used > covers.total && 'font-semibold text-destructive',
                )}
              >
                {covers.total}
              </span>{' '}
              del salón
            </>
          ) : null}
        </p>
      </div>

      <section aria-label="Ocupación por zona" className="space-y-2.5">
        {zones.map((z) => {
          const pct = z.capacity > 0 ? Math.min(100, (z.used / z.capacity) * 100) : 0
          const over = z.capacity > 0 && z.used > z.capacity
          return (
            <div key={z.zone}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{z.label}</span>
                <span
                  className={cn(
                    'font-mono text-xs tabular-nums text-muted-foreground',
                    over && 'font-semibold text-destructive',
                  )}
                >
                  {z.used}
                  {z.capacity > 0 ? `/${z.capacity}` : ''}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-(--duration-slower) ease-(--ease-out)',
                    over ? 'bg-destructive' : pct >= 90 ? 'bg-warning' : 'bg-primary',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
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
