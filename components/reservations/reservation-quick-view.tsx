'use client'

import { Check, ChevronDown, Clock, MapPin, Minus, Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ContactButton } from '@/components/messaging/contact-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { updateActualGuests, updateSalonReservation } from '@/lib/salon/actions'
import { fetchDayCapacity } from '@/lib/salon/client-actions'
import {
  type DayCapacityBucket,
  MEAL_TYPE_LABELS,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationWithJoins,
  type SalonZone,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { ReservationStatusControls } from './reservation-status-controls'
import { StatusPill } from './status-pill'

function fmtTime(t: string): string {
  return t.slice(0, 5)
}
function fmtDate(d: string): string {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}
function zoneOrEvent(r: ReservationWithJoins): string {
  if (r.zone === 'event_floating') return r.scheduled_event?.template?.name ?? 'Evento'
  return ZONE_LABELS[r.zone]
}

/**
 * Popup de vista + gestión rápida de una reserva. Reemplaza la navegación a la
 * página de detalle desde el listado. La edición a fondo sigue en /reservas/[id]
 * vía el botón "Edición completa".
 *
 * Incluye edición rápida de personas (stepper optimista con debounce), hora y
 * zona — pensado para el caso "reservé para 6 pero somos 10" resuelto en
 * segundos desde la lista, sin ir al formulario completo.
 *
 * `trigger` permite usar una fila completa como disparador (popup del día).
 * `onChanged` refresca el contenedor cuando aplica (popup del día).
 */
export function ReservationQuickView({
  tenantSlug,
  reservation,
  onChanged,
  trigger,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const r = reservation
  const editable = r.status !== 'cancelled' && r.status !== 'no_show'
  const guests = r.actual_guests ?? r.estimated_guests
  const guestsHint =
    r.actual_guests != null && r.actual_guests !== r.estimated_guests
      ? ` (est. ${r.estimated_guests})`
      : ''

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm">
            Ver
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 font-serif">
            <span className="truncate">{r.guest_name}</span>
            <StatusPill status={r.status} />
          </DialogTitle>
        </DialogHeader>

        {editable ? (
          <QuickEditPanel tenantSlug={tenantSlug} reservation={r} onChanged={onChanged} />
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Cuándo">
            {fmtDate(r.reservation_date)}
            {editable ? '' : ` · ${fmtTime(r.reservation_time_local)}`}
          </Field>
          {editable ? null : <Field label="Dónde">{zoneOrEvent(r)}</Field>}
          <Field label="Servicio">{MEAL_TYPE_LABELS[r.meal_type]}</Field>
          <Field label="Naturaleza">{RESERVATION_KIND_LABELS[r.kind]}</Field>
          {editable ? null : (
            <Field label="Personas">
              <span className="tabular-nums">{guests}</span>
              <span className="text-[11px] text-muted-foreground">{guestsHint}</span>
            </Field>
          )}
          <Field label="Origen">{ORIGIN_LABELS[r.origin]}</Field>
          <Field label="Gestor">
            {r.primary_manager?.display_name ?? '—'}
            {r.assistant_manager ? ` + ${r.assistant_manager.display_name}` : ''}
          </Field>
          {r.cake_count > 0 || r.champagne_count > 0 ? (
            <Field label="Cumpleaños">
              {r.cake_count > 0 ? `🎂 ${r.cake_count}` : ''}
              {r.cake_count > 0 && r.champagne_count > 0 ? ' · ' : ''}
              {r.champagne_count > 0 ? `🍾 ${r.champagne_count}` : ''}
            </Field>
          ) : null}
        </dl>

        {r.comments ? (
          <p className="rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground">
            {r.comments}
          </p>
        ) : null}

        <div data-tour="quick-estado">
          <ReservationStatusControls
            tenantSlug={tenantSlug}
            reservation={r}
            onChanged={onChanged}
            showActualGuestsEditor={false}
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/${tenantSlug}/reservas/${r.id}`}>Edición completa</Link>
            </Button>
            {r.customer?.phone || r.guest_phone ? (
              <ContactButton
                tenantSlug={tenantSlug}
                phone={r.customer?.phone ?? r.guest_phone ?? ''}
                customerId={r.customer?.id}
                name={r.guest_name}
              />
            ) : null}
          </div>
          <DialogClose asChild>
            <Button variant="ghost">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Bloque de edición rápida: personas (stepper − / +, optimista con debounce de
 * 600ms y flush al cerrar el popup), hora y zona como chips con mini popover.
 *
 * - pending/arrived → edita `estimated_guests` vía updateSalonReservation
 *   (payload completo armado desde la reserva actual).
 * - seated/closed → edita `actual_guests` vía updateActualGuests (recalcula
 *   comisión server-side).
 * - Advertencia inline no bloqueante si el número proyectado supera la
 *   capacidad del día (fetchDayCapacity al abrir el popup).
 */
function QuickEditPanel({
  tenantSlug,
  reservation: r,
  onChanged,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
}) {
  const isPost = r.status === 'seated' || r.status === 'closed'
  const serverGuests = isPost ? (r.actual_guests ?? r.estimated_guests) : r.estimated_guests
  const serverZone = r.zone
  const serverTime = fmtTime(r.reservation_time_local)

  const [pending, startTransition] = useTransition()

  // Estado optimista (el número/chip cambia YA; si el guardado falla, revierte).
  const [guests, setGuests] = useState(serverGuests)
  const [zone, setZone] = useState<SalonZone>(serverZone)
  const [time, setTime] = useState(serverTime)

  // Refs espejo para leer el valor vigente desde closures (debounce, flush).
  const guestsRef = useRef(guests)
  const zoneRef = useRef(zone)
  const timeRef = useRef(time)
  const serverGuestsRef = useRef(serverGuests)
  const serverZoneRef = useRef(serverZone)
  const serverTimeRef = useRef(serverTime)
  serverGuestsRef.current = serverGuests
  serverZoneRef.current = serverZone
  serverTimeRef.current = serverTime

  const guestsDirtyRef = useRef(false)
  const zoneDirtyRef = useRef(false)
  const timeDirtyRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function setGuestsBoth(n: number) {
    guestsRef.current = n
    setGuests(n)
  }
  function setZoneBoth(z: SalonZone) {
    zoneRef.current = z
    setZone(z)
  }
  function setTimeBoth(t: string) {
    timeRef.current = t
    setTime(t)
  }

  // Re-sincronizar desde el server cuando el contenedor refresca (router.refresh
  // o load() del popup del día) y no hay una edición local en curso.
  const snapshot = `${serverGuests}|${serverZone}|${serverTime}`
  const [prevSnapshot, setPrevSnapshot] = useState(snapshot)
  if (prevSnapshot !== snapshot) {
    setPrevSnapshot(snapshot)
    if (!guestsDirtyRef.current) setGuestsBoth(serverGuests)
    if (!zoneDirtyRef.current) setZoneBoth(serverZone)
    if (!timeDirtyRef.current) setTimeBoth(serverTime)
  }

  // Capacidad del día — hint no bloqueante. Se lee al abrir el popup y se
  // vuelve a leer cuando el server refresca la reserva tras un guardado (los
  // campos de las deps son los que mueven el `used` del bucket). Si falla,
  // simplemente no hay advertencia.
  const [buckets, setBuckets] = useState<DayCapacityBucket[] | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps "de más" (guests/zone/status) fuerzan el refetch del snapshot cuando el server refresca la reserva tras guardar — sin eso el hint queda desfasado.
  useEffect(() => {
    let alive = true
    fetchDayCapacity(tenantSlug, r.reservation_date)
      .then((res) => {
        if (alive && res.ok) setBuckets(res.buckets)
      })
      .catch(() => {
        /* hint opcional: sin datos no hay advertencia */
      })
    return () => {
      alive = false
    }
  }, [tenantSlug, r.reservation_date, r.estimated_guests, r.actual_guests, r.zone, r.status])

  /**
   * Payload completo para updateSalonReservation: la action exige el objeto
   * entero, así que copiamos la reserva actual tal cual (fechas/enums sin
   * transformar) y pisamos solo lo editado. Usa los refs para no perder un
   * cambio optimista concurrente (ej. cambiar zona con un stepper pendiente).
   */
  function panelPayload(patch: Record<string, unknown>): Record<string, unknown> {
    return {
      id: r.id,
      customer_id: r.customer_id,
      guest_name: r.guest_name,
      guest_phone: r.guest_phone,
      guest_email: r.guest_email,
      kind: r.kind,
      meal_type: r.meal_type,
      reservation_date: r.reservation_date,
      reservation_time_local: `${timeRef.current}:00`,
      zone: zoneRef.current,
      scheduled_event_id: r.scheduled_event_id,
      estimated_guests: isPost ? r.estimated_guests : guestsRef.current,
      actual_guests: isPost ? guestsRef.current : r.actual_guests,
      cake_count: r.cake_count,
      champagne_count: r.champagne_count,
      deposit_cents: r.deposit_cents,
      origin: r.origin,
      primary_manager_id: r.primary_manager_id,
      assistant_manager_id: r.assistant_manager_id,
      comments: r.comments,
      ...patch,
    }
  }

  function persistGuests(n: number) {
    if (isPost) return updateActualGuests(tenantSlug, { id: r.id, actual_guests: n })
    return updateSalonReservation(tenantSlug, panelPayload({ estimated_guests: n }))
  }

  function bump(delta: number) {
    const next = Math.max(1, Math.min(99, guestsRef.current + delta))
    if (next === guestsRef.current) return
    guestsDirtyRef.current = true
    setGuestsBoth(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      commitGuests(next)
    }, 600)
  }

  function commitGuests(n: number) {
    startTransition(async () => {
      const res = await persistGuests(n)
      if (res.ok) {
        // Si no volvió a tocar el stepper mientras guardábamos, quedó limpio.
        if (guestsRef.current === n) guestsDirtyRef.current = false
        onChanged?.()
      } else {
        guestsDirtyRef.current = false
        setGuestsBoth(serverGuestsRef.current)
        toast.error(res.message ?? 'No pudimos guardar la cantidad.')
      }
    })
  }

  // Si cierran el popup con un cambio de personas todavía en debounce, lo
  // guardamos igual al desmontar (fire-and-forget; el toast global avisa si falla).
  const flushRef = useRef<() => void>(() => {})
  flushRef.current = () => {
    if (!debounceRef.current) return
    clearTimeout(debounceRef.current)
    debounceRef.current = null
    void persistGuests(guestsRef.current).then((res) => {
      if (res.ok) onChanged?.()
      else toast.error(res.message ?? 'No pudimos guardar la cantidad.')
    })
  }
  useEffect(() => () => flushRef.current(), [])

  // ── Hora ──
  const [timeOpen, setTimeOpen] = useState(false)
  const [timeDraft, setTimeDraft] = useState(serverTime)
  function onTimeOpenChange(o: boolean) {
    if (o) setTimeDraft(timeRef.current)
    setTimeOpen(o)
  }
  function saveTime() {
    setTimeOpen(false)
    const t = timeDraft
    if (!/^\d{2}:\d{2}$/.test(t) || t === timeRef.current) return
    timeDirtyRef.current = true
    setTimeBoth(t)
    startTransition(async () => {
      const res = await updateSalonReservation(
        tenantSlug,
        panelPayload({ reservation_time_local: `${t}:00` }),
      )
      timeDirtyRef.current = false
      if (res.ok) {
        onChanged?.()
      } else {
        setTimeBoth(serverTimeRef.current)
        toast.error(res.message ?? 'No pudimos cambiar la hora.')
      }
    })
  }

  // ── Zona ──
  const [zoneOpen, setZoneOpen] = useState(false)
  function saveZone(z: 'planta_alta' | 'planta_baja') {
    setZoneOpen(false)
    if (z === zoneRef.current) return
    zoneDirtyRef.current = true
    setZoneBoth(z)
    startTransition(async () => {
      const res = await updateSalonReservation(tenantSlug, panelPayload({ zone: z }))
      zoneDirtyRef.current = false
      if (res.ok) {
        onChanged?.()
      } else {
        setZoneBoth(serverZoneRef.current)
        toast.error(res.message ?? 'No pudimos cambiar la zona.')
      }
    })
  }

  // ── Advertencia de capacidad (no bloqueante) ──
  const bucketKey = zone === 'event_floating' ? `event:${r.scheduled_event_id}` : `zone:${zone}`
  const originalKey =
    r.zone === 'event_floating' ? `event:${r.scheduled_event_id}` : `zone:${r.zone}`
  const bucket = buckets?.find((b) => b.bucket === bucketKey) ?? null
  // Lo que el snapshot ya cuenta para esta reserva (está incluida en `used`).
  const counted = r.actual_guests ?? r.estimated_guests
  const projected = bucket ? bucket.used - (bucketKey === originalKey ? counted : 0) + guests : null
  const overCapacity = bucket !== null && projected !== null && projected > bucket.capacity
  const bucketLabel =
    zone === 'event_floating'
      ? (r.scheduled_event?.template?.name ?? 'el evento')
      : ZONE_LABELS[zone]

  return (
    <section data-tour="quick-personas" className="rounded-xl border border-border/70 bg-card p-4">
      <header className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {isPost ? 'Personas reales' : 'Personas'}
        </span>
        <span aria-live="polite" className="text-[11px] text-muted-foreground">
          {pending ? 'Guardando…' : ''}
        </span>
      </header>

      <div className="flex items-center justify-center gap-5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 rounded-full"
          aria-label="Una persona menos"
          disabled={guests <= 1}
          onClick={() => bump(-1)}
        >
          <Minus className="size-5" />
        </Button>
        <div className="min-w-16 text-center">
          <div className="font-mono text-4xl font-semibold leading-none tabular-nums">{guests}</div>
          {isPost && guests !== r.estimated_guests ? (
            <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              est. {r.estimated_guests}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 rounded-full"
          aria-label="Una persona más"
          disabled={guests >= 99}
          onClick={() => bump(1)}
        >
          <Plus className="size-5" />
        </Button>
      </div>

      {overCapacity && bucket && projected !== null ? (
        <p className="mt-2 text-center text-xs text-amber-700 dark:text-amber-300">
          Ojo: quedarían {projected} personas en {bucketLabel} (capacidad {bucket.capacity}). Se
          guarda igual.
        </p>
      ) : null}
      {isPost && r.actual_guests === null ? (
        <p className="mt-2 text-center text-[11px] text-amber-700 dark:text-amber-300">
          Sin cantidad real cargada — la comisión se calcula sobre {r.estimated_guests} estimadas.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <Popover open={timeOpen} onOpenChange={onTimeOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 rounded-full px-4"
              aria-label={`Cambiar hora (actual ${time})`}
            >
              <Clock className="size-4 text-muted-foreground" />
              <span className="font-mono text-sm tabular-nums">{time}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Hora de la reserva
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
                className="h-11 flex-1 tabular-nums"
                aria-label="Nueva hora"
              />
              <Button
                type="button"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Guardar hora"
                onClick={saveTime}
              >
                <Check className="size-5" />
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {r.zone === 'event_floating' ? (
          <span className="inline-flex h-11 items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-4 text-sm">
            <Sparkles className="size-4 text-muted-foreground" />
            {r.scheduled_event?.template?.name ?? 'Evento'}
          </span>
        ) : (
          <Popover open={zoneOpen} onOpenChange={setZoneOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 rounded-full px-4"
                aria-label={`Cambiar zona (actual ${zone === 'event_floating' ? 'evento' : ZONE_LABELS[zone]})`}
              >
                <MapPin className="size-4 text-muted-foreground" />
                <span className="text-sm">
                  {zone === 'event_floating' ? 'Evento' : ZONE_LABELS[zone]}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 space-y-1.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Zona</p>
              {(['planta_alta', 'planta_baja'] as const).map((z) => (
                <Button
                  key={z}
                  type="button"
                  variant={zone === z ? 'default' : 'outline'}
                  className="h-11 w-full justify-start"
                  onClick={() => saveZone(z)}
                >
                  {ZONE_LABELS[z]}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
