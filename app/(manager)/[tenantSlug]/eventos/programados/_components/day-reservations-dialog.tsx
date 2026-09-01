'use client'

import { CalendarPlus, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
import { StatusPill } from '@/components/reservations/status-pill'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  fetchDayCapacity,
  fetchReservationsForDate,
  fetchScheduledEventsForDate,
} from '@/lib/salon/client-actions'
import { summarizeDayCovers } from '@/lib/salon/covers'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import {
  type DayCapacityBucket,
  MEAL_TYPE_LABELS,
  type ReservationWithJoins,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'

function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt)
}

function zoneOrEvent(r: ReservationWithJoins): string {
  if (r.zone === 'event_floating') return r.scheduled_event?.template?.name ?? 'Evento'
  return ZONE_LABELS[r.zone]
}

export function DayReservationsDialog({
  tenantSlug,
  date,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  date: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [reservations, setReservations] = useState<ReservationWithJoins[]>([])
  const [buckets, setBuckets] = useState<DayCapacityBucket[]>([])
  const [events, setEvents] = useState<ScheduledEventWithTemplate[]>([])

  const load = useCallback(async () => {
    if (!date) return
    setLoading(true)
    const [resR, capR, evR] = await Promise.all([
      fetchReservationsForDate(tenantSlug, date),
      fetchDayCapacity(tenantSlug, date),
      fetchScheduledEventsForDate(tenantSlug, date),
    ])
    setReservations(resR.ok ? resR.reservations : [])
    setBuckets(capR.ok ? capR.buckets : [])
    setEvents(evR.ok ? evR.events : [])
    setLoading(false)
  }, [tenantSlug, date])

  useEffect(() => {
    if (open && date) void load()
  }, [open, date, load])

  const pa = buckets.find((b) => b.bucket === 'zone:planta_alta')
  const pb = buckets.find((b) => b.bucket === 'zone:planta_baja')
  // Mismo criterio que el contador de /reservas: el total del día incluye a la
  // gente que vino por un evento, porque igual se sienta en el salón.
  const covers = summarizeDayCovers(buckets)
  const isOver = covers.used > covers.total
  const isFull = !isOver && covers.total > 0 && covers.used >= covers.total * 0.9

  const usedByEvent = new Map<string, DayCapacityBucket>()
  for (const b of buckets) {
    if (b.bucket.startsWith('event:')) usedByEvent.set(b.bucket.slice('event:'.length), b)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif capitalize">
            {date ? formatDateLong(date) : 'Día'}
          </DialogTitle>
          <DialogDescription>Reservas del día y ocupación del salón.</DialogDescription>
        </DialogHeader>

        {/* Resumen de capacidad */}
        <div
          className={cn(
            'space-y-2 rounded-xl border p-3',
            // Mismo semáforo (y mismos tokens) que el chip de /reservas.
            isOver
              ? 'border-destructive/50 bg-destructive/10'
              : isFull
                ? 'border-warning/50 bg-warning/10'
                : 'border-border/70 bg-card/60',
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Cubiertos del día
            </span>
            <span
              className={cn(
                'font-mono text-lg font-semibold tabular-nums',
                isOver ? 'text-destructive' : 'text-foreground',
              )}
            >
              {covers.used}
              <span className="text-sm font-normal text-muted-foreground">/{covers.total}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
            <span>
              {ZONE_LABELS.planta_alta}: {pa?.used ?? 0}/{pa?.capacity ?? 0}
            </span>
            <span>
              {ZONE_LABELS.planta_baja}: {pb?.used ?? 0}/{pb?.capacity ?? 0}
            </span>
            {covers.eventos > 0 ? <span>Eventos: {covers.eventos}</span> : null}
          </div>
        </div>

        {/* Eventos del día: cada uno con su botón. Reservar desde acá llega al
            form con el evento ya elegido (antes: "Nueva reserva" → "Sujeta a
            evento" → buscarlo en un combo — tres pasos para la misma decisión). */}
        {events.length > 0 ? (
          <ul className="space-y-1.5">
            {events.map((e) => {
              const b = usedByEvent.get(e.id)
              const color = e.template?.color_hex ?? 'var(--primary)'
              const name = e.name_override ?? e.template?.name ?? 'Evento'
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {e.starts_at_local.slice(0, 5)} · {b?.used ?? 0}/{b?.capacity ?? e.capacity}
                  </span>
                  <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                    <Link href={`/${tenantSlug}/reservas/nuevo?date=${date}&event=${e.id}`}>
                      <CalendarPlus className="size-3.5" />
                      Reservar
                    </Link>
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : null}

        {/* Listado */}
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : reservations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay reservas para este día.
          </p>
        ) : (
          <ScrollArea className="max-h-[50vh]">
            <ul className="space-y-1.5 pr-3">
              {reservations.map((r) => (
                <li key={r.id}>
                  <ReservationQuickView
                    tenantSlug={tenantSlug}
                    reservation={r}
                    onChanged={load}
                    trigger={
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                      >
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {r.reservation_time_local.slice(0, 5)}
                        </span>
                        <span className="flex-1 truncate font-medium">{r.guest_name}</span>
                        <span className="text-[11px] text-muted-foreground">{zoneOrEvent(r)}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {r.actual_guests ?? r.estimated_guests}p · {MEAL_TYPE_LABELS[r.meal_type]}
                        </span>
                        <StatusPill status={r.status} />
                      </button>
                    }
                  />
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button asChild className="gap-2">
            <Link href={`/${tenantSlug}/reservas/nuevo${date ? `?date=${date}` : ''}`}>
              <CalendarPlus className="size-4" />
              Nueva reserva
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
