import { z } from 'zod'
import { isRealIsoDay } from '@/lib/dates'
import type { ServiceAlert } from '@/lib/salon/alerts'
import { parseServiceAlerts, SERVICE_ALERT_META } from '@/lib/salon/alerts'
import { formatDayLabel } from '@/lib/salon/date-presets'
import { hhmm } from '@/lib/salon/format'
import {
  buildReservationCandidate,
  resolveNewReservationDefaults,
} from '@/lib/salon/new-reservation-defaults'
import { isHere, reversibleHint, splitTableLabel } from '@/lib/salon/operativo'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import {
  actualGuestsSchema,
  cancelReservationSchema,
  createSalonReservationSchema,
  mealTypeEnum,
  reservationKindEnum,
  reservationTableLabelSchema,
  salonZoneEnum,
  scheduledEventSchema,
  scheduledTemplateSchema,
  tableLabelField,
  transitionStatusSchema,
  updateSalonReservationSchema,
} from '@/lib/salon/schemas'
import {
  hhmmSchema,
  segmentConfigSaveSchema,
  segmentOverrideKeySchema,
  segmentOverrideSchema,
} from '@/lib/salon/segment-schemas'
import {
  computeDaySegments,
  type DaySegmentsSnapshot,
  eventDisplayName,
  type IsoDow,
  mealTypeForSegment,
  mealTypeToSave,
  projectReservation,
  type ReservationCandidate,
  resolveSegmentSettings,
  type SegmentEventInput,
  type SegmentLoad,
  type SegmentProjection,
  type SegmentSettingsResolved,
  type SegmentWeeklyCapRow,
  segmentOfEventStart,
  segmentOfMealType,
  segmentOfTime,
} from '@/lib/salon/segments'
import {
  capSourceLabel,
  overCapacityConfirmCopy,
  SEGMENT_LABELS,
  SEGMENT_WITH_ARTICLE,
  segmentEventNote,
  segmentHeadline,
  segmentStatusLine,
} from '@/lib/salon/segments-copy'
import { uniqueSlugFrom } from '@/lib/salon/slug-dedupe'
import {
  type CakeOptionRow,
  describeCake,
  type MealType,
  RESERVATION_KIND_LABELS,
  type ReservationWithJoins,
  type SalonReservationStatus,
  type SalonZone,
  type ScheduledEventTemplateRow,
  STATUS_LABELS,
} from '@/lib/salon/types'
import { fullUpdatePayload } from '@/lib/salon/update-payload'
import type { TexTicketRow, TexTicketWarning } from '../../protocol'
import { dayText, money, pesosToCents, type TexTicketDraft, zodIssuesText } from '../types'
import {
  ALERT_OF_WORD,
  ALERT_WORDS,
  CONFIGURABLE_SEGMENT_OF_WORD,
  CONFIGURABLE_SERVICE_WORDS,
  FLOOR_WORDS,
  ISO_DOW_OF_WORD,
  KIND_OF_WORD,
  KIND_WORDS,
  maskPhone,
  normalizedPhone,
  OPERABLE_STATUS,
  ORIGIN_OF_WORD,
  ORIGIN_TEXT,
  ORIGIN_WORDS,
  realDay,
  SEGMENT_OF_WORD,
  SERVICE_WORDS,
  STATUS_CHANGE_WORDS,
  TARGET_OF_CHANGE,
  WEEKDAY_PLURAL,
  WEEKDAY_WORDS,
  ZONE_OF_WORD,
} from './_words'

/**
 * De lo que pide Tex al tique y a lo que recibe la acción. Puro: las lecturas las hace la herramienta y
 * llegan acá como `facts`. Lo que sale tiene que pasar el mismo zod de la acción: es lo primero que se
 * fija en `tex-agenda.test.ts`.
 */

export type Draft<T> = ({ ok: true } & T) | { ok: false; message: string }

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message })

function row(label: string, value: string | number | null | undefined): TexTicketRow[] {
  return value === null || value === undefined || value === ''
    ? []
    : [{ label, value: String(value) }]
}

function change(label: string, before: string | number, after: string | number): TexTicketRow {
  return { label, value: `${before} → ${after}` }
}

const peopleWord = (n: number): string => (n === 1 ? '1 persona' : `${n} personas`)

// ─── El cupo: avisa, no bloquea ──────────────────────────────────────────────

export const reservationCandidateSchema = z.object({
  id: z.string().optional(),
  reservation_date: z.string(),
  meal_type: mealTypeEnum,
  reservation_time_local: z.string(),
  scheduled_event_id: z.string().nullable(),
  zone: salonZoneEnum,
  guests: z.number(),
  kind: reservationKindEnum,
  cake_count: z.number(),
  virtualEvent: z
    .object({ name: z.string(), capacity: z.number(), starts_at_local: z.string() })
    .nullable()
    .optional(),
})

/** Los mismos textos que la confirmación del formulario (`over-capacity-confirm`). */
export function overCapacityWarning(projection: SegmentProjection): TexTicketWarning {
  const copy = overCapacityConfirmCopy(projection)
  return {
    key: 'over_capacity',
    title: copy.title,
    body: [copy.body, copy.eventLine].filter(Boolean).join(' '),
  }
}

export type CapacityCheck = {
  rows: TexTicketRow[]
  warnings: TexTicketWarning[]
  /** Se pasa del cupo y la reserva lo empeora: el tique lo dice y el botón dice «igual». */
  over: boolean
}

export function capacityCheck(
  snapshot: DaySegmentsSnapshot | null,
  candidate: ReservationCandidate,
): CapacityCheck {
  if (!snapshot) {
    return {
      rows: [],
      over: false,
      warnings: [
        {
          key: 'no_capacity',
          title: 'No pude leer el cupo de ese día',
          body: 'Se puede guardar igual, pero sin el aviso de sobrecupo.',
        },
      ],
    }
  }
  const projection = projectReservation(snapshot, candidate)
  if (!projection) return { rows: [], warnings: [], over: false }
  const { after, event, needsConfirm } = projection
  const warnings: TexTicketWarning[] = []
  if (needsConfirm) warnings.push(overCapacityWarning(projection))
  else if (event?.over) {
    warnings.push({
      key: 'event_over',
      title: `${event.name} quedaría ${event.used}/${event.capacity}`,
      body: null,
    })
  }
  return {
    rows: [{ label: 'Cómo queda', value: segmentHeadline(after, 'long') }],
    warnings,
    over: needsConfirm,
  }
}

// ─── Reserva nueva ───────────────────────────────────────────────────────────

const pesos = z.number().min(0).max(100_000_000)

export const newReservationInput = z.object({
  nombre: z.string().trim().min(1).max(120).optional().describe('A nombre de quién.'),
  cliente: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .optional()
    .describe('Si ya es cliente del bar: su id, o su nombre y apellido.'),
  personas: z.number().int().min(1).max(99),
  fecha: realDay('yyyy-MM-dd. Si no la dijo, hoy.').optional(),
  hora: hhmmSchema.optional().describe('HH:MM. Sin hora, la sugerida del servicio.'),
  servicio: z
    .enum(SERVICE_WORDS)
    .optional()
    .describe('Si dijo «a la noche» y no la hora. Sin nada, cena.'),
  telefono: z.string().trim().min(6).max(30).optional(),
  instagram: z.string().trim().min(1).max(200).optional().describe('Usuario o link del perfil.'),
  evento: z.string().trim().min(1).optional().describe('Si viene a un evento: nombre o id.'),
  formato: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Cumple o especial que pide un formato que ese día no está programado.'),
  planta: z.enum(FLOOR_WORDS).optional().describe('Sin planta: alta, o «sin ubicar» en un evento.'),
  tipo: z.enum(KIND_WORDS).optional(),
  tortas: z.number().int().min(0).max(2).optional(),
  torta: z.string().trim().min(1).optional().describe('Cuál del menú: nombre o id.'),
  champagne: z.number().int().min(0).max(2).optional(),
  sena: pesos.optional().describe('En pesos.'),
  origen: z.enum(ORIGIN_WORDS).optional().describe('Por dónde entró. Sin esto, WhatsApp.'),
  gestor: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Quién la tomó: de eso sale la comisión. Sin esto, el último que se usó, o vos.'),
  asistente: z.string().trim().min(1).optional().describe('Si la comparten: reparten la comisión.'),
  nota: z.string().trim().max(2000).optional(),
  destacar: z.boolean().optional().describe('La nota se muestra abierta en la lista.'),
  avisos: z.array(z.enum(ALERT_WORDS)).max(6).optional(),
})
export type NewReservationInput = z.infer<typeof newReservationInput>

