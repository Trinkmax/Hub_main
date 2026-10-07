'use client'

import { Check, ChevronDown, Clock, MapPin, Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ContactButton } from '@/components/messaging/contact-button'
import { CakeChip } from '@/components/reservations/cake-chip'
import { ChampagneChip } from '@/components/reservations/celebration-chip'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { NumberField } from '@/components/ui/number-field'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { TimeField } from '@/components/ui/time-field'
import { formatIsoDay } from '@/lib/dates/format'
import { updateActualGuests, updateSalonReservation } from '@/lib/salon/actions'
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import { editReservationHref } from '@/lib/salon/calendar-links'
import { EVENT_FLOOR_QUESTION, isEventReservation, zoneChoicesFor } from '@/lib/salon/event-floor'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'
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
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { ReservationStatusControls } from './reservation-status-controls'
import { StatusPill } from './status-pill'

// Se mudó al kit (`components/ui/toast`): los diálogos, hojas y popovers del
// kit ya lo aplican solos. Queda exportado acá para los que lo importan de
// este archivo.
export { keepOpenOnToast } from '@/components/ui/toast'

const HHMM = /^\d{2}:\d{2}$/

function fmtTime(t: string): string {
  return t.slice(0, 5)
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
 *
 * `fullEditHref` es el link de "Edición completa". Sin él va a la ficha
 * pelada, que al guardar vuelve a la lista; el calendario pasa la ficha con
 * `?volver=calendario` para volver al día desde el que se abrió.
 */
export function ReservationQuickView({
  tenantSlug,
  reservation,
  onChanged,
  trigger,
  open: openProp,
  onOpenChange,
  fullEditHref,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  fullEditHref?: string
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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* El nombre entero: en el celular «Familia Rodríguez Etchega…» no
                dejaba saber de quién era la reserva. Si no entra, envuelve. */}
            <span className="min-w-0 break-words">{r.guest_name}</span>
            <StatusPill status={r.status} />
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="grid content-start gap-4">
          {editable ? (
            <QuickEditPanel tenantSlug={tenantSlug} reservation={r} onChanged={onChanged} />
          ) : null}

          {alerts.length > 0 ? <ServiceAlertChips alerts={alerts} /> : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Detail label="Cuándo">
              {formatIsoDay(r.reservation_date)}
              {/* En modo editable la hora de inicio la muestra (y edita) el panel de
                  arriba, así que acá solo se agrega el fin. Sin esto, el dato
                  quedaba invisible justo en el popup que se abre desde la lista. */}
              {editable ? '' : ` · ${fmtTime(r.reservation_time_local)}`}
              {r.reservation_end_time_local
                ? editable
                  ? ` · termina ${fmtTime(r.reservation_end_time_local)}`
                  : ` – ${fmtTime(r.reservation_end_time_local)}`
                : ''}
            </Detail>
            {editable ? null : <Detail label="Dónde">{placeLabel(r, joinedEventName(r))}</Detail>}
            <Detail label="Servicio">{MEAL_TYPE_LABELS[r.meal_type]}</Detail>
            <Detail label="Naturaleza">{RESERVATION_KIND_LABELS[r.kind]}</Detail>
            {editable ? null : (
              <Detail label="Personas">
                <span className="tabular-nums">{guests}</span>
                <span className="type-caption font-normal text-muted-foreground">{guestsHint}</span>
              </Detail>
            )}
            <Detail label="Origen">{ORIGIN_LABELS[r.origin]}</Detail>
            {/* La seña se veía solo entrando a la edición completa; es lo primero
                que pregunta el dueño cuando mira una reserva. */}
            <Detail label="Seña">
              {r.deposit_cents > 0 ? (
                <Amount cents={r.deposit_cents} decimals={0} />
              ) : (
                <span className="font-normal text-muted-foreground">Sin seña</span>
              )}
            </Detail>
            <Detail label="Gestor">
              {r.primary_manager?.display_name ?? '—'}
              {r.assistant_manager ? ` + ${r.assistant_manager.display_name}` : ''}
            </Detail>
            {r.cake_count > 0 || r.champagne_count > 0 ? (
              // Qué torta va, no cuántas: la hace el bar y la cocina la tiene que
              // poder leer desde acá sin abrir la edición completa.
              <Detail label="Cumpleaños" wide>
                <span className="flex flex-wrap items-center gap-1.5">
                  <CakeChip
                    count={r.cake_count}
                    option={r.cake_option}
                    optionId={r.cake_option_id}
                    detailed
                  />
                  <ChampagneChip count={r.champagne_count} />
                </span>
              </Detail>
            ) : null}
          </dl>

          {r.comments ? (
            <div
              className={cn(
                'rounded-lg p-3',
                // Destacado: se tiñe el bloque que YA existe en vez de repetir el
                // comentario arriba. Mostrarlo dos veces en un popup chico es peor
                // que no destacarlo.
                r.highlight_comment ? 'bg-warning-soft' : 'bg-secondary',
              )}
            >
              <p className="mb-1 type-caption text-muted-foreground">
                {r.highlight_comment ? 'Comentario destacado' : 'Comentario del cliente'}
              </p>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words type-body">
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
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button asChild variant="secondary">
              <Link href={fullEditHref ?? editReservationHref(tenantSlug, r.id)}>
                Edición completa
              </Link>
            </Button>
            {r.customer?.phone || r.guest_phone ? (
              <ContactButton
                tenantSlug={tenantSlug}
                phone={r.customer?.phone ?? r.guest_phone ?? ''}
                customerId={r.customer?.id}
                name={r.guest_name}
                size="md"
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
  const guestsLabelId = useId()
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
  // Con evento se elige la planta DENTRO del evento (o "Sin definir") y el
  // evento se conserva: `panelPayload` manda siempre el `scheduled_event_id`
  // de la reserva. Sin evento, las dos plantas de siempre.
  const [zoneOpen, setZoneOpen] = useState(false)
  const hasEvent = isEventReservation(r)
  const eventName = joinedEventName(r)
  const zoneChoices = zoneChoicesFor(r)
  const zoneText = placeLabel({ zone, scheduled_event_id: r.scheduled_event_id }, eventName)
  function saveZone(z: SalonZone) {
    setZoneOpen(false)
    if (z === zoneRef.current) return
    // La zona flotante sin evento la rechaza el schema: ni se intenta.
    if (z === 'event_floating' && !hasEvent) return
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
    <section
      data-tour="quick-personas"
      className="grid gap-3 rounded-xl border border-border bg-card p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <span id={guestsLabelId} className="type-label text-muted-foreground">
          {isPost ? 'Personas reales' : 'Personas'}
        </span>
        <span aria-live="polite" className="type-caption text-muted-foreground">
          {pending ? 'Guardando…' : ''}
        </span>
      </header>

      <div className="grid justify-items-center gap-1">
        {/* El NumberField del kit: − y + grandes para el dedo, y también se
            puede tipear (20 → 18) o usar las flechas. Cada cambio pasa por
            `bump`, que proyecta el cupo y guarda con debounce. */}
        <NumberField
          value={guests}
          onValueChange={(n) => {
            if (n !== null) bump(n - guestsRef.current)
          }}
          min={1}
          max={99}
          size="lg"
          suffix={guests === 1 ? 'persona' : 'personas'}
          aria-labelledby={guestsLabelId}
          incrementLabel="Una persona más"
          decrementLabel="Una persona menos"
          className="w-60"
        />
        {isPost && guests !== r.estimated_guests ? (
          <span className="type-caption tabular-nums text-muted-foreground">
            reservaron {r.estimated_guests}
          </span>
        ) : null}
      </div>

      {/* Región viva siempre montada: el lector de pantalla anuncia el aviso
          apenas aparece, sin mover el foco del contador. */}
      <div aria-live="polite">
        {guestsHeld ? (
          <Callout
            tone="danger"
            title={projection ? pendingGuestsLine(projection) : 'Te pasás del cupo del servicio'}
            action={
              <>
                <Button type="button" size="sm" onClick={confirmHeldGuests}>
                  Guardar igual
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={undoHeldGuests}>
                  Deshacer
                </Button>
              </>
            }
          >
            {overProjection ? (
              <OverCapacityDetail projection={overProjection} countInHeadline />
            ) : null}
            <p>Todavía no se guardó.</p>
          </Callout>
        ) : overProjection ? (
          <OverCapacityNotice projection={overProjection} />
        ) : null}
      </div>
      {isPost && r.actual_guests === null ? (
        <p className="text-center type-caption text-warning-text">
          Sin cantidad real cargada — la comisión se calcula sobre {r.estimated_guests} estimadas.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Popover open={timeOpen} onOpenChange={onTimeOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              className="rounded-full"
              aria-label={`Cambiar hora (actual ${time})`}
              // Con personas frenadas esperando "Guardar igual", primero se
              // resuelve eso: si no, la hora saldría con un número sin confirmar.
              disabled={guestsHeld}
            >
              <Clock aria-hidden className="text-muted-foreground" />
              <span className="tabular-nums">{time}</span>
              <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="grid gap-3">
            <PopoverHeader>
              <PopoverTitle>Hora de la reserva</PopoverTitle>
            </PopoverHeader>
            <div className="flex items-center gap-2">
              <TimeField
                value={timeDraft}
                onValueChange={(t) => setTimeDraft(t ?? '')}
                // Enter guarda, igual que el botón de al lado.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveTime()
                  }
                }}
                aria-label="Nueva hora"
                className="flex-1"
              />
              {/* Un solo botón que cambia de cara: si se desmontara el tilde
                  para montar "Guardar igual", el foco del teclado se perdería
                  justo cuando hay que confirmar. */}
              <Button
                type="button"
                size={timeArmed ? 'md' : 'icon'}
                className="shrink-0"
                aria-label={timeArmed ? undefined : 'Guardar hora'}
                onClick={saveTime}
              >
                {timeArmed ? 'Guardar igual' : <Check aria-hidden />}
              </Button>
            </div>
            <div aria-live="polite" className="grid gap-2">
              {draftCrossesTo ? (
                <p className="type-small text-muted-foreground">
                  Pasa a {SEGMENT_WITH_ARTICLE[draftCrossesTo]}
                </p>
              ) : null}
              {timeArmed && draftProjection ? (
                <OverCapacityNotice projection={draftProjection} />
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

        {/* Antes, una reserva de evento mostraba "Evento" fijo y no se podía
            tocar: ahora se le elige la planta sin sacarla del evento. */}
        <Popover open={zoneOpen} onOpenChange={setZoneOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              className="max-w-full rounded-full"
              aria-label={`${hasEvent ? 'Cambiar dónde se sientan' : 'Cambiar zona'} (actual ${zoneText})`}
              disabled={guestsHeld}
            >
              {hasEvent ? (
                <Sparkles aria-hidden className="text-muted-foreground" />
              ) : (
                <MapPin aria-hidden className="text-muted-foreground" />
              )}
              <span className="truncate">{zoneText}</span>
              <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" size="sm" className="grid gap-2">
            <PopoverHeader>
              <PopoverTitle>{hasEvent ? EVENT_FLOOR_QUESTION : 'Zona'}</PopoverTitle>
              {hasEvent ? (
                <PopoverDescription>
                  Sigue en {eventName ?? 'el evento'}: esto solo dice en qué planta.
                </PopoverDescription>
              ) : null}
            </PopoverHeader>
            <div className="grid gap-1">
              {zoneChoices.map((c) => {
                const selected = zone === c.zone
                return (
                  <Button
                    key={c.zone}
                    type="button"
                    variant="ghost"
                    aria-pressed={selected}
                    className={cn(
                      'w-full justify-between text-foreground',
                      selected && 'bg-selected font-semibold',
                    )}
                    onClick={() => saveZone(c.zone)}
                  >
                    {c.label}
                    {selected ? <Check aria-hidden className="text-primary" /> : null}
                  </Button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
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
  className,
}: {
  projection: SegmentProjection
  className?: string
}) {
  const { title } = overCapacityConfirmCopy(projection)
  return (
    <Callout tone="danger" title={title} className={className}>
      <OverCapacityDetail projection={projection} />
    </Callout>
  )
}

/** Un dato de la reserva: rótulo chico arriba, valor abajo. */
function Detail({
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
    <div className={cn('grid content-start gap-0.5', wide && 'col-span-2')}>
      <dt className="type-caption text-muted-foreground">{label}</dt>
      <dd className="type-body font-medium">{children}</dd>
    </div>
  )
}
