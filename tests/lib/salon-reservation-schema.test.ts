import { describe, expect, it } from 'vitest'
import { createSalonReservationSchema, updateSalonReservationSchema } from '@/lib/salon/schemas'

const base = {
  guest_name: 'Juan',
  meal_type: 'dinner',
  reservation_date: '2026-06-20',
  reservation_time_local: '21:00',
  zone: 'planta_alta',
  estimated_guests: 4,
  primary_manager_id: '11111111-1111-4111-8111-111111111111',
}

describe('createSalonReservationSchema', () => {
  it('acepta una reserva normal válida', () => {
    expect(createSalonReservationSchema.safeParse(base).success).toBe(true)
  })

  it('la zona "event_floating" exige evento programado o formato pedido', () => {
    const r = createSalonReservationSchema.safeParse({ ...base, zone: 'event_floating' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'scheduled_event_id')).toBe(true)
    }
  })

  it('event_floating con scheduled_event_id pasa', () => {
    const r = createSalonReservationSchema.safeParse({
      ...base,
      zone: 'event_floating',
      scheduled_event_id: '22222222-2222-4222-8222-222222222222',
    })
    expect(r.success).toBe(true)
  })
})

// Planta dentro de un evento (pedido del dueño del 22/09/2026): la reserva de
// Pizza libre puede sentarse en Planta Alta y sigue siendo del evento. El
// schema no puede tirar ni borrar el evento por la zona.
describe('planta + evento', () => {
  const EVENT_ID = '22222222-2222-4222-8222-222222222222'

  it('el alta acepta planta_alta con evento y conserva el evento', () => {
    const r = createSalonReservationSchema.safeParse({
      ...base,
      zone: 'planta_alta',
      scheduled_event_id: EVENT_ID,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.zone).toBe('planta_alta')
      expect(r.data.scheduled_event_id).toBe(EVENT_ID)
    }
  })

  it('la edición acepta planta_baja con evento y conserva el evento', () => {
    const r = updateSalonReservationSchema.safeParse({
      ...base,
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'normal',
      origin: 'whatsapp',
      zone: 'planta_baja',
      scheduled_event_id: EVENT_ID,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.zone).toBe('planta_baja')
      expect(r.data.scheduled_event_id).toBe(EVENT_ID)
    }
  })

  it('la edición sigue rechazando "Sin ubicar" sin evento', () => {
    const r = updateSalonReservationSchema.safeParse({
      ...base,
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'normal',
      origin: 'whatsapp',
      zone: 'event_floating',
      scheduled_event_id: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'scheduled_event_id')).toBe(true)
    }
  })
})