export type ManagerChoice = {
  id: string
  name: string
  eligible: boolean
  /** No lo dijo nadie: es el último que se usó o el primero de la lista. */
  assumed: boolean
}

export type CustomerChoice = {
  id: string
  name: string
  phone: string | null
  alerts: readonly ServiceAlert[]
}

export type NewReservationFacts = {
  today: string
  date: string
  snapshot: DaySegmentsSnapshot | null
  settings: SegmentSettingsResolved
  /** El evento elegido. */
  event: ScheduledEventWithTemplate | null
  dayEvents: readonly ScheduledEventWithTemplate[]
  /** El formato pedido que ese día no está programado. */
  template: ScheduledEventTemplateRow | null
  manager: ManagerChoice
  assistant: ManagerChoice | null
  cake: CakeOptionRow | null
  /** El cliente que dijo, o el dueño del teléfono: el alta lo vincula igual. */
  customer: CustomerChoice | null
  /** El flow «Se acerca un evento» prendido en el bar. */
  eventFlow: { name: string; hoursBefore: number } | null
}

export const newReservationPayload = z.object({
  values: z.record(z.string(), z.unknown()),
  candidate: reservationCandidateSchema,
  capacityAck: z.boolean(),
})
export type NewReservationPayload = z.infer<typeof newReservationPayload>

function eventFlowWarning(flow: NonNullable<NewReservationFacts['eventFlow']>): TexTicketWarning {
  return {
    key: 'event_flow',
    title: 'Le puede llegar un WhatsApp al cliente',
    body: `Está prendido «${flow.name}»: le escribe ${flow.hoursBefore} h antes del evento a quienes tienen ficha y reserva en ese evento.`,
  }
}

export function newReservationDraft(
  input: NewReservationInput,
  facts: NewReservationFacts,
): Draft<{ payload: NewReservationPayload; ticket: TexTicketDraft }> {
  const { date, event, template, manager, assistant, cake, customer } = facts
  const name = (input.nombre ?? customer?.name ?? '').trim()
  if (!name) return fail('Preguntale a nombre de quién va la reserva.')
  if (!isRealIsoDay(date)) return fail('Esa fecha no existe: revisala.')
  if (template && input.tipo === 'normal') {
    return fail(
      'Un formato que no está programado se pide solo en un cumple o una reserva especial.',
    )
  }
  if (input.tortas === 0 && input.torta) {
    return fail('Dijo qué torta y también que no lleva: preguntale.')
  }

  const defaults = resolveNewReservationDefaults({
    params: {
      date,
      event: event?.id,
      meal: input.servicio && !input.hora ? SEGMENT_OF_WORD[input.servicio] : undefined,
      time: input.hora,
    },
    today: facts.today,
    event: event
      ? {
          id: event.id,
          event_date: event.event_date,
          starts_at_local: event.starts_at_local,
          ends_at_local: event.ends_at_local,
        }
      : null,
    settings: facts.settings,
  })
  const time = input.hora ?? defaults.initialValues.reservation_time_local
  const { segment } = defaults
  const meal: MealType = mealTypeForSegment(segment)
  const zone: SalonZone = input.planta
    ? ZONE_OF_WORD[input.planta]
    : event || template
      ? 'event_floating'
      : 'planta_alta'
  const kind = input.tipo ? KIND_OF_WORD[input.tipo] : template ? 'special' : 'normal'
  const cakes = input.tortas ?? (input.torta ? 1 : 0)
  const phone = input.telefono ? normalizedPhone(input.telefono) : (customer?.phone ?? undefined)
  const alerts = [
    ...new Set([...(input.avisos ?? []).map((a) => ALERT_OF_WORD[a]), ...(customer?.alerts ?? [])]),
  ]
  const origin = input.origen ? ORIGIN_OF_WORD[input.origen] : 'whatsapp'

  const values: Record<string, unknown> = {
    ...(customer ? { customer_id: customer.id } : {}),
    guest_name: name,
    ...(phone ? { guest_phone: phone } : {}),
    ...(input.instagram ? { guest_instagram: input.instagram } : {}),
    kind,
    meal_type: meal,
    reservation_date: date,
    reservation_time_local: time,
    ...(defaults.initialValues.reservation_end_time_local
      ? { reservation_end_time_local: defaults.initialValues.reservation_end_time_local }
      : {}),
    zone,
    scheduled_event_id: event?.id ?? null,
    requested_template_id: template?.id ?? null,
    estimated_guests: input.personas,
    cake_count: cakes,
    cake_option_id: cake?.id ?? null,
    champagne_count: input.champagne ?? 0,
    deposit_cents: input.sena !== undefined ? pesosToCents(input.sena) : 0,
    origin,
    primary_manager_id: manager.id,
    assistant_manager_id: assistant?.id ?? null,
    ...(input.nota ? { comments: input.nota } : {}),
    service_alerts: alerts,
    highlight_comment: Boolean(input.destacar && input.nota),
  }
  const parsed = createSalonReservationSchema.safeParse(values)
  if (!parsed.success) return fail(zodIssuesText(parsed.error))

  const candidate = buildReservationCandidate({
    mode: 'create',
    values: {
      reservation_date: date,
      meal_type: meal,
      reservation_time_local: time,
      scheduled_event_id: event?.id ?? null,
      zone,
      estimated_guests: input.personas,
      kind,
      cake_count: cakes,
      requested_template_id: template?.id ?? null,
    },
    loadedActualGuests: null,
    templates: template ? [template] : [],
    eventsForDate: [],
  })
  const capacity = capacityCheck(facts.snapshot, candidate)

  const warnings: TexTicketWarning[] = [...capacity.warnings]
  if (date < facts.today) {
    warnings.push({ key: 'past', title: `Esa fecha ya pasó: ${dayText(date)}`, body: null })
  }
  if (
    input.servicio &&
    input.hora &&
    SEGMENT_OF_WORD[input.servicio] !== segmentOfTime(input.hora)
  ) {
    warnings.push({
      key: 'time_service',
      title: `Las ${input.hora} son de ${SEGMENT_WITH_ARTICLE[segmentOfTime(input.hora)]}: la cargo ahí`,
      body: null,
    })
  }
  if (event && input.hora && segmentOfTime(input.hora) !== segment) {
    warnings.push({
      key: 'time_event',
      title: `${eventDisplayName(event)} es de ${SEGMENT_WITH_ARTICLE[segment]} y esta hora no`,
      body: 'Cuenta en el evento igual. Revisá la hora.',
    })
  }
  if (!event && !template) {
    const same = facts.dayEvents.filter((e) => segmentOfEventStart(e.starts_at_local) === segment)
    if (same.length > 0) {
      warnings.push({
        key: 'outside_event',
        title: `Ese servicio tiene ${same.map(eventDisplayName).join(' y ')}`,
        body: 'Esta reserva queda afuera del evento. Si viene al evento, decilo.',
      })
    }
  }
  if (template) {
    warnings.push({
      key: 'new_private_date',
      title: `Se programa ${template.name} ese día, como grupo privado`,
      body: `Con cupo ${template.default_capacity ?? 30}, a la hora de la reserva. No sale en los reportes de eventos.`,
    })
  }
  if (manager.assumed && manager.eligible) {
    warnings.push({
      key: 'manager_assumed',
      title: `Queda a nombre de ${manager.name}`,
      body: 'De eso sale la comisión. Si la tomó otra persona, decilo.',
    })
  }
  if (facts.eventFlow && (event || template) && (customer || phone)) {
    warnings.push(eventFlowWarning(facts.eventFlow))
  }

  const cakeText = cake ? describeCake(cake) : cakes > 0 ? 'Falta elegir cuál' : null
  const rows: TexTicketRow[] = [
    { label: 'Cuándo', value: `${formatDayLabel(date)} · ${time}` },
    { label: 'Servicio', value: SEGMENT_LABELS[segment] },
    {
      label: 'Dónde',
      value: placeLabel(
        { zone, scheduled_event_id: event?.id ?? template?.id ?? null },
        event ? eventDisplayName(event) : (template?.name ?? null),
      ),
    },
    ...row(
      'Cliente',
      customer
        ? `Ya es cliente${customer.phone ? ` (${maskPhone(customer.phone)})` : ''}`
        : phone
          ? `${maskPhone(phone)} · se le crea la ficha`
          : null,
    ),
    ...row('Instagram', input.instagram ? 'Cargado' : null),
    ...row('Tipo', kind === 'normal' ? null : RESERVATION_KIND_LABELS[kind]),
    ...row('Torta', cakes > 0 ? (cakes === 1 ? cakeText : `${cakes} · ${cakeText}`) : null),
    ...row('Champagne', input.champagne ? input.champagne : null),
    ...row('Seña', input.sena ? money(pesosToCents(input.sena)) : null),
    { label: 'Gestor', value: `${manager.name}${manager.eligible ? ' (cobra comisión)' : ''}` },
    ...row('Asistente', assistant?.name),
    { label: 'Entró por', value: ORIGIN_TEXT[origin] },
    ...row('Avisos', alerts.map((a) => SERVICE_ALERT_META[a].short).join(', ')),
    ...row('Nota', input.nota),
    ...capacity.rows,
  ]

  return {
    ok: true,
    payload: { values, candidate, capacityAck: capacity.over },
    ticket: {
      kind: 'reserva',
      title: 'Nueva reserva',
      subtitle: name,
      rows,
      total: { label: 'Personas', value: String(input.personas) },
      entry: [],
      warnings,
      confirmLabel: capacity.over
        ? `Cargar igual para ${input.personas}`
        : `Reservar para ${input.personas}`,
    },
  }
}

