import { describe, expect, it } from 'vitest'
import { createSalonReservationSchema } from '@/lib/salon/schemas'

const base = {
  guest_name: 'Juan',
  meal_type: 'hub_event',
  reservation_date: '2026-06-20',
  reservation_time_local: '21:00',
  zone: 'planta_alta',
  estimated_guests: 4,
  primary_manager_id: '11111111-1111-4111-8111-111111111111',
}

describe('createSalonReservationSchema — hub_event_id', () => {
  it('rechaza meal_type hub_event sin hub_event_id', () => {
    const r = createSalonReservationSchema.safeParse(base)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'hub_event_id')).toBe(true)
    }
  })

  it('acepta meal_type hub_event con hub_event_id', () => {
    const r = createSalonReservationSchema.safeParse({
      ...base,
      hub_event_id: '22222222-2222-4222-8222-222222222222',
    })
    expect(r.success).toBe(true)
  })

  it('no exige hub_event_id para otros meal_type', () => {
    const r = createSalonReservationSchema.safeParse({ ...base, meal_type: 'dinner' })
    expect(r.success).toBe(true)
  })
})
