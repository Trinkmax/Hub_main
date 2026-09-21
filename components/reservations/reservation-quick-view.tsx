'use client'

import { Check, ChevronDown, Clock, MapPin, Minus, Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ContactButton } from '@/components/messaging/contact-button'
import { CakeChip } from '@/components/reservations/cake-chip'
import { ChampagneChip } from '@/components/reservations/celebration-chip'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
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
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import { ARSFormat } from '@/lib/salon/format'
import { fetchDaySegments } from '@/lib/salon/segment-actions'
import {
  type DaySegmentsSnapshot,
  mealTypeForSegment,
  projectReservation,
  type SegmentProjection,
  segmentOfMealType,
  segmentOfTime,
} from '@/lib/salon/segments'
import {
  overCapacityConfirmCopy,
  SEGMENT_WITH_ARTICLE,
  segmentStatusLine,
} from '@/lib/salon/segments-copy'
import {
  MEAL_TYPE_LABELS,
  type MealType,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationWithJoins,
  type SalonZone,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { ReservationStatusControls } from './reservation-status-controls'
import { StatusPill } from './status-pill'

const HHMM = /^\d{2}:\d{2}$/

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

/** Lo que el panel edita y mueve la cuenta del servicio. */
type PanelValues = { guests: number; zone: SalonZone; time: string; meal: MealType }

/**
 * Cómo queda el servicio de la reserva con los valores del panel. Es la MISMA
 * proyección que usan el alta y la vista del día: si el panel hiciera su
 * propia cuenta, la anfitriona vería un número acá y otro en el calendario.
 *
 * Cuenta lo que va a contar (R4): con la gente adentro, las personas reales
 * que edita el stepper; antes de que lleguen, el real si alguien ya lo cargó
 * y si no el estimado. null mientras no llegó el snapshot del día (sin datos
 * no hay aviso; nunca se bloquea un guardado por eso).
 */
function projectPanel(
  snapshot: DaySegmentsSnapshot | null,
  r: ReservationWithJoins,
  isPost: boolean,
  v: PanelValues,
): SegmentProjection | null {
  if (!snapshot) return null
  return projectReservation(snapshot, {
    id: r.id,
    reservation_date: r.reservation_date,
    meal_type: v.meal,
    reservation_time_local: v.time,
    scheduled_event_id: r.scheduled_event_id,
    zone: v.zone,
    guests: isPost ? v.guests : (r.actual_guests ?? v.guests),
    kind: r.kind,
    cake_count: r.cake_count,
  })
}

/**
 * meal_type que corresponde a una hora nueva. En una reserva SIN evento el
 * servicio sale del meal_type (R3): mover una reserva de 13:00 a 21:00 sin
 * tocarlo la dejaba contada en el almuerzo y con la tarifa de comisión del
 * almuerzo. Si la hora sigue en el mismo servicio se respeta lo que había (un
 * 'breakfast' viejo no se reescribe por correrlo media hora). Con evento
 * manda el evento, así que no se toca.
 */
function mealForTime(r: ReservationWithJoins, currentMeal: MealType, time: string): MealType {
  if (r.scheduled_event_id) return currentMeal
  const segment = segmentOfTime(time)
  return segmentOfMealType(currentMeal) === segment ? currentMeal : mealTypeForSegment(segment)
}

/** 'Quedarían 124 de 120 en la cena': la barra que frena al stepper. */
function pendingGuestsLine(p: SegmentProjection): string {
  const where = SEGMENT_WITH_ARTICLE[p.segment]
  return p.after.capacity === null
    ? `Quedarían ${p.after.people} en ${where}`
    : `Quedarían ${p.after.people} de ${p.after.capacity} en ${where}`
}

/**
 * Para el `onInteractOutside` de un diálogo o popover de Radix: tocar un toast
 * no cuenta como "afuera". El Toaster vive en el body, fuera del contenido del
 * diálogo, así que el pointerdown sobre «Deshacer» (o sobre la X del toast)
 * cerraba la capa de arriba antes de que corriera el click. En el celu la hoja
 * del día tiene el toast encima: tocarlo era cerrar el día.
 */
export function keepOpenOnToast(event: Event): void {
  const target = event.target
  if (target instanceof Element && target.closest('[data-sonner-toaster]')) {
    event.preventDefault()
  }
}

/**
 * Popup de vista + gestión rápida de una reserva. Reemplaza la navegación a la
 * página de detalle desde el día del calendario. La edición a fondo sigue en
 * /reservas/[id] vía el botón "Edición completa".
 *
 * Incluye edición rápida de personas (stepper optimista con debounce), hora y
 * zona — pensado para el caso "reservé para 6 pero somos 10" resuelto en
 * segundos desde el día, sin ir al formulario completo.
 *
 * `trigger` permite usar una fila completa como disparador (popup del día).
 * `onChanged` refresca el contenedor cuando aplica (el que no se re-renderiza
 * con la respuesta de la action).
 *
 * `open` / `onOpenChange` son opcionales: sin ellos el popup maneja su propio
 * estado, como siempre. La vista del día los usa porque una reserva que cambia
 * de hora puede pasar a otro servicio y montarse en OTRA lista; con el estado
 * local, el popup se cerraba solo apenas llegaba el día nuevo.
 */
export function ReservationQuickView({
  tenantSlug,
  reservation,
  onChanged,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : localOpen
  function setOpen(next: boolean) {
    if (!controlled) setLocalOpen(next)
    onOpenChange?.(next)
  }
  const r = reservation
  const alerts = resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)
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
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"
        onInteractOutside={keepOpenOnToast}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 font-serif">
            <span className="truncate">{r.guest_name}</span>
            <StatusPill status={r.status} />
          </DialogTitle>
        </DialogHeader>

        {editable ? (
          <QuickEditPanel tenantSlug={tenantSlug} reservation={r} onChanged={onChanged} />
        ) : null}

        {alerts.length > 0 ? <ServiceAlertChips alerts={alerts} className="pb-1" /> : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Cuándo">
            {fmtDate(r.reservation_date)}
            {/* En modo editable la hora de inicio la muestra (y edita) el panel de
                arriba, así que acá solo se agrega el fin. Sin esto, el dato
                quedaba invisible justo en el popup que se abre desde la lista. */}
            {editable ? '' : ` · ${fmtTime(r.reservation_time_local)}`}
            {r.reservation_end_time_local
              ? editable
                ? ` · termina ${fmtTime(r.reservation_end_time_local)}`
                : ` – ${fmtTime(r.reservation_end_time_local)}`
              : ''}
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
          {/* La seña se veía solo entrando a la edición completa; es lo primero
              que pregunta el dueño cuando mira una reserva. */}
          <Field label="Seña">
            {r.deposit_cents > 0 ? (
              <span className="font-mono tabular-nums">{ARSFormat(r.deposit_cents)}</span>
            ) : (
              <span className="text-muted-foreground">Sin seña</span>
            )}
          </Field>
          <Field label="Gestor">
            {r.primary_manager?.display_name ?? '—'}
            {r.assistant_manager ? ` + ${r.assistant_manager.display_name}` : ''}
          </Field>
          {r.cake_count > 0 || r.champagne_count > 0 ? (
            // Qué torta va, no cuántas: la hace el bar y la cocina la tiene que
            // poder leer desde acá sin abrir la edición completa.
            <Field label="Cumpleaños" wide>
              <span className="flex flex-wrap items-center gap-1.5">
                <CakeChip
                  count={r.cake_count}
                  option={r.cake_option}
                  optionId={r.cake_option_id}
                  detailed
                />
                <ChampagneChip count={r.champagne_count} />
              </span>
            </Field>
          ) : null}
        </dl>

        {r.comments ? (
          <div
            className={cn(
              'rounded-lg p-3',
              // Destacado: se tiñe el bloque que YA existe en vez de repetir el
              // comentario arriba. Mostrarlo dos veces en un popup chico es peor
              // que no destacarlo.
              r.highlight_comment ? 'border border-warning/50 bg-warning/10' : 'bg-secondary/50',
            )}
          >
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {r.highlight_comment ? 'Comentario destacado' : 'Comentario del cliente'}
            </p>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm">
              {r.comments}
            </p>
          </div>
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
 * - pending → edita `estimated_guests` vía updateSalonReservation (payload
 *   completo armado desde la reserva actual). Todavía no llegaron: cambiar el
 *   número es cambiar la reserva.
 * - arrived/seated/closed → edita `actual_guests` vía updateActualGuests
 *   (recalcula comisión server-side). Ya están adentro: el número que se toca
 *   es cuánta gente vino.
 *
 * `arrived` estaba del lado del estimado y era la mitad del problema que
 * reportó el dueño. Desde que la comisión se liquida al marcar "Llegó"
 * (migración 20260826150000) casi ninguna mesa pasa a `seated`, así que la
 * rama de asistencia no se ejecutaba nunca: el encargado creía estar anotando
 * los 18 que vinieron y en realidad estaba reescribiendo la reserva de 20.
 *
 * Cupo POR SERVICIO (almuerzo / merienda / cena): al abrir se pide el snapshot
 * del día (fetchDaySegments) y cada cambio se proyecta con projectReservation,
 * la misma cuenta que el calendario y el alta.
 * - Si el servicio queda pasado, aviso fuerte con los números y la causa.
 * - Con la reserva pendiente, un cambio que empeora un servicio lleno se
 *   frena antes de guardar: el stepper pausa el debounce y pide "Guardar
 *   igual" / "Deshacer"; la hora pide un segundo toque. Nunca bloquea (D3).
 * - Con la gente adentro no se pregunta, solo se avisa: es la realidad en la
 *   puerta y la anfitriona no puede hacer nada con una pregunta.
 * - Mover la hora a otro servicio (sin evento) cambia también el meal_type,
 *   así la reserva cuenta en el servicio nuevo y cobra la tarifa que va.
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
  const isPost = r.status === 'arrived' || r.status === 'seated' || r.status === 'closed'
  const serverGuests = isPost ? (r.actual_guests ?? r.estimated_guests) : r.estimated_guests
  const serverZone = r.zone
  const serverTime = fmtTime(r.reservation_time_local)
  const serverMeal = r.meal_type

  const [pending, startTransition] = useTransition()

  // Estado optimista (el número/chip cambia YA; si el guardado falla, revierte).
  const [guests, setGuests] = useState(serverGuests)
  const [zone, setZone] = useState<SalonZone>(serverZone)
  const [time, setTime] = useState(serverTime)
  const [meal, setMeal] = useState<MealType>(serverMeal)

  // Refs espejo para leer el valor vigente desde closures (debounce, flush).
  const guestsRef = useRef(guests)
  const zoneRef = useRef(zone)
  const timeRef = useRef(time)
  // meal_type vigente: cambia junto con la hora cuando cruza de servicio. Los
  // saves siguientes (personas, zona) lo leen de acá; si leyeran r.meal_type
  // antes de que llegue el refresh del server, devolverían la reserva al
  // servicio viejo.
  const mealRef = useRef(meal)
  const serverGuestsRef = useRef(serverGuests)
  const serverZoneRef = useRef(serverZone)
  const serverTimeRef = useRef(serverTime)
  const serverMealRef = useRef(serverMeal)
  serverGuestsRef.current = serverGuests
  serverZoneRef.current = serverZone
  serverTimeRef.current = serverTime
  serverMealRef.current = serverMeal

  const guestsDirtyRef = useRef(false)
  const zoneDirtyRef = useRef(false)
  const timeDirtyRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Último número de personas que se mandó a guardar (o el del server). Es a
  // lo que vuelve "Deshacer": si 6→7 ya salió y 7→8 quedó frenado, deshacer
  // deja 7, no 6.
  const committedGuestsRef = useRef(serverGuests)

  // Stepper frenado esperando "Guardar igual" (reserva pendiente que pasaría
  // un servicio lleno). El debounce queda apagado mientras tanto.
  const [guestsHeld, setGuestsHeld] = useState(false)

  // Último actual_guests confirmado por el server. Los saves de hora/zona lo
  // mandan TAL CUAL (null si null): corregir la hora de una reserva sentada no
  // debe "confirmar" una cantidad real que nadie cargó (la comisión se
  // recalcularía sobre estimated como si fuera dato real). Se actualiza cuando
  // el stepper isPost commitea vía updateActualGuests, para no pisar ese cambio
  // si un save de hora/zona sale antes de que llegue el refresh del server.
  const actualGuestsRef = useRef<number | null>(r.actual_guests)
  const prevActualGuestsRef = useRef(r.actual_guests)
  if (prevActualGuestsRef.current !== r.actual_guests) {
    prevActualGuestsRef.current = r.actual_guests
    actualGuestsRef.current = r.actual_guests
  }

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
  function setMealBoth(m: MealType) {
    mealRef.current = m
    setMeal(m)
  }

  // Re-sincronizar desde el server cuando el contenedor refresca (router.refresh
  // o load() del popup del día) y no hay una edición local en curso. Un cambio
  // de estado (marcaron "Llegó" desde abajo) descarta un número frenado: pasó
  // a ser otro número (el real) y la pregunta ya no aplica.
  const serverKey = `${serverGuests}|${serverZone}|${serverTime}|${serverMeal}|${r.status}`
  const [prevServerKey, setPrevServerKey] = useState(serverKey)
  const [prevStatus, setPrevStatus] = useState(r.status)
  if (prevServerKey !== serverKey) {
    setPrevServerKey(serverKey)
    if (prevStatus !== r.status) {
      setPrevStatus(r.status)
      if (guestsHeld) {
        setGuestsHeld(false)
        guestsDirtyRef.current = false
      }
    }
    if (!guestsDirtyRef.current) {
      setGuestsBoth(serverGuests)
      committedGuestsRef.current = serverGuests
    }
    if (!zoneDirtyRef.current) setZoneBoth(serverZone)
    if (!timeDirtyRef.current) {
      setTimeBoth(serverTime)
      setMealBoth(serverMeal)
    }
  }

  // Snapshot del día para el cupo por servicio. Se lee al abrir el popup y se
  // vuelve a leer cuando el server refresca la reserva tras un guardado (las
  // deps son los campos que la mueven de número o de servicio). Si falla,
  // simplemente no hay aviso: nunca se frena un guardado por falta de datos.
  const [daySnapshot, setDaySnapshot] = useState<DaySegmentsSnapshot | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps "de más" (personas/zona/estado/hora/servicio) fuerzan el refetch del snapshot cuando el server refresca la reserva tras guardar — sin eso la proyección queda desfasada.
  useEffect(() => {
    let alive = true
    fetchDaySegments(tenantSlug, r.reservation_date)
      .then((res) => {
        if (alive && res.ok) setDaySnapshot(res.data)
      })
      .catch(() => {
        /* aviso opcional: sin datos no hay advertencia */
      })
    return () => {
      alive = false
    }
  }, [
    tenantSlug,
    r.reservation_date,
    r.estimated_guests,
    r.actual_guests,
    r.zone,
    r.status,
    r.reservation_time_local,
    r.meal_type,
  ])

  /** Proyección con los valores vigentes (refs), pisando lo que se está por cambiar. */
  function projectNow(patch: Partial<PanelValues> = {}): SegmentProjection | null {
    return projectPanel(daySnapshot, r, isPost, {
      guests: guestsRef.current,
      zone: zoneRef.current,
      time: timeRef.current,
      meal: mealRef.current,
      ...patch,
    })
  }

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
      meal_type: mealRef.current,
      reservation_date: r.reservation_date,
      reservation_time_local: `${timeRef.current}:00`,
      // Va explícita aunque este panel no la edite: el payload es un snapshot de
      // la fila, y si faltara, cada toque acá borraría el horario de fin.
      reservation_end_time_local: r.reservation_end_time_local,
      // Snapshot fiel: sin estas dos, mover la hora o las personas desde acá
      // borraría los avisos y el destacado de la reserva.
      service_alerts: r.service_alerts,
      highlight_comment: r.highlight_comment,
      zone: zoneRef.current,
      scheduled_event_id: r.scheduled_event_id,
      estimated_guests: isPost ? r.estimated_guests : guestsRef.current,
      actual_guests: actualGuestsRef.current,
      cake_count: r.cake_count,
      // Snapshot fiel, igual que los avisos: sin esto, mover la hora o las
      // personas desde este popup borraría qué torta hay que hacer.
      cake_option_id: r.cake_option_id,
      champagne_count: r.champagne_count,
      deposit_cents: r.deposit_cents,
      origin: r.origin,
      primary_manager_id: r.primary_manager_id,
      assistant_manager_id: r.assistant_manager_id,
      comments: r.comments,
      ...patch,
    }
  }

  async function persistGuests(n: number) {
    if (isPost) {
      const res = await updateActualGuests(tenantSlug, { id: r.id, actual_guests: n })
      if (res.ok) actualGuestsRef.current = n
      return res
    }
    return updateSalonReservation(tenantSlug, panelPayload({ estimated_guests: n }))
  }

  function bump(delta: number) {
    const next = Math.max(1, Math.min(99, guestsRef.current + delta))
    if (next === guestsRef.current) return
    guestsDirtyRef.current = true
    setGuestsBoth(next)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    // Reserva pendiente que pasaría un servicio lleno: se frena ANTES de
    // guardar y se pregunta (D3). Con la gente adentro no se pregunta: el aviso
    // de abajo alcanza.
    if (!isPost && projectNow({ guests: next })?.needsConfirm) {
      setGuestsHeld(true)
      return
    }
    setGuestsHeld(false)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      commitGuests(next)
    }, 600)
  }

  function commitGuests(n: number) {
    committedGuestsRef.current = n
    startTransition(async () => {
      const res = await persistGuests(n)
      if (res.ok) {
        // Si no volvió a tocar el stepper mientras guardábamos, quedó limpio.
        if (guestsRef.current === n) guestsDirtyRef.current = false
        onChanged?.()
      } else {
        guestsDirtyRef.current = false
        committedGuestsRef.current = serverGuestsRef.current
        setGuestsHeld(false)
        setGuestsBoth(serverGuestsRef.current)
        toast.error(res.message ?? 'No pudimos guardar la cantidad.')
      }
    })
  }

  function confirmHeldGuests() {
    setGuestsHeld(false)
    commitGuests(guestsRef.current)
  }

  function undoHeldGuests() {
    setGuestsHeld(false)
    guestsDirtyRef.current = false
    setGuestsBoth(committedGuestsRef.current)
  }

  // Si cierran el popup con un cambio de personas todavía en debounce, lo
  // guardamos igual al desmontar (fire-and-forget; el toast global avisa si falla).
  // Un número FRENADO no tiene debounce: cerrar sin "Guardar igual" es no
  // confirmarlo, y no se guarda.
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
  // Hora para la que ya se mostró el aviso de sobrecupo: el segundo toque de
  // "Guardar igual" sobre ESA hora guarda. Si la cambian, vuelve a preguntar.
  const [timeArmedFor, setTimeArmedFor] = useState<string | null>(null)
  function onTimeOpenChange(o: boolean) {
    if (o) setTimeDraft(timeRef.current)
    setTimeArmedFor(null)
    setTimeOpen(o)
  }
  function saveTime() {
    const t = timeDraft
    if (!HHMM.test(t) || t === timeRef.current) {
      setTimeArmedFor(null)
      setTimeOpen(false)
      return
    }
    const nextMeal = mealForTime(r, mealRef.current, t)
    if (!isPost && timeArmedFor !== t && projectNow({ time: t, meal: nextMeal })?.needsConfirm) {
      setTimeArmedFor(t)
      return
    }
    setTimeArmedFor(null)
    setTimeOpen(false)
    const crossedTo = nextMeal !== mealRef.current ? segmentOfMealType(nextMeal) : null
    timeDirtyRef.current = true
    setTimeBoth(t)
    setMealBoth(nextMeal)
    startTransition(async () => {
      const res = await updateSalonReservation(
        tenantSlug,
        panelPayload({ reservation_time_local: `${t}:00`, meal_type: nextMeal }),
      )
      timeDirtyRef.current = false
      if (res.ok) {
        if (crossedTo) toast.success(`Pasó a ${SEGMENT_WITH_ARTICLE[crossedTo]}`)
        onChanged?.()
      } else {
        setTimeBoth(serverTimeRef.current)
        setMealBoth(serverMealRef.current)
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

  // ── Cupo del servicio (se calcula con el estado que se ve en pantalla) ──
  const projection = projectPanel(daySnapshot, r, isPost, { guests, zone, time, meal })
  const overProjection = projection?.after.status === 'over' ? projection : null

  // Hora en borrador: a qué servicio pasaría y si hay que confirmar.
  const draftValid = HHMM.test(timeDraft) && timeDraft !== time
  const draftMeal = draftValid ? mealForTime(r, meal, timeDraft) : meal
  const draftCrossesTo = draftValid && draftMeal !== meal ? segmentOfMealType(draftMeal) : null
  const draftProjection =
    draftValid && timeArmedFor === timeDraft
      ? projectPanel(daySnapshot, r, isPost, { guests, zone, time: timeDraft, meal: draftMeal })
      : null
  const timeArmed = draftProjection?.needsConfirm === true

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

      {/* Región viva siempre montada: el lector de pantalla anuncia el aviso
          apenas aparece, sin mover el foco del stepper. */}
      <div aria-live="polite">
        {guestsHeld ? (
          <div className="mt-3 space-y-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground">
            <p className="font-medium text-destructive">
              {projection ? pendingGuestsLine(projection) : 'Te pasás del cupo del servicio'}
            </p>
            {overProjection ? (
              <OverCapacityDetail projection={overProjection} countInHeadline />
            ) : null}
            <p className="text-xs text-muted-foreground">Todavía no se guardó.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="h-10" onClick={confirmHeldGuests}>
                Guardar igual
              </Button>
              <Button type="button" variant="outline" className="h-10" onClick={undoHeldGuests}>
                Deshacer
              </Button>
            </div>
          </div>
        ) : overProjection ? (
          <OverCapacityNotice projection={overProjection} className="mt-3" />
        ) : null}
      </div>
      {isPost && r.actual_guests === null ? (
        <p className="mt-2 text-center text-[11px] text-warning-text">
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
              // Con personas frenadas esperando "Guardar igual", primero se
              // resuelve eso: si no, la hora saldría con un número sin confirmar.
              disabled={guestsHeld}
            >
              <Clock className="size-4 text-muted-foreground" />
              <span className="font-mono text-sm tabular-nums">{time}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2">
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
              {/* Un solo botón que cambia de cara: si se desmontara el ✓ para
                  montar "Guardar igual", el foco del teclado se perdería justo
                  cuando hay que confirmar. */}
              <Button
                type="button"
                size={timeArmed ? 'default' : 'icon'}
                className={timeArmed ? 'h-11 shrink-0 px-3' : 'size-11 shrink-0'}
                aria-label={timeArmed ? undefined : 'Guardar hora'}
                onClick={saveTime}
              >
                {timeArmed ? 'Guardar igual' : <Check className="size-5" />}
              </Button>
            </div>
            <div aria-live="polite" className="space-y-2">
              {draftCrossesTo ? (
                <p className="text-xs text-muted-foreground">
                  Pasa a {SEGMENT_WITH_ARTICLE[draftCrossesTo]}
                </p>
              ) : null}
              {timeArmed && draftProjection ? (
                <OverCapacityNotice projection={draftProjection} compact />
              ) : null}
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
                disabled={guestsHeld}
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

/**
 * Por qué se pasa y cuánto. Si el cambio no suma a nadie (el servicio ya venía
 * pasado y solo se abrió la reserva), el "esta suma 0" del texto de
 * confirmación no dice nada: la línea de estado explica la causa.
 *
 * `countInHeadline`: la barra del stepper ya dice "Quedarían 124 de 120 en la
 * cena", así que cuando la causa es gente de más no se repite el número; solo
 * se agrega la explicación cuando lo que pisa es el lugar apartado del evento.
 */
function OverCapacityDetail({
  projection,
  countInHeadline = false,
}: {
  projection: SegmentProjection
  countInHeadline?: boolean
}) {
  const copy = overCapacityConfirmCopy(projection)
  const body = projection.addedPeople > 0 ? copy.body : segmentStatusLine(projection.after)
  const showBody = !(countInHeadline && projection.after.cause === 'people_over')
  return (
    <>
      {showBody ? <p>{body}</p> : null}
      {copy.eventLine ? <p>{copy.eventLine}</p> : null}
    </>
  )
}

/**
 * Aviso fuerte de sobrecupo del servicio con los mismos textos que la
 * confirmación del alta: la anfitriona ve los mismos números en todos lados.
 */
function OverCapacityNotice({
  projection,
  compact = false,
  className,
}: {
  projection: SegmentProjection
  compact?: boolean
  className?: string
}) {
  const { title } = overCapacityConfirmCopy(projection)
  return (
    <div
      className={cn(
        'space-y-1 rounded-lg border border-destructive/50 bg-destructive/10 text-foreground',
        compact ? 'p-2 text-xs' : 'p-3 text-sm',
        className,
      )}
    >
      <p className="font-medium text-destructive">{title}</p>
      <OverCapacityDetail projection={projection} />
    </div>
  )
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  /** Ocupa las dos columnas: para lo que no entra en media grilla (la torta). */
  wide?: boolean
}) {
  return (
    <div className={cn('space-y-0.5', wide && 'col-span-2')}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