// ─── Cambiar una reserva ─────────────────────────────────────────────────────

export const changeReservationInput = z.object({
  reserva: z.string().trim().min(2).describe('Nombre o id.'),
  de_la_fecha: realDay('La fecha que tiene hoy, si hay más de una con ese nombre.').optional(),
  fecha: realDay('El día nuevo, yyyy-MM-dd.').optional(),
  hora: hhmmSchema.optional().describe('La hora nueva, HH:MM.'),
  servicio: z.enum(SERVICE_WORDS).optional(),
  personas: z
    .number()
    .int()
    .min(1)
    .max(99)
    .optional()
    .describe('Si ya llegaron, es cuántos vinieron.'),
  mesa: z.string().max(24).optional().describe('«12», «12+13», «Barra». Vacío la saca.'),
  nota: z.string().trim().max(2000).optional().describe('Se suma a la que hay.'),
  reemplazar_nota: z.boolean().optional(),
  destacar: z.boolean().optional(),
  planta: z.enum(FLOOR_WORDS).optional(),
  evento: z.string().trim().min(1).optional().describe('Pasarla a un evento de ese día.'),
  sacar_del_evento: z.boolean().optional(),
  sena: pesos.optional().describe('En pesos.'),
  gestor: z.string().trim().min(1).optional().describe('Nombre o id.'),
  nombre: z.string().trim().min(1).max(120).optional(),
  telefono: z.string().trim().min(6).max(30).optional(),
  instagram: z.string().trim().max(200).optional(),
  tipo: z.enum(KIND_WORDS).optional(),
  tortas: z.number().int().min(0).max(2).optional(),
  torta: z.string().trim().min(1).optional().describe('Cuál del menú: nombre o id.'),
  champagne: z.number().int().min(0).max(2).optional(),
  avisos: z.array(z.enum(ALERT_WORDS)).max(6).optional().describe('Se suman a los que tiene.'),
})
export type ChangeReservationInput = z.infer<typeof changeReservationInput>

export type ChangeReservationFacts = {
  snapshot: DaySegmentsSnapshot | null
  settings: SegmentSettingsResolved
  /** A qué evento se pasa. */
  targetEvent: ScheduledEventWithTemplate | null
  manager: ManagerChoice | null
  cake: CakeOptionRow | null
  /** Las mesas ya ocupadas esa noche (`occupiedTables`). */
  occupied: ReadonlyMap<string, string>
  /** El flow «Se acerca un evento» prendido en el bar. */
  eventFlow?: NewReservationFacts['eventFlow']
}

export const changeReservationPayload = z.object({
  id: z.uuid(),
  /** `mesa` y `asistencia` tienen su acción chica, como la pantalla. */
  save: z.enum(['mesa', 'asistencia', 'completa']),
  /** Solo lo que cambia: la fila se vuelve a leer al confirmar, para no pisar lo que cambió otro. */
  patch: z.record(z.string(), z.unknown()),
  /** Lo que se suma a la nota: se suma a la que haya al confirmar, no a la de cuando se armó el tique. */
  appendNote: z.string().nullable().default(null),
  candidate: reservationCandidateSchema.nullable(),
  capacityAck: z.boolean(),
})
export type ChangeReservationPayload = z.infer<typeof changeReservationPayload>

/** Los campos que mueven el cupo: el resto no hace falta proyectarlo. */
const CAPACITY_FIELDS = [
  'reservation_date',
  'reservation_time_local',
  'meal_type',
  'zone',
  'scheduled_event_id',
  'estimated_guests',
  'actual_guests',
]

export function changeNeedsCapacity(input: ChangeReservationInput): boolean {
  return Boolean(
    input.fecha ||
      input.hora ||
      input.servicio ||
      input.personas ||
      input.planta ||
      input.evento ||
      input.sacar_del_evento,
  )
}

export function joinNote(current: string | null, added: string): string {
  return current ? `${current}\n${added}` : added
}

