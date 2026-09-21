import { describe, expect, it } from 'vitest'
import {
  buildReservationCandidate,
  type NewReservationEventInput,
  type ReservationCandidateFormValues,
  resolveNewReservationDefaults,
} from '@/lib/salon/new-reservation-defaults'
import { newReservationParamsSchema } from '@/lib/salon/segment-schemas'
import {
  DEFAULT_SEGMENT_TIMES,
  projectReservation,
  resolveSegmentSettings,
  type SegmentSettingsResolved,
} from '@/lib/salon/segments'

const R = '6a1f2c3d-4b5e-4f60-8a71-92b3c4d5e6f7'
const TODAY = '2026-09-21'
const SETTINGS: SegmentSettingsResolved = resolveSegmentSettings([])

const ramen: NewReservationEventInput = {
  id: R,
  event_date: '2026-09-28',
  starts_at_local: '21:00:00',
  ends_at_local: null,
}

function params(raw: Record<string, string>) {
  return newReservationParamsSchema.parse(raw)
}

describe('resolveNewReservationDefaults — con evento', () => {
  it('Ramen del 28/09 a las 21:00 entra como cena, adentro del evento', () => {
    const d = resolveNewReservationDefaults({
      params: params({ date: '2026-09-28', event: R }),
      today: TODAY,
      event: ramen,
      settings: SETTINGS,
    })
    expect(d.initialDate).toBe('2026-09-28')
    expect(d.segment).toBe('dinner')
    expect(d.targetEventId).toBe(R)
    expect(d.initialValues).toEqual({
      meal_type: 'dinner',
      reservation_time_local: '21:00',
      zone: 'event_floating',
      scheduled_event_id: R,
      reservation_end_time_local: '',
    })
  })

  it('el servicio sale de la hora del evento (R2 literal): Merienda y Arte a las 13:00 es almuerzo', () => {
    const d = resolveNewReservationDefaults({
      params: params({ event: R }),
      today: TODAY,
      event: { ...ramen, starts_at_local: '13:00:00' },
      settings: SETTINGS,
    })
    expect(d.initialValues.meal_type).toBe('lunch')
    expect(d.segment).toBe('lunch')
    expect(d.initialValues.reservation_time_local).toBe('13:00')
  })

  it('?event sin ?date abre en la fecha del evento', () => {
    const d = resolveNewReservationDefaults({
      params: params({ event: R }),
      today: TODAY,
      event: { ...ramen, event_date: '2026-10-03' },
      settings: SETTINGS,
    })
    expect(d.initialDate).toBe('2026-10-03')
  })

  it('la fecha del evento gana sobre un ?date de otro día', () => {
    const d = resolveNewReservationDefaults({
      params: params({ date: '2026-09-25', event: R }),
      today: TODAY,
      event: ramen,
      settings: SETTINGS,
    })
    expect(d.initialDate).toBe('2026-09-28')
  })

  it('con hora de fin la precarga en HH:MM', () => {
    const d = resolveNewReservationDefaults({
      params: params({ event: R }),
      today: TODAY,
      event: { ...ramen, ends_at_local: '23:30:00' },
      settings: SETTINGS,
    })
    expect(d.initialValues.reservation_end_time_local).toBe('23:30')
  })
})

