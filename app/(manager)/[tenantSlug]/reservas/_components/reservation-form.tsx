'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Cake, GlassWater, RotateCcw, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { toast } from 'sonner'
import { CakeOptionPicker } from '@/components/reservations/cake-option-picker'
import { SEGMENT_TONE_CLASSES, SegmentBar } from '@/components/reservations/segment-meter'
import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Field, FieldRow, FormSection } from '@/components/ui/field'
import { FilterChip } from '@/components/ui/filter-chip'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { KbdShortcut } from '@/components/ui/kbd-shortcut'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { RadioCards, type RadioCardsItem } from '@/components/ui/radio-cards'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { TimeField } from '@/components/ui/time-field'
import { calculateCommission, type RateTier } from '@/lib/commissions/calculate'
import { type CustomerSearchResult, searchCustomers } from '@/lib/customers/search'
import { addDays, weekdayOf } from '@/lib/dates/civil'
import { formatDayMonth } from '@/lib/dates/format'
import { createSalonReservation, updateSalonReservation } from '@/lib/salon/actions'
import {
  parseServiceAlerts,
  SERVICE_ALERT_META,
  SERVICE_ALERTS,
  type ServiceAlert,
} from '@/lib/salon/alerts'
import { type ReservationReturnTo, reservationSavedHref } from '@/lib/salon/calendar-links'
import { fetchScheduledEventsForDate } from '@/lib/salon/client-actions'
import {
  EVENT_FLOOR_OPTIONS,
  EVENT_FLOOR_QUESTION,
  type FloorZone,
  floorLabel,
  isEventReservation,
  pickEventTile,
  pickFloorTile,
  placeSelection,
} from '@/lib/salon/event-floor'
import { durationLabel, endsNextDay, isImplausibleSpan, tableSpanMinutes } from '@/lib/salon/format'
import { groupManagersForSelect, pickDefaultManagerId } from '@/lib/salon/managers'
import { buildReservationCandidate } from '@/lib/salon/new-reservation-defaults'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { type CreateSalonReservationInput, createSalonReservationSchema } from '@/lib/salon/schemas'
import { fetchDaySegments } from '@/lib/salon/segment-actions'
import {
  computeDaySegments,
  type DaySegmentsSnapshot,
  eventLoadsById,
  mealTypeForSegment,
  projectReservation,
  resolveSegmentSettings,
  type SegmentEventLoad,
  type SegmentKey,
  type SegmentProjection,
  segmentOfEventStart,
  segmentOfMealType,
  segmentOfTime,
} from '@/lib/salon/segments'
import {
  overCapacityConfirmCopy,
  SEGMENT_WITH_ARTICLE,
  savedToastCopy,
  segmentHeadline,
  segmentStatusLine,
  segmentTone,
} from '@/lib/salon/segments-copy'
import {
  type CakeOptionRow,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationKind,
  type ReservationManagerRow,
  type ReservationOrigin,
  type SalonReservationStatus,
  type SalonZone,
  type ScheduledEventTemplateRow,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { CommitDatePicker } from './commit-date-picker'
import { OverCapacityConfirm } from './over-capacity-confirm'
import { QuickTemplateDialog } from './quick-template-dialog'
import { SegmentPicker } from './segment-picker'

type ReservationFormInput = CreateSalonReservationInput

type Props = {
  mode: 'create' | 'edit'
  tenantSlug: string
  /**
   * A dónde se vuelve después de guardar: la pantalla desde la que se entró.
   * Lo resuelve la página con el `?volver` de su URL (el form no lee
   * searchParams): 'calendario' abre el día con la fila resaltada, 'reservas'
   * (el default) la lista en ese día.
   */
  returnTo: ReservationReturnTo
  /**
   * El «Cancelar» de la barra de acciones: la misma pantalla de origen que el
   * «volver» del encabezado. Sin él no se dibuja.
   */
  cancelHref?: string
  initialDate: string
  /**
   * Hoy en Córdoba, desde el server. Los chips "Hoy / Mañana / …" salen de acá
   * y no de `initialDate`: todas las altas nacen del calendario con ?date=, y
   * con initialDate cualquier fecha futura decía "Hoy".
   */
  today: string
  /**
   * El cupo del día de `initialDate` (reservas activas sin datos personales,
   * eventos, cupos y horas sugeridas por servicio). Llega con el HTML para que
   * el medidor no arranque vacío; null si el server no lo pudo leer (el form
   * lo vuelve a pedir y guardar nunca depende de esto).
   */
  initialSnapshot: DaySegmentsSnapshot | null
  /**
   * Estado de la reserva editada. Una cancelada o "no vino" no ocupa lugar:
   * sin esto la proyección la sumaba y editarle el comentario en una cena
   * llena pedía confirmar un sobrecupo que no existe.
   */
  reservationStatus?: SalonReservationStatus
  managers: ReservationManagerRow[]
  templates: ScheduledEventTemplateRow[]
  initialEventsForDate: ScheduledEventWithTemplate[]
  /**
   * El menú de tortas del bar. Se elige acá porque la torta la hace el bar y la
   * cocina necesita saber CUÁL — no alcanza con "traen torta".
   */
  cakeOptions: CakeOptionRow[]
  /** ¿Este rol puede editar el catálogo de tortas? (owner) — muestra el link. */
  canManageCakes?: boolean
  rateTiers: RateTier[]
  bonusPerGuestCents: number
  /**
   * Gestor de reservas vinculado a la cuenta del usuario actual (si existe).
   * Marca la fila "Vos" en el combo y es el default de create cuando el
   * dispositivo todavía no eligió a nadie. Se ignora si no está en
   * `managers` (inactivo).
   */
  linkedManagerId?: string | null
  /**
   * Último gestor elegido en este dispositivo, leído de la cookie en el server.
   * Es el primer candidato a default en create — ver `pickDefaultManagerId`.
   */
  lastManagerId?: string | null
  /**
   * ¿Este rol puede dar de alta gestores? (owner). Solo entonces mostramos el
   * link a Configuración → Comisiones → Gestores; al resto le decimos a quién
   * pedírselo en vez de mandarlo a una página que no puede abrir.
   */
  canManageManagers?: boolean
  // Edit mode props
  reservationId?: string
  initialValues?: Partial<ReservationFormInput> & {
    actual_guests?: number | null
  }
  /**
   * Avisos guardados en la ficha del cliente linkeado. Prop aparte y NO dentro
   * de `initialValues` a propósito: eso se spreadea en los `defaultValues` del
   * form y terminaría viajando en el submit, y esto no es un campo de la
   * reserva. Solo sirve para pre-marcar los chips y aclarar cuáles no se sacan
   * desde acá.
   */
  customerServiceAlerts?: ServiceAlert[]
}

// El servicio se elige con <SegmentPicker> (Almuerzo / Merienda / Cena). Ni
// 'hub_event' (retirado: los eventos viven en el Calendario y la reserva se
// asocia tocando el evento en "Dónde se sienta") ni 'breakfast' (2 en toda la historia,
// cuenta como almuerzo) se ofrecen; el enum los sigue aceptando por las
// reservas viejas.
const ORIGINS: ReservationOrigin[] = [
  'whatsapp',
  'instagram',
  'messenger',
  'in_person',
  'partner_referral',
]
// Las plantas se listan fijas; los eventos del día se suman como tarjetas al
// lado (ver "Dónde se sienta"). Las tarjetas de planta son la reserva NORMAL; la
// planta de una reserva de evento se elige abajo, en "¿Dónde se sientan?".
const FLOOR_ZONES: FloorZone[] = ['planta_alta', 'planta_baja']
const KINDS: ReservationKind[] = ['normal', 'birthday', 'special']
/** El valor de radio de un evento en "Dónde se sienta" (las plantas van por su nombre). */
const EVENT_VALUE_PREFIX = 'evento:'

// El campo de fecha da '' mientras está vacío: con eso no se pide el cupo (el
// server igual valida la fecha con zod).
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d/

/**
 * Los atajos de fecha: Hoy, Mañana y el próximo viernes y sábado. Aritmética
 * de calendario sobre el `yyyy-MM-dd` de Córdoba que manda el server (sin la
 * zona horaria del navegador ni `Intl`).
 */
function quickChips(today: string): Array<{ label: string; date: string }> {
  const out: Array<{ label: string; date: string }> = [
    { label: 'Hoy', date: today },
    { label: 'Mañana', date: addDays(today, 1) },
  ]
  // weekdayOf: 0 = domingo … 5 = viernes, 6 = sábado.
  for (const [label, dow] of [
    ['Viernes', 5],
    ['Sábado', 6],
  ] as const) {
    for (let i = 2; i <= 9; i++) {
      const date = addDays(today, i)
      if (weekdayOf(date) === dow) {
        out.push({ label, date })
        break
      }
    }
  }
  return out
}

export function ReservationForm({
  mode,
  tenantSlug,
  returnTo,
  cancelHref,
  initialDate,
  today,
  initialSnapshot,
  reservationStatus,
  managers,
  templates: templatesProp,
  initialEventsForDate,
  cakeOptions,
  canManageCakes = false,
  rateTiers,
  bonusPerGuestCents,
  linkedManagerId,
  lastManagerId,
  canManageManagers = false,
  reservationId,
  initialValues,
  customerServiceAlerts,
}: Props) {
  const router = useRouter()
  const [templates, setTemplates] = useState<ScheduledEventTemplateRow[]>(templatesProp)
  const [submitting, startSubmit] = useTransition()
  const [, startSnapshot] = useTransition()
  const [, startEvents] = useTransition()

  // Hora sugerida por servicio (13:00 / 15:30 / 21:00 o la que configuró el
  // bar). Es del bar, no del día: para los defaults alcanza con la que vino
  // del server; si no vino, la del primer cupo que llegue (ver `settings`).
  const initialSettings = useMemo(
    () => initialSnapshot?.settings ?? resolveSegmentSettings([]),
    [initialSnapshot],
  )

  // Clave vieja del último gestor usado. Quedó en localStorage de los
  // dispositivos que ya venían cargando reservas; abajo la migramos a cookie.
  const legacyLastManagerKey = `salon:last-manager:${tenantSlug}`

  const defaultPrimary = pickDefaultManagerId({
    managers,
    mode,
    currentManagerId: initialValues?.primary_manager_id,
    lastUsedManagerId: lastManagerId,
    selfManagerId: linkedManagerId,
  })

  const managerGroups = useMemo(
    () => groupManagersForSelect(managers, linkedManagerId),
    [managers, linkedManagerId],
  )

  const form = useForm<ReservationFormInput>({
    resolver: zodResolver(createSalonReservationSchema) as never,
    defaultValues: {
      guest_name: '',
      guest_phone: undefined,
      guest_email: undefined,
      customer_id: undefined,
      kind: 'normal',
      // La cena a su hora sugerida (21:00 en el HUB; antes era un '21:30'
      // fijo). Los initialValues de la página (?meal, ?time, ?event) la pisan.
      meal_type: 'dinner',
      reservation_date: initialDate,
      reservation_time_local: initialSettings.dinner.defaultTime,
      reservation_end_time_local: '',
      zone: 'planta_alta',
      scheduled_event_id: undefined,
      requested_template_id: undefined,
      estimated_guests: 2,
      cake_count: 0,
      cake_option_id: null,
      champagne_count: 0,
      deposit_cents: 0,
      origin: 'whatsapp',
      primary_manager_id: defaultPrimary,
      assistant_manager_id: undefined,
      comments: undefined,
      service_alerts: [],
      highlight_comment: false,
      ...initialValues,
    },
  })

  const values = form.watch()

  // Una cena que arranca 21:30 y termina 00:30 es la noche típica del bar, no un
  // error de carga: no lo bloqueamos, lo decimos.
  // Los avisos ya guardados en la ficha del cliente. Vienen del server en la
  // edición y del combobox al elegir un cliente en el alta.
  const [profileAlerts, setProfileAlerts] = useState<ServiceAlert[]>(() =>
    parseServiceAlerts(customerServiceAlerts),
  )
  const selectedAlerts = parseServiceAlerts(values.service_alerts)
  // Sin cliente linkeado (ni teléfono para crearlo) no hay ficha donde guardar
  // el aviso permanente — la action lo resuelve igual, pero el copy no puede
  // prometer algo que no va a pasar.
  const hasCustomerLink = Boolean(values.customer_id || values.guest_phone)

  function toggleAlert(alert: ServiceAlert) {
    const next = selectedAlerts.includes(alert)
      ? selectedAlerts.filter((a) => a !== alert)
      : [...selectedAlerts, alert]
    form.setValue('service_alerts', next, { shouldValidate: true })
  }

  const startTime = values.reservation_time_local ?? ''
  const endTime = values.reservation_end_time_local || null
  const crossesMidnight = endsNextDay(startTime, endTime)
  const spanMinutes = tableSpanMinutes(startTime, endTime)
  // 21:30 → 20:00 también "cruza medianoche", pero son 22h30 de mesa: casi
  // seguro quisieron poner 00:00. Avisamos sin bloquear en vez de tapar el
  // dedazo con un "termina al día siguiente" que suena tranquilizador.
  const implausibleSpan = isImplausibleSpan(startTime, endTime)
  const [eventsForDate, setEventsForDate] =
    useState<ScheduledEventWithTemplate[]>(initialEventsForDate)
  // Cupo del día elegido: la foto con la que se proyecta la reserva sobre su
  // servicio. `snapshotFailedFor` distingue "no se pudo leer" de "está
  // llegando" para no dejar un skeleton eterno.
  const [snapshot, setSnapshot] = useState<DaySegmentsSnapshot | null>(initialSnapshot)
  const [snapshotFailedFor, setSnapshotFailedFor] = useState<string | null>(null)
  const snapshotRequest = useRef(0)
  const settings = snapshot?.settings ?? initialSettings
  // Confirmación de sobrecupo abierta (D3): lo que se iba a guardar y con qué números.
  const [confirming, setConfirming] = useState<{
    data: ReservationFormInput
    projection: SegmentProjection
  } | null>(null)
  // "Pasó a Merienda": el cambio de hora movió la reserva de servicio.
  const [autoSwitchedTo, setAutoSwitchedTo] = useState<SegmentKey | null>(null)

  // Fecha real de cada evento que pasó por el combo. Sin esto, al mover la
  // fecha de la reserva el evento elegido desaparecía de la lista y no había
  // manera de contarle al usuario a qué día pertenecía.
  const [eventDates, setEventDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialEventsForDate.map((e) => [e.id, e.event_date])),
  )

  // Migración de la memoria del último gestor: localStorage → cookie. Los
  // dispositivos que ya venían cargando reservas tienen ahí a quién eligieron
  // siempre; sin esto, la primera carga después del deploy caería en "sos vos"
  // y la comisión se iría a otra persona. Sólo aplica el valor: la cookie la
  // escribe el server al guardar. Corre una sola vez — el `removeItem` la hace
  // idempotente.
  useEffect(() => {
    if (mode !== 'create' || lastManagerId || initialValues?.primary_manager_id) return
    const saved = window.localStorage.getItem(legacyLastManagerKey)
    if (!saved) return
    window.localStorage.removeItem(legacyLastManagerKey)
    if (!managers.some((m) => m.id === saved)) return
    form.setValue('primary_manager_id', saved, { shouldValidate: true })
  }, [mode, lastManagerId, legacyLastManagerKey, managers, initialValues?.primary_manager_id, form])

  // Refetch eventos cuando cambia la fecha
  useEffect(() => {
    if (values.reservation_date === initialDate) {
      setEventsForDate(initialEventsForDate)
      return
    }
    startEvents(async () => {
      const r = await fetchScheduledEventsForDate(tenantSlug, values.reservation_date)
      if (r.ok) {
        setEventsForDate(r.events)
        setEventDates((prev) => {
          const next = { ...prev }
          for (const e of r.events) next[e.id] = e.event_date
          return next
        })
      }
    })
  }, [values.reservation_date, initialDate, initialEventsForDate, tenantSlug])

  // Pide el cupo de un día. Guard de respuesta vieja: si la anfitriona toca
  // "Mañana" y enseguida "Viernes", la respuesta de mañana no puede pisar la
  // del viernes. Es la misma función para el cambio de fecha y para el
  // «Reintentar» del medidor: limpiar el error al arrancar vuelve a mostrar el
  // skeleton mientras se pide, así el reintento se nota.
  const requestSnapshot = useCallback(
    (date: string) => {
      const request = ++snapshotRequest.current
      setSnapshotFailedFor(null)
      startSnapshot(async () => {
        try {
          const r = await fetchDaySegments(tenantSlug, date)
          if (request !== snapshotRequest.current) return
          if (r.ok) {
            setSnapshot(r.data)
            setSnapshotFailedFor(null)
          } else {
            setSnapshotFailedFor(date)
          }
        } catch {
          // Sin red: el medidor lo dice y guardar sigue andando (D3 no bloquea).
          if (request === snapshotRequest.current) setSnapshotFailedFor(date)
        }
      })
    },
    [tenantSlug],
  )

  // Cupo del día cuando cambia la fecha. La fecha inicial usa la foto que vino
  // del server.
  useEffect(() => {
    const date = values.reservation_date
    if (!date || !ISO_DAY_RE.test(date)) return
    if (initialSnapshot && initialSnapshot.date === date) {
      snapshotRequest.current += 1
      setSnapshot(initialSnapshot)
      return
    }
    requestSnapshot(date)
  }, [values.reservation_date, initialSnapshot, requestSnapshot])

  // (Acá había un efecto que borraba `scheduled_event_id` apenas la zona era
  // una planta. Con eso una reserva de evento no podía tener planta, y abrir
  // en la edición una de Pizza libre en Planta Alta la sacaba del evento sin
  // avisar. Ahora el evento se limpia solo cuando el usuario toca una planta
  // suelta — ver `pickFloorTile`.)

  // Si vacían el comentario después de destacarlo, el flag queda colgado: la
  // reserva se guardaría con highlight_comment=true y comments=null, y el día
  // que alguien escriba un comentario nuevo saldría destacado sin haberlo pedido.
  useEffect(() => {
    if (values.highlight_comment && !values.comments?.trim()) {
      form.setValue('highlight_comment', false)
    }
  }, [values.highlight_comment, values.comments, form])

  // Auto-clear requested_template_id si kind=normal
  useEffect(() => {
    if (values.kind === 'normal' && values.requested_template_id) {
      form.setValue('requested_template_id', undefined)
    }
  }, [values.kind, values.requested_template_id, form])

  // ── Cupo por servicio ─────────────────────────────────────
  // Cómo viene el día (sin esta reserva) y cómo queda con ella. Los números
  // salen de la MISMA cuenta que el calendario, el operativo y la confirmación
  // de sobrecupo: la anfitriona ve acá lo que después le va a preguntar el
  // AlertDialog.
  const loadedActualGuests = initialValues?.actual_guests ?? null
  const countsForCapacity = reservationStatus !== 'cancelled' && reservationStatus !== 'no_show'
  const daySegments = useMemo(
    () =>
      snapshot && snapshot.date === values.reservation_date ? computeDaySegments(snapshot) : null,
    [snapshot, values.reservation_date],
  )
  // No se pudo leer el cupo del día elegido (no "está llegando"): el medidor
  // ofrece reintentar y el selector de servicio deja de mostrar skeletons.
  const snapshotFailed = snapshotFailedFor === values.reservation_date
  const eventLoads = useMemo<Record<string, SegmentEventLoad>>(
    () => (daySegments ? eventLoadsById({ [daySegments.date]: daySegments }) : {}),
    [daySegments],
  )
  const candidate = useMemo(
    () =>
      buildReservationCandidate({
        mode,
        reservationId,
        values: {
          reservation_date: values.reservation_date,
          meal_type: values.meal_type,
          reservation_time_local: values.reservation_time_local,
          scheduled_event_id: values.scheduled_event_id,
          zone: values.zone,
          estimated_guests: values.estimated_guests,
          kind: values.kind,
          cake_count: values.cake_count,
          requested_template_id: values.requested_template_id,
        },
        loadedActualGuests,
        templates,
        eventsForDate,
      }),
    [
      mode,
      reservationId,
      values.reservation_date,
      values.meal_type,
      values.reservation_time_local,
      values.scheduled_event_id,
      values.zone,
      values.estimated_guests,
      values.kind,
      values.cake_count,
      values.requested_template_id,
      loadedActualGuests,
      templates,
      eventsForDate,
    ],
  )
  const projection = useMemo(
    () => (countsForCapacity && snapshot ? projectReservation(snapshot, candidate) : null),
    [countsForCapacity, snapshot, candidate],
  )

  // ── Hora ↔ servicio ───────────────────────────────────────
  // Sin evento, el servicio de una reserva sale de `meal_type` (R3) y de eso
  // sale también su tarifa de comisión: la hora y el servicio tienen que ir
  // juntos. Se sincronizan SOLO desde lo que toca el usuario (onChange / onClick),
  // nunca en un efecto: un efecto que escribe hora y servicio a la vez entra en
  // loop con los otros efectos encadenados del form.
  // "De evento" lo dice el id, no la zona: una reserva de Pizza libre puede
  // tener planta (zone = planta_*) y sigue siendo del evento.
  const hasEvent = isEventReservation(values)
  const place = placeSelection(values)
  const chosenEvent = hasEvent
    ? (eventsForDate.find((e) => e.id === values.scheduled_event_id) ?? null)
    : null
  const lockedSegment: SegmentKey | null = hasEvent
    ? chosenEvent
      ? segmentOfEventStart(chosenEvent.starts_at_local)
      : segmentOfMealType(values.meal_type)
    : null
  const selectedSegment = lockedSegment ?? segmentOfMealType(values.meal_type)
  // "La hora no fue tocada": la puso el sistema (default, ?time, un evento, un
  // servicio). Las escrituras automáticas van con shouldDirty:false.
  const timeTouched = Boolean(form.formState.dirtyFields.reservation_time_local)
  const timeValue = values.reservation_time_local ?? ''
  const timeSegment = HHMM_RE.test(timeValue) ? segmentOfTime(timeValue) : null
  const timeMismatch =
    !lockedSegment && timeSegment && timeSegment !== selectedSegment
      ? { time: timeValue.slice(0, 5), timeSegment }
      : null

  function selectSegment(segment: SegmentKey) {
    setAutoSwitchedTo(null)
    form.setValue('meal_type', mealTypeForSegment(segment), { shouldValidate: true })
    if (!timeTouched) {
      form.setValue('reservation_time_local', settings[segment].defaultTime, {
        shouldValidate: true,
        shouldDirty: false,
      })
    }
  }

  function handleTimeChangedByUser(time: string) {
    if (hasEvent || !HHMM_RE.test(time)) return
    const next = segmentOfTime(time)
    if (next === segmentOfMealType(values.meal_type)) return
    form.setValue('meal_type', mealTypeForSegment(next), {
      shouldValidate: true,
      shouldDirty: false,
    })
    setAutoSwitchedTo(next)
  }

  // Preview de comisión client-side
  const commissionPreviewCents = useMemo(() => {
    const primary = managers.find((m) => m.id === values.primary_manager_id)
    const assistant = values.assistant_manager_id
      ? (managers.find((m) => m.id === values.assistant_manager_id) ?? null)
      : null
    const event = values.scheduled_event_id
      ? (eventsForDate.find((e) => e.id === values.scheduled_event_id) ?? null)
      : null
    const eventInfo = event
      ? {
          capacity: event.capacity,
          // total_used vs capacity para activar el bonus de evento lleno: cómo
          // queda el evento CON esta reserva (la proyección ya la suma, o la
          // reemplaza en la edición). Sin cupo leído todavía, al menos cuenta
          // la propia en el alta, como antes.
          total_used:
            projection?.event?.id === event.id
              ? projection.event.used
              : mode === 'create'
                ? values.estimated_guests
                : 0,
          full_bonus_active: event.full_bonus_active,
        }
      : null
    const entries = calculateCommission(
      {
        // En edición, la reserva puede tener asistencia cargada: el preview
        // tiene que mostrar la MISMA plata que el ledger, o el form promete
        // $2.080 y después el reporte dice $1.560.
        guests: loadedActualGuests ?? values.estimated_guests,
        bookedGuests: values.estimated_guests,
        meal_type: values.meal_type,
        primary: { id: values.primary_manager_id || 'x', eligible: !!primary?.commission_eligible },
        assistant: assistant
          ? { id: assistant.id, eligible: !!assistant.commission_eligible }
          : null,
        scheduledEvent: eventInfo,
        status: 'closed',
      },
      rateTiers,
      bonusPerGuestCents,
    )
    return entries.reduce((acc, e) => acc + e.payable_cents, 0)
  }, [
    values.primary_manager_id,
    values.assistant_manager_id,
    values.scheduled_event_id,
    values.estimated_guests,
    values.meal_type,
    managers,
    eventsForDate,
    projection,
    rateTiers,
    bonusPerGuestCents,
    mode,
    loadedActualGuests,
  ])

  // ── Coherencia fecha ↔ evento ─────────────────────────────
  // Cambiar la fecha con un evento ya elegido dejaba la reserva apuntando a un
  // evento de otro día (la DB lo rechaza con un trigger). No lo limpiamos solos:
  // si le borrás la selección sin avisar, el usuario no entiende qué pasó.
  // Mostramos el choque y ofrecemos las dos salidas posibles.
  const selectedEventDate = values.scheduled_event_id
    ? (eventDates[values.scheduled_event_id] ?? null)
    : null
  const eventDateMismatch =
    hasEvent &&
    (selectedEventDate !== null
      ? selectedEventDate !== values.reservation_date
      : !eventsForDate.some((e) => e.id === values.scheduled_event_id))

  // Submit
  // Guarda de verdad. El último gestor usado lo persiste `createSalonReservation`
  // en cookie.
  async function persist(data: ReservationFormInput, saved: SegmentProjection | null) {
    const result =
      mode === 'create'
        ? await createSalonReservation(tenantSlug, data as Record<string, unknown>)
        : await updateSalonReservation(tenantSlug, {
            ...data,
            id: reservationId,
          } as Record<string, unknown>)
    if (result.ok) {
      // El toast dice cómo quedó el servicio ("Reserva cargada · Cena · 123 de 120").
      toast.success(savedToastCopy(mode, saved))
      // Volvemos a la pantalla desde la que se entró (la lista o el
      // calendario), ABIERTA EN EL DÍA de la reserva y con ella resaltada: al
      // cargar una para el 31/07 el dueño volvía a hoy y no la veía ("las
      // reservas no salen una vez registradas").
      const savedId =
        mode === 'create'
          ? typeof result.data?.id === 'string'
            ? result.data.id
            : undefined
          : reservationId
      router.push(
        reservationSavedHref(tenantSlug, {
          returnTo,
          mode,
          date: data.reservation_date,
          id: savedId,
        }),
      )
      router.refresh()
    } else {
      toast.error(result.message)
      if (result.field) {
        form.setError(result.field as keyof ReservationFormInput, { message: result.message })
      }
    }
  }

  /**
   * Proyección con datos FRESCOS al apretar Guardar (D3): la anfitriona y los
   * socios cargan a la vez y el calendario no tiene Realtime, así que la foto
   * de cuando se eligió la fecha puede estar vieja. Si el pedido falla se usa
   * la foto que había: la confirmación nunca bloquea el guardado.
   */
  async function freshProjection(data: ReservationFormInput): Promise<SegmentProjection | null> {
    if (!countsForCapacity) return null
    const fresh = buildReservationCandidate({
      mode,
      reservationId,
      values: data,
      loadedActualGuests,
      templates,
      eventsForDate,
    })
    let base = snapshot
    try {
      const r = await fetchDaySegments(tenantSlug, data.reservation_date)
      if (r.ok) {
        base = r.data
        // El medidor pasa a mostrar los mismos números que la confirmación.
        snapshotRequest.current += 1
        setSnapshot(r.data)
        setSnapshotFailedFor(null)
      }
    } catch {
      // Sin red: se sigue con la foto que había.
    }
    return base ? projectReservation(base, fresh) : null
  }

  const onSubmit = form.handleSubmit(
    (data) => {
      if (eventDateMismatch) {
        form.setError('scheduled_event_id', {
          message: 'La fecha no coincide con el evento.',
        })
        toast.error('La fecha de la reserva no coincide con la del evento elegido.')
        return
      }
      if (confirming) return
      startSubmit(async () => {
        const checked = await freshProjection(data)
        // Se pregunta solo si el servicio queda pasado Y esta reserva lo
        // empeora: editar el comentario de una cena ya llena no molesta.
        if (checked?.needsConfirm) {
          setConfirming({ data, projection: checked })
          return
        }
        await persist(data, checked)
      })
    },
    (errors) => {
      // Nombrar los campos que fallaron (antes el toast era genérico y no se
      // sabía cuál corregir — típicamente Cliente o Gestor sin completar).
      const LABELS: Record<string, string> = {
        guest_name: 'Cliente / nombre',
        guest_phone: 'Teléfono',
        guest_email: 'Email',
        meal_type: 'Servicio',
        reservation_date: 'Fecha',
        reservation_time_local: 'Horario',
        reservation_end_time_local: 'Horario de fin',
        zone: 'Zona',
        scheduled_event_id: 'Evento programado',
        requested_template_id: 'Formato pedido',
        estimated_guests: 'Comensales',
        cake_count: 'Tortas',
        cake_option_id: 'Torta elegida',
        champagne_count: 'Champagne',
        deposit_cents: 'Seña',
        primary_manager_id: 'Gestor',
        assistant_manager_id: 'Asistente',
        comments: 'Comentarios',
        service_alerts: 'Avisos',
        highlight_comment: 'Destacar comentario',
      }
      const fields = Object.keys(errors).map((k) => LABELS[k] ?? k)
      const shown = fields.slice(0, 3).join(', ')
      const extra = fields.length > 3 ? ` y ${fields.length - 3} más` : ''
      toast.error(
        fields.length > 0
          ? `Falta completar o corregir: ${shown}${extra}.`
          : 'Revisá los campos marcados en rojo antes de guardar.',
      )
    },
  )

  // Cmd+Enter submit: el mismo camino que el botón (chequeo fresco y
  // confirmación). Con la confirmación abierta o guardando, no dispara otra vez.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (submitting || confirming) return
        onSubmit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSubmit, submitting, confirming])

  const chips = quickChips(today)
  const errors = form.formState.errors

  // "Dónde se sienta": las dos plantas y los eventos del día en un solo grupo
  // de radio. El valor de un evento lleva prefijo para no chocar con una zona.
  // Siempre un string: '' es «nada elegido» sin pasar el grupo a no controlado
  // (un evento de otro día que ya no está en la lista).
  const placeValue = place.floorTile
    ? place.floorTile
    : place.eventId
      ? `${EVENT_VALUE_PREFIX}${place.eventId}`
      : ''
  const placeItems: RadioCardsItem[] = [
    ...FLOOR_ZONES.map((z) => ({
      value: z,
      label: floorLabel(z),
      // Personas en la planta EN ESTE SERVICIO, sin denominador: el tope por
      // planta del día entero mezclaba almuerzo y cena (el mismo defecto que el
      // "171 de 130"). El tope es del servicio y lo muestra el medidor.
      description: projection
        ? `${projection.before.byZone[z]} en ${SEGMENT_WITH_ARTICLE[projection.segment]}`
        : undefined,
    })),
    ...eventsForDate.map((e) =>
      eventPlaceItem(e, eventLoads[e.id] ?? null, place.eventId === e.id ? place.eventFloor : null),
    ),
  ]

  function choosePlace(next: string) {
    if (next.startsWith(EVENT_VALUE_PREFIX)) {
      const e = eventsForDate.find((x) => x.id === next.slice(EVENT_VALUE_PREFIX.length))
      if (!e) return
      // Entra al evento. La planta arranca "Sin definir", salvo que ya fuera
      // este evento (volver a tocarlo no la borra).
      const picked = pickEventTile(values, e.id)
      form.setValue('zone', picked.zone, { shouldValidate: true })
      form.setValue('scheduled_event_id', picked.scheduled_event_id, { shouldValidate: true })
      form.clearErrors('scheduled_event_id')
      // El evento define el servicio (por su hora, R2) y con eso la tarifa:
      // 'hub_event' no tiene y dejaba la comisión en 0. Si la hora no la
      // tocaron, la reserva arranca con el evento.
      setAutoSwitchedTo(null)
      form.setValue('meal_type', mealTypeForSegment(segmentOfEventStart(e.starts_at_local)), {
        shouldValidate: true,
        shouldDirty: false,
      })
      if (!timeTouched) {
        form.setValue('reservation_time_local', e.starts_at_local.slice(0, 5), {
          shouldValidate: true,
          shouldDirty: false,
        })
      }
      return
    }
    // Tocar una planta suelta es "sin evento": se limpia acá, en el toque, y
    // no en un efecto (ver `pickFloorTile`).
    const picked = pickFloorTile(next as FloorZone)
    form.setValue('zone', picked.zone, { shouldValidate: true })
    form.setValue('scheduled_event_id', picked.scheduled_event_id, { shouldValidate: true })
    form.clearErrors('scheduled_event_id')
  }

  return (
    <form onSubmit={onSubmit}>
      {/* Cliente */}
      <FormSection title="Cliente">
        <CustomerCombobox
          value={{
            customer_id: values.customer_id,
            guest_name: values.guest_name,
            guest_phone: values.guest_phone ?? null,
            guest_email: values.guest_email ?? null,
          }}
          tenantSlug={tenantSlug}
          onChange={(v) => {
            form.setValue('customer_id', v.customer_id, { shouldValidate: true })
            form.setValue('guest_name', v.guest_name, { shouldValidate: true })
            form.setValue('guest_phone', v.guest_phone ?? undefined, { shouldValidate: true })
            form.setValue('guest_email', v.guest_email ?? undefined)
            // Elegir a Melina tiene que traer "es celíaca" en el acto: si el
            // aviso apareciera recién al guardar, el que carga la reserva no se
            // entera justo cuando está hablando por teléfono con ella.
            if (v.service_alerts) {
              setProfileAlerts(v.service_alerts)
              const next = [...new Set([...selectedAlerts, ...v.service_alerts])]
              form.setValue('service_alerts', next, { shouldValidate: true })
            } else if (!v.customer_id) {
              setProfileAlerts([])
            }
          }}
          error={errors.guest_name?.message}
          phoneError={errors.guest_phone?.message}
        />
      </FormSection>

      {/* Fecha + horario */}
      <FormSection title="Cuándo">
        <Field label="Fecha" error={errors.reservation_date?.message}>
          {/* Tipeando, la fecha se aplica al salir del campo (o con Enter): si no,
              «15/10» pasaba por el 1 de enero y pedía el cupo de cada fecha a
              medio tipear. Del calendario, en el momento. */}
          <CommitDatePicker
            value={values.reservation_date || null}
            today={today}
            onCommit={(iso) =>
              form.setValue('reservation_date', iso ?? '', { shouldValidate: iso !== null })
            }
          />
        </Field>
        <fieldset className="-mt-2 flex min-w-0 flex-wrap gap-2">
          <legend className="sr-only">Atajos de fecha</legend>
          {chips.map((c) => (
            <FilterChip
              key={c.label}
              pressed={values.reservation_date === c.date}
              onClick={() => form.setValue('reservation_date', c.date, { shouldValidate: true })}
            >
              {c.label}
            </FilterChip>
          ))}
        </fieldset>
        {/* Los dos horarios van juntos y en ese orden: se leen como un rango.
            En mobile quedan uno al lado del otro en vez de apilarse, que es
            como el staff los piensa ("de nueve y media a doce y media"). */}
        <div className="grid grid-cols-2 items-start gap-4">
          <Field label="Horario" error={errors.reservation_time_local?.message}>
            <TimeField
              value={timeValue}
              step={15}
              onValueChange={(t) =>
                form.setValue('reservation_time_local', t ?? '', {
                  shouldValidate: t !== null,
                  shouldDirty: true,
                })
              }
              // El servicio se acomoda a la hora cuando se termina de tipear:
              // tipeando «1300», «130» es la 01:30 y no tiene que pasar la
              // reserva a la cena y volverla al almuerzo en el medio.
              onBlur={() => handleTimeChangedByUser(form.getValues('reservation_time_local') ?? '')}
            />
          </Field>
          <Field
            label="Hasta"
            optional
            error={errors.reservation_end_time_local?.message}
            hint={
              implausibleSpan
                ? undefined
                : !endTime
                  ? 'Si no sabés hasta qué hora se quedan, dejalo vacío.'
                  : crossesMidnight
                    ? `Termina al día siguiente · ${durationLabel(spanMinutes ?? 0)} de mesa.`
                    : `${durationLabel(spanMinutes ?? 0)} de mesa.`
            }
          >
            {(control) => (
              <div className="flex items-center gap-1">
                <TimeField
                  {...control}
                  value={endTime ?? ''}
                  step={15}
                  className="flex-1"
                  onValueChange={(t) =>
                    form.setValue('reservation_end_time_local', t ?? '', { shouldValidate: true })
                  }
                />
                {/* Puede llegar cargado solo (el alta desde un evento lo
                    precarga): un toque lo deja vacío otra vez. */}
                {endTime ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Quitar el horario de fin"
                    onClick={() =>
                      form.setValue('reservation_end_time_local', '', { shouldValidate: true })
                    }
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </div>
            )}
          </Field>
        </div>
        {/* Una cena que arranca 21:30 y termina 00:30 es la noche típica del
            bar, no un error de carga: no lo bloqueamos, lo decimos. Un tramo
            absurdo (21:30 → 20:00 son 22h30 de mesa) es casi seguro un dedazo. */}
        {implausibleSpan ? (
          <Callout tone="warning">
            Serían {durationLabel(spanMinutes ?? 0)} de mesa. ¿Está bien el horario?
          </Callout>
        ) : null}
      </FormSection>

      {/* Servicio: Almuerzo / Merienda / Cena con su hora sugerida y cómo
          viene su cupo ese día. Tocar uno mueve la hora si todavía no la
          tocaron; si la tocaron y es de otro servicio, se avisa. */}
      <FormSection title="Servicio">
        <SegmentPicker
          value={selectedSegment}
          settings={settings}
          segments={daySegments?.segments ?? null}
          segmentsFailed={snapshotFailed}
          lockedSegment={lockedSegment}
          onSelect={selectSegment}
          timeMismatch={timeMismatch}
          onUseSuggestedTime={() =>
            form.setValue('reservation_time_local', settings[selectedSegment].defaultTime, {
              shouldValidate: true,
              shouldDirty: false,
            })
          }
          autoSwitchedTo={autoSwitchedTo}
        />
      </FormSection>

      {/* Dónde se sienta: plantas + eventos del día en UNA sola grilla. Antes
          había que elegir "Sujeta a evento" y DESPUÉS buscar el evento en un
          combo — dos veces la misma decisión. Ahora cada evento programado del
          día es una opción más, con su hora y su ocupación a la vista. Con un
          evento elegido aparece abajo, opcional, en qué planta se sientan. */}
      <FormSection title="Dónde se sienta">
        <RadioCards
          aria-label="Dónde se sienta"
          columns={3}
          size="sm"
          items={placeItems}
          value={placeValue}
          onValueChange={choosePlace}
          invalid={Boolean(errors.zone)}
        />
        {/* La planta DENTRO del evento ("si lo requiere", pidió el dueño): la
            reserva sigue siendo del evento y cuenta en su cupo; esto solo dice
            dónde se sienta. Sin elegir queda "Sin ubicar", como siempre. */}
        {hasEvent ? (
          <EventFloorChooser
            value={place.eventFloor ?? 'event_floating'}
            byZone={projection?.before.byZone ?? null}
            segmentLabel={projection ? SEGMENT_WITH_ARTICLE[projection.segment] : null}
            onChange={(z) => form.setValue('zone', z, { shouldValidate: true })}
          />
        ) : null}
        {eventsForDate.length === 0 && !eventDateMismatch ? (
          <p className="type-small text-muted-foreground">
            Sin eventos programados para el {formatDayMonth(values.reservation_date)}. Si la reserva
            es para un evento,{' '}
            <a
              href={`/${tenantSlug}/eventos/programados`}
              target="_blank"
              rel="noopener"
              className="text-primary underline underline-offset-[3px] hover:decoration-2"
            >
              programalo en el calendario
            </a>{' '}
            y va a aparecer acá como opción.
          </p>
        ) : null}
        {errors.zone?.message ? (
          <p role="alert" className="type-caption text-destructive-text">
            {errors.zone.message}
          </p>
        ) : null}
        {eventDateMismatch ? (
          <Callout
            tone="danger"
            announce="assertive"
            title={`La fecha no coincide con el evento${
              selectedEventDate ? ` (el evento es del ${formatDayMonth(selectedEventDate)})` : ''
            }.`}
            action={
              <>
                {selectedEventDate ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      form.setValue('reservation_date', selectedEventDate, {
                        shouldValidate: true,
                      })
                    }
                  >
                    Volver al {formatDayMonth(selectedEventDate)}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Sacarla del evento: vuelve a una planta para que el form
                    // quede válido aunque ese día no haya otros eventos. Si ya
                    // tenía planta elegida dentro del evento, se queda en esa.
                    const next = pickFloorTile(
                      values.zone === 'event_floating' ? 'planta_alta' : values.zone,
                    )
                    form.setValue('zone', next.zone, { shouldValidate: true })
                    form.setValue('scheduled_event_id', next.scheduled_event_id, {
                      shouldValidate: true,
                    })
                    form.clearErrors('scheduled_event_id')
                  }}
                >
                  Sacarla del evento
                </Button>
              </>
            }
          >
            No podemos guardarla así. Elegí cómo seguir:
          </Callout>
        ) : errors.scheduled_event_id?.message ? (
          <p role="alert" className="type-caption text-destructive-text">
            {errors.scheduled_event_id.message}
          </p>
        ) : null}
      </FormSection>

      {/* Tipo de reserva */}
      <FormSection title="Tipo de reserva">
        <SegmentedControl
          aria-label="Tipo de reserva"
          items={KINDS.map((k) => ({ value: k, label: RESERVATION_KIND_LABELS[k] }))}
          value={values.kind}
          onValueChange={(v) => form.setValue('kind', v, { shouldValidate: true })}
        />
      </FormSection>

      {/* ESPECIAL: formato pedido (cumple/recibida que pide Sushi/Pizza/Ramen) */}
      {values.kind === 'birthday' || values.kind === 'special' ? (
        <FormSection
          title="¿Piden un formato del calendario?"
          description="Si el cumple o la recibida pide Sushi Libre, Pizza Libre, Ramen u otro formato del catálogo. Si ese evento ya está programado ese día, se suma; si no, se crea un evento solo para este cliente."
        >
          <Field label="Formato" error={errors.requested_template_id?.message}>
            <Select
              value={values.requested_template_id ?? '__none__'}
              onValueChange={(v) =>
                form.setValue('requested_template_id', v === '__none__' ? undefined : v, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin formato (cena normal)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin formato — cena normal</SelectItem>
                {templates.length === 0 ? (
                  <div className="px-3 py-2 type-small text-muted-foreground">
                    No hay formatos cargados.{' '}
                    <a
                      href={`/${tenantSlug}/eventos/templates`}
                      target="_blank"
                      rel="noopener"
                      className="text-primary underline underline-offset-[3px]"
                    >
                      Crear uno
                    </a>
                  </div>
                ) : (
                  templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: t.color_hex }}
                          aria-hidden
                        />
                        {t.name}
                        {t.default_capacity ? (
                          <span className="type-caption text-muted-foreground">
                            · cupo {t.default_capacity}
                          </span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end">
            <QuickTemplateDialog
              tenantSlug={tenantSlug}
              defaultMealType={values.meal_type}
              onCreated={(tpl) => {
                setTemplates((prev) => [...prev, tpl].sort((a, b) => a.name.localeCompare(b.name)))
                form.setValue('requested_template_id', tpl.id, { shouldValidate: true })
              }}
            />
          </div>
          {values.requested_template_id ? (
            <Callout tone="success">
              {(() => {
                const tpl = templates.find((t) => t.id === values.requested_template_id)
                const existing = eventsForDate.find(
                  (e) => e.template?.id === values.requested_template_id,
                )
                if (existing) {
                  return `Se suma al ${tpl?.name} ya programado (${existing.starts_at_local.slice(0, 5)} · cupo ${existing.capacity}).`
                }
                return `${tpl?.name} no está programado ese día: se crea solo al guardar.`
              })()}
            </Callout>
          ) : null}
        </FormSection>
      ) : null}

      {/* Cantidad + capacidad */}
      <FormSection title="Cuántos son">
        <div className="grid items-start gap-4 sm:grid-cols-[13rem_1fr]">
          <Field label="Personas" error={errors.estimated_guests?.message}>
            <NumberField
              value={values.estimated_guests}
              onValueChange={(v) => {
                if (v !== null) form.setValue('estimated_guests', v, { shouldValidate: true })
              }}
              min={1}
              max={99}
              size="lg"
              incrementLabel="Una persona más"
              decrementLabel="Una persona menos"
            />
          </Field>
          <SegmentMeter
            projection={projection}
            fallback={
              !countsForCapacity
                ? 'inactive'
                : !ISO_DAY_RE.test(values.reservation_date ?? '')
                  ? 'no-date'
                  : snapshotFailed
                    ? 'error'
                    : 'loading'
            }
            onRetry={() => requestSnapshot(values.reservation_date)}
          />
        </div>
      </FormSection>

      {/* Cumpleaños extras (condicional).
          Se abre también cuando la reserva YA tiene torta o champagne aunque el
          tipo no sea Cumpleaños: si no, una reserva normal con torta cargada
          (hay una real del 28/05) queda con el aviso ámbar "falta elegir torta"
          y sin ningún control para resolverlo — ni siquiera para bajar las
          tortas a 0. La DB no ata la torta al `kind`, así que la UI tampoco. */}
      {values.kind === 'birthday' || values.cake_count > 0 || values.champagne_count > 0 ? (
        <FormSection title={values.kind === 'birthday' ? 'Cumpleaños' : 'Torta y champagne'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <BringsItemControl
              icon={Cake}
              label="¿Lleva torta?"
              itemLabel="tortas"
              value={values.cake_count}
              onChange={(v) => {
                form.setValue('cake_count', v)
                // Bajar a 0 tortas limpia el sabor: la DB tiene un check que
                // lo prohíbe y, sobre todo, guardar "opción 2" en una mesa
                // sin torta le deja a la cocina una comanda fantasma.
                if (v === 0) form.setValue('cake_option_id', null)
              }}
            />
            <BringsItemControl
              icon={GlassWater}
              label="¿Traen champagne?"
              itemLabel="botellas"
              value={values.champagne_count}
              onChange={(v) => form.setValue('champagne_count', v)}
            />
          </div>

          {/* El desplegable de tortas: se abre solo cuando hay torta que
              hacer. Es la mitad que faltaba — antes se anotaba "torta: 1" y
              el lunes nadie sabía de qué era. */}
          {values.cake_count > 0 ? (
            <CakeOptionPicker
              options={cakeOptions}
              value={values.cake_option_id ?? null}
              onChange={(id) => form.setValue('cake_option_id', id, { shouldValidate: true })}
              cakeCount={values.cake_count}
              manageHref={canManageCakes ? `/${tenantSlug}/configuracion/tortas` : undefined}
            />
          ) : null}
        </FormSection>
      ) : null}

      {/* Gestor + asistente */}
      <FormSection title="Quién gestionó">
        <FieldRow>
          <Field
            label="Gestor principal"
            error={errors.primary_manager_id?.message}
            hint="Es quien se lleva la comisión."
          >
            <Select
              value={values.primary_manager_id}
              onValueChange={(v) =>
                form.setValue('primary_manager_id', v, { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Elegí un gestor" />
              </SelectTrigger>
              <SelectContent>
                {managerGroups.map((g) => (
                  <SelectGroup key={g.key}>
                    {g.label ? <SelectLabel>{g.label}</SelectLabel> : null}
                    {g.items.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <ManagerOption manager={m} isSelf={m.id === linkedManagerId} />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Asistente" optional hint="Si suman dos comisionables, se reparte 50/50.">
            <Select
              value={values.assistant_manager_id ?? '__none__'}
              onValueChange={(v) =>
                form.setValue('assistant_manager_id', v === '__none__' ? undefined : v, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Nadie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nadie</SelectItem>
                {managerGroups.map((g) => {
                  const items = g.items.filter((m) => m.id !== values.primary_manager_id)
                  if (items.length === 0) return null
                  return (
                    <SelectGroup key={g.key}>
                      {g.label ? <SelectLabel>{g.label}</SelectLabel> : null}
                      {items.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <ManagerOption manager={m} isSelf={m.id === linkedManagerId} />
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )
                })}
              </SelectContent>
            </Select>
          </Field>
        </FieldRow>
        <ManagersHint
          tenantSlug={tenantSlug}
          count={managers.length}
          canManage={canManageManagers}
        />
      </FormSection>

      {/* Origen */}
      <FormSection title="Cómo llegó la reserva">
        <fieldset className="flex min-w-0 flex-wrap gap-2">
          <legend className="sr-only">Cómo llegó la reserva</legend>
          {ORIGINS.map((o) => (
            <FilterChip
              key={o}
              pressed={values.origin === o}
              onClick={() => form.setValue('origin', o, { shouldValidate: true })}
            >
              {ORIGIN_LABELS[o]}
            </FilterChip>
          ))}
        </fieldset>
      </FormSection>

      {/* Seña + avisos + comentarios */}
      <FormSection title="Seña, avisos y comentarios">
        <Field
          label="Seña"
          optional
          error={errors.deposit_cents?.message}
          hint="En pesos. Si no dejaron seña, dejalo vacío."
          className="sm:max-w-60"
        >
          <MoneyField
            cents={values.deposit_cents > 0 ? values.deposit_cents : null}
            decimals="auto"
            placeholder="Sin seña"
            onCentsChange={(cents) =>
              form.setValue('deposit_cents', cents ?? 0, { shouldValidate: true })
            }
          />
        </Field>

        {/* Avisos: van pegados al comentario porque son la versión marcable de
            lo que antes se escribía suelto ahí y nadie leía. Chips y no un
            select múltiple: el staff carga reservas por teléfono desde el
            celular, y esto tiene que ser un toque. */}
        <div className="grid gap-2">
          <fieldset className="grid min-w-0 gap-2">
            <legend className="mb-2 type-label text-foreground">Avisos para cocina y salón</legend>
            <div className="flex flex-wrap gap-2">
              {SERVICE_ALERTS.map((alert) => {
                const meta = SERVICE_ALERT_META[alert]
                return (
                  <FilterChip
                    key={alert}
                    pressed={selectedAlerts.includes(alert)}
                    title={meta.hint}
                    onClick={() => toggleAlert(alert)}
                  >
                    {meta.label}
                  </FilterChip>
                )
              })}
            </div>
          </fieldset>
          <p className="type-caption text-pretty text-subtle-foreground">
            {profileAlerts.length > 0
              ? `${profileAlerts.map((a) => SERVICE_ALERT_META[a].label).join(', ')} ${
                  profileAlerts.length === 1 ? 'ya está' : 'ya están'
                } en la ficha de este cliente y ${
                  profileAlerts.length === 1 ? 'aparece' : 'aparecen'
                } solos en cada reserva. Para sacarlo hay que editar la ficha.`
              : hasCustomerLink
                ? 'Lo que es de la persona (celíaca, alérgica) queda guardado en su ficha y vuelve solo la próxima vez.'
                : // Sin cliente en el CRM no hay ficha donde guardarlo. Decirlo:
                  // prometer "vuelve solo" y que no vuelva es peor que no prometerlo.
                  'Estos avisos quedan solo en esta reserva. Cargá el teléfono para que se guarden en la ficha del cliente y vuelvan solos la próxima vez.'}
          </p>
        </div>

        <Field label="Comentarios" optional error={errors.comments?.message}>
          <Textarea
            {...form.register('comments')}
            placeholder="Alergia a qué, mesa preferida, promos ofrecidas, etc."
            rows={3}
          />
        </Field>
        {/* La válvula de escape para lo que no entra en ningún chip. Solo
            tiene sentido si hay algo escrito. */}
        {values.comments?.trim() ? (
          <Field
            layout="toggle"
            label="Destacar este comentario"
            hint="Se lee entero en la agenda y en el panel de mozos, sin abrir nada."
          >
            <Switch
              checked={Boolean(values.highlight_comment)}
              onCheckedChange={(v) =>
                form.setValue('highlight_comment', v, { shouldValidate: true })
              }
            />
          </Field>
        ) : null}
      </FormSection>

      {/* Comisión estimada: el número con plata atrás, justo antes de guardar. */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <p className="type-small text-muted-foreground">
          Comisión estimada:{' '}
          {commissionPreviewCents > 0 ? (
            <Amount
              cents={commissionPreviewCents}
              decimals={0}
              className="font-semibold text-foreground"
            />
          ) : (
            <span className="text-foreground">—</span>
          )}
        </p>
        <p className="inline-flex items-center gap-1.5 type-caption text-muted-foreground max-sm:hidden">
          Para guardar sin el mouse: <KbdShortcut keys={['mod', 'enter']} />
        </p>
      </div>

      <FormActions sticky="always">
        {cancelHref ? (
          <Button asChild variant="secondary" className="max-sm:hidden">
            <Link href={cancelHref}>Cancelar</Link>
          </Button>
        ) : null}
        <Button
          type="submit"
          loading={submitting}
          loadingText="Guardando…"
          disabled={eventDateMismatch}
          title={
            eventDateMismatch
              ? 'La fecha de la reserva no coincide con la del evento elegido.'
              : undefined
          }
        >
          {mode === 'create' ? 'Crear reserva' : 'Guardar cambios'}
        </Button>
      </FormActions>

      {/* Sobrecupo (D3): se guarda recién al confirmar. El diálogo va en un
          portal, así que sus botones no envían este <form>. */}
      <OverCapacityConfirm
        projection={confirming?.projection ?? null}
        mode={mode}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const pending = confirming
          setConfirming(null)
          if (!pending) return
          startSubmit(async () => {
            await persist(pending.data, pending.projection)
          })
        }}
      />
    </form>
  )
}

// ──────────────────────────────────────────────────────────
// Subcomponentes
// ──────────────────────────────────────────────────────────

/** Solo hex: el color viene de la DB y va a un `style`. */
function safeColor(colorHex: string | null | undefined): string {
  return colorHex && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colorHex)
    ? colorHex
    : 'var(--primary)'
}

/**
 * Un evento programado del día como opción de "Dónde se sienta": nombre con el
 * color del formato, hora y ocupación real (la misma cuenta del calendario, si
 * ya llegó el cupo del día). Un toque = `scheduled_event_id` y el servicio del
 * evento; la planta se elige aparte (`EventFloorChooser`) y, si la eligieron,
 * la tarjeta la repite abajo ("Evento · Planta Alta") para leerla de un vistazo.
 */
function eventPlaceItem(
  event: ScheduledEventWithTemplate,
  load: SegmentEventLoad | null,
  /** Planta elegida dentro de este evento (solo si es el elegido). */
  floor: SalonZone | null,
): RadioCardsItem {
  const name = event.name_override ?? event.template?.name ?? 'Evento'
  const used = load?.used ?? null
  const cap = load?.capacity ?? event.capacity
  const full = used !== null && cap > 0 && used >= cap
  return {
    value: `${EVENT_VALUE_PREFIX}${event.id}`,
    label: (
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: safeColor(event.template?.color_hex) }}
        />
        <span className="truncate">{name}</span>
      </span>
    ),
    meta: event.starts_at_local.slice(0, 5),
    description: (
      <>
        <span className={cn('tabular-nums', full && 'font-medium text-destructive-text')}>
          {used !== null ? `${used}/${cap}` : `cupo ${cap}`}
          {full ? ' · lleno' : ''}
        </span>
        <span className="block">
          {floor && floor !== 'event_floating' ? `Evento · ${floorLabel(floor)}` : 'Evento'}
        </span>
      </>
    ),
  }
}

/**
 * Fila de un gestor dentro del combo. "Vos" es el ancla para encontrarse
 * rápido en una lista que ahora tiene a todo el equipo; "$$" marca a quien
 * cobra comisión, que es el dato con plata atrás.
 */
function ManagerOption({ manager, isSelf }: { manager: ReservationManagerRow; isSelf: boolean }) {
  return (
    <span className="flex items-center gap-2">
      {manager.display_name}
      {isSelf ? <Badge tone="neutral">Vos</Badge> : null}
      {manager.commission_eligible ? (
        <Badge tone="brand" title="Cobra comisión">
          $$
          <span className="sr-only">(cobra comisión)</span>
        </Badge>
      ) : null}
    </span>
  )
}

/**
 * Aviso del combo de gestores. El ABM existe hace rato (Configuración →
 * Comisiones → tab Gestores) pero nadie lo encontraba: el bar terminó con un
 * solo gestor cargado y todas las reservas quedaron atribuidas a esa persona.
 * El link está siempre; el aviso fuerte aparece cuando hay 1 o ninguno.
 *
 * OJO con el copy: la página de Comisiones abre SIEMPRE en el tab "Tarifas"
 * (`defaultValue` fijo, todavía no lee el `?tab=`), así que el texto nombra el
 * tab explícitamente — mandarlo a una página donde el ABM no se ve es
 * exactamente el problema que este aviso viene a resolver. El `?tab=gestores`
 * queda puesto para cuando esa página lo respete.
 */
function ManagersHint({
  tenantSlug,
  count,
  canManage,
}: {
  tenantSlug: string
  count: number
  canManage: boolean
}) {
  const href = `/${tenantSlug}/configuracion/comisiones?tab=gestores`

  if (count === 0) {
    return (
      <Callout tone="danger" announce="assertive" title="No hay gestores cargados.">
        Sin al menos un gestor no se puede guardar la reserva.{' '}
        {canManage ? (
          <>
            <a href={href} target="_blank" rel="noopener">
              Cargalos en Comisiones
            </a>
            , pestaña «Gestores».
          </>
        ) : (
          'Pedile al dueño que los cargue en Configuración → Comisiones → pestaña «Gestores».'
        )}
      </Callout>
    )
  }

  if (count === 1) {
    return (
      <Callout tone="warning">
        Hay un solo gestor cargado, así que todas las reservas van a quedar a su nombre. ¿Falta
        alguien?{' '}
        {canManage ? (
          <>
            <a href={href} target="_blank" rel="noopener">
              Agregalos en Comisiones
            </a>
            , pestaña «Gestores».
          </>
        ) : (
          'Pedile al dueño que agregue al resto en Configuración → Comisiones → pestaña «Gestores».'
        )}
      </Callout>
    )
  }

  if (!canManage) return null

  return (
    <p className="type-caption text-muted-foreground">
      ¿Falta alguien en la lista?{' '}
      <a
        href={href}
        target="_blank"
        rel="noopener"
        className="underline underline-offset-[3px] hover:text-foreground"
      >
        Agregalos en Comisiones
      </a>
      , pestaña «Gestores».
    </p>
  )
}

/**
 * «¿Lleva torta?» / «¿Traen champagne?»: No o Sí, y cuántas (hasta 2) si es
 * que sí. Un segmentado de dos opciones del kit y su `NumberField`.
 */
function BringsItemControl({
  icon: Icon,
  label,
  itemLabel,
  value,
  onChange,
}: {
  icon: typeof Cake
  label: string
  /** «tortas», «botellas»: el nombre de la cantidad para el lector de pantalla. */
  itemLabel: string
  value: number
  onChange: (v: number) => void
}) {
  const labelId = useId()
  const brings = value > 0
  return (
    <div className="grid content-start gap-2">
      <span id={labelId} className="inline-flex items-center gap-1.5 type-label text-foreground">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label={label}
          items={[
            { value: 'no', label: 'No' },
            { value: 'si', label: 'Sí' },
          ]}
          value={brings ? 'si' : 'no'}
          onValueChange={(v) => onChange(v === 'si' ? (value > 0 ? value : 1) : 0)}
        />
        {brings ? (
          <NumberField
            value={value}
            onValueChange={(n) => {
              if (n !== null) onChange(n)
            }}
            min={1}
            max={2}
            size="sm"
            aria-label={`Cuántas ${itemLabel} (máximo 2)`}
            className="w-32"
          />
        ) : null}
      </div>
    </div>
  )
}

const METER_FALLBACK_TEXT = {
  'no-date': 'Elegí la fecha para ver el cupo del servicio.',
  error: 'No pudimos leer el cupo de ese día. Igual podés guardar.',
  inactive: 'Esta reserva está cancelada o marcada como que no vino: no ocupa lugar en el cupo.',
} as const

/**
 * Cómo queda el servicio CON esta reserva: "Cena · 123 de 120", la barra
 * (evento con su color, normales con el tono del estado, libre) y la decisión
 * en una línea. Son los mismos números que va a mostrar la confirmación de
 * sobrecupo al guardar, así el diálogo no sorprende. Pasarse se permite: solo
 * se avisa.
 */
function SegmentMeter({
  projection,
  fallback,
  onRetry,
}: {
  projection: SegmentProjection | null
  fallback: 'loading' | 'error' | 'no-date' | 'inactive'
  /** Vuelve a pedir el cupo del día. Sin esto, la única salida era cambiar de fecha y volver. */
  onRetry: () => void
}) {
  if (!projection) {
    if (fallback === 'loading') {
      return (
        <div role="status" className="grid gap-2 rounded-xl border border-border bg-card p-3">
          <span className="sr-only">Leyendo el cupo del servicio…</span>
          <Skeleton aria-hidden className="h-4 w-32" />
          <Skeleton aria-hidden className="h-1.5 w-full rounded-full" />
          <Skeleton aria-hidden className="h-3 w-40" />
        </div>
      )
    }
    if (fallback === 'error') {
      return (
        <Callout
          tone="warning"
          announce="polite"
          action={
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden />
              Reintentar
            </Button>
          }
        >
          {METER_FALLBACK_TEXT.error}
        </Callout>
      )
    }
    return (
      <p className="flex min-h-14 items-center rounded-xl border border-dashed border-border-strong px-4 type-small text-muted-foreground">
        {METER_FALLBACK_TEXT[fallback]}
      </p>
    )
  }

  const after = projection.after
  const tone = SEGMENT_TONE_CLASSES[segmentTone(after)]
  const status = segmentStatusLine(after)
  const eventLine = projection.event ? overCapacityConfirmCopy(projection).eventLine : null
  return (
    <div className="grid gap-1.5 rounded-xl border border-border bg-card p-3">
      <p className={cn('type-label tabular-nums', tone.text)}>{segmentHeadline(after, 'long')}</p>
      <SegmentBar segment={after} size="sm" />
      <p
        aria-live="polite"
        className={cn(
          'type-caption',
          projection.needsConfirm ? tone.text : 'text-muted-foreground',
        )}
      >
        {projection.needsConfirm ? `Al guardar te vamos a pedir confirmación: ${status}` : status}
      </p>
      {eventLine ? <p className="type-caption text-muted-foreground">{eventLine}</p> : null}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// CustomerCombobox: autocomplete contra el CRM
// ──────────────────────────────────────────────────────────

/**
 * Nombre del cliente con sugerencias del CRM, y su teléfono.
 *
 * Es un campo de texto libre (una reserva no necesita cliente del CRM: se
 * puede escribir cualquier nombre) con la lista de sugerencias del patrón
 * «combobox» de la APG: `role="combobox"`, `aria-expanded`,
 * `aria-activedescendant`, ↑ ↓ para recorrer, Enter para elegir y Esc para
 * cerrar. El `Combobox` del kit elige de una lista y no deja texto libre,
 * por eso este queda acá.
 */
function CustomerCombobox({
  tenantSlug,
  value,
  onChange,
  error,
  phoneError,
}: {
  tenantSlug: string
  value: {
    customer_id?: string
    guest_name: string
    guest_phone: string | null
    guest_email: string | null
  }
  onChange: (v: {
    customer_id?: string
    guest_name: string
    guest_phone: string | null
    guest_email: string | null
    /** Avisos de la ficha del cliente elegido; `undefined` si se escribió a mano. */
    service_alerts?: ServiceAlert[]
  }) => void
  error?: string
  phoneError?: string
}) {
  const listId = useId()
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [, startSearch] = useTransition()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestRef = useRef(0)

  const search = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (q.trim().length < 2) {
        requestRef.current += 1
        setResults([])
        setOpen(false)
        return
      }
      debounceRef.current = setTimeout(() => {
        // Solo la última búsqueda escribe: una respuesta atrasada de "ma" no
        // pisa la de "mar".
        const id = ++requestRef.current
        startSearch(async () => {
          const r = await searchCustomers(tenantSlug, q)
          if (id !== requestRef.current) return
          setResults(r)
          setActive(-1)
          setOpen(true)
        })
      }, 200)
    },
    [tenantSlug],
  )

  function pick(c: CustomerSearchResult) {
    onChange({
      customer_id: c.id,
      guest_name: `${c.first_name} ${c.last_name}`.trim(),
      guest_phone: c.phone,
      guest_email: null,
      service_alerts: parseServiceAlerts(c.service_alerts),
    })
    setOpen(false)
    setActive(-1)
  }

  const expanded = open && results.length > 0

  return (
    <FieldRow className="sm:grid-cols-[1fr_15rem]">
      <Field
        label="Nombre del cliente"
        error={error}
        hint={
          value.customer_id
            ? 'Cliente vinculado al CRM.'
            : value.guest_name
              ? 'Reserva libre: no se vincula a un cliente del CRM.'
              : 'Escribí el nombre: si ya es cliente, aparece para elegirlo.'
        }
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
            aria-hidden
          />
          <Input
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            value={value.guest_name}
            onChange={(e) => {
              onChange({ ...value, guest_name: e.target.value, customer_id: undefined })
              search(e.target.value)
            }}
            onKeyDown={(e) => {
              if (!expanded) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => (i + 1) % results.length)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
              } else if (e.key === 'Enter' && active >= 0) {
                const c = results[active]
                if (c) {
                  e.preventDefault()
                  pick(c)
                }
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
            }}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Buscar o escribir el nombre…"
            className="pl-9"
          />
          <div
            id={listId}
            role="listbox"
            aria-label="Clientes del CRM"
            hidden={!expanded}
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-float"
          >
            {results.map((c, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: el teclado lo maneja el campo (flechas, aria-activedescendant); el click es para el mouse y el dedo
              <div
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                // Elegir con el mouse no le saca el foco al campo.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={cn(
                  'flex min-h-8 cursor-default items-center justify-between gap-2 rounded-md px-2 type-body pointer-coarse:min-h-11',
                  'hover:bg-accent',
                  i === active && 'bg-accent',
                )}
              >
                <span className="truncate">
                  {c.first_name} {c.last_name}
                </span>
                <span className="shrink-0 type-caption tabular-nums text-muted-foreground">
                  {c.phone}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Field>
      <Field
        label="Teléfono"
        optional
        error={phoneError}
        hint="Tocá la bandera si el cliente es de otro país."
      >
        {(control) => (
          <PhoneInput
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            international
            defaultCountry="AR"
            placeholder="351 555 1234"
            value={value.guest_phone ?? undefined}
            onChange={(v) =>
              onChange({
                ...value,
                guest_phone: v ?? null,
                customer_id: undefined,
              })
            }
            className="hub-phone-input"
          />
        )}
      </Field>
    </FieldRow>
  )
}

/**
 * "¿Dónde se sientan? (opcional)": la planta de una reserva de evento, con las
 * `RadioCards` del kit (un solo tab stop, flechas del teclado, el lector
 * anuncia "1 de 3").
 *
 * Al lado de cada planta, la gente que ya hay en ella en ESE servicio (la misma
 * cuenta de las tarjetas de arriba), sin denominador: el tope es del servicio y
 * lo dice el medidor. Sirve para decidir dónde entra el grupo.
 */
function EventFloorChooser({
  value,
  byZone,
  segmentLabel,
  onChange,
}: {
  value: SalonZone
  byZone: Record<SalonZone, number> | null
  /** "la cena", "el almuerzo"… (null mientras no llegó el cupo del día). */
  segmentLabel: string | null
  onChange: (zone: SalonZone) => void
}) {
  const labelId = useId()
  return (
    <div className="grid gap-2 border-t border-border pt-4">
      <p id={labelId} className="type-label text-foreground">
        {EVENT_FLOOR_QUESTION}{' '}
        <span className="font-normal text-subtle-foreground">(opcional)</span>
      </p>
      <RadioCards
        aria-labelledby={labelId}
        size="sm"
        className="min-[420px]:grid-cols-3"
        value={value}
        onValueChange={(z) => onChange(z as SalonZone)}
        items={EVENT_FLOOR_OPTIONS.map((o) => ({
          value: o.zone,
          label: o.label,
          description:
            o.zone !== 'event_floating' && byZone && segmentLabel
              ? `${byZone[o.zone]} en ${segmentLabel}`
              : undefined,
        }))}
      />
    </div>
  )
}