export function changeReservationDraft(
  r: ReservationWithJoins,
  input: ChangeReservationInput,
  facts: ChangeReservationFacts,
): Draft<{ payload: ChangeReservationPayload; ticket: TexTicketDraft }> {
  if (r.status === 'cancelled') {
    return fail(`La reserva de ${r.guest_name} está cancelada: se mira en su ficha.`)
  }
  if (input.fecha && !isRealIsoDay(input.fecha)) return fail('Esa fecha no existe: revisala.')
  const { targetEvent: target } = facts
  const currentName = joinedEventName(r)
  const date = input.fecha ?? r.reservation_date
  const dateChanged = date !== r.reservation_date
  const time0 = hhmm(r.reservation_time_local)

  let eventId = r.scheduled_event_id
  let zone: SalonZone = r.zone
  if (input.sacar_del_evento) {
    if (target) return fail('Dijo que sale del evento y también a qué evento va: preguntale.')
    eventId = null
    if (r.zone === 'event_floating' && !input.planta) {
      return fail('Sin evento tiene que tener planta: preguntale en cuál se sienta.')
    }
  }
  if (target) {
    if (target.event_date !== date) {
      return fail(
        `${eventDisplayName(target)} es del ${dayText(target.event_date)} y la reserva queda para el ${dayText(date)}: tienen que coincidir.`,
      )
    }
    if (target.id !== r.scheduled_event_id) zone = 'event_floating'
    eventId = target.id
  }
  if (dateChanged && eventId && eventId === r.scheduled_event_id) {
    return fail(
      `Está adentro de ${currentName ?? 'un evento'} del ${dayText(r.reservation_date)}. Para moverla de día, decime a qué evento de esa fecha pasa, o que salga del evento.`,
    )
  }
  if (input.planta) zone = ZONE_OF_WORD[input.planta]
  const eventChanged = eventId !== r.scheduled_event_id
  if (input.servicio && eventId) {
    return fail('El servicio lo define el evento: se cambia la hora del evento o se saca de ahí.')
  }

  let time = input.hora ?? time0
  let meal: MealType = r.meal_type
  if (target && eventChanged) {
    meal = mealTypeToSave(r.meal_type, target)
    if (!input.hora && segmentOfTime(time) !== segmentOfEventStart(target.starts_at_local)) {
      time = hhmm(target.starts_at_local)
    }
  } else if (!eventId) {
    if (input.servicio && !input.hora) {
      const segment = SEGMENT_OF_WORD[input.servicio]
      meal = mealTypeForSegment(segment)
      if (segmentOfTime(time) !== segment) time = facts.settings[segment].defaultTime
    } else if (input.hora || eventChanged) {
      // Hora y servicio van juntos: de eso sale el cupo y la tarifa de la comisión.
      const segment = segmentOfTime(time)
      if (segmentOfMealType(meal) !== segment) meal = mealTypeForSegment(segment)
    }
  }

  const patch: Record<string, unknown> = {}
  const rows: TexTicketRow[] = []
  const warnings: TexTicketWarning[] = []
  if (dateChanged) {
    patch.reservation_date = date
    rows.push(change('Día', dayText(r.reservation_date) ?? '', dayText(date) ?? date))
  }
  if (time !== time0) {
    patch.reservation_time_local = time
    rows.push(change('Hora', time0, time))
  }
  if (meal !== r.meal_type) {
    patch.meal_type = meal
    rows.push(
      change(
        'Servicio',
        SEGMENT_LABELS[segmentOfMealType(r.meal_type)],
        SEGMENT_LABELS[segmentOfMealType(meal)],
      ),
    )
  }
  if (zone !== r.zone || eventChanged) {
    patch.zone = zone
    patch.scheduled_event_id = eventId
    rows.push(
      change(
        'Dónde',
        placeLabel(r, currentName),
        placeLabel(
          { zone, scheduled_event_id: eventId },
          target ? eventDisplayName(target) : eventId ? currentName : null,
        ),
      ),
    )
  }

  const post = isHere(r.status)
  let estimated = r.estimated_guests
  let actual = r.actual_guests
  if (input.personas !== undefined) {
    if (post) {
      if (input.personas !== (r.actual_guests ?? r.estimated_guests)) {
        patch.actual_guests = input.personas
        rows.push(change('Vinieron', r.actual_guests ?? r.estimated_guests, input.personas))
      }
      actual = input.personas
    } else if (input.personas !== r.estimated_guests) {
      patch.estimated_guests = input.personas
      rows.push(change('Personas', r.estimated_guests, input.personas))
      estimated = input.personas
    }
  }

  if (input.mesa !== undefined) {
    const cleaned = tableLabelField.safeParse(input.mesa)
    if (!cleaned.success) return fail(zodIssuesText(cleaned.error))
    const table = cleaned.data ?? null
    if (table !== r.table_label) {
      patch.table_label = table
      rows.push(change('Mesa', r.table_label ?? 'Sin mesa', table ?? 'Sin mesa'))
      for (const part of splitTableLabel(table)) {
        const holder = facts.occupied.get(part)
        if (holder) {
          warnings.push({
            key: `table_${part}`,
            title: `La mesa ${part} ya la tiene ${holder}`,
            body: 'Se puede guardar igual.',
          })
        }
      }
    }
  }

  let appendNote: string | null = null
  if (input.nota !== undefined) {
    const replaces = input.reemplazar_nota === true
    const next = replaces || !r.comments ? input.nota : joinNote(r.comments, input.nota)
    if (next !== (r.comments ?? '')) {
      patch.comments = next
      appendNote = replaces ? null : input.nota
      rows.push(...row('Nota', next || 'Se saca'))
      if (r.origin === 'web' && input.reemplazar_nota) {
        warnings.push({
          key: 'web_note',
          title: 'Esa nota dice cuánto resta cobrar',
          body: 'La escribió la compra online. Si la reemplazás, se pierde ese dato.',
        })
      }
    }
  }
  if (input.destacar !== undefined && input.destacar !== r.highlight_comment) {
    patch.highlight_comment = input.destacar
    rows.push({ label: 'Nota destacada', value: input.destacar ? 'Sí' : 'No' })
  }

  if (input.sena !== undefined) {
    const cents = pesosToCents(input.sena)
    if (cents !== Number(r.deposit_cents)) {
      patch.deposit_cents = cents
      rows.push(change('Seña', money(Number(r.deposit_cents)), money(cents)))
      if (r.origin === 'web') {
        warnings.push({
          key: 'web_deposit',
          title: 'Esa seña la puso una compra online',
          body: 'Cambiarla acá no mueve la plata de Mercado Pago.',
        })
      }
    }
  }
  if (facts.manager && facts.manager.id !== r.primary_manager_id) {
    patch.primary_manager_id = facts.manager.id
    rows.push(change('Gestor', r.primary_manager?.display_name ?? '—', facts.manager.name))
    warnings.push({
      key: 'manager_change',
      title: `La comisión pasa a ${facts.manager.name}`,
      body: 'Lo que ya se pagó no cambia.',
    })
  }
  if (input.nombre && input.nombre !== r.guest_name) {
    patch.guest_name = input.nombre
    rows.push(change('Nombre', r.guest_name, input.nombre))
  }
  if (input.telefono) {
    patch.guest_phone = normalizedPhone(input.telefono)
    rows.push({ label: 'Teléfono', value: maskPhone(input.telefono) ?? 'Cargado' })
  }
  if (input.instagram !== undefined) {
    patch.guest_instagram = input.instagram || null
    rows.push({ label: 'Instagram', value: input.instagram ? 'Cargado' : 'Se saca' })
  }
  if (input.tipo && KIND_OF_WORD[input.tipo] !== r.kind) {
    patch.kind = KIND_OF_WORD[input.tipo]
    rows.push(
      change(
        'Tipo',
        RESERVATION_KIND_LABELS[r.kind],
        RESERVATION_KIND_LABELS[KIND_OF_WORD[input.tipo]],
      ),
    )
  }
  const cakes = input.tortas ?? (input.torta && r.cake_count === 0 ? 1 : r.cake_count)
  if (cakes !== r.cake_count) {
    patch.cake_count = cakes
    rows.push(change('Tortas', r.cake_count, cakes))
  }
  if (facts.cake && facts.cake.id !== r.cake_option_id) {
    patch.cake_option_id = facts.cake.id
    rows.push({ label: 'Torta', value: describeCake(facts.cake) })
  }
  if (input.champagne !== undefined && input.champagne !== r.champagne_count) {
    patch.champagne_count = input.champagne
    rows.push(change('Champagne', r.champagne_count, input.champagne))
  }
  if (input.avisos) {
    const added = input.avisos.map((a) => ALERT_OF_WORD[a])
    const before = parseServiceAlerts(r.service_alerts)
    const merged = [...new Set([...before, ...added])]
    if (merged.length !== before.length) {
      patch.service_alerts = merged
      rows.push({
        label: 'Avisos',
        value: merged.map((a) => SERVICE_ALERT_META[a].short).join(', '),
      })
    }
  }

  const keys = Object.keys(patch)
  if (keys.length === 0) return fail('No hay nada para cambiar: preguntale qué quiere cambiar.')

  const save =
    keys.length === 1 && keys[0] === 'table_label'
      ? 'mesa'
      : keys.length === 1 && keys[0] === 'actual_guests'
        ? 'asistencia'
        : 'completa'
  const valid =
    save === 'mesa'
      ? reservationTableLabelSchema.safeParse({ id: r.id, table_label: patch.table_label })
      : save === 'asistencia'
        ? actualGuestsSchema.safeParse({ id: r.id, actual_guests: patch.actual_guests })
        : updateSalonReservationSchema.safeParse(fullUpdatePayload(r, patch))
  if (!valid.success) return fail(zodIssuesText(valid.error))

  const movesCapacity = r.status !== 'no_show' && keys.some((key) => CAPACITY_FIELDS.includes(key))
  const candidate = movesCapacity
    ? buildReservationCandidate({
        mode: 'edit',
        reservationId: r.id,
        values: {
          reservation_date: date,
          meal_type: meal,
          reservation_time_local: time,
          scheduled_event_id: eventId,
          zone,
          estimated_guests: estimated,
          kind: r.kind,
          cake_count: cakes,
        },
        loadedActualGuests: actual,
        templates: [],
        eventsForDate: [],
      })
    : null
  const capacity = candidate ? capacityCheck(facts.snapshot, candidate) : null
  if (capacity) {
    warnings.unshift(...capacity.warnings)
    rows.push(...capacity.rows)
  }
  if (facts.eventFlow && target && eventChanged && r.customer_id) {
    warnings.push(eventFlowWarning(facts.eventFlow))
  }
  if (r.origin === 'web' && (dateChanged || keys.includes('estimated_guests'))) {
    warnings.push({
      key: 'web_change',
      title: 'Es una compra online',
      body: 'Lo que se pagó no cambia. Su entrada muestra la fecha y la hora de la reserva.',
    })
  }

  return {
    ok: true,
    payload: { id: r.id, save, patch, appendNote, candidate, capacityAck: capacity?.over ?? false },
    ticket: {
      kind: 'cambio_reserva',
      title: 'Cambiar la reserva',
      subtitle: `${r.guest_name} · ${formatDayLabel(r.reservation_date)} ${time0}`,
      rows,
      total: null,
      entry: [],
      warnings,
      confirmLabel: capacity?.over ? 'Guardar igual' : 'Guardar los cambios',
    },
  }
}

