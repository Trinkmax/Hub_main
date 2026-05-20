'use client'

import { CalendarPlus, ChevronLeft, ChevronRight, RefreshCw, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { type AnyRealtimePayload, mergeRow } from '@/lib/realtime/optimistic-merge'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { fetchDayCapacity, fetchScheduledEventsForDate } from '@/lib/salon/client-actions'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type {
  DayCapacityBucket,
  MealType,
  ReservationWithJoins,
  SalonZone,
} from '@/lib/salon/types'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { CapacityHeader } from './capacity-header'
import { MealTypeFilter } from './meal-type-filter'
import { ReservationCard } from './reservation-card'

const ALL_MEALS: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']

const SAFETY_NET_INTERVAL_MS = 30_000

const ZONE_ORDER: SalonZone[] = ['planta_alta', 'planta_baja', 'event_floating']
const ZONE_TITLES: Record<SalonZone, string> = {
  planta_alta: 'Planta Alta',
  planta_baja: 'Planta Baja',
  event_floating: 'Sujeta a evento',
}

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
  initialReservations,
  initialCapacity,
  initialEvents,
  initialMeals,
}: {
  tenantSlug: string
  tenantId: string
  role: TenantRole
  date: string
  initialReservations: ReservationWithJoins[]
  initialCapacity: DayCapacityBucket[]
  initialEvents: ScheduledEventWithTemplate[]
  initialMeals: ReadonlySet<MealType>
}) {
  const router = useRouter()
  const [reservations, setReservations] = useState(initialReservations)
  const [capacity, setCapacity] = useState(initialCapacity)
  const [events, setEvents] = useState(initialEvents)
  const [refreshing, startRefresh] = useTransition()
  const [selectedMeals, setSelectedMeals] = useState<ReadonlySet<MealType>>(initialMeals)

  const canOperate = role === 'owner' || role === 'cashier' || role === 'waiter'

  // Sync filtro a URL para shareable / persistencia entre nav
  const updateMealsInUrl = useCallback((next: ReadonlySet<MealType>) => {
    const url = new URL(window.location.href)
    if (next.size === 0 || next.size === ALL_MEALS.length) {
      url.searchParams.delete('meals')
    } else {
      url.searchParams.set('meals', ALL_MEALS.filter((m) => next.has(m)).join(','))
    }
    window.history.replaceState({}, '', url.toString())
  }, [])

  const handleMealsChange = useCallback(
    (next: ReadonlySet<MealType>) => {
      setSelectedMeals(next)
      updateMealsInUrl(next)
    },
    [updateMealsInUrl],
  )

  const isMealActive = useCallback(
    (m: MealType) => selectedMeals.size === 0 || selectedMeals.has(m),
    [selectedMeals],
  )

  const refreshExtras = useCallback(async () => {
    const [cap, ev] = await Promise.all([
      fetchDayCapacity(tenantSlug, date),
      fetchScheduledEventsForDate(tenantSlug, date),
    ])
    if (cap.ok) setCapacity(cap.buckets)
    if (ev.ok) setEvents(ev.events)
  }, [tenantSlug, date])

  const refreshAll = useCallback(() => {
    startRefresh(() => {
      router.refresh() // re-renderiza el RSC, lo cual repuebla initialReservations
      void refreshExtras()
    })
  }, [router, refreshExtras])

  const debouncedCapacity = useDebouncedRefresh(refreshExtras, 600)

  // Resetear estado al cambiar de fecha (cuando el RSC re-renderea con nuevos props)
  useEffect(() => {
    setReservations(initialReservations)
  }, [initialReservations])
  useEffect(() => {
    setCapacity(initialCapacity)
  }, [initialCapacity])
  useEffect(() => {
    setEvents(initialEvents)
  }, [initialEvents])

  // Realtime: salon_reservations y scheduled_events del tenant
  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `salon-res-${tenantId}-${date}`,
      events: [
        {
          event: '*',
          table: 'salon_reservations',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: (raw) => {
            const payload = raw as AnyRealtimePayload
            // Filter por fecha en JS — Realtime no permite filter por date.eq
            setReservations((prev) =>
              mergeRow<ReservationWithJoins>(
                prev,
                payload,
                (r) => r.id,
                (r) => r.reservation_date === date,
              ),
            )
            // capacidad: recalcular debounced
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

    // Safety-net: re-sync periódico
    const interval = window.setInterval(() => {
      void refreshExtras()
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      cleanup()
      window.clearInterval(interval)
    }
  }, [tenantId, date, refreshExtras, debouncedCapacity])

  // Counts por meal_type (sin filtrar — informan los chips)
  const mealCounts = useMemo(() => {
    const out: Record<MealType, number> = {
      breakfast: 0,
      lunch: 0,
      tea_time: 0,
      dinner: 0,
      hub_event: 0,
    }
    for (const r of reservations) out[r.meal_type] = (out[r.meal_type] ?? 0) + 1
    return out
  }, [reservations])

  // Reservas y eventos visibles según filtro
  const filteredReservations = useMemo(
    () => reservations.filter((r) => isMealActive(r.meal_type)),
    [reservations, isMealActive],
  )
  const filteredEvents = useMemo(
    () => events.filter((e) => isMealActive(e.meal_type)),
    [events, isMealActive],
  )
  // Capacidad: zonas siempre visibles; eventos solo los que matchean el filtro.
  const filteredCapacity = useMemo(() => {
    const visibleEventIds = new Set(filteredEvents.map((e) => e.id))
    return capacity.filter((b) => {
      if (b.bucket.startsWith('event:')) {
        return visibleEventIds.has(b.bucket.slice('event:'.length))
      }
      return true
    })
  }, [capacity, filteredEvents])

  const isFiltered = selectedMeals.size > 0 && selectedMeals.size < ALL_MEALS.length

  // Agrupar reservas por zona, ordenadas por hora
  const grouped = useMemo(() => {
    const out: Record<SalonZone, ReservationWithJoins[]> = {
      planta_alta: [],
      planta_baja: [],
      event_floating: [],
    }
    for (const r of filteredReservations) {
      out[r.zone].push(r)
    }
    for (const k of ZONE_ORDER) {
      out[k].sort((a, b) => {
        if (a.reservation_time_local !== b.reservation_time_local) {
          return a.reservation_time_local < b.reservation_time_local ? -1 : 1
        }
        return a.guest_name.localeCompare(b.guest_name, 'es-AR')
      })
    }
    return out
  }, [filteredReservations])

  // Resumen rápido top-right (usa el set filtrado para que matchee lo que ve)
  const totals = useMemo(() => {
    let pending = 0
    let arrived = 0
    let seated = 0
    let closed = 0
    for (const r of filteredReservations) {
      if (r.status === 'pending') pending++
      else if (r.status === 'arrived') arrived++
      else if (r.status === 'seated') seated++
      else if (r.status === 'closed') closed++
    }
    return { pending, arrived, seated, closed, total: filteredReservations.length }
  }, [filteredReservations])

  function gotoDate(d: string) {
    router.push(`/${tenantSlug}/salon/reservas-operativo?date=${d}`)
  }

  return (
    <>
      {/* Header sticky */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 px-3 py-3 backdrop-blur sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Día anterior"
              onClick={() => gotoDate(shiftDate(date, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="px-2 text-center">
              <div className="font-serif text-lg font-semibold leading-tight capitalize">
                {formatDateLong(date)}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {totals.total} {totals.total === 1 ? 'reserva' : 'reservas'} ·{' '}
                <span className="text-amber-700 dark:text-amber-300">{totals.pending} pend</span> ·{' '}
                <span className="text-blue-600 dark:text-blue-400">{totals.arrived} llegó</span> ·{' '}
                <span className="text-emerald-600 dark:text-emerald-400">{totals.seated} sent</span>{' '}
                · <span className="text-slate-500">{totals.closed} cerr</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Día siguiente"
              onClick={() => gotoDate(shiftDate(date, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={refreshing}
              className="gap-1.5"
            >
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
              Refrescar
            </Button>
            <Button asChild size="sm" className="gap-2">
              <Link href={`/${tenantSlug}/reservas/nuevo`}>
                <CalendarPlus className="size-4" />
                Nueva
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <CapacityHeader capacity={filteredCapacity} events={filteredEvents} />
        </div>
        <div className="mt-2.5">
          <MealTypeFilter
            selected={selectedMeals}
            counts={mealCounts}
            onChange={handleMealsChange}
          />
        </div>
      </header>

      {/* Timeline */}
      <div className="flex-1 overflow-auto p-3 sm:p-6">
        {reservations.length === 0 ? (
          <div className="mt-12 flex flex-col items-center justify-center gap-3 text-center">
            <Sparkles className="size-12 text-muted-foreground/50" />
            <h2 className="font-serif text-xl font-semibold">Sin reservas para este día</h2>
            <p className="text-sm text-muted-foreground">
              Cuando alguien cargue una reserva para {formatDateLong(date)} va a aparecer acá en
              tiempo real.
            </p>
            <Button asChild className="mt-2 gap-2">
              <Link href={`/${tenantSlug}/reservas/nuevo`}>
                <CalendarPlus className="size-4" />
                Crear la primera
              </Link>
            </Button>
          </div>
        ) : filteredReservations.length === 0 ? (
          <div className="mt-12 flex flex-col items-center justify-center gap-3 text-center">
            <Sparkles className="size-12 text-muted-foreground/50" />
            <h2 className="font-serif text-xl font-semibold">Ninguna reserva matchea el filtro</h2>
            <p className="text-sm text-muted-foreground">
              Hay {reservations.length} {reservations.length === 1 ? 'reserva' : 'reservas'} en el
              día, pero ninguna del tipo seleccionado.
            </p>
            <Button variant="outline" className="mt-2" onClick={() => handleMealsChange(new Set())}>
              Quitar filtro
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {ZONE_ORDER.map((zone) => {
              const rows = grouped[zone]
              const eventList = zone === 'event_floating' ? filteredEvents : []
              return (
                <ZoneColumn
                  key={zone}
                  title={ZONE_TITLES[zone]}
                  zone={zone}
                  rows={rows}
                  events={eventList}
                  tenantSlug={tenantSlug}
                  canOperate={canOperate}
                />
              )
            })}
          </div>
        )}
        {isFiltered ? (
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Mostrando {filteredReservations.length} de {reservations.length}{' '}
            {reservations.length === 1 ? 'reserva' : 'reservas'} — filtro activo
          </p>
        ) : null}
      </div>
    </>
  )
}

function ZoneColumn({
  title,
  zone,
  rows,
  events,
  tenantSlug,
  canOperate,
}: {
  title: string
  zone: SalonZone
  rows: ReservationWithJoins[]
  events: ScheduledEventWithTemplate[]
  tenantSlug: string
  canOperate: boolean
}) {
  // Agrupar reservas event_floating por scheduled_event_id
  const byEvent = useMemo(() => {
    if (zone !== 'event_floating') return null
    const out = new Map<string, ReservationWithJoins[]>()
    for (const r of rows) {
      const k = r.scheduled_event_id ?? '__no_event__'
      const arr = out.get(k) ?? []
      arr.push(r)
      out.set(k, arr)
    }
    return out
  }, [rows, zone])

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card/30 p-3">
      <header className="flex items-center justify-between px-1">
        <h2 className="font-serif text-base font-semibold">{title}</h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="my-2 rounded-lg border border-dashed border-border/60 bg-card/40 px-3 py-6 text-center text-xs text-muted-foreground">
          Vacío
        </div>
      ) : null}

      {byEvent ? (
        Array.from(byEvent.entries()).map(([eventId, list]) => {
          const event = events.find((e) => e.id === eventId)
          return (
            <div key={eventId} className="space-y-2">
              {event ? (
                <div
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: `${event.template?.color_hex ?? '#7c3aed'}15`,
                    color: event.template?.color_hex ?? '#7c3aed',
                  }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: event.template?.color_hex ?? '#7c3aed' }}
                  />
                  {event.name_override ?? event.template?.name ?? 'Evento'}
                </div>
              ) : null}
              <AnimatePresence initial={false}>
                {list.map((r) => (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                  >
                    <ReservationCard
                      tenantSlug={tenantSlug}
                      reservation={r}
                      canOperate={canOperate}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )
        })
      ) : (
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
            >
              <ReservationCard tenantSlug={tenantSlug} reservation={r} canOperate={canOperate} />
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </section>
  )
}
