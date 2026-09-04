'use client'

import { CalendarPlus, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CakeChip } from '@/components/reservations/cake-chip'
import { DayHighlights } from '@/components/reservations/day-highlights'
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
import { ServiceSummary } from '@/components/reservations/service-summary'
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
import {
  fetchDayCapacity,
  fetchReservationsForDate,
  fetchScheduledEventsForDate,
} from '@/lib/salon/client-actions'
import { summarizeDayCovers } from '@/lib/salon/covers'
import { buildDayHighlights, usedByEventMap } from '@/lib/salon/day-highlights'
import { timeRangeLabel } from '@/lib/salon/format'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { groupByService } from '@/lib/salon/services'
import { type DayCapacityBucket, type ReservationWithJoins, ZONE_LABELS } from '@/lib/salon/types'
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

  // Eventos y cumpleaños en un solo renglón: el cumple deja de estar escondido
  // adentro del evento (ver lib/salon/day-highlights.ts).
  const highlights = useMemo(
    () =>
      buildDayHighlights({
        events,
        reservations,
        usedByEvent: usedByEventMap(buckets),
      }),
    [events, reservations, buckets],
  )

  // La agenda del día cortada por servicio: desayuno / almuerzo / merienda /
  // cena, cada uno con su desglose por zona.
  const services = useMemo(() => groupByService(reservations), [reservations])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `DialogContent` no trae alto máximo: en un celular de 640px con varios
          eventos y reservas el contenido desbordaba arriba y abajo (está
          centrado con translate -50%) y se perdían el título, la X y el botón
          de cerrar, sin scroll para recuperarlos. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
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

        {/* Eventos + cumpleaños, al mismo nivel. Reservar desde acá llega al
            form con el evento ya elegido (antes: "Nueva reserva" → "Sujeta a
            evento" → buscarlo en un combo — tres pasos para la misma decisión). */}
        {date ? (
          <DayHighlights tenantSlug={tenantSlug} date={date} highlights={highlights} />
        ) : null}

        {/* Listado, cortado por servicio */}
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : reservations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay reservas para este día.
          </p>
        ) : (
          <div className="space-y-4">
            {services.map((bucket) => (
              <section key={bucket.mealType} className="space-y-1.5">
                {/* Banda, no tarjeta: en 360px el diálogo ya es una caja con
                    borde y adentro van las filas con borde. Un tercer borde acá
                    es card-dentro-de-card-dentro-de-card. */}
                <ServiceSummary
                  bucket={bucket}
                  compact
                  className="rounded-lg bg-secondary/50 px-3 py-2"
                />
                <ul className="space-y-1.5">
                  {bucket.rows.map((r) => (
                    <li key={r.id}>
                      <ReservationQuickView
                        tenantSlug={tenantSlug}
                        reservation={r}
                        onChanged={load}
                        trigger={
                          <button
                            type="button"
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary',
                              (r.status === 'cancelled' || r.status === 'no_show') && 'opacity-60',
                            )}
                          >
                            <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                              {timeRangeLabel(
                                r.reservation_time_local,
                                r.reservation_end_time_local,
                              )}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col leading-tight">
                              <span className="truncate font-medium">{r.guest_name}</span>
                              {/* La torta viaja con la fila: es lo que el bar
                                  tiene que producir, no un detalle del cliente. */}
                              {r.cake_count > 0 ? (
                                <CakeChip
                                  count={r.cake_count}
                                  option={r.cake_option}
                                  className="mt-1 self-start"
                                />
                              ) : null}
                            </span>
                            <span className="hidden text-[11px] text-muted-foreground sm:inline">
                              {zoneOrEvent(r)}
                            </span>
                            <span className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
                              {r.actual_guests ?? r.estimated_guests}p
                            </span>
                            <StatusPill status={r.status} />
                          </button>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
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