// ─── El estado: llegó, no vino, sentada, cerrada ─────────────────────────────

export const statusChangeInput = z.object({
  reserva: z.string().trim().min(2).describe('Nombre o id.'),
  de_la_fecha: realDay('Su fecha, si hay más de una con ese nombre.').optional(),
  estado: z.enum(STATUS_CHANGE_WORDS).describe('por_llegar deshace un «llegó» o un «no vino».'),
  personas: z.number().int().min(1).max(99).optional().describe('Cuántos vinieron, si lo dijo.'),
  mesa: z.string().max(24).optional().describe('En qué mesa, al marcar que llegó.'),
})
export type StatusChangeInput = z.infer<typeof statusChangeInput>

/**
 * Las de `transition_reservation_status`, sin cancelar (va aparte, con su motivo). `arrived → closed`
 * no está en la base: es lo que encadena `closeTable`, como el botón del tablero.
 */
const LEGAL_TRANSITIONS: Readonly<
  Record<SalonReservationStatus, readonly SalonReservationStatus[]>
> = {
  pending: ['arrived', 'no_show'],
  arrived: ['seated', 'closed', 'pending'],
  seated: ['closed', 'arrived'],
  closed: ['seated'],
  no_show: ['pending', 'arrived'],
  cancelled: [],
}

export const statusChangePayload = z.object({
  id: z.uuid(),
  to: OPERABLE_STATUS,
  actual_guests: z.number().int().min(1).max(99).nullable(),
  table_label: z.string().nullable().optional(),
  /** Para decidir a dónde llevar y qué señalar después. */
  date: z.string(),
  name: z.string(),
})
export type StatusChangePayload = z.infer<typeof statusChangePayload>

function statusConfirmLabel(from: SalonReservationStatus, to: SalonReservationStatus): string {
  if (to === 'no_show') return 'Marcar que no vino'
  if (to === 'pending') return 'Volver a «por llegar»'
  if (to === 'closed') return 'Cerrar la mesa'
  if (to === 'seated') return from === 'closed' ? 'Reabrir la mesa' : 'Sentar'
  return from === 'seated' ? 'Volver a «llegó»' : 'Marcar que llegó'
}

export function statusChangeDraft(
  r: ReservationWithJoins,
  input: StatusChangeInput,
  facts: { serviceDay: string; occupied: ReadonlyMap<string, string> },
): Draft<{ payload: StatusChangePayload; ticket: TexTicketDraft }> {
  const to = TARGET_OF_CHANGE[input.estado]
  const name = r.guest_name
  if (r.status === 'cancelled') {
    return fail(`La reserva de ${name} está cancelada: una cancelada no vuelve.`)
  }
  if (r.status === to) return fail(`${name} ya figura como «${STATUS_LABELS[to]}».`)
  if (!LEGAL_TRANSITIONS[r.status].includes(to)) {
    return fail(
      `${name} está en «${STATUS_LABELS[r.status]}»: no pasa directo a «${STATUS_LABELS[to]}».`,
    )
  }
  // El tablero no ofrece esto para un día que no llegó: no hay nadie a quien marcar.
  if (to !== 'pending' && r.reservation_date > facts.serviceDay) {
    return fail(`La reserva es del ${dayText(r.reservation_date)}: ese día todavía no llegó.`)
  }

  const cleaned = input.mesa !== undefined ? tableLabelField.safeParse(input.mesa) : null
  if (cleaned && !cleaned.success) return fail(zodIssuesText(cleaned.error))
  const table = cleaned?.success ? cleaned.data : undefined
  if (table !== undefined && to !== 'arrived' && to !== 'seated') {
    return fail('La mesa se carga al marcar que llegó, o se cambia con preparar_cambio_reserva.')
  }

  // Cerrar pide cuántos vinieron: arranca en lo contado o lo reservado, como el botón del tablero.
  const guests =
    to === 'closed'
      ? (input.personas ?? r.actual_guests ?? r.estimated_guests)
      : to === 'arrived' || to === 'seated'
        ? (input.personas ?? null)
        : null
  const valid =
    to === 'closed'
      ? actualGuestsSchema.safeParse({ id: r.id, actual_guests: guests })
      : transitionStatusSchema.safeParse({
          id: r.id,
          to,
          actual_guests: guests,
          ...(table !== undefined ? { table_label: table } : {}),
        })
  if (!valid.success) return fail(zodIssuesText(valid.error))

  const warnings: TexTicketWarning[] = []
  const deposit = Number(r.deposit_cents)
  if (to === 'no_show') {
    warnings.push({
      key: 'no_show',
      title: 'Libera su lugar y le saca la comisión',
      body:
        deposit > 0
          ? `Lo ya pagado no cambia. Tiene una seña de ${money(deposit)}: queda en Señas como «no vino».`
          : 'Lo ya pagado no cambia.',
    })
  }
  if (to === 'pending' || (to === 'seated' && r.status === 'closed')) {
    warnings.push({ key: 'revert', title: reversibleHint(r.status), body: null })
  }
  for (const part of splitTableLabel(table ?? null)) {
    const holder = facts.occupied.get(part)
    if (holder) {
      warnings.push({
        key: `table_${part}`,
        title: `La mesa ${part} ya la tiene ${holder}`,
        body: 'Se puede guardar igual.',
      })
    }
  }

  return {
    ok: true,
    payload: {
      id: r.id,
      to,
      actual_guests: guests,
      ...(table !== undefined ? { table_label: table } : {}),
      date: r.reservation_date,
      name,
    },
    ticket: {
      kind: 'estado_reserva',
      title: statusConfirmLabel(r.status, to),
      subtitle: `${name} · ${formatDayLabel(r.reservation_date)} ${hhmm(r.reservation_time_local)}`,
      rows: [
        change('Estado', STATUS_LABELS[r.status], STATUS_LABELS[to]),
        ...row(
          to === 'closed' || input.personas ? 'Vinieron' : 'Personas',
          guests ?? r.actual_guests ?? r.estimated_guests,
        ),
        ...row('Mesa', table ?? r.table_label),
        ...row('Seña', deposit > 0 ? money(deposit) : null),
      ],
      total: null,
      entry: [],
      warnings,
      confirmLabel: statusConfirmLabel(r.status, to),
    },
  }
}

// ─── Cancelar una reserva ────────────────────────────────────────────────────

export const cancelReservationInput = z.object({
  reserva: z.string().trim().min(2).describe('Nombre o id.'),
  de_la_fecha: realDay('Su fecha, si hay más de una con ese nombre.').optional(),
  motivo: z.string().trim().max(280).optional(),
})
export type CancelReservationInput = z.infer<typeof cancelReservationInput>