describe('resolveNewReservationDefaults — sin evento', () => {
  it('?meal=tea_time abre la merienda a las 15:30 y en la fecha de hoy', () => {
    const d = resolveNewReservationDefaults({
      params: params({ meal: 'tea_time' }),
      today: TODAY,
      event: null,
      settings: SETTINGS,
    })
    expect(d.initialDate).toBe(TODAY)
    expect(d.segment).toBe('tea_time')
    expect(d.targetEventId).toBeNull()
    expect(d.initialValues).toEqual({ meal_type: 'tea_time', reservation_time_local: '15:30' })
  })

  it('?meal=tea_time&time=16:30 respeta la hora puntual', () => {
    const d = resolveNewReservationDefaults({
      params: params({ meal: 'tea_time', time: '16:30' }),
      today: TODAY,
      event: null,
      settings: SETTINGS,
    })
    expect(d.initialValues.reservation_time_local).toBe('16:30')
    expect(d.initialValues.meal_type).toBe('tea_time')
  })

  it('?time=13:15 sin ?meal deriva el almuerzo de la hora', () => {
    const d = resolveNewReservationDefaults({
      params: params({ time: '13:15' }),
      today: TODAY,
      event: null,
      settings: SETTINGS,
    })
    expect(d.initialValues.meal_type).toBe('lunch')
    expect(d.segment).toBe('lunch')
  })

  it('sin params es la cena a las 21:00 (no más 21:30)', () => {
    const d = resolveNewReservationDefaults({
      params: params({}),
      today: TODAY,
      event: null,
      settings: SETTINGS,
    })
    expect(d.initialValues).toEqual({ meal_type: 'dinner', reservation_time_local: '21:00' })
    expect(DEFAULT_SEGMENT_TIMES.dinner).toBe('21:00')
  })

  it('la hora sugerida sale de la config del bar', () => {
    const d = resolveNewReservationDefaults({
      params: params({}),
      today: TODAY,
      event: null,
      settings: resolveSegmentSettings([
        { segment: 'dinner', default_time: '20:30:00', warn_note: null },
      ]),
    })
    expect(d.initialValues.reservation_time_local).toBe('20:30')
  })

  it('?date se respeta', () => {
    const d = resolveNewReservationDefaults({
      params: params({ date: '2026-09-25', meal: 'tea_time' }),
      today: TODAY,
      event: null,
      settings: SETTINGS,
    })
    expect(d.initialDate).toBe('2026-09-25')
  })

  it('?guest_name pasa directo', () => {
    const d = resolveNewReservationDefaults({
      params: params({ guest_name: 'Juan' }),
      today: TODAY,
      event: null,
      settings: SETTINGS,
    })
    expect(d.initialValues.guest_name).toBe('Juan')
  })

  it('params rotos se ignoran y quedan los defaults', () => {
    const d = resolveNewReservationDefaults({
      params: params({ meal: 'breakfast', time: '25:00', date: '2026-02-30' }),
      today: TODAY,
      event: null,
      settings: SETTINGS,
    })
    expect(d.initialDate).toBe(TODAY)
    expect(d.initialValues).toEqual({ meal_type: 'dinner', reservation_time_local: '21:00' })
  })
})

// ──────────────────────────────────────────────────────────
// Candidata del form
// ──────────────────────────────────────────────────────────

const TPL_PIZZA = { id: 'tpl-pizza', name: 'Pizza libre', default_capacity: 140 }
const TPL_SIN_CUPO = { id: 'tpl-x', name: 'Degustación', default_capacity: null }

function values(p: Partial<ReservationCandidateFormValues> = {}): ReservationCandidateFormValues {
  return {
    reservation_date: '2026-09-10',
    meal_type: 'dinner',
    reservation_time_local: '21:00',
    scheduled_event_id: null,
    zone: 'planta_alta',
    estimated_guests: 4,
    kind: 'normal',
    cake_count: 0,
    requested_template_id: null,
    ...p,
  }
}

