import { describe, expect, it } from 'vitest'
import { createSalonReservationSchema } from '@/lib/salon/schemas'

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