export function cancelReservationDraft(
  r: ReservationWithJoins,
  input: CancelReservationInput,
): Draft<{ payload: z.output<typeof cancelReservationSchema>; ticket: TexTicketDraft }> {
  if (r.status === 'cancelled') return fail(`La reserva de ${r.guest_name} ya está cancelada.`)
  const parsed = cancelReservationSchema.safeParse({ id: r.id, reason: input.motivo })
  if (!parsed.success) return fail(zodIssuesText(parsed.error))

  const deposit = Number(r.deposit_cents)
  const warnings: TexTicketWarning[] = []
  if (r.origin === 'web') {
    warnings.push({
      key: 'web_cancel',
      title: 'Es una compra online: su entrada deja de valer',
      body: 'Cancelar no devuelve la plata. La devolución la hace un dueño en Entradas › Ventas online.',
    })
  } else if (deposit > 0) {
    warnings.push({
      key: 'deposit',
      title: `Tiene una seña de ${money(deposit)}`,
      body: 'Cancelar no la devuelve: queda en Señas como cancelada. Si hay que devolverla, se hace por fuera del sistema.',
    })
  }
  if (isHere(r.status)) {
    warnings.push({
      key: 'already_here',
      title: `Ya figura como «${STATUS_LABELS[r.status]}»`,
      body: 'Cancelar saca a esa gente de la cuenta del servicio.',
    })
  }
  return {
    ok: true,
    payload: parsed.data,
    ticket: {
      kind: 'cancelar_reserva',
      title: 'Cancelar la reserva',
      subtitle: r.guest_name,
      rows: [
        {
          label: 'Cuándo',
          value: `${formatDayLabel(r.reservation_date)} · ${hhmm(r.reservation_time_local)}`,
        },
        { label: 'Personas', value: String(r.actual_guests ?? r.estimated_guests) },
        { label: 'Dónde', value: placeLabel(r, joinedEventName(r)) },
        ...row('Seña', deposit > 0 ? money(deposit) : null),
        ...row('Motivo', input.motivo),
        { label: 'Qué pasa', value: 'Libera el lugar. La comisión se saca, salvo lo ya pagado.' },
      ],
      total: null,
      entry: [],
      warnings,
      confirmLabel: 'Cancelar la reserva',
    },
  }
}

// ─── Un evento del calendario ────────────────────────────────────────────────

export const eventInput = z.object({
  evento: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Para cambiar uno: nombre o id. Sin esto, es uno nuevo.'),
  de_la_fecha: realDay('La fecha que tiene hoy, si hay más de uno con ese nombre.').optional(),
  formato: z.string().trim().min(1).optional().describe('Nombre o id. En uno nuevo, obligatorio.'),
  fecha: realDay('yyyy-MM-dd. En uno nuevo, obligatoria.').optional(),
  hora: hhmmSchema.optional().describe('HH:MM. Sin esto, la del servicio del formato.'),
  hora_fin: hhmmSchema.optional(),
  cupo: z.number().int().min(1).max(999).optional().describe('Sin esto, el del formato.'),
  nombre: z.string().trim().min(1).max(120).optional().describe('Si esa fecha se llama distinto.'),
  notas: z.string().trim().max(500).optional(),
  puntos: z.number().int().min(0).max(100000).optional().describe('Puntos por asistir.'),
  bonus_lleno: z.boolean().optional().describe('Bonus al gestor si se llena.'),
  grupo_privado: z.boolean().optional().describe('Ocupa cupo, no sale en los reportes de eventos.'),
})
export type EventInput = z.infer<typeof eventInput>

export type EventFacts = {
  /** El evento que se cambia. */
  existing: ScheduledEventWithTemplate | null
  /** El formato que se pidió. */
  template: ScheduledEventTemplateRow | null
  date: string
  snapshot: DaySegmentsSnapshot | null
  /** Los eventos de esa fecha. */
  dayEvents: readonly ScheduledEventWithTemplate[]
  /** Del evento que se cambia: reservas en pie y gente. */
  active: { reservations: number; people: number }
}

export const eventPayload = z.object({
  values: z.record(z.string(), z.unknown()),
  /** Cambia de día: va por la acción que controla que no tenga reservas. */
  moved: z.boolean(),
  /** Solo cambia de día. */
  onlyMove: z.boolean(),
})
export type EventPayload = z.infer<typeof eventPayload>

function eventServiceWarnings(
  snapshot: DaySegmentsSnapshot,
  candidate: SegmentEventInput,
): TexTicketWarning[] {
  const segment = segmentOfEventStart(candidate.starts_at_local)
  const before = computeDaySegments(snapshot).segments[segment]
  const after = computeDaySegments({
    ...snapshot,
    events: [...snapshot.events.filter((e) => e.id !== candidate.id), candidate],
  }).segments[segment]
  const warnings: TexTicketWarning[] = []
  if (after.status === 'over' && after.occupied > before.occupied) {
    warnings.push({
      key: 'event_over_service',
      title: `Con este evento te pasás del cupo de ${SEGMENT_WITH_ARTICLE[segment]}`,
      body: segmentStatusLine(after),
    })
  }
  const note = segmentEventNote(after)
  if (note) warnings.push({ key: 'event_takes_service', title: note, body: null })
  return warnings
}

export function eventDraft(
  input: EventInput,
  facts: EventFacts,
): Draft<{ payload: EventPayload; ticket: TexTicketDraft }> {
  const { existing, template, date, snapshot, dayEvents, active } = facts
  if (!isRealIsoDay(date)) return fail('Esa fecha no existe: revisala.')
  const templateId = template?.id ?? existing?.template_id
  if (!templateId) return fail('Preguntale qué formato es. Los que hay están en ver_formatos.')
  const capacity = input.cupo ?? existing?.capacity ?? template?.default_capacity ?? null
  if (capacity === null) {
    return fail(
      `«${template?.name ?? 'Ese formato'}» no tiene cupo por defecto: preguntale el cupo.`,
    )
  }

  const settings = snapshot?.settings ?? resolveSegmentSettings([])
  const usualSegment = segmentOfMealType(template?.default_meal_type ?? 'dinner')
  const time0 = existing ? hhmm(existing.starts_at_local) : null
  const time = input.hora ?? time0 ?? settings[usualSegment].defaultTime
  // El servicio de un evento lo marca su hora; lo que diga la columna se ignora al contar.
  const meal: MealType =
    existing && !input.hora
      ? existing.meal_type
      : mealTypeForSegment(segmentOfEventStart(`${time}:00`))
  const moved = Boolean(existing && date !== existing.event_date)
  const duplicate = dayEvents.find((e) => e.template_id === templateId && e.id !== existing?.id)
  if (duplicate) {
    return fail(
      `Ya hay ${eventDisplayName(duplicate)} el ${dayText(date)} (id ${duplicate.id}): un formato va una vez por día. Se puede cambiar ese.`,
    )
  }
  if (moved && active.reservations > 0) {
    return fail(
      `No se puede mover: el evento tiene ${active.reservations} ${active.reservations === 1 ? 'reserva activa' : 'reservas activas'}. Hay que cancelarlas o pasarlas a otra fecha primero.`,
    )
  }

  const endTime = input.hora_fin ?? (existing?.ends_at_local ? hhmm(existing.ends_at_local) : null)
  const privateGroup = input.grupo_privado
  const values: Record<string, unknown> = {
    ...(existing ? { id: existing.id } : {}),
    template_id: templateId,
    name_override: input.nombre ?? existing?.name_override ?? null,
    event_date: date,
    starts_at_local: time,
    ends_at_local: endTime,
    capacity,
    meal_type: meal,
    full_bonus_active: input.bonus_lleno ?? existing?.full_bonus_active ?? true,
    attendance_points: input.puntos ?? existing?.attendance_points ?? 0,
    notes: input.notas ?? existing?.notes ?? null,
    ...(privateGroup !== undefined ? { private_group: privateGroup } : {}),
  }
  const parsed = scheduledEventSchema.safeParse(values)
  if (!parsed.success) return fail(zodIssuesText(parsed.error))

  const name =
    input.nombre ??
    (existing ? eventDisplayName(existing) : (template?.name ?? 'Evento'))
      .replace(/\s+/g, ' ')
      .trim()
  const warnings: TexTicketWarning[] = []
  if (snapshot) {
    warnings.push(
      ...eventServiceWarnings(snapshot, {
        id: existing?.id ?? 'virtual:new-event',
        event_date: date,
        starts_at_local: `${time}:00`,
        capacity,
        name_override: name,
        template: null,
      }),
    )
  } else {
    warnings.push({
      key: 'no_capacity',
      title: 'No pude leer el cupo de ese día',
      body: 'Se puede guardar igual, pero sin el aviso de sobrecupo.',
    })
  }

  let rows: TexTicketRow[]
  if (existing) {
    rows = [
      ...(moved ? [change('Día', dayText(existing.event_date) ?? '', dayText(date) ?? date)] : []),
      ...(time !== time0 ? [change('Hora', time0 ?? '', time)] : []),
      ...(input.hora_fin ? [{ label: 'Hasta', value: input.hora_fin }] : []),
      ...(capacity !== existing.capacity ? [change('Cupo', existing.capacity, capacity)] : []),
      ...(template && template.id !== existing.template_id
        ? [{ label: 'Formato', value: template.name }]
        : []),
      ...row('Nombre', input.nombre),
      ...row('Puntos por asistir', input.puntos),
      ...(input.bonus_lleno !== undefined && input.bonus_lleno !== existing.full_bonus_active
        ? [{ label: 'Bonus por lleno', value: input.bonus_lleno ? 'Sí' : 'No' }]
        : []),
      ...(privateGroup !== undefined && privateGroup !== existing.private_group
        ? [{ label: 'Grupo privado', value: privateGroup ? 'Sí' : 'No' }]
        : []),
      ...row('Notas', input.notas),
    ]
    if (rows.length === 0) return fail('No hay nada para cambiar: preguntale qué quiere cambiar.')
    if (time !== time0 && active.reservations > 0) {
      warnings.push({
        key: 'event_time_reservations',
        title: `Cambia la hora del evento, no la de sus ${active.reservations} reservas`,
        body: 'Si hace falta, se cambia reserva por reserva.',
      })
    }
    if (capacity < active.people) {
      warnings.push({
        key: 'event_capacity_people',
        title: `Ya hay ${peopleWord(active.people)}: queda pasado por ${active.people - capacity}`,
        body: null,
      })
    }
  } else {
    rows = [
      { label: 'Cuándo', value: `${formatDayLabel(date)} · ${time}` },
      { label: 'Servicio', value: SEGMENT_LABELS[segmentOfEventStart(`${time}:00`)] },
      { label: 'Cupo', value: String(capacity) },
      ...row('Hasta', endTime),
      ...row('Nombre', input.nombre),
      ...row('Puntos por asistir', input.puntos),
      ...(input.bonus_lleno === false ? [{ label: 'Bonus por lleno', value: 'No' }] : []),
      ...((privateGroup ?? template?.default_private_group)
        ? [{ label: 'Grupo privado', value: 'Sí' }]
        : []),
      ...row('Notas', input.notas),
    ]
  }

  return {
    ok: true,
    payload: {
      values,
      moved,
      onlyMove: moved && rows.length === 1,
    },
    ticket: {
      kind: 'evento',
      title: existing ? 'Cambiar el evento' : 'Nuevo evento',
      subtitle: existing ? `${name} · ${formatDayLabel(existing.event_date)}` : name,
      rows,
      total: null,
      entry: [],
      warnings,
      confirmLabel: existing ? 'Guardar los cambios' : 'Programar el evento',
    },
  }
}