describe('buildReservationCandidate', () => {
  it('alta normal: cuentan las estimadas y no lleva id', () => {
    const c = buildReservationCandidate({
      mode: 'create',
      values: values(),
      loadedActualGuests: null,
      templates: [],
      eventsForDate: [],
    })
    expect(c).toEqual({
      reservation_date: '2026-09-10',
      meal_type: 'dinner',
      reservation_time_local: '21:00',
      scheduled_event_id: null,
      zone: 'planta_alta',
      guests: 4,
      kind: 'normal',
      cake_count: 0,
      virtualEvent: null,
    })
  })

  it('edición con asistencia cargada: cuenta la real y reemplaza su fila', () => {
    const c = buildReservationCandidate({
      mode: 'edit',
      reservationId: 'r-1',
      values: values({ estimated_guests: 16 }),
      loadedActualGuests: 18,
      templates: [],
      eventsForDate: [],
    })
    expect(c.id).toBe('r-1')
    expect(c.guests).toBe(18)
  })

  it('edición sin asistencia: cuentan las estimadas del stepper', () => {
    const c = buildReservationCandidate({
      mode: 'edit',
      reservationId: 'r-1',
      values: values({ estimated_guests: 16 }),
      loadedActualGuests: null,
      templates: [],
      eventsForDate: [],
    })
    expect(c.guests).toBe(16)
  })

  it('especial con formato no programado ese día → evento virtual con el cupo del formato', () => {
    const c = buildReservationCandidate({
      mode: 'create',
      values: values({ kind: 'special', requested_template_id: TPL_PIZZA.id }),
      loadedActualGuests: null,
      templates: [TPL_PIZZA],
      eventsForDate: [],
    })
    expect(c.scheduled_event_id).toBeNull()
    expect(c.virtualEvent).toEqual({ name: 'Pizza libre', capacity: 140, starts_at_local: '21:00' })
  })

  it('formato sin cupo propio → 30, como el server', () => {
    const c = buildReservationCandidate({
      mode: 'create',
      values: values({ kind: 'birthday', requested_template_id: TPL_SIN_CUPO.id }),
      loadedActualGuests: null,
      templates: [TPL_SIN_CUPO],
      eventsForDate: [],
    })
    expect(c.virtualEvent?.capacity).toBe(30)
  })

  it('formato ya programado ese día → se suma a ese evento', () => {
    const c = buildReservationCandidate({
      mode: 'create',
      values: values({ kind: 'special', requested_template_id: TPL_PIZZA.id }),
      loadedActualGuests: null,
      templates: [TPL_PIZZA],
      eventsForDate: [{ id: 'ev-pizza', event_date: '2026-09-10', template: { id: TPL_PIZZA.id } }],
    })
    expect(c.scheduled_event_id).toBe('ev-pizza')
    expect(c.virtualEvent).toBeNull()
  })

  it('un evento del formato de OTRO día no cuenta como programado', () => {
    const c = buildReservationCandidate({
      mode: 'create',
      values: values({ kind: 'special', requested_template_id: TPL_PIZZA.id }),
      loadedActualGuests: null,
      templates: [TPL_PIZZA],
      eventsForDate: [{ id: 'ev-pizza', event_date: '2026-09-11', template: { id: TPL_PIZZA.id } }],
    })
    expect(c.virtualEvent?.name).toBe('Pizza libre')
  })

  it('reserva normal: el formato pedido se ignora (el form lo limpia y el server no lo usa)', () => {
    const c = buildReservationCandidate({
      mode: 'create',
      values: values({ kind: 'normal', requested_template_id: TPL_PIZZA.id }),
      loadedActualGuests: null,
      templates: [TPL_PIZZA],
      eventsForDate: [],
    })
    expect(c.virtualEvent).toBeNull()
  })

  it('en la edición el formato pedido no se proyecta (el server lo descarta)', () => {
    const c = buildReservationCandidate({
      mode: 'edit',
      reservationId: 'r-1',
      values: values({ kind: 'special', requested_template_id: TPL_PIZZA.id }),
      loadedActualGuests: null,
      templates: [TPL_PIZZA],
      eventsForDate: [],
    })
    expect(c.virtualEvent).toBeNull()
    expect(c.scheduled_event_id).toBeNull()
  })

  it('con el evento virtual la proyección descuenta el cupo del formato (caso 22h de la spec)', () => {
    const snapshot = {
      date: '2026-09-10',
      caps: {
        lunch: cap(70),
        tea_time: cap(120),
        dinner: cap(120),
      },
      settings: SETTINGS,
      reservations: Array.from({ length: 25 }, (_, i) => ({
        id: `n-${i}`,
        reservation_date: '2026-09-10',
        meal_type: 'dinner' as const,
        reservation_time_local: '21:00:00',
        scheduled_event_id: null,
        zone: 'planta_alta' as const,
        status: 'pending' as const,
        estimated_guests: 4,
        actual_guests: null,
        kind: 'normal' as const,
        cake_count: 0,
      })),
      events: [],
    }
    const candidate = buildReservationCandidate({
      mode: 'create',
      values: values({
        kind: 'special',
        requested_template_id: TPL_PIZZA.id,
        estimated_guests: 30,
      }),
      loadedActualGuests: null,
      templates: [TPL_PIZZA],
      eventsForDate: [],
    })
    const p = projectReservation(snapshot, candidate)
    expect(p?.after.reservedForEvents).toBe(120)
    expect(p?.after.occupied).toBe(220)
    expect(p?.needsConfirm).toBe(true)
    expect(p?.event?.name).toBe('Pizza libre')
  })
})

function cap(capacity: number) {
  return {
    capacity,
    warnAt: null,
    warnNote: null,
    source: 'weekly' as const,
    overrideReason: null,
  }
}
