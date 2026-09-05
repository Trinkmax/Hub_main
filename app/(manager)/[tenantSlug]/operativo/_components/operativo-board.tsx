'use client'

import { AnimatePresence, LayoutGroup, MotionConfig } from 'motion/react'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetGrabber, SheetTitle } from '@/components/ui/sheet'
import { awardPointsByAmount } from '@/lib/points/actions'
import type { EarnRate } from '@/lib/points/earn-rate'
import type { RecentQrAward } from '@/lib/points/queries'
import { type AnyRealtimePayload, mergeRow } from '@/lib/realtime/optimistic-merge'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import {
  type ActionState,
  closeTable,
  linkReservationCustomer,
  markArrived,
  markNoShow,
  revertStatus,
  updateActualGuests,
  updateReservationTableLabel,
  updateSalonReservation,
} from '@/lib/salon/actions'
import { fetchOperativoExtras, fetchReservationsForDate } from '@/lib/salon/client-actions'
import { buildDayHighlights, usedByEventMap } from '@/lib/salon/day-highlights'
import {
  type BoardFilter,
  countByFilter,
  filterForBoard,
  nameDisambiguation,
  nightPulse,
  normalizeText,
  nowMarkerIndex,
  occupiedTables,
  urgencyOf,
} from '@/lib/salon/operativo'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { groupByService } from '@/lib/salon/services'
import type {
  DayCapacityBucket,
  ReservationWithJoins,
  SalonReservationStatus,
} from '@/lib/salon/types'
import { fullUpdatePayload } from '@/lib/salon/update-payload'
import type { TenantRole } from '@/lib/tenant/types'
import { cn } from '@/lib/utils'
import { DayNav } from './day-nav'
import { PulseCard } from './pulse-card'
import { PulseExtended } from './pulse-extended'
import { ReservationCard } from './reservation-card'
import { ReservationList } from './reservation-list'
import { type PanelMode, ReservationPanel } from './reservation-panel'
import { ServiceBar } from './service-bar'
import { useBoardClock } from './use-board-clock'
import { useHaptic } from './use-haptic'
import { useIsDesktop } from './use-is-desktop'

// Realtime es el camino principal; esto es la red de seguridad.
const SAFETY_NET_INTERVAL_MS = 60_000
const FILTER_STORAGE_KEY = 'hub_operativo_filter'
const UNDO_MS = 6000

export type AwardsByCustomer = Record<string, RecentQrAward>

export type BoardActions = {
  arrive: (id: string, guests: number, tableLabel: string | null) => Promise<boolean>
  noShow: (id: string) => Promise<void>
  revert: (id: string, to: SalonReservationStatus) => Promise<void>
  setTable: (id: string, label: string | null) => Promise<boolean>
  setGuests: (id: string, guests: number) => Promise<boolean>
  close: (id: string, guests: number) => Promise<boolean>
  linkCustomer: (id: string) => Promise<boolean>
  award: (
    id: string,
    customerId: string,
    amountCents: number,
  ) => Promise<{ ok: true; points: number; newBalance: number } | { ok: false; message: string }>
}

type Props = {
  tenantSlug: string
  tenantId: string
  role: TenantRole
  date: string
  today: string
  initialReservations: ReservationWithJoins[]
  initialCapacity: DayCapacityBucket[]
  initialEvents: ScheduledEventWithTemplate[]
  initialAwards: RecentQrAward[]
  earnRate: EarnRate | null
  canOperate: boolean
  canAward: boolean
  /** Puede vincular la reserva a un socio (STAFF: dueño, caja, anfitrión). */
  canLink: boolean
  isOwner: boolean
}

function toAwardMap(list: RecentQrAward[]): AwardsByCustomer {
  const map: AwardsByCustomer = {}
  for (const a of list) if (!map[a.customer_id]) map[a.customer_id] = a
  return map
}

function readStoredFilter(): BoardFilter {
  try {
    const v = window.sessionStorage.getItem(FILTER_STORAGE_KEY)
    if (v === 'all' || v === 'waiting' || v === 'inside' || v === 'done') return v
  } catch {
    // sessionStorage puede no existir (modo privado, iframe): default.
  }
  return 'all'
}

