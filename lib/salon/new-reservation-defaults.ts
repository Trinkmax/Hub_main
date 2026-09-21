/**
 * Con qué arranca el alta de una reserva y cómo se proyecta sobre el cupo.
 *
 * PURO (sin supabase, next ni react): la página /reservas/nuevo resuelve los
 * valores iniciales desde la URL y el form arma la candidata que se proyecta
 * sobre el servicio. Vive acá y no en los componentes para que la regla quede
 * testeada: define qué `meal_type` se guarda, y de eso sale la tarifa de
 * comisión de la reserva.
 */

import type { NewReservationParams } from './segment-schemas'
import {
  mealTypeForSegment,
  type ReservationCandidate,
  type SegmentEventInput,
  type SegmentKey,
  type SegmentSettingsResolved,
  segmentOfEventStart,
  segmentOfTime,
} from './segments'
import type { MealType, ReservationKind, SalonZone } from './types'

export type NewReservationEventInput = Pick<
  SegmentEventInput,
  'id' | 'event_date' | 'starts_at_local'
> & { ends_at_local: string | null }

export type NewReservationDefaults = {
  initialDate: string
  segment: SegmentKey
  targetEventId: string | null
  initialValues: {
    meal_type: 'lunch' | 'tea_time' | 'dinner'
    reservation_time_local: string // 'HH:MM'
    zone?: 'event_floating'
    scheduled_event_id?: string
    reservation_end_time_local?: string
    guest_name?: string
  }
}

/** 'HH:MM:SS' (columna `time`) → 'HH:MM', que es lo que muestra el input. */
function hhmm(time: string): string {
  return time.slice(0, 5)
}

/**
 * Valores iniciales del alta.
 *
 * - CON evento (?event=): la reserva nace adentro del evento, en SU fecha y a
 *   su hora, con el servicio que marca la hora de inicio (R2). El `meal_type`
 *   del evento se ignora a propósito: 'hub_event' no tiene tarifa (la comisión
 *   quedaba en 0) y Ramen del 28/09 figura 'lunch' a las 21:00.
 * - SIN evento: el servicio sale de ?meal, si no de la hora de ?time, y si no
 *   es la cena (el servicio que más se reserva). La hora es ?time o la sugerida
 *   del servicio en la config del bar (13:00 / 15:30 / 21:00): se acaba el
 *   '21:30' fijo del form.
 * - ?guest_name pasa directo (lo manda el operativo al cargar un walk-in).
 */
export function resolveNewReservationDefaults(input: {
  params: NewReservationParams
  today: string
  event: NewReservationEventInput | null
  settings: SegmentSettingsResolved
}): NewReservationDefaults {
  const { params, today, event, settings } = input
  const guestName = params.guest_name ? { guest_name: params.guest_name } : {}

  if (event) {
    const segment = segmentOfEventStart(event.starts_at_local)
    return {
      initialDate: event.event_date,
      segment,
      targetEventId: event.id,
      initialValues: {
        meal_type: mealTypeForSegment(segment),
        reservation_time_local: hhmm(event.starts_at_local),
        zone: 'event_floating',
        scheduled_event_id: event.id,
        // El evento ya sabe hasta qué hora va; si no lo tiene, el campo queda
        // vacío (es opcional) en vez de inventar una hora de fin.
        reservation_end_time_local: event.ends_at_local ? hhmm(event.ends_at_local) : '',
        ...guestName,
      },
    }
  }

  const segment: SegmentKey = params.meal ?? (params.time ? segmentOfTime(params.time) : 'dinner')
  return {
    initialDate: params.date ?? today,
    segment,
    targetEventId: null,
    initialValues: {
      meal_type: mealTypeForSegment(segment),
      reservation_time_local: params.time ?? settings[segment].defaultTime,
      ...guestName,
    },
  }
}

/** Cupo de un formato sin `default_capacity`: el mismo 30 que usa el server. */
const REQUESTED_TEMPLATE_DEFAULT_CAPACITY = 30

export type ReservationCandidateFormValues = {
  reservation_date: string
  meal_type: MealType
  reservation_time_local: string
  scheduled_event_id?: string | null
  zone: SalonZone
  estimated_guests: number
  kind: ReservationKind
  cake_count: number
  requested_template_id?: string | null
}

/**
 * La reserva del form como candidata para `projectReservation`: lo que va a
 * quedar guardado, no lo que dice cada campo por separado.
 *
 * - Personas: en la edición, si ya se cargó la asistencia real, cuenta esa
 *   (R4: actual ?? estimated); si no, las estimadas del stepper.
 * - Formato pedido (solo en el alta, que es la única que lo procesa: la
 *   edición lo descarta en el server): el server pisa el evento elegido con el
 *   del formato. Si ese formato ya está programado ese día, la reserva se suma
 *   a ese evento; si no, se crea uno ad-hoc con el cupo del formato (o 30) a
 *   la hora de la reserva, que acá se simula como `virtualEvent` para que el
 *   medidor y la confirmación ya descuenten su cupo.
 */
export function buildReservationCandidate(input: {
  mode: 'create' | 'edit'
  reservationId?: string | null
  values: ReservationCandidateFormValues
  loadedActualGuests: number | null
  templates: ReadonlyArray<{ id: string; name: string; default_capacity: number | null }>
  eventsForDate: ReadonlyArray<{ id: string; event_date: string; template: { id: string } | null }>
}): ReservationCandidate {
  const { mode, values } = input
  const guests =
    mode === 'edit' && input.loadedActualGuests !== null
      ? input.loadedActualGuests
      : values.estimated_guests

  let scheduledEventId = values.scheduled_event_id ?? null
  let virtualEvent: ReservationCandidate['virtualEvent'] = null
  const templateId = values.requested_template_id ?? null
  if (mode === 'create' && templateId && values.kind !== 'normal') {
    const existing = input.eventsForDate.find(
      (e) => e.template?.id === templateId && e.event_date === values.reservation_date,
    )
    if (existing) {
      scheduledEventId = existing.id
    } else {
      const template = input.templates.find((t) => t.id === templateId)
      scheduledEventId = null
      virtualEvent = {
        name: template?.name ?? 'Formato pedido',
        capacity: template?.default_capacity ?? REQUESTED_TEMPLATE_DEFAULT_CAPACITY,
        starts_at_local: values.reservation_time_local,
      }
    }
  }

  return {
    ...(mode === 'edit' && input.reservationId ? { id: input.reservationId } : {}),
    reservation_date: values.reservation_date,
    meal_type: values.meal_type,
    reservation_time_local: values.reservation_time_local,
    scheduled_event_id: scheduledEventId,
    zone: values.zone,
    guests,
    kind: values.kind,
    cake_count: values.cake_count,
    virtualEvent,
  }
}
