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
import { fetchDayCapacity, fetchReservationsForDate } from '@/lib/salon/client-actions'
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

  const load = useCallback(async () => {
    if (!date) return
    setLoading(true)
    const [resR, capR] = await Promise.all([
      fetchReservationsForDate(tenantSlug, date),
      fetchDayCapacity(tenantSlug, date),
    ])
    setReservations(resR.ok ? resR.reservations : [])
    setBuckets(capR.ok ? capR.buckets : [])
    setLoading(false)
  }, [tenantSlug, date])

  useEffect(() => {
    if (open && date) void load()
  }, [open, date, load])

  const pa = buckets.find((b) => b.bucket === 'zone:planta_alta')
  const pb = buckets.find((b) => b.bucket === 'zone:planta_baja')
  const usedZones = (pa?.used ?? 0) + (pb?.used ?? 0)
  const totalZones = (pa?.capacity ?? 0) + (pb?.capacity ?? 0)
  const isOver = usedZones > totalZones
  const isFull = !isOver && totalZones > 0 && usedZones >= totalZones * 0.9

  // Mapa id→{nombre,cap} de eventos del día derivado de las reservas con evento.
  const eventBuckets = buckets.filter((b) => b.bucket.startsWith('event:'))
  const eventNames = new Map<string, string>()
  for (const r of reservations) {
    if (r.scheduled_event) {
      eventNames.set(r.scheduled_event.id, r.scheduled_event.template?.name ?? 'Evento')
    }
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
        <div className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Cubiertos del salón
            </span>
            <span
              className={cn(
                'font-mono text-lg font-semibold tabular-nums',
                isOver
                  ? 'text-rose-600 dark:text-rose-400'
                  : isFull
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-foreground',
              )}
            >
              {usedZones}
              <span className="text-sm font-normal text-muted-foreground">/{totalZones}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
            <span>
              {ZONE_LABELS.planta_alta}: {pa?.used ?? 0}/{pa?.capacity ?? 0}
            </span>
            <span>
              {ZONE_LABELS.planta_baja}: {pb?.used ?? 0}/{pb?.capacity ?? 0}
            </span>
            {eventBuckets.map((b) => {
              const id = b.bucket.slice('event:'.length)
              return (
                <span key={b.bucket}>
                  {eventNames.get(id) ?? 'Evento'}: {b.used}/{b.capacity}
                </span>
              )
            })}
          </div>
        </div>

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