export const cancelEventInput = z.object({
  evento: z.string().trim().min(1).describe('Nombre o id.'),
  de_la_fecha: realDay('Su fecha, si hay más de uno con ese nombre.').optional(),
})

export const cancelEventPayload = z.object({ id: z.uuid() })

export function cancelEventDraft(
  e: ScheduledEventWithTemplate,
  facts: {
    /** Reservas en pie. */
    active: number
    /** Reservas caídas sin planta: la base no deja borrar la fecha con esas. */
    fallenUnplaced: number
  },
): Draft<{ payload: z.infer<typeof cancelEventPayload>; ticket: TexTicketDraft }> {
  const name = eventDisplayName(e)
  if (facts.active > 0) {
    return fail(
      `No se puede cancelar: ${name} del ${dayText(e.event_date)} tiene ${facts.active} ${facts.active === 1 ? 'reserva activa' : 'reservas activas'}. Hay que cancelarlas o pasarlas a otra fecha primero.`,
    )
  }
  if (facts.fallenUnplaced > 0) {
    return fail(
      `No se puede borrar todavía: ${name} del ${dayText(e.event_date)} tiene ${facts.fallenUnplaced} ${facts.fallenUnplaced === 1 ? 'reserva caída' : 'reservas caídas'} sin planta, y el sistema no deja borrar la fecha así. Se arregla poniéndoles planta desde su ficha.`,
    )
  }
  return {
    ok: true,
    payload: { id: e.id },
    ticket: {
      kind: 'cancelar_evento',
      title: 'Cancelar el evento',
      subtitle: name,
      rows: [
        { label: 'Cuándo', value: `${formatDayLabel(e.event_date)} · ${hhmm(e.starts_at_local)}` },
        { label: 'Cupo', value: String(e.capacity) },
        { label: 'Reservas activas', value: 'Ninguna' },
      ],
      total: null,
      entry: [],
      warnings: [
        {
          key: 'event_delete',
          title: 'Se borra del calendario y no se puede deshacer',
          body: 'Si el formato se vende en Entradas, esta fecha sale de la cartelera.',
        },
      ],
      confirmLabel: 'Cancelar el evento',
    },
  }
}

// ─── Un formato de evento ────────────────────────────────────────────────────

