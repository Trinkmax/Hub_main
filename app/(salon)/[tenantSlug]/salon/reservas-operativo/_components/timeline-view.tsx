'use client'

import { CalendarPlus, CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { type BranchFilter, inBranchFilter } from '@/lib/branches/filter'
import { type AnyRealtimePayload, mergeRow } from '@/lib/realtime/optimistic-merge'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { branchFilterKey } from '@/lib/salon/branch-scope'
import { newReservationHref } from '@/lib/salon/calendar-links'
import { fetchDayExtras, fetchReservationsForDate } from '@/lib/salon/client-actions'
import { eventUsedById } from '@/lib/salon/day-counter'
import { nowMinutesInCordoba } from '@/lib/salon/operativo'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { computeDaySegments, type DaySegmentCaps, focusSegment } from '@/lib/salon/segments'
import type { ReservationWithJoins } from '@/lib/salon/types'
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

// Realtime es el camino principal; esto es la red de seguridad (ver useVisibleInterval). Con el canal en vivo
// alcanza con una pasada cada tanto; sin canal (conectando o caído) la lectura es lo único que hay.
const SAFETY_NET_LIVE_MS = 30_000
const SAFETY_NET_OFFLINE_MS = 6_000
/** Un INSERT llega sin joins (cliente, gestores, torta, evento) y un UPDATE que cambia una FK los deja viejos. */
const JOIN_KEYS = [
  'customer_id',
  'cake_option_id',
  'primary_manager_id',
  'assistant_manager_id',
  'scheduled_event_id',
] as const
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
  branchFilter,
  initialReservations,
  initialSegmentCaps,
  initialEvents,
}: {
  tenantSlug: string
  tenantId: string
  role: TenantRole
  date: string
  isToday: boolean
  /**
   * La sucursal de este dispositivo (el salón no mira «Todas»): lo que se vuelve a pedir lleva este filtro y lo que
   * llega en vivo de otra sucursal se descarta.
   */
  branchFilter: BranchFilter
  initialReservations: ReservationWithJoins[]
  /** Cupos resueltos de almuerzo/merienda/cena para `date` (el cálculo corre acá). */
  initialSegmentCaps: DaySegmentCaps
  initialEvents: ScheduledEventWithTemplate[]
}) {
  const router = useRouter()
  const [reservations, setReservations] = useState(initialReservations)
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

  // El filtro por ref: lo que se pide de nuevo va con la sucursal con la que se
  // dibujó la pantalla (el servidor lo recorta). Cambiar de sucursal la remonta.
  const branchRef = useRef(branchFilter)
  branchRef.current = branchFilter
  const branchKey = branchFilterKey(branchFilter)
  // Las reservas que ya se ven, por ref: el aviso en vivo decide con lo actual.
  const reservationsRef = useRef(reservations)
  reservationsRef.current = reservations

  // El día que se está mirando, por ref: una respuesta que vuelve después de cambiar de día no pisa nada.
  const activeDate = useRef(date)
  activeDate.current = date
  // Solo vale la última lectura de reservas: una vieja que tarda más no pisa a una nueva.
  const readSeq = useRef(0)
  // Estado real del canal: decide cada cuánto se vuelve a leer por las dudas.
  const [live, setLive] = useState<'connecting' | 'live' | 'offline'>('connecting')

  // Una sola server action (eventos + cupos por servicio): cada action es una
  // invocación de función aparte en Vercel.
  const refreshExtras = useCallback(async () => {
    const r = await fetchDayExtras(tenantSlug, date, branchRef.current)
    if (!r.ok || activeDate.current !== date) return
    setSegmentCaps(r.caps)
    setEvents(r.events)
  }, [tenantSlug, date])

  // Las reservas del día, enteras. Lo que llega en vivo trae solo la fila: esto completa los joins y, sobre todo,
  // recupera lo que pasó mientras el celular estuvo bloqueado o sin señal (Realtime no lo reenvía).
  const refreshReservations = useCallback(async () => {
    const seq = ++readSeq.current
    const res = await fetchReservationsForDate(tenantSlug, date, branchRef.current)
    if (!res.ok || seq !== readSeq.current || activeDate.current !== date) return
    setReservations(res.reservations)
  }, [tenantSlug, date])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshReservations(), refreshExtras()])
  }, [refreshReservations, refreshExtras])

  const debouncedCapacity = useDebouncedRefresh(refreshExtras, 600)
  const debouncedReservations = useDebouncedRefresh(refreshReservations, 700)

  // Resetear estado al cambiar de fecha (el RSC re-renderea con props nuevas).
  useEffect(() => setReservations(initialReservations), [initialReservations])
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
    // trae cambios FUTUROS.
    let cancelled = false
    let joinedOnce = false
    void refreshReservations()
    void refreshExtras()

    const cleanup = subscribeChanges({
      channel: `salon-res-${tenantId}-${date}-${branchKey}`,
      events: [
        {
          event: '*',
          table: 'salon_reservations',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: (raw) => {
            const payload = raw as AnyRealtimePayload
            const next = payload.new as ReservationWithJoins | undefined
            // Filtro por fecha y por sucursal en JS: Realtime no permite filter
            // por date.eq y la suscripción es por bar. Lo de otra sucursal se
            // descarta (si estaba, porque se mudó, `mergeRow` la saca).
            if (
              next &&
              !inBranchFilter(next.branch_id, branchRef.current) &&
              !reservationsRef.current.some((r) => r.id === next.id)
            ) {
              return
            }
            // Un INSERT llega sin joins, y un UPDATE que mueve una FK los deja viejos: completar leyendo.
            const current = next ? reservationsRef.current.find((r) => r.id === next.id) : undefined
            const needsJoins =
              payload.eventType === 'INSERT' ||
              (payload.eventType === 'UPDATE' &&
                next !== undefined &&
                (!current || JOIN_KEYS.some((key) => current[key] !== next[key])))
            setReservations((prev) =>
              mergeRow<ReservationWithJoins>(
                prev,
                payload,
                (r) => r.id,
                (r) =>
                  r.reservation_date === date && inBranchFilter(r.branch_id, branchRef.current),
              ),
            )
            if (needsJoins) debouncedReservations()
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
      // Tras una reconexión se relee todo: lo que pasó en el hueco no vuelve a llegar.
      onStatus: (status) => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') {
          setLive('live')
          if (joinedOnce) void refreshAll()
          joinedOnce = true
        } else {
          setLive('offline')
        }
      },
    })

    // Vuelve la red: se lee ya, sin esperar a que el canal avise.
    const onOnline = () => void refreshAll()
    const onOffline = () => setLive('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      cancelled = true
      cleanup()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [
    tenantId,
    date,
    branchKey,
    refreshReservations,
    refreshExtras,
    refreshAll,
    debouncedCapacity,
    debouncedReservations,
  ])

  // Red de seguridad: reservas Y cupos. Corre al volver a la pantalla (celular desbloqueado) y cada tanto.
  useVisibleInterval(refreshAll, live === 'live' ? SAFETY_NET_LIVE_MS : SAFETY_NET_OFFLINE_MS)

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
  // La gente de cada evento, de la misma cuenta (ya no de `evaluate_day_capacity`,
  // que no sabe de sucursales).
  const usedByEvent = useMemo(() => eventUsedById(daySegments), [daySegments])

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

        <CapacityHeader
          segments={daySegments}
          focus={focus}
          usedByEvent={usedByEvent}
          events={events}
        />
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
