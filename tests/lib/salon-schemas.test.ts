import { describe, expect, it } from 'vitest'
import {
  cancelReservationSchema,
  createSalonReservationSchema,
  rateTierSchema,
  scheduledEventSchema,
  transitionStatusSchema,
  updateSalonReservationSchema,
} from '@/lib/salon/schemas'

const baseValid = {
  guest_name: 'Juan Test',
  meal_type: 'dinner' as const,
  reservation_date: '2026-06-01',
  reservation_time_local: '21:30',
  zone: 'planta_alta' as const,
  estimated_guests: 4,
  origin: 'whatsapp' as const,
  primary_manager_id: '00000000-0000-4000-8000-000000000001',
}

describe('createSalonReservationSchema', () => {
  it('camino feliz', () => {
    const r = createSalonReservationSchema.safeParse(baseValid)
    expect(r.success).toBe(true)
  })

  it('event_floating sin scheduled_event_id → error', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      zone: 'event_floating',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('evento programado'))).toBe(true)
    }
  })

  it('event_floating con scheduled_event_id → OK', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      zone: 'event_floating',
      scheduled_event_id: '00000000-0000-4000-8000-0000000000aa',
    })
    expect(r.success).toBe(true)
  })

  it('asistente == primario → error', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      assistant_manager_id: baseValid.primary_manager_id,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('asistente'))).toBe(true)
    }
  })

  it('teléfono inválido → error', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      guest_phone: '12',
    })
    expect(r.success).toBe(false)
  })

  it('teléfono AR sin código → normaliza a E.164', () => {
    const r = createSalonReservationSchema.safeParse({
      ...baseValid,
      guest_phone: '3515551234',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.guest_phone?.startsWith('+')).toBe(true)
    }
  })

  it('horario sin segundos → normaliza con :00', () => {
    const r = createSalonReservationSchema.safeParse({ ...baseValid })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.reservation_time_local).toBe('21:30:00')
    }
  })

  it('estimated_guests > 99 → error', () => {
    const r = createSalonReservationSchema.safeParse({ ...baseValid, estimated_guests: 200 })
    expect(r.success).toBe(false)
  })

  it('cake_count fuera de [0,2] → error', () => {
    const r = createSalonReservationSchema.safeParse({ ...baseValid, cake_count: 5 })
    expect(r.success).toBe(false)
  })
})

describe('updateSalonReservationSchema', () => {
  it('permite actual_guests', () => {
    const r = updateSalonReservationSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      ...baseValid,
      kind: 'normal',
      actual_guests: 5,
    })
    expect(r.success).toBe(true)
  })

  it('actual_guests null → OK', () => {
    const r = updateSalonReservationSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      ...baseValid,
      kind: 'normal',
      actual_guests: null,
    })
    expect(r.success).toBe(true)
  })
})

describe('transitionStatusSchema', () => {
  it('to=closed con actual_guests', () => {
    const r = transitionStatusSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      to: 'closed',
      actual_guests: 6,
    })
    expect(r.success).toBe(true)
  })

  it('to=arrived sin actual_guests', () => {
    const r = transitionStatusSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      to: 'arrived',
    })
    expect(r.success).toBe(true)
  })

  it('to inválido → error', () => {
    const r = transitionStatusSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000099',
      to: 'whatever',
    })
    expect(r.success).toBe(false)
  })
})

describe('cancelReservationSchema', () => {
  it('reason opcional', () => {
    const r = cancelReservationSchema.safeParse({ id: '00000000-0000-4000-8000-000000000099' })
    expect(r.success).toBe(true)
  })
})

describe('scheduledEventSchema', () => {
  it('camino feliz', () => {
    const r = scheduledEventSchema.safeParse({
      template_id: '00000000-0000-4000-8000-000000000010',
      event_date: '2026-06-15',
      starts_at_local: '21:00',
      capacity: 40,
      meal_type: 'dinner',
    })
    expect(r.success).toBe(true)
  })
})

describe('rateTierSchema', () => {
  it('max_guests vacío → null', () => {
    const r = rateTierSchema.safeParse({
      meal_type: 'dinner',
      min_guests: 31,
      max_guests: '',
      rate_per_guest_cents: 14000,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.max_guests).toBeNull()
  })
})
