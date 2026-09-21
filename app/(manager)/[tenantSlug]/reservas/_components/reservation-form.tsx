'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import {
  Cake,
  Calendar,
  Clock,
  GlassWater,
  HandHeart,
  MessageCircle,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { toast } from 'sonner'
import { CakeOptionPicker } from '@/components/reservations/cake-option-picker'
import { SEGMENT_TONE_CLASSES, SegmentBar } from '@/components/reservations/segment-meter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { calculateCommission, type RateTier } from '@/lib/commissions/calculate'
import { type CustomerSearchResult, searchCustomers } from '@/lib/customers/search'
import { createSalonReservation, updateSalonReservation } from '@/lib/salon/actions'
import {
  parseServiceAlerts,
  SERVICE_ALERT_META,
  SERVICE_ALERTS,
  type ServiceAlert,
} from '@/lib/salon/alerts'
import { calendarHref } from '@/lib/salon/calendar-links'
import { fetchScheduledEventsForDate } from '@/lib/salon/client-actions'
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
import { OverCapacityConfirm } from './over-capacity-confirm'
import { QuickTemplateDialog } from './quick-template-dialog'
import { SegmentPicker } from './segment-picker'

type ReservationFormInput = CreateSalonReservationInput

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

type Props = {
  mode: 'create' | 'edit'
  tenantSlug: string
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
// asocia vía zona "event_floating") ni 'breakfast' (2 en toda la historia,
// cuenta como almuerzo) se ofrecen; el enum los sigue aceptando por las
// reservas viejas.
const ORIGINS: ReservationOrigin[] = [
  'whatsapp',
  'instagram',
  'messenger',
  'in_person',
  'partner_referral',
]
// Las plantas se listan fijas; los eventos del día se suman como tiles al lado
// (ver "Dónde se sienta"). `event_floating` sólo se setea al tocar un evento.
const FLOOR_ZONES: SalonZone[] = ['planta_alta', 'planta_baja']

const ZONE_TILE =
  'flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 text-sm font-medium transition-all'
const ZONE_TILE_ACTIVE = 'border-primary bg-primary/10 text-foreground shadow-inner'
const ZONE_TILE_IDLE = 'border-border bg-card/40 text-muted-foreground hover:bg-secondary'
const KINDS: ReservationKind[] = ['normal', 'birthday', 'special']

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

/** 'YYYY-MM-DD' → 'dd/MM' (así habla el bar de las fechas). */
function ddMM(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// El input date da '' mientras está vacío: con eso no se pide el cupo (el
// server igual valida la fecha con zod).
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d/

function quickChips(today: string): Array<{ label: string; date: string }> {
  const base = new Date(`${today}T12:00:00Z`)
  const out: Array<{ label: string; date: string }> = []
  const fmt = (d: Date) => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Cordoba',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  }
  out.push({ label: 'Hoy', date: today })
  const tomorrow = new Date(base.getTime() + 24 * 3600 * 1000)
  out.push({ label: 'Mañana', date: fmt(tomorrow) })
  // próximo viernes / sábado
  for (let i = 2; i <= 9; i++) {
    const d = new Date(base.getTime() + i * 24 * 3600 * 1000)
    const dow = d.getUTCDay() // 0=Sun ... 5=Fri 6=Sat
    if (dow === 5) {
      out.push({ label: 'Viernes', date: fmt(d) })
      break
    }
  }
  for (let i = 2; i <= 9; i++) {
    const d = new Date(base.getTime() + i * 24 * 3600 * 1000)
    const dow = d.getUTCDay()
    if (dow === 6) {
      out.push({ label: 'Sábado', date: fmt(d) })
      break
    }
  }
  return out
}

export function ReservationForm({
  mode,
  tenantSlug,
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

  // Auto-clear scheduled_event_id si zona no es event_floating
  useEffect(() => {
    if (values.zone !== 'event_floating' && values.scheduled_event_id) {
      form.setValue('scheduled_event_id', undefined)
    }
  }, [values.zone, values.scheduled_event_id, form])

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
  const hasEvent = values.zone === 'event_floating' && !!values.scheduled_event_id
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

  const timeField = form.register('reservation_time_local')

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
    values.zone === 'event_floating' &&
    !!values.scheduled_event_id &&
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
      // Volvemos al calendario ABIERTO EN EL DÍA de la reserva y con su fila
      // resaltada: al cargar una para el 31/07 el dueño volvía a hoy y no la
      // veía ("las reservas no salen una vez registradas").
      const savedId =
        mode === 'create'
          ? typeof result.data?.id === 'string'
            ? result.data.id
            : undefined
          : reservationId
      router.push(calendarHref(tenantSlug, { day: data.reservation_date, focusId: savedId }))
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

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Cliente */}
      <FieldGroup title="Cliente" icon={UserIcon}>
        <CustomerCombobox
          tenantSlug={tenantSlug}
          value={{
            customer_id: values.customer_id,
            guest_name: values.guest_name,
            guest_phone: values.guest_phone ?? null,
            guest_email: values.guest_email ?? null,
          }}
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
          error={form.formState.errors.guest_name?.message}
        />
      </FieldGroup>

      {/* Fecha + horario */}
      <FieldGroup title="Cuándo" icon={Calendar}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label
              htmlFor="reservation_date"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Fecha
            </Label>
            <Input
              id="reservation_date"
              type="date"
              aria-invalid={!!form.formState.errors.reservation_date}
              {...form.register('reservation_date')}
              className="h-11 text-base"
            />
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  type="button"
                  key={c.label}
                  onClick={() =>
                    form.setValue('reservation_date', c.date, { shouldValidate: true })
                  }
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    values.reservation_date === c.date
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {/* Los dos horarios van juntos y en ese orden: se leen como un rango.
              En mobile quedan uno al lado del otro en vez de apilarse, que es
              como el staff los piensa ("de nueve y media a doce y media"). */}
          <div className="grid grid-cols-2 gap-3 sm:w-[292px]">
            <div className="space-y-2">
              <Label
                htmlFor="reservation_time_local"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Horario
              </Label>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reservation_time_local"
                  type="time"
                  step={900}
                  aria-invalid={!!form.formState.errors.reservation_time_local}
                  {...timeField}
                  onChange={(e) => {
                    void timeField.onChange(e)
                    handleTimeChangedByUser(e.target.value)
                  }}
                  className="h-11 pl-9 text-base tabular-nums"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="reservation_end_time_local"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Hasta (opcional)
              </Label>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="reservation_end_time_local"
                  type="time"
                  step={900}
                  aria-invalid={!!form.formState.errors.reservation_end_time_local}
                  aria-describedby="reservation_end_time_hint"
                  {...form.register('reservation_end_time_local')}
                  className={cn('h-11 pl-9 text-base tabular-nums', endTime && 'pr-9')}
                />
                {/* Sin esto no se puede volver a "sin hora de fin" desde el
                    celular: la rueda de iOS y el reloj de Android no tienen
                    cómo dejar el campo vacío. Y puede llegar cargado solo,
                    porque el alta desde un evento lo precarga. */}
                {endTime ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Quitar el horario de fin"
                    onClick={() =>
                      form.setValue('reservation_end_time_local', '', { shouldValidate: true })
                    }
                    className="absolute right-1 top-1/2 size-8 -translate-y-1/2 rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
            {/* Tres estados, no dos: sin fin es un consejo, con fin es el dato
                que el dueño vino a buscar (cuánto dura la mesa), y un tramo
                absurdo es un aviso. Decirle "dejalo vacío" a alguien que acaba
                de completar el campo era un consejo desalineado. */}
            <p
              id="reservation_end_time_hint"
              className={cn(
                'col-span-2 text-[11px] leading-snug',
                // Tinte de fondo, no color de texto: `--warning-foreground` está
                // pensado SOBRE el ámbar y en dark mode queda casi negro sobre
                // negro. Es el mismo patrón del chip de cubiertos.
                implausibleSpan
                  ? 'rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {!endTime
                ? 'Si no sabés hasta qué hora se quedan, dejalo vacío.'
                : implausibleSpan
                  ? `Serían ${durationLabel(spanMinutes ?? 0)} de mesa. ¿Está bien el horario?`
                  : crossesMidnight
                    ? `Termina al día siguiente · ${durationLabel(spanMinutes ?? 0)} de mesa.`
                    : `${durationLabel(spanMinutes ?? 0)} de mesa.`}
            </p>
          </div>
        </div>
      </FieldGroup>

      {/* Servicio: Almuerzo / Merienda / Cena con su hora sugerida y cómo
          viene su cupo ese día. Tocar uno mueve la hora si todavía no la
          tocaron; si la tocaron y es de otro servicio, se avisa. */}
      <FieldGroup title="Tipo de servicio" icon={Sparkles}>
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
      </FieldGroup>

      {/* Dónde se sienta: plantas + eventos del día en UNA sola grilla. Antes
          había que elegir "Sujeta a evento" y DESPUÉS buscar el evento en un
          combo — dos veces la misma decisión. Ahora cada evento programado del
          día es una opción más, con su hora y su ocupación a la vista. */}
      <FieldGroup title="Dónde se sienta" icon={Users}>
        <div className="grid gap-2 sm:grid-cols-3">
          {FLOOR_ZONES.map((z) => {
            const isActive = values.zone === z
            return (
              <button
                type="button"
                key={z}
                aria-pressed={isActive}
                onClick={() => form.setValue('zone', z, { shouldValidate: true })}
                className={cn(ZONE_TILE, isActive ? ZONE_TILE_ACTIVE : ZONE_TILE_IDLE)}
              >
                <span>{z === 'planta_alta' ? 'Planta Alta' : 'Planta Baja'}</span>
                {/* Personas en la planta EN ESTE SERVICIO, sin denominador: el
                    tope por planta del día entero mezclaba almuerzo y cena
                    (el mismo defecto que el "171 de 130"). El tope es del
                    servicio y lo muestra el medidor de abajo. */}
                {projection ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {projection.before.byZone[z]} en {SEGMENT_WITH_ARTICLE[projection.segment]}
                  </span>
                ) : null}
              </button>
            )
          })}
          {eventsForDate.map((e) => (
            <EventZoneTile
              key={e.id}
              event={e}
              active={values.zone === 'event_floating' && values.scheduled_event_id === e.id}
              load={eventLoads[e.id] ?? null}
              onSelect={() => {
                form.setValue('zone', 'event_floating', { shouldValidate: true })
                form.setValue('scheduled_event_id', e.id, { shouldValidate: true })
                form.clearErrors('scheduled_event_id')
                // El evento define el servicio (por su hora, R2) y con eso la
                // tarifa: 'hub_event' no tiene y dejaba la comisión en 0. Si la
                // hora no la tocaron, la reserva arranca con el evento.
                setAutoSwitchedTo(null)
                form.setValue(
                  'meal_type',
                  mealTypeForSegment(segmentOfEventStart(e.starts_at_local)),
                  { shouldValidate: true, shouldDirty: false },
                )
                if (!timeTouched) {
                  form.setValue('reservation_time_local', e.starts_at_local.slice(0, 5), {
                    shouldValidate: true,
                    shouldDirty: false,
                  })
                }
              }}
            />
          ))}
        </div>
        {eventsForDate.length === 0 && !eventDateMismatch ? (
          <p className="text-xs text-muted-foreground">
            Sin eventos programados para el {ddMM(values.reservation_date)}. Si la reserva es para
            un evento,{' '}
            <a
              href={`/${tenantSlug}/eventos/programados`}
              target="_blank"
              rel="noopener"
              className="text-primary underline"
            >
              programalo en el calendario
            </a>{' '}
            y va a aparecer acá como opción.
          </p>
        ) : null}
        {form.formState.errors.zone?.message ? (
          <p className="text-sm text-destructive">{form.formState.errors.zone.message}</p>
        ) : null}
        {eventDateMismatch ? (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3"
          >
            <p className="text-sm font-medium text-destructive">
              La fecha no coincide con el evento
              {selectedEventDate ? ` (el evento es del ${ddMM(selectedEventDate)})` : ''}.
            </p>
            <p className="text-xs text-muted-foreground">
              No podemos guardarla así. Elegí cómo seguir:
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedEventDate ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() =>
                    form.setValue('reservation_date', selectedEventDate, {
                      shouldValidate: true,
                    })
                  }
                >
                  Volver al {ddMM(selectedEventDate)}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={() => {
                  // Sacarla del evento: vuelve a una planta para que el form
                  // quede válido aunque ese día no haya otros eventos.
                  form.setValue('zone', 'planta_alta', { shouldValidate: true })
                  form.setValue('scheduled_event_id', undefined, { shouldValidate: true })
                  form.clearErrors('scheduled_event_id')
                }}
              >
                Sacarla del evento
              </Button>
            </div>
          </div>
        ) : form.formState.errors.scheduled_event_id?.message ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.scheduled_event_id.message}
          </p>
        ) : null}
      </FieldGroup>

      {/* Tipo de reserva */}
      <FieldGroup title="Naturaleza" icon={HandHeart}>
        <Segmented
          options={KINDS.map((k) => ({ value: k, label: RESERVATION_KIND_LABELS[k] }))}
          value={values.kind}
          onChange={(v) => form.setValue('kind', v as ReservationKind, { shouldValidate: true })}
        />
      </FieldGroup>

      {/* ESPECIAL: formato pedido (cumple/recibida que pide Sushi/Pizza/Ramen) */}
      <AnimatePresence initial={false}>
        {(values.kind === 'birthday' || values.kind === 'special') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FieldGroup title="¿Piden formato calendarizado?" icon={Sparkles}>
              <p className="text-xs text-muted-foreground">
                Si el cumple / recibida pide Sushi Libre, Pizza Libre, Ramen u otro formato del
                catálogo. Si ya hay ese evento programado ese día, se suma; si no, se crea
                automáticamente un evento ad-hoc para ese cliente.
              </p>
              <Select
                value={values.requested_template_id ?? '__none__'}
                onValueChange={(v) =>
                  form.setValue('requested_template_id', v === '__none__' ? undefined : v, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger className="h-11 text-base">
                  <SelectValue placeholder="Sin formato (cena normal)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin formato — cena normal</SelectItem>
                  {templates.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No hay templates configurados.{' '}
                      <a
                        href={`/${tenantSlug}/eventos/templates`}
                        target="_blank"
                        rel="noopener"
                        className="text-primary underline"
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
                            <span className="text-xs text-muted-foreground">
                              · cap {t.default_capacity}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <div className="flex justify-end">
                <QuickTemplateDialog
                  tenantSlug={tenantSlug}
                  defaultMealType={values.meal_type}
                  onCreated={(tpl) => {
                    setTemplates((prev) =>
                      [...prev, tpl].sort((a, b) => a.name.localeCompare(b.name)),
                    )
                    form.setValue('requested_template_id', tpl.id, { shouldValidate: true })
                  }}
                />
              </div>
              {values.requested_template_id ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  ✓ {(() => {
                    const tpl = templates.find((t) => t.id === values.requested_template_id)
                    const existing = eventsForDate.find(
                      (e) => e.template?.id === values.requested_template_id,
                    )
                    if (existing) {
                      return `Se suma al ${tpl?.name} ya programado (${existing.starts_at_local.slice(0, 5)} · cap ${existing.capacity}).`
                    }
                    return `${tpl?.name} no está programado ese día — se crea ad-hoc al guardar.`
                  })()}
                </p>
              ) : null}
              {form.formState.errors.requested_template_id?.message ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.requested_template_id.message}
                </p>
              ) : null}
            </FieldGroup>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cantidad + capacidad */}
      <FieldGroup title="Cantidad de personas" icon={Users}>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <GuestStepper
            value={values.estimated_guests}
            onChange={(v) => form.setValue('estimated_guests', v, { shouldValidate: true })}
          />
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
      </FieldGroup>

      {/* Cumpleaños extras (condicional).
          Se abre también cuando la reserva YA tiene torta o champagne aunque el
          tipo no sea Cumpleaños: si no, una reserva normal con torta cargada
          (hay una real del 28/05) queda con el aviso ámbar "falta elegir torta"
          y sin ningún control para resolverlo — ni siquiera para bajar las
          tortas a 0. La DB no ata la torta al `kind`, así que la UI tampoco. */}
      <AnimatePresence initial={false}>
        {(values.kind === 'birthday' || values.cake_count > 0 || values.champagne_count > 0) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FieldGroup
              title={values.kind === 'birthday' ? 'Cumpleaños' : 'Torta y champagne'}
              icon={Cake}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <BringsItemControl
                  icon={Cake}
                  label="¿Lleva torta?"
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
                  value={values.champagne_count}
                  onChange={(v) => form.setValue('champagne_count', v)}
                />
              </div>

              {/* El desplegable de tortas: se abre solo cuando hay torta que
                  hacer. Es la mitad que faltaba — antes se anotaba "torta: 1" y
                  el lunes nadie sabía de qué era. */}
              <AnimatePresence initial={false}>
                {values.cake_count > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <CakeOptionPicker
                      className="pt-3"
                      options={cakeOptions}
                      value={values.cake_option_id ?? null}
                      onChange={(id) =>
                        form.setValue('cake_option_id', id, { shouldValidate: true })
                      }
                      cakeCount={values.cake_count}
                      manageHref={
                        canManageCakes ? `/${tenantSlug}/configuracion/tortas` : undefined
                      }
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </FieldGroup>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gestor + asistente */}
      <FieldGroup title="Quién gestionó" icon={UserIcon}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Gestor principal
            </Label>
            <Select
              value={values.primary_manager_id}
              onValueChange={(v) =>
                form.setValue('primary_manager_id', v, { shouldValidate: true })
              }
            >
              <SelectTrigger
                className="h-11"
                aria-invalid={!!form.formState.errors.primary_manager_id}
              >
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
            {form.formState.errors.primary_manager_id?.message ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.primary_manager_id.message}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Es quien se lleva la comisión.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Asistente (opcional)
            </Label>
            <Select
              value={values.assistant_manager_id ?? '__none__'}
              onValueChange={(v) =>
                form.setValue('assistant_manager_id', v === '__none__' ? undefined : v, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className="h-11">
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
            <p className="text-xs text-muted-foreground">
              Si suman dos comisionables, se splittea 50/50.
            </p>
          </div>
        </div>
        <ManagersHint
          tenantSlug={tenantSlug}
          count={managers.length}
          canManage={canManageManagers}
        />
      </FieldGroup>

      {/* Origen */}
      <FieldGroup title="Cómo llegó la reserva" icon={MessageCircle}>
        <Segmented
          options={ORIGINS.map((o) => ({ value: o, label: ORIGIN_LABELS[o] }))}
          value={values.origin}
          onChange={(v) =>
            form.setValue('origin', v as ReservationOrigin, { shouldValidate: true })
          }
        />
      </FieldGroup>

      {/* Seña + comentarios */}
      <FieldGroup title="Extras" icon={Sparkles}>
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <div className="space-y-1.5">
            <Label
              htmlFor="deposit_cents"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Seña (ARS)
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="deposit_cents"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder="0"
                value={values.deposit_cents > 0 ? Math.round(values.deposit_cents / 100) : ''}
                onChange={(e) =>
                  form.setValue('deposit_cents', Math.max(0, Number(e.target.value) * 100), {
                    shouldValidate: true,
                  })
                }
                className="h-11 pl-7 text-base tabular-nums"
              />
            </div>
          </div>
          {/* Avisos: van pegados al comentario porque son la versión marcable de
              lo que antes se escribía suelto ahí y nadie leía. Chips y no un
              select múltiple: el staff carga reservas por teléfono desde el
              celular, y esto tiene que ser un toque. */}
          <div className="space-y-1.5">
            <fieldset className="space-y-1.5">
              <legend className="text-xs uppercase tracking-wide text-muted-foreground">
                Avisos para cocina y salón
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {SERVICE_ALERTS.map((alert) => {
                  const meta = SERVICE_ALERT_META[alert]
                  const active = selectedAlerts.includes(alert)
                  return (
                    <button
                      type="button"
                      key={alert}
                      aria-pressed={active}
                      title={meta.hint}
                      onClick={() => toggleAlert(alert)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? meta.severity === 'critical'
                            ? 'border-destructive/60 bg-destructive/10 text-destructive'
                            : 'border-warning/60 bg-warning/15 text-foreground'
                          : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
                      )}
                    >
                      {meta.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            {profileAlerts.length > 0 ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {profileAlerts.map((a) => SERVICE_ALERT_META[a].label).join(', ')}{' '}
                {profileAlerts.length === 1 ? 'ya está' : 'ya están'} en la ficha de este cliente y
                {profileAlerts.length === 1 ? ' aparece' : ' aparecen'} solos en cada reserva. Para
                sacarlo hay que editar la ficha.
              </p>
            ) : hasCustomerLink ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Lo que es de la persona (celíaca, alérgica) queda guardado en su ficha y vuelve solo
                la próxima vez.
              </p>
            ) : (
              // Sin cliente en el CRM no hay ficha donde guardarlo. Decirlo:
              // prometer "vuelve solo" y que no vuelva es peor que no prometerlo.
              <p className="text-[11px] leading-snug text-muted-foreground">
                Estos avisos quedan solo en esta reserva. Cargá el teléfono para que se guarden en
                la ficha del cliente y vuelvan solos la próxima vez.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="comments"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Comentarios
            </Label>
            <Textarea
              id="comments"
              {...form.register('comments')}
              placeholder="Alergia a qué, mesa preferida, promos ofrecidas, etc."
              rows={3}
            />
            {/* La válvula de escape para lo que no entra en ningún chip. Solo
                tiene sentido si hay algo escrito. */}
            {values.comments?.trim() ? (
              <div className="flex items-center gap-2 pt-0.5">
                <Switch
                  id="highlight_comment"
                  checked={Boolean(values.highlight_comment)}
                  onCheckedChange={(v) =>
                    form.setValue('highlight_comment', v, { shouldValidate: true })
                  }
                />
                <Label
                  htmlFor="highlight_comment"
                  className="cursor-pointer text-[11px] font-normal leading-snug text-muted-foreground"
                >
                  Destacar este comentario: se lee entero en la agenda y en el panel de mozos, sin
                  abrir nada.
                </Label>
              </div>
            ) : null}
          </div>
        </div>
      </FieldGroup>

      {/* Footer: comisión + submit */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/90 px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm dark:bg-amber-950/40">
            <span className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Comisión estimada
            </span>
            <div className="font-mono text-base font-semibold text-amber-900 dark:text-amber-100 tabular-nums">
              {commissionPreviewCents > 0 ? ARSFormat(commissionPreviewCents) : '—'}
            </div>
          </div>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Atajo: ⌘/Ctrl + Enter para confirmar
          </p>
        </div>
        <Button
          type="submit"
          disabled={submitting || eventDateMismatch}
          title={
            eventDateMismatch
              ? 'La fecha de la reserva no coincide con la del evento elegido.'
              : undefined
          }
          className="min-w-[160px] h-11 text-base"
        >
          {submitting ? 'Guardando…' : mode === 'create' ? 'Crear reserva' : 'Guardar cambios'}
        </Button>
      </div>

      {/* Sobrecupo (D3): se guarda recién al confirmar. El AlertDialog va en
          un portal, así que sus botones no envían este <form>. */}
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

function FieldGroup({
  title,
  icon: Icon,
  children,
}: {
  title: string
  // biome-ignore lint/suspicious/noExplicitAny: lucide icon type
  icon: any
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4 sm:p-5">
      <header className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="font-serif text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  )
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
      {isSelf ? (
        <span className="rounded-full border bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
          Vos
        </span>
      ) : null}
      {manager.commission_eligible ? (
        <span
          className="rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
          title="Cobra comisión"
        >
          $$
        </span>
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
      <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
        <p className="text-sm font-medium text-destructive">No hay gestores cargados.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Sin al menos un gestor no se puede guardar la reserva.{' '}
          {canManage ? (
            <>
              <a href={href} target="_blank" rel="noopener" className="text-primary underline">
                Cargalos en Comisiones
              </a>
              , tab «Gestores».
            </>
          ) : (
            'Pedile al dueño que los cargue en Configuración → Comisiones → tab «Gestores».'
          )}
        </p>
      </div>
    )
  }

  if (count === 1) {
    return (
      <div className="rounded-lg border border-amber-300/60 bg-amber-50/70 p-3 dark:border-amber-800/60 dark:bg-amber-950/30">
        <p className="text-xs text-amber-900 dark:text-amber-100">
          Hay un solo gestor cargado, así que todas las reservas van a quedar a su nombre. ¿Falta
          alguien?{' '}
          {canManage ? (
            <>
              <a href={href} target="_blank" rel="noopener" className="font-medium underline">
                Agregalos en Comisiones
              </a>
              , tab «Gestores».
            </>
          ) : (
            'Pedile al dueño que agregue al resto en Configuración → Comisiones → tab «Gestores».'
          )}
        </p>
      </div>
    )
  }

  if (!canManage) return null

  return (
    <p className="text-xs text-muted-foreground">
      ¿Falta alguien en la lista?{' '}
      <a href={href} target="_blank" rel="noopener" className="underline hover:text-foreground">
        Agregalos en Comisiones
      </a>
      , tab «Gestores».
    </p>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isActive = value === opt.value
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
              isActive
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function GuestStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex h-14 items-center rounded-xl border border-border bg-card/60">
      <button
        type="button"
        aria-label="Quitar"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60 active:bg-secondary"
      >
        <Minus className="size-4" />
      </button>
      <div className="flex flex-1 flex-col items-center font-mono">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">personas</span>
      </div>
      <button
        type="button"
        aria-label="Agregar"
        onClick={() => onChange(Math.min(99, value + 1))}
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60 active:bg-secondary"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

function BringsItemControl({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: lucide icon type
  icon: any
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const brings = value > 0
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(0)}
          className={cn(
            'h-10 rounded-lg border px-4 text-sm font-medium transition-all',
            !brings
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
          )}
        >
          No
        </button>
        <button
          type="button"
          onClick={() => onChange(value > 0 ? value : 1)}
          className={cn(
            'flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-all',
            brings
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
          )}
        >
          <Icon className="size-4" />
          Sí
        </button>
      </div>
      <AnimatePresence initial={false}>
        {brings ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-center gap-3 pt-1">
              <span className="text-xs text-muted-foreground">Cantidad</span>
              <div className="flex h-10 items-center rounded-lg border border-border bg-card/60">
                <button
                  type="button"
                  aria-label="Quitar"
                  onClick={() => onChange(Math.max(1, value - 1))}
                  className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60"
                >
                  <Minus className="size-3.5" />
                </button>
                <span className="w-8 text-center font-mono text-base font-semibold tabular-nums">
                  {value}
                </span>
                <button
                  type="button"
                  aria-label="Agregar"
                  onClick={() => onChange(Math.min(2, value + 1))}
                  className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <span className="text-[11px] text-muted-foreground">máx 2</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
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
 * sobrecupo al guardar, así el AlertDialog no sorprende. Pasarse se permite:
 * solo se avisa.
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
        <div className="space-y-2 rounded-xl border border-border/60 bg-card/60 p-3">
          <span className="sr-only">Leyendo el cupo del servicio…</span>
          <Skeleton aria-hidden className="h-4 w-32" />
          <Skeleton aria-hidden className="h-1.5 w-full rounded-full" />
          <Skeleton aria-hidden className="h-3 w-40" />
        </div>
      )
    }
    if (fallback === 'error') {
      return (
        <div className="flex min-h-14 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-4 py-3 text-center text-xs text-muted-foreground">
          <p role="status">{METER_FALLBACK_TEXT.error}</p>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={onRetry}>
            <RotateCcw aria-hidden className="size-3.5" />
            Reintentar
          </Button>
        </div>
      )
    }
    return (
      <div className="flex min-h-14 items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/40 px-4 text-center text-xs text-muted-foreground">
        {METER_FALLBACK_TEXT[fallback]}
      </div>
    )
  }

  const after = projection.after
  const tone = SEGMENT_TONE_CLASSES[segmentTone(after)]
  const status = segmentStatusLine(after)
  const eventLine = projection.event ? overCapacityConfirmCopy(projection).eventLine : null
  return (
    <div className="space-y-1.5 rounded-xl border border-border/60 bg-card/60 p-3">
      <p className={cn('font-mono text-sm font-medium tabular-nums', tone.text)}>
        {segmentHeadline(after, 'long')}
      </p>
      <SegmentBar segment={after} size="sm" />
      <p
        aria-live="polite"
        className={cn(
          'text-[11px] leading-snug',
          projection.needsConfirm ? tone.text : 'text-muted-foreground',
        )}
      >
        {projection.needsConfirm ? `Al guardar te vamos a pedir confirmación: ${status}` : status}
      </p>
      {eventLine ? <p className="text-[11px] text-muted-foreground">{eventLine}</p> : null}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// CustomerCombobox: autocomplete contra el CRM
// ──────────────────────────────────────────────────────────

function CustomerCombobox({
  tenantSlug,
  value,
  onChange,
  error,
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
}) {
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [, startSearch] = useTransition()
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (q.trim().length < 2) {
        setResults([])
        return
      }
      debounceRef.current = setTimeout(() => {
        startSearch(async () => {
          const r = await searchCustomers(tenantSlug, q)
          setResults(r)
          setOpen(true)
        })
      }, 200)
    },
    [tenantSlug],
  )

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="space-y-1.5">
          <Label
            htmlFor="guest_name"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Nombre del cliente
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="guest_name"
              autoComplete="off"
              aria-invalid={!!error}
              value={value.guest_name}
              onChange={(e) => {
                onChange({ ...value, guest_name: e.target.value, customer_id: undefined })
                search(e.target.value)
              }}
              onFocus={() => results.length > 0 && setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Buscar o escribir nombre…"
              className="h-11 pl-9 text-base"
            />
            {open && results.length > 0 ? (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                {results.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => {
                      onChange({
                        customer_id: c.id,
                        guest_name: `${c.first_name} ${c.last_name}`.trim(),
                        guest_phone: c.phone,
                        guest_email: null,
                        service_alerts: parseServiceAlerts(c.service_alerts),
                      })
                      setOpen(false)
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary"
                  >
                    <span className="truncate">
                      {c.first_name} {c.last_name}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.phone}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {value.customer_id ? (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
              ✓ Cliente vinculado al CRM
            </p>
          ) : value.guest_name ? (
            <p className="text-[11px] text-muted-foreground">
              Reserva libre — no se vincula a cliente del CRM.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="guest_phone"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Teléfono (opcional)
          </Label>
          <PhoneInput
            id="guest_phone"
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
          <p className="text-[11px] text-muted-foreground">
            Tocá la bandera si el cliente es de otro país.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Un evento programado del día como opción de "Dónde se sienta": nombre con el
 * color del formato, hora y ocupación real (la misma cuenta del calendario, si
 * ya llegó el cupo del día). Un toque = zona `event_floating` +
 * `scheduled_event_id`, y el servicio del evento.
 */
function EventZoneTile({
  event,
  active,
  load,
  onSelect,
}: {
  event: ScheduledEventWithTemplate
  active: boolean
  load: SegmentEventLoad | null
  onSelect: () => void
}) {
  const color = event.template?.color_hex ?? 'var(--primary)'
  const name = event.name_override ?? event.template?.name ?? 'Evento'
  const used = load?.used ?? null
  const cap = load?.capacity ?? event.capacity
  const full = used !== null && cap > 0 && used >= cap
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(ZONE_TILE, active ? ZONE_TILE_ACTIVE : ZONE_TILE_IDLE)}
      style={active ? { borderColor: color } : undefined}
    >
      <span className="flex max-w-full items-center gap-1.5">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{name}</span>
      </span>
      <span
        className={cn(
          'text-[11px] tabular-nums',
          full ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {event.starts_at_local.slice(0, 5)} · {used !== null ? `${used}/${cap}` : `cap ${cap}`}
        {full ? ' · lleno' : ''}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Evento</span>
    </button>
  )
}