/**
 * El tablero de la noche. Todo el estado vive acá y baja a las piezas:
 *
 *  - la lista se filtra y ordena en cliente (`lib/salon/operativo`) sobre el
 *    array vivo, que Realtime mantiene al día;
 *  - cada acción es OPTIMISTA: la fila cambia al toque, la Server Action
 *    confirma con `data.row`, y si falla se vuelve atrás con un toast;
 *  - las acciones reversibles no piden confirmación: tienen "Deshacer" 6 s.
 *    Solo "volver a pendiente" desde llegó (liquida comisión) confirma.
 */
export function OperativoBoard({
  tenantSlug,
  tenantId,
  date,
  today,
  initialReservations,
  initialCapacity,
  initialEvents,
  initialAwards,
  earnRate,
  canOperate,
  canAward,
  canLink,
  isOwner,
}: Props) {
  const router = useRouter()
  const haptic = useHaptic()
  const [, startTransition] = useTransition()

  const [reservations, setReservations] = useState(initialReservations)
  const [capacity, setCapacity] = useState(initialCapacity)
  const [events, setEvents] = useState(initialEvents)
  const [awards, setAwards] = useState<AwardsByCustomer>(() => toAwardMap(initialAwards))
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilterState] = useState<BoardFilter>('all')
  const [eventFilter, setEventFilter] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>('detail')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [live, setLive] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [remoteTouched, setRemoteTouched] = useState<Record<string, number>>({})
  const [pulseInView, setPulseInView] = useState(true)

  const clock = useBoardClock(date)
  const isDesktop = useIsDesktop()

  // (Cambiar de día remonta el tablero entero: page.tsx lo keyea por fecha.)
  const isToday = date === today
  const isFuture = date > today

  // Acciones propias en vuelo: un UPDATE de Realtime de esas filas es nuestro
  // propio eco, no un cambio "del salón" que haya que resaltar.
  const ownPending = useRef(new Map<string, number>())
  const markOwn = useCallback((id: string) => {
    ownPending.current.set(id, Date.now())
  }, [])

  // El array vivo también por ref: las acciones y los "Deshacer" de los toasts
  // tienen que leer el estado ACTUAL, no el del render en que se crearon.
  const reservationsRef = useRef(reservations)
  reservationsRef.current = reservations

  // La fecha activa por ref: un fetch del día anterior que resuelve tarde no
  // puede pisar el tablero del día nuevo.
  const activeDate = useRef(date)
  activeDate.current = date

  /**
   * Mezcla una lista fresca del server sin pisar filas con una acción propia
   * en vuelo (el fetch / el RSC pueden haber salido antes de que el server la
   * escribiera). Vale tanto para el refetch como para el re-render del RSC.
   */
  const mergeFresh = useCallback((fresh: ReservationWithJoins[]) => {
    setReservations((prev) => {
      const now = Date.now()
      return fresh.map((row) => {
        const stamp = ownPending.current.get(row.id)
        if (stamp && now - stamp < 4000) return prev.find((p) => p.id === row.id) ?? row
        return row
      })
    })
  }, [])

  // ── Estado inicial y re-sync ─────────────────────────────────────────
  useEffect(() => mergeFresh(initialReservations), [initialReservations, mergeFresh])
  useEffect(() => setCapacity(initialCapacity), [initialCapacity])
  useEffect(() => setEvents(initialEvents), [initialEvents])
  useEffect(() => setAwards(toAwardMap(initialAwards)), [initialAwards])
  useEffect(() => {
    setFilterState(readStoredFilter())
  }, [])

  const setFilter = useCallback((next: BoardFilter) => {
    setFilterState(next)
    try {
      window.sessionStorage.setItem(FILTER_STORAGE_KEY, next)
    } catch {
      // sin memoria de filtro: no pasa nada
    }
  }, [])

  const customerIds = useMemo(
    () =>
      Array.from(
        new Set(reservations.map((r) => r.customer_id).filter((id): id is string => Boolean(id))),
      ),
    [reservations],
  )
  const customerIdsRef = useRef(customerIds)
  customerIdsRef.current = customerIds

  const refreshExtras = useCallback(async () => {
    const r = await fetchOperativoExtras(tenantSlug, date, customerIdsRef.current)
    if (!r.ok || activeDate.current !== date) return
    setCapacity(r.buckets)
    setEvents(r.events)
    setAwards(toAwardMap(r.awards))
  }, [tenantSlug, date])

  const refreshReservations = useCallback(async () => {
    const res = await fetchReservationsForDate(tenantSlug, date)
    if (!res.ok || activeDate.current !== date) return
    mergeFresh(res.reservations)
  }, [tenantSlug, date, mergeFresh])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshReservations(), refreshExtras()])
  }, [refreshReservations, refreshExtras])

  const debouncedExtras = useDebouncedRefresh(refreshExtras, 600)
  const debouncedReservations = useDebouncedRefresh(refreshReservations, 900)

  // ── Realtime ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let joinedOnce = false
    // Con staleTimes la página puede venir del Client Router Cache: sincronizar YA.
    void refreshReservations()
    void refreshExtras()

    const cleanup = subscribeChanges({
      channel: `operativo-${tenantId}-${date}`,
      events: [
        {
          event: '*',
          table: 'salon_reservations',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: (raw) => {
            if (cancelled) return
            const payload = raw as AnyRealtimePayload
            const next = payload.new as ReservationWithJoins | undefined
            const id = (next?.id ?? (payload.old as { id?: string } | undefined)?.id) as
              | string
              | undefined
            const own = id ? ownPending.current.get(id) : undefined
            const isOwnEcho = Boolean(own && Date.now() - (own ?? 0) < 4000)
            let fkChanged = false
            setReservations((prev) => {
              // Una acción propia en vuelo manda: sus ecos intermedios (p. ej.
              // "sentada" antes de "cerrada" al cerrar mesa) no pisan lo que
              // ya mostramos; la action confirma con su propia fila al final.
              if (payload.eventType === 'UPDATE' && isOwnEcho) return prev
              // Guard de updated_at: un payload viejo no pisa un cambio optimista.
              if (payload.eventType === 'UPDATE' && next?.updated_at) {
                const current = prev.find((r) => r.id === next.id)
                if (current?.updated_at && current.updated_at > next.updated_at) return prev
                // Si cambió una FK, los joins que tenemos quedaron viejos.
                if (
                  !current ||
                  current.customer_id !== next.customer_id ||
                  current.cake_option_id !== next.cake_option_id ||
                  current.primary_manager_id !== next.primary_manager_id ||
                  current.assistant_manager_id !== next.assistant_manager_id ||
                  current.scheduled_event_id !== next.scheduled_event_id
                ) {
                  fkChanged = true
                }
              }
              return mergeRow<ReservationWithJoins>(
                prev,
                payload,
                (r) => r.id,
                (r) => r.reservation_date === date,
              )
            })
            if (id) {
              if (!isOwnEcho) {
                setRemoteTouched((m) => ({ ...m, [id]: Date.now() }))
                window.setTimeout(
                  () =>
                    setRemoteTouched((m) => {
                      const { [id]: _gone, ...rest } = m
                      return rest
                    }),
                  1200,
                )
              }
            }
            // Un INSERT llega sin joins (gestor, socio, torta): completar. Y un
            // UPDATE que movió una FK también deja los joins viejos.
            if (payload.eventType === 'INSERT' || fkChanged) debouncedReservations()
            debouncedExtras()
          },
        },
        {
          event: '*',
          table: 'scheduled_events',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: () => debouncedExtras(),
        },
      ],
      // El punto "en vivo" dice la verdad del canal. Tras una reconexión se
      // re-sincroniza todo: lo que pasó en el hueco no vuelve a llegar.
      onStatus: (status) => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') {
          setLive('live')
          if (joinedOnce) {
            void refreshReservations()
            void refreshExtras()
          }
          joinedOnce = true
        } else {
          setLive('offline')
        }
      },
    })

    const onOnline = () => {
      // Vuelve la red; el canal avisará SUBSCRIBED cuando re-joinee. Mientras,
      // los datos se piden igual.
      void refreshReservations()
      void refreshExtras()
    }
    const onOffline = () => setLive('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) setLive('offline')

    return () => {
      cancelled = true
      cleanup()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [tenantId, date, refreshReservations, refreshExtras, debouncedExtras, debouncedReservations])

  // Red de seguridad: reservas Y extras (al volver de segundo plano, Realtime
  // puede haberse perdido cambios).
  useVisibleInterval(refreshAll, SAFETY_NET_INTERVAL_MS)

  // ── Derivados ────────────────────────────────────────────────────────
  const searching = normalizeText(deferredQuery).length > 0
  const visible = useMemo(() => {
    const rows = filterForBoard(reservations, { query: deferredQuery, filter })
    return eventFilter && !searching
      ? rows.filter((r) => r.scheduled_event_id === eventFilter)
      : rows
  }, [reservations, deferredQuery, filter, eventFilter, searching])

  const counts = useMemo(() => countByFilter(reservations), [reservations])
  const pulse = useMemo(
    () => nightPulse(reservations, clock.minutes),
    [reservations, clock.minutes],
  )
  const disambiguation = useMemo(() => nameDisambiguation(reservations), [reservations])
  const occupied = useMemo(
    () => occupiedTables(reservations, selectedId ?? undefined),
    [reservations, selectedId],
  )
  // Las etiquetas crudas de la noche (para los atajos del editor de mesa).
  const usedToday = useMemo(
    () =>
      reservations
        .filter((r) => r.table_label && r.status !== 'cancelled')
        .map((r) => r.table_label as string),
    [reservations],
  )
  const highlights = useMemo(
    () =>
      buildDayHighlights({
        events,
        reservations,
        usedByEvent: usedByEventMap(capacity),
      }),
    [events, reservations, capacity],
  )
  const cancelled = useMemo(
    () => reservations.filter((r) => r.status === 'cancelled'),
    [reservations],
  )
  const groups = useMemo(() => groupByService(visible), [visible])
  // El marcador se calcula sobre el orden en que se RENDERIZA (por servicio y
  // adentro por hora), no sobre la lista plana: si no, un evento HUB de las 20
  // renderizado después de la cena corría la línea de lugar.
  const markerIndex = useMemo(() => {
    if (searching) return null
    return nowMarkerIndex(
      groups.flatMap((g) => g.rows),
      clock.minutes,
    )
  }, [groups, clock.minutes, searching])

  const selected = selectedId ? (reservations.find((r) => r.id === selectedId) ?? null) : null

  // Si la seleccionada desapareció (cambió de día, la borraron), cerrar.
  useEffect(() => {
    if (selectedId && !reservations.some((r) => r.id === selectedId)) {
      setSelectedId(null)
      setSheetOpen(false)
    }
  }, [selectedId, reservations])

  // ── Mutaciones optimistas ────────────────────────────────────────────
  const patchRow = useCallback((id: string, patch: Partial<ReservationWithJoins>) => {
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const snapshotOf = useCallback(
    (id: string) => reservationsRef.current.find((r) => r.id === id) ?? null,
    [],
  )

  const restore = useCallback((row: ReservationWithJoins | null) => {
    if (!row) return
    setReservations((prev) => prev.map((r) => (r.id === row.id ? row : r)))
  }, [])

  /** Aplica la fila confirmada por el server sin perder los joins locales. */
  const confirm = useCallback(
    (id: string, result: ActionState) => {
      const row = result.ok ? (result.data?.row as Partial<ReservationWithJoins> | undefined) : null
      if (row) patchRow(id, row)
    },
    [patchRow],
  )

  const undoToast = useCallback((id: string, message: string, undo: () => Promise<void>) => {
    toast(message, {
      id: `op-${id}`,
      duration: UNDO_MS,
      action: {
        label: 'Deshacer',
        onClick: () => {
          void undo()
        },
      },
    })
  }, [])

  const actions = useMemo<BoardActions>(() => {
    const revertQuiet = async (id: string, to: SalonReservationStatus): Promise<boolean> => {
      const before = snapshotOf(id)
      markOwn(id)
      patchRow(id, { status: to })
      const res = await revertStatus(tenantSlug, id, to)
      if (!res.ok) {
        restore(before)
        toast.error(res.message)
        return false
      }
      confirm(id, res)
      return true
    }

    return {
      async arrive(id, guests, tableLabel) {
        const before = snapshotOf(id)
        if (!before) return false
        markOwn(id)
        patchRow(id, {
          status: 'arrived',
          actual_guests: guests,
          table_label: tableLabel ?? before.table_label,
          arrived_at: before.arrived_at ?? new Date().toISOString(),
        })
        const res = await markArrived(tenantSlug, id, guests, tableLabel ?? undefined)
        if (!res.ok) {
          restore(before)
          toast.error(res.message)
          return false
        }
        confirm(id, res)
        haptic(12)
        if (res.message) toast.warning(res.message)
        undoToast(
          id,
          `${before.guest_name} llegó · ${guests} ${guests === 1 ? 'persona' : 'personas'}${
            tableLabel ? ` · Mesa ${tableLabel}` : ''
          }`,
          async () => {
            await revertQuiet(id, 'pending')
          },
        )
        return true
      },

      async noShow(id) {
        const before = snapshotOf(id)
        if (!before) return
        markOwn(id)
        patchRow(id, { status: 'no_show' })
        const res = await markNoShow(tenantSlug, id)
        if (!res.ok) {
          restore(before)
          toast.error(res.message)
          return
        }
        confirm(id, res)
        undoToast(id, `${before.guest_name} · no vino`, async () => {
          await revertQuiet(id, 'pending')
        })
      },

      async revert(id, to) {
        const before = snapshotOf(id)
        if (!before) return
        const ok = await revertQuiet(id, to)
        if (!ok) return
        const label =
          to === 'pending'
            ? `${before.guest_name} · vuelve a "por llegar"`
            : to === 'arrived'
              ? `${before.guest_name} · vuelve a "llegó"`
              : `${before.guest_name} · mesa reabierta`
        undoToast(id, label, async () => {
          await revertQuiet(id, before.status)
        })
      },

      async setTable(id, label) {
        const before = snapshotOf(id)
        if (!before) return false
        markOwn(id)
        patchRow(id, { table_label: label })
        const res = await updateReservationTableLabel(tenantSlug, { id, table_label: label })
        if (!res.ok) {
          restore(before)
          toast.error(res.message)
          return false
        }
        confirm(id, res)
        haptic(8)
        return true
      },

      async setGuests(id, guests) {
        const before = snapshotOf(id)
        if (!before) return false
        markOwn(id)
        // Antes de llegar se corrige lo RESERVADO (cambia cupo y escalón de
        // comisión); una vez adentro se corrige la asistencia real.
        const editingEstimate = before.status === 'pending'
        patchRow(id, editingEstimate ? { estimated_guests: guests } : { actual_guests: guests })
        const res = editingEstimate
          ? await updateSalonReservation(
              tenantSlug,
              fullUpdatePayload(before, { estimated_guests: guests }),
            )
          : await updateActualGuests(tenantSlug, { id, actual_guests: guests })
        if (!res.ok) {
          restore(before)
          toast.error(res.message)
          return false
        }
        confirm(id, res)
        return true
      },

      async close(id, guests) {
        const before = snapshotOf(id)
        if (!before) return false
        markOwn(id)
        patchRow(id, {
          status: 'closed',
          actual_guests: guests,
          closed_at: new Date().toISOString(),
        })
        const res = await closeTable(tenantSlug, { id, actual_guests: guests })
        if (!res.ok) {
          restore(before)
          toast.error(res.message)
          return false
        }
        confirm(id, res)
        haptic(12)
        undoToast(id, `${before.guest_name} · mesa cerrada`, async () => {
          await revertQuiet(id, 'seated')
        })
        return true
      },

      async linkCustomer(id) {
        const res = await linkReservationCustomer(tenantSlug, id)
        if (!res.ok) {
          toast.error(res.message)
          return false
        }
        const customer = res.data?.customer as ReservationWithJoins['customer'] | undefined
        const customerId = res.data?.customer_id as string | undefined
        if (customerId) {
          markOwn(id)
          patchRow(id, { customer_id: customerId, ...(customer ? { customer } : {}) })
        }
        toast.success(res.message ?? 'Vinculada.')
        return true
      },

      async award(_id, customerId, amountCents) {
        const res = await awardPointsByAmount(tenantSlug, {
          customer_id: customerId,
          amount_cents: amountCents,
        })
        if (!res.ok) return { ok: false, message: res.message }
        haptic([10, 30, 10])
        const at = new Date().toISOString()
        setAwards((prev) => ({
          ...prev,
          [customerId]: {
            customer_id: customerId,
            points: res.points_awarded,
            amount_cents: res.amount_cents,
            created_at: at,
          },
        }))
        setReservations((prev) =>
          prev.map((r) =>
            r.customer?.id === customerId && r.customer
              ? { ...r, customer: { ...r.customer, points_balance: res.new_balance } }
              : r,
          ),
        )
        // La action no revalida /operativo: refrescar el RSC en segundo plano
        // para que la próxima navegación ya traiga el saldo nuevo.
        startTransition(() => router.refresh())
        return { ok: true, points: res.points_awarded, newBalance: res.new_balance }
      },
    }
  }, [tenantSlug, snapshotOf, patchRow, restore, confirm, undoToast, haptic, router, markOwn])

  // ── Navegación entre reservas ────────────────────────────────────────
  const openPanel = useCallback(
    (id: string, mode: PanelMode = 'detail') => {
      setSelectedId(id)
      setPanelMode(mode)
      // En desktop el panel ya está a la vista (aside): no hay sheet que abrir.
      setSheetOpen(!isDesktop)
    },
    [isDesktop],
  )

  // Si el viewport cruza el límite con el sheet abierto, el aside ya lo muestra.
  useEffect(() => {
    if (isDesktop) setSheetOpen(false)
  }, [isDesktop])

  const closePanel = useCallback(() => {
    setSheetOpen(false)
    setPanelMode('detail')
    setSelectedId(null)
  }, [])

  const gotoDate = useCallback(
    (d: string) => {
      setSelectedId(null)
      setSheetOpen(false)
      router.push(d === today ? `/${tenantSlug}/operativo` : `/${tenantSlug}/operativo?date=${d}`)
    },
    [router, tenantSlug, today],
  )

  // Atajos de teclado (desktop): "/" busca, Esc limpia/cierra, ↑↓ recorren, Enter abre.
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Radix (menú, diálogo, popover) ya usó la tecla: no la pisamos.
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      // Con el foco en un botón, link o capa flotante, Enter y las flechas son
      // de ese control, no del tablero.
      const onControl = Boolean(
        target?.closest(
          'button, a, select, [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
        ),
      )
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.key === 'Escape') {
        if (typing && target === searchRef.current) {
          setQuery('')
          searchRef.current?.blur()
          return
        }
        if (onControl && target?.closest('[role="dialog"], [role="menu"]')) return
        if (sheetOpen) closePanel()
        else if (selectedId) setSelectedId(null)
        return
      }
      if (typing || onControl) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
        if (visible.length === 0) return
        e.preventDefault()
        const idx = visible.findIndex((r) => r.id === selectedId)
        const dir = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1
        const next = visible[(idx + dir + visible.length) % visible.length]
        if (next) {
          setSelectedId(next.id)
          setPanelMode('detail')
        }
        return
      }
      if (e.key === 'Enter' && selectedId) {
        e.preventDefault()
        openPanel(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, selectedId, sheetOpen, openPanel, closePanel])

  // ── Render ───────────────────────────────────────────────────────────
  const panel = selected ? (
    <ReservationPanel
      key={selected.id}
      tenantSlug={tenantSlug}
      reservation={selected}
      mode={panelMode}
      onModeChange={setPanelMode}
      actions={actions}
      award={selected.customer_id ? (awards[selected.customer_id] ?? null) : null}
      earnRate={earnRate}
      occupied={occupied}
      usedToday={usedToday}
      clock={clock.minutes}
      isFuture={isFuture}
      canOperate={canOperate}
      canAward={canAward}
      canLink={canLink}
      isOwner={isOwner}
      onClose={closePanel}
      remoteTouched={Boolean(remoteTouched[selected.id])}
    />
  ) : null

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-screen-2xl px-4 pb-16 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <DayNav
          date={date}
          today={today}
          onChange={gotoDate}
          live={live}
          tenantSlug={tenantSlug}
          canAward={canAward}
        />

        <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6">
          <div className="min-w-0">
            <PulseCard
              pulse={pulse}
              reservations={reservations}
              capacity={capacity}
              highlights={highlights}
              clock={clock}
              isToday={isToday}
              filter={filter}
              onFilter={setFilter}
              eventFilter={eventFilter}
              onEventFilter={setEventFilter}
              onInViewChange={setPulseInView}
            />

            <ServiceBar
              ref={searchRef}
              query={query}
              onQuery={setQuery}
              filter={filter}
              onFilter={setFilter}
              counts={counts}
              late={pulse.late}
              progress={pulse.progress}
              showRail={!pulseInView}
              resultCount={searching ? visible.length : null}
              tenantSlug={tenantSlug}
              date={date}
              canAward={canAward}
            />

            <LayoutGroup id="operativo">
              <ReservationList
                groups={groups}
                total={visible.length}
                searching={searching}
                query={deferredQuery}
                filter={filter}
                eventFilter={eventFilter}
                onClearEventFilter={() => setEventFilter(null)}
                markerIndex={markerIndex}
                nowLabel={clock.hhmm}
                cancelled={cancelled}
                tenantSlug={tenantSlug}
                date={date}
                isToday={isToday}
                emptyAll={counts.all === 0}
                renderCard={(r, flatIndex) => (
                  <ReservationCard
                    key={r.id}
                    reservation={r}
                    urgency={urgencyOf(r, clock.minutes)}
                    clock={clock.minutes}
                    query={deferredQuery}
                    suffix={disambiguation.get(r.id) ?? null}
                    award={r.customer_id ? (awards[r.customer_id] ?? null) : null}
                    selected={selectedId === r.id}
                    remoteTouched={Boolean(remoteTouched[r.id])}
                    canOperate={canOperate && !isFuture}
                    index={flatIndex}
                    onOpen={() => openPanel(r.id)}
                    onArrive={() => openPanel(r.id, 'arrive')}
                    onNoShow={() => void actions.noShow(r.id)}
                    onReappear={() => void actions.revert(r.id, 'pending')}
                    onTable={() => openPanel(r.id, 'table')}
                  />
                )}
              />
            </LayoutGroup>
          </div>

          {/* Desktop: el detalle vive al lado, pegado bajo el topbar. */}
          <aside className="hidden lg:block lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
            <AnimatePresence mode="wait" initial={false}>
              {panel && isDesktop ? (
                <div
                  key={selected?.id}
                  className={cn(
                    'card-hairline rounded-2xl border bg-card shadow-xs',
                    'animate-in fade-in-0 slide-in-from-right-2 duration-(--duration-base) motion-reduce:animate-none',
                  )}
                >
                  {panel}
                </div>
              ) : (
                <PulseExtended
                  key="extended"
                  pulse={pulse}
                  reservations={reservations}
                  capacity={capacity}
                  events={events}
                  highlights={highlights}
                  isToday={isToday}
                />
              )}
            </AnimatePresence>
          </aside>
        </div>
      </div>

      {/* Mobile / tablet: el mismo panel, en un sheet desde abajo. */}
      <Sheet
        open={sheetOpen && Boolean(selected) && !isDesktop}
        onOpenChange={(open) => {
          if (!open) closePanel()
        }}
      >
        <SheetContent
          side="bottom"
          showClose={false}
          aria-describedby={undefined}
          className="max-h-[92dvh] gap-0 px-0 pt-0 data-[state=closed]:duration-(--duration-base) data-[state=open]:duration-(--duration-slow)"
        >
          <SheetGrabber />
          <SheetTitle className="sr-only">
            {selected ? `Reserva de ${selected.guest_name}` : 'Reserva'}
          </SheetTitle>
          {/* El scroll vive adentro: el grabber y el borde redondeado quedan fijos. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3">
            {isDesktop ? null : panel}
          </div>
        </SheetContent>
      </Sheet>
    </MotionConfig>
  )
}