export const templateInput = z.object({
  formato: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Para cambiar uno: nombre o id. Sin esto, es uno nuevo.'),
  nombre: z.string().trim().min(1).max(80).optional().describe('En uno nuevo, obligatorio.'),
  cupo: z.number().int().min(1).max(9999).optional().describe('El cupo con que nacen sus fechas.'),
  servicio: z.enum(SERVICE_WORDS).optional().describe('Sin esto, cena.'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe('#RRGGBB.'),
  activo: z.boolean().optional().describe('false: deja de ofrecerse para programar.'),
  grupos_privados: z.boolean().optional().describe('Sus fechas nuevas nacen como grupo privado.'),
})
export type TemplateInput = z.infer<typeof templateInput>

export const templatePayload = z.object({ values: z.record(z.string(), z.unknown()) })
export type TemplatePayload = z.infer<typeof templatePayload>

const DEFAULT_TEMPLATE_COLOR = '#7c3aed'

export function templateDraft(
  input: TemplateInput,
  facts: { existing: ScheduledEventTemplateRow | null; takenSlugs: readonly string[] },
): Draft<{ payload: TemplatePayload; ticket: TexTicketDraft }> {
  const { existing } = facts
  const name = input.nombre ?? existing?.name
  if (!name) return fail('Preguntale cómo se llama el formato.')
  if (!existing) {
    const same = facts.takenSlugs.includes(uniqueSlugFrom(name, []))
    if (same)
      return fail(`Ya hay un formato que se llama parecido a «${name}»: se puede cambiar ese.`)
  }
  const mealOf = input.servicio ? mealTypeForSegment(SEGMENT_OF_WORD[input.servicio]) : null
  const values: Record<string, unknown> = {
    ...(existing ? { id: existing.id } : {}),
    name,
    slug: existing?.slug ?? uniqueSlugFrom(name, facts.takenSlugs),
    consume_special_reservations: existing?.consume_special_reservations ?? true,
    default_capacity: input.cupo ?? existing?.default_capacity ?? null,
    default_meal_type: mealOf ?? existing?.default_meal_type ?? 'dinner',
    color_hex: input.color ?? existing?.color_hex ?? DEFAULT_TEMPLATE_COLOR,
    active: input.activo ?? existing?.active ?? true,
    default_private_group: input.grupos_privados ?? existing?.default_private_group ?? false,
  }
  const parsed = scheduledTemplateSchema.safeParse(values)
  if (!parsed.success) return fail(zodIssuesText(parsed.error))

  const warnings: TexTicketWarning[] = []
  if (existing && input.activo === false && existing.active) {
    warnings.push({
      key: 'template_off',
      title: 'Deja de ofrecerse para programar',
      body: 'Las fechas que ya están en el calendario siguen.',
    })
  }
  if (existing && (input.cupo !== undefined || input.grupos_privados !== undefined)) {
    warnings.push({
      key: 'template_new_dates',
      title: 'Cuenta para las fechas nuevas',
      body: 'Las que ya están programadas no cambian.',
    })
  }
  const rows: TexTicketRow[] = existing
    ? [
        ...(input.nombre && input.nombre !== existing.name
          ? [change('Nombre', existing.name, input.nombre)]
          : []),
        ...(input.cupo !== undefined && input.cupo !== existing.default_capacity
          ? [change('Cupo', existing.default_capacity ?? 'Sin cupo', input.cupo)]
          : []),
        ...(mealOf && mealOf !== existing.default_meal_type
          ? [
              change(
                'Servicio',
                SEGMENT_LABELS[segmentOfMealType(existing.default_meal_type)],
                SEGMENT_LABELS[segmentOfMealType(mealOf)],
              ),
            ]
          : []),
        ...(input.color && input.color !== existing.color_hex
          ? [{ label: 'Color', value: input.color }]
          : []),
        ...(input.activo !== undefined && input.activo !== existing.active
          ? [{ label: 'Estado', value: input.activo ? 'Activo' : 'Inactivo' }]
          : []),
        ...(input.grupos_privados !== undefined &&
        input.grupos_privados !== existing.default_private_group
          ? [{ label: 'Grupos privados', value: input.grupos_privados ? 'Sí' : 'No' }]
          : []),
      ]
    : [
        ...row('Cupo', input.cupo ?? 'Se elige en cada fecha'),
        {
          label: 'Servicio',
          value: SEGMENT_LABELS[segmentOfMealType(mealOf ?? 'dinner')],
        },
        ...(input.grupos_privados ? [{ label: 'Grupos privados', value: 'Sí' }] : []),
      ]
  if (existing && rows.length === 0) {
    return fail('No hay nada para cambiar: preguntale qué quiere cambiar.')
  }
  return {
    ok: true,
    payload: { values },
    ticket: {
      kind: 'formato',
      title: existing ? 'Cambiar el formato' : 'Nuevo formato',
      subtitle: existing?.name ?? name,
      rows,
      total: null,
      entry: [],
      warnings,
      confirmLabel: existing ? 'Guardar los cambios' : 'Crear el formato',
    },
  }
}

// ─── Los cupos ───────────────────────────────────────────────────────────────

export const specialCapacityInput = z.object({
  fecha: realDay('El día, yyyy-MM-dd.'),
  servicio: z.enum(CONFIGURABLE_SERVICE_WORDS),
  cupo: z.number().int().min(0).max(999).optional().describe('0 cierra el servicio ese día.'),
  aviso: z.number().int().min(1).max(999).optional().describe('Avisar desde esta cantidad.'),
  motivo: z.string().trim().max(120).optional(),
  quitar: z.boolean().optional().describe('true: vuelve al cupo de ese día de la semana.'),
})
export type SpecialCapacityInput = z.infer<typeof specialCapacityInput>

export function specialCapacityDraft(
  input: SpecialCapacityInput,
  /** El servicio ese día, como está ahora. */
  current: { segment: SegmentLoad | null; isoDow: IsoDow },
):
  | Draft<{
      remove: false
      payload: z.output<typeof segmentOverrideSchema>
      ticket: TexTicketDraft
    }>
  | Draft<{
      remove: true
      payload: z.output<typeof segmentOverrideKeySchema>
      ticket: TexTicketDraft
    }> {
  const segmentKey = CONFIGURABLE_SEGMENT_OF_WORD[input.servicio]
  const label = SEGMENT_WITH_ARTICLE[segmentKey]
  const { segment, isoDow } = current
  const subtitle = `${SEGMENT_LABELS[segmentKey]} · ${dayText(input.fecha)}`
  if (!isRealIsoDay(input.fecha)) return fail('Esa fecha no existe: revisala.')

  if (input.quitar) {
    const parsed = segmentOverrideKeySchema.safeParse({
      override_date: input.fecha,
      segment: segmentKey,
    })
    if (!parsed.success) return fail(zodIssuesText(parsed.error))
    if (segment && segment.capSource !== 'override') {
      return fail(`Ese día ${label} no tiene cupo especial.`)
    }
    return {
      ok: true,
      remove: true,
      payload: parsed.data,
      ticket: {
        kind: 'cupo_especial',
        title: 'Quitar el cupo especial',
        subtitle,
        rows: [
          ...row('Cupo ahora', segment?.capacity),
          { label: 'Vuelve a', value: 'El cupo de ese día de la semana' },
        ],
        total: null,
        entry: [],
        warnings: [],
        confirmLabel: 'Quitar el cupo especial',
      },
    }
  }

  if (input.cupo === undefined) return fail('Preguntale de cuánto es el cupo.')
  const parsed = segmentOverrideSchema.safeParse({
    override_date: input.fecha,
    segment: segmentKey,
    capacity: input.cupo,
    warn_at: input.aviso ?? null,
    reason: input.motivo ?? null,
  })
  if (!parsed.success) return fail(zodIssuesText(parsed.error))

  const warnings: TexTicketWarning[] = []
  if (segment && input.cupo < segment.people) {
    warnings.push({
      key: 'capacity_people',
      title:
        input.cupo === 0
          ? `Lo cierra con ${peopleWord(segment.people)} reservadas`
          : `Ya hay ${peopleWord(segment.people)}: queda pasado por ${segment.people - input.cupo}`,
      body: 'Las reservas no se tocan.',
    })
  }
  return {
    ok: true,
    remove: false,
    payload: parsed.data,
    ticket: {
      kind: 'cupo_especial',
      title: input.cupo === 0 ? 'Cerrar el servicio ese día' : 'Cupo especial',
      subtitle,
      rows: [
        segment?.capacity !== null && segment?.capacity !== undefined
          ? change('Cupo', segment.capacity, input.cupo)
          : { label: 'Cupo', value: String(input.cupo) },
        ...row('De dónde sale el de ahora', segment ? capSourceLabel(segment, isoDow) : null),
        ...row('Aviso desde', input.aviso),
        ...row('Motivo', input.motivo),
      ],
      total: null,
      entry: [],
      warnings,
      confirmLabel: input.cupo === 0 ? 'Cerrar ese día' : 'Guardar el cupo',
    },
  }
}

export const weeklyCapacityInput = z.object({
  dia: z.enum(WEEKDAY_WORDS),
  servicio: z.enum(CONFIGURABLE_SERVICE_WORDS),
  cupo: z.number().int().min(0).max(999).optional().describe('0 lo cierra todos esos días.'),
  aviso: z.number().int().min(1).max(999).optional().describe('Avisar desde esta cantidad.'),
  volver_al_general: z.boolean().optional().describe('true: esos días usan el cupo general.'),
})
export type WeeklyCapacityInput = z.infer<typeof weeklyCapacityInput>

export function weeklyCapacityDraft(
  input: WeeklyCapacityInput,
  facts: { current: SegmentWeeklyCapRow | null; fallbackTotal: number },
): Draft<{ payload: z.output<typeof segmentConfigSaveSchema>; ticket: TexTicketDraft }> {
  const { current, fallbackTotal } = facts
  const segment = CONFIGURABLE_SEGMENT_OF_WORD[input.servicio]
  const iso_dow = ISO_DOW_OF_WORD[input.dia]
  const back = input.volver_al_general === true
  if (!back && input.cupo === undefined) return fail('Preguntale de cuánto es el cupo.')
  const capacity = back ? null : (input.cupo ?? null)
  // Un aviso más alto que el cupo nuevo la base lo rechaza: si no dijo otro, se saca.
  const keptWarn = current?.warn_at ?? null
  const warn =
    capacity === null
      ? null
      : (input.aviso ?? (keptWarn !== null && keptWarn <= capacity ? keptWarn : null))
  const parsed = segmentConfigSaveSchema.safeParse({
    weekly: [{ segment, iso_dow, capacity, warn_at: warn }],
    settings: [],
  })
  if (!parsed.success) return fail(zodIssuesText(parsed.error))
  const before = current ? String(current.capacity) : `El general (${fallbackTotal})`
  const after = capacity === null ? `El general (${fallbackTotal})` : String(capacity)
  if (before === after && warn === keptWarn) {
    return fail('Ya está así: no hay nada para cambiar.')
  }
  return {
    ok: true,
    payload: parsed.data,
    ticket: {
      kind: 'cupo_semanal',
      title: 'Cupo de la semana',
      subtitle: `${SEGMENT_LABELS[segment]} · todos los ${WEEKDAY_PLURAL[input.dia]}`,
      rows: [
        change('Cupo', before, after),
        ...(warn !== keptWarn
          ? [change('Aviso desde', keptWarn ?? 'Sin aviso', warn ?? 'Sin aviso')]
          : []),
      ],
      total: null,
      entry: [],
      warnings: [
        {
          key: 'weekly_cap',
          title: 'Rige para todos esos días, salvo los que tengan cupo especial',
          body: 'Las reservas no se tocan.',
        },
      ],
      confirmLabel: 'Guardar el cupo',
    },
  }
}
