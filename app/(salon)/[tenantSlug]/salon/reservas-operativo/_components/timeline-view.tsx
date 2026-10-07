'use client'

import { CalendarPlus, CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { type AnyRealtimePayload, mergeRow } from '@/lib/realtime/optimistic-merge'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { newReservationHref } from '@/lib/salon/calendar-links'
import { fetchDayExtras, fetchReservationsForDate } from '@/lib/salon/client-actions'
import { nowMinutesInCordoba } from '@/lib/salon/operativo'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { computeDaySegments, type DaySegmentCaps, focusSegment } from '@/lib/salon/segments'
import type { DayCapacityBucket, ReservationWithJoins } from '@/lib/salon/types'
import { RESERVATION_OPERATOR_ROLES, RESERVATION_STAFF_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { CapacityHeader } from './capacity-header'
import { ReservationCard } from './reservation-card'

/**
 * El pase de lista de la noche.
 *
 * Rediseñado para el celular del mozo:
 *
 * - UNA lista cronológica, agrupada por hora. Antes era una grilla de tres
 *   columnas por zona (`lg:grid-cols-3`) que en un teléfono nunca se activaba y
 *   quedaban tres cajas apiladas. Dónde se sienta cada reserva va en su fila
 *   (`placeLabel`: "Pizza libre · Planta Alta"); ya no hay una nota al pie del
 *   grupo con los nombres "· Evento", que con la planta dentro del evento
 *   (22/09/2026) dejaba de decir dónde se sientan.
 * - Sin `overflow-auto` propio ni `h-[100dvh]`: scrollea el documento, como
 *   manda el shell. Eso era la mitad de los "scrolls raros" — un contenedor
 *   scrolleable dentro de una página que también scrolleaba.
 * - El header sticky se ancla DEBAJO del topbar (`top-[var(--salon-topbar-h)]`)
 *   y en z-10, no z-30: antes tapaba el topbar al scrollear.
 * - Sin filtro por tipo de servicio ni botón "Refrescar": el mozo mira el día
 *   entero y el pull-to-refresh del shell ya cubre el refresco manual.
 */

// Realtime es el camino principal; esto es la red de seguridad (ver useVisibleInterval).
const SAFETY_NET_INTERVAL_MS = 90_000
// El reloj solo elige qué servicio va adelante: con un minuto de precisión sobra.
const CLOCK_TICK_MS = 60_000

function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(dt)
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export function TimelineView({
  tenantSlug,
  tenantId,
  role,
  date,
  isToday,
  initialReservations,
  initialCapacity,
  initialSegmentCaps,
  initialEvents,
}: {
  tenantSlug: string
  tenantId: string
  role: TenantRole
  date: string
  isToday: boolean
  initialReservations: ReservationWithJoins[]
  initialCapacity: DayCapacityBucket[]
  /** Cupos resueltos de almuerzo/merienda/cena para `date` (el cálculo corre acá). */
  initialSegmentCaps: DaySegmentCaps
  initialEvents: ScheduledEventWithTemplate[]
}) {
  const router = useRouter()
  const [reservations, setReservations] = useState(initialReservations)
  const [capacity, setCapacity] = useState(initialCapacity)
  const [segmentCaps, setSegmentCaps] = useState(initialSegmentCaps)
  const [events, setEvents] = useState(initialEvents)
  // Minutos del reloj del bar, solo hoy. Arranca en null también en el cliente:
  // el server no sabe la hora del dispositivo y así no hay desajuste de
  // hidratación (mientras tanto el foco es la cena).
  const [nowMinutes, setNowMinutes] = useState<number | null>(null)

  const canOperate = RESERVATION_OPERATOR_ROLES.includes(role)
  // Cargar una reserva vive en el workspace manager, del que el proxy rebota a
  // cualquier mozo: mostrarle el link era un callejón sin salida. El link lleva
  // la fecha que se está mirando: el alta abre en ese día, no en hoy.
  const canCreate = RESERVATION_STAFF_ROLES.includes(role)

  // Una sola server action (capacidad + eventos + cupos por servicio): cada
  // action es una invocación de función aparte en Vercel.
  const refreshExtras = useCallback(async () => {
    const r = await fetchDayExtras(tenantSlug, date)
    if (!r.ok) return
    setCapacity(r.buckets)
    setSegmentCaps(r.caps)
    setEvents(r.events)
  }, [tenantSlug, date])

  const debouncedCapacity = useDebouncedRefresh(refreshExtras, 600)

  // Resetear estado al cambiar de fecha (el RSC re-renderea con props nuevas).
  useEffect(() => setReservations(initialReservations), [initialReservations])
  useEffect(() => setCapacity(initialCapacity), [initialCapacity])
  useEffect(() => setSegmentCaps(initialSegmentCaps), [initialSegmentCaps])
  useEffect(() => setEvents(initialEvents), [initialEvents])

  useEffect(() => {
    if (!isToday) {
      setNowMinutes(null)
      return
    }
    const tick = () => setNowMinutes(nowMinutesInCordoba())
    tick()
    const id = window.setInterval(tick, CLOCK_TICK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isToday])

  // Realtime: si el host carga una reserva desde el manager, al mozo le aparece
  // sola en la lista.
  useEffect(() => {
    // Al montar, sincronizar YA: con staleTimes (next.config.ts) la página puede
    // venir del Client Router Cache con reservas de hasta 30 s; Realtime sólo
    // trae cambios FUTUROS y el safety net de abajo no refresca reservas.
    let cancelled = false
    void fetchReservationsForDate(tenantSlug, date).then((res) => {
      if (!cancelled && res.ok) setReservations(res.reservations)
    })
    void refreshExtras()

    const cleanup = subscribeChanges({
      channel: `salon-res-${tenantId}-${date}`,
      events: [
        {
          event: '*',
          table: 'salon_reservations',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: (raw) => {
            const payload = raw as AnyRealtimePayload
            // Filtro por fecha en JS — Realtime no permite filter por date.eq.
            setReservations((prev) =>
              mergeRow<ReservationWithJoins>(
                prev,
                payload,
                (r) => r.id,
                (r) => r.reservation_date === date,
              ),
            )
            debouncedCapacity()
          },
        },
        {
          event: '*',
          table: 'scheduled_events',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: () => debouncedCapacity(),
        },
      ],
    })

    return () => {
      cancelled = true
      cleanup()
    }
  }, [tenantId, tenantSlug, date, refreshExtras, debouncedCapacity])

  useVisibleInterval(refreshExtras, SAFETY_NET_INTERVAL_MS)

  const totals = useMemo(() => {
    let waiting = 0
    let here = 0
    for (const r of reservations) {
      if (r.status === 'pending') waiting++
      else if (r.status === 'arrived' || r.status === 'seated' || r.status === 'closed') here++
    }
    return { waiting, here, total: reservations.length }
  }, [reservations])

  // Cupo POR SERVICIO sobre las reservas que ya mergea Realtime: una reserva
  // que carga la anfitriona mueve el chip de la cena al toque, con la misma
  // cuenta que el calendario y el operativo.
  const daySegments = useMemo(
    () => computeDaySegments({ date, reservations, events, caps: segmentCaps }),
    [date, reservations, events, segmentCaps],
  )
  const focus = focusSegment(daySegments, isToday ? nowMinutes : null)

  // Agrupadas por hora, en orden. Es como el mozo lee la noche.
  const groups = useMemo(() => {
    const byTime = new Map<string, ReservationWithJoins[]>()
    for (const r of reservations) {
      if (r.status === 'cancelled') continue
      const key = r.reservation_time_local.slice(0, 5)
      const list = byTime.get(key) ?? []
      list.push(r)
      byTime.set(key, list)
    }
    return Array.from(byTime.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([time, rows]) => ({
        time,
        rows: rows.sort((a, b) => {
          // Los que faltan primero: son los que el mozo todavía tiene que tocar.
          const aDone = a.status !== 'pending'
          const bDone = b.status !== 'pending'
          if (aDone !== bDone) return aDone ? 1 : -1
          return a.guest_name.localeCompare(b.guest_name, 'es-AR')
        }),
      }))
  }, [reservations])

  const gotoDate = (d: string) => router.push(`/${tenantSlug}/salon/reservas-operativo?date=${d}`)

  return (
    <div className="space-y-3">
      {/* Header sticky: fecha + cuánto falta. Una fila. */}
      <div className="sticky top-[var(--salon-topbar-h)] z-10 -mx-4 space-y-2 border-b border-border/60 bg-background/95 px-4 pb-2.5 pt-1 backdrop-blur">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0"
            aria-label="Día anterior"
            onClick={() => gotoDate(shiftDate(date, -1))}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Button>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-semibold capitalize leading-tight">
              {isToday ? 'Hoy' : formatDateLong(date)}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {totals.total === 0 ? (
                'Sin reservas'
              ) : (
                <>
                  <span className="font-semibold text-foreground">{totals.waiting}</span> por llegar
                  {totals.here > 0 ? (
                    <>
                      {' · '}
                      <span className="font-medium text-success">{totals.here} adentro</span>
                    </>
                  ) : null}
                </>
              )}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0"
            aria-label="Día siguiente"
            onClick={() => gotoDate(shiftDate(date, 1))}
          >
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        </div>

        <CapacityHeader segments={daySegments} focus={focus} capacity={capacity} events={events} />
      </div>

      {groups.length === 0 ? (
        <div className="card-hairline rounded-2xl border bg-card p-10 text-center">
          <CalendarX2 className="mx-auto size-9 text-muted-foreground/60" aria-hidden />
          <h2 className="mt-3 font-display text-lg font-semibold">
            {isToday ? 'Nada reservado para hoy' : 'Nada reservado para este día'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground text-balance">
            Si entra una reserva, te aparece acá sola.
          </p>
          {canCreate ? (
            <Button asChild variant="outline" className="mt-5 gap-2">
              <Link href={newReservationHref(tenantSlug, { date })} prefetch={false}>
                <CalendarPlus className="size-4" aria-hidden />
                Cargar una
              </Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.time} aria-label={`Reservas de las ${group.time}`}>
              <div className="mb-1.5 flex items-center gap-2">
                <h2 className="font-mono text-sm font-semibold tabular-nums">{group.time}</h2>
                <span className="h-px flex-1 bg-border" aria-hidden />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {group.rows.reduce((acc, r) => acc + (r.actual_guests ?? r.estimated_guests), 0)}{' '}
                  pax
                </span>
              </div>
              <ul className="space-y-2">
                {group.rows.map((r) => (
                  <ReservationCard
                    key={r.id}
                    tenantSlug={tenantSlug}
                    reservation={r}
                    canOperate={canOperate}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {canCreate && groups.length > 0 ? (
        <Button asChild variant="outline" className={cn('h-12 w-full gap-2')}>
          <Link href={newReservationHref(tenantSlug, { date })} prefetch={false}>
            <CalendarPlus className="size-4" aria-hidden />
            Cargar una reserva
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
