import { describe, expect, it } from 'vitest'
import { aggregateMonthCapacity } from '@/lib/salon/month-capacity'

const defaults = { planta_alta: 30, planta_baja: 30 }

describe('aggregateMonthCapacity', () => {
  it('defaultTotal = suma de zonas', () => {
    const r = aggregateMonthCapacity({ reservations: [], overrides: [], defaults })
    expect(r.defaultTotal).toBe(60)
    expect(r.days).toEqual({})
  })

  it('suma comensales por día sobre zonas físicas', () => {
    const r = aggregateMonthCapacity({
      reservations: [
        {
          reservation_date: '2026-06-05',
          zone: 'planta_alta',
          estimated_guests: 4,
          actual_guests: null,
          status: 'pending',
        },
        {
          reservation_date: '2026-06-05',
          zone: 'planta_baja',
          estimated_guests: 6,
          actual_guests: null,
          status: 'arrived',
        },
      ],
      overrides: [],
      defaults,
    })
    expect(r.days['2026-06-05']).toEqual({ used: 10, total: 60 })
  })

  it('usa actual_guests solo si status=closed', () => {
    const r = aggregateMonthCapacity({
      reservations: [
        {
          reservation_date: '2026-06-06',
          zone: 'planta_alta',
          estimated_guests: 4,
          actual_guests: 7,
          status: 'closed',
        },
        {
          reservation_date: '2026-06-06',
          zone: 'planta_alta',
          estimated_guests: 5,
          actual_guests: 9,
          status: 'seated',
        },
      ],
      overrides: [],
      defaults,
    })
    // closed → 7, seated → estimated 5 = 12
    expect(r.days['2026-06-06']?.used).toBe(12)
  })

  it('excluye cancelled/no_show y zona event_floating', () => {
    const r = aggregateMonthCapacity({
      reservations: [
        {
          reservation_date: '2026-06-07',
          zone: 'planta_alta',
          estimated_guests: 4,
          actual_guests: null,
          status: 'cancelled',
        },
        {
          reservation_date: '2026-06-07',
          zone: 'planta_alta',
          estimated_guests: 3,
          actual_guests: null,
          status: 'no_show',
        },
        {
          reservation_date: '2026-06-07',
          zone: 'event_floating',
          estimated_guests: 8,
          actual_guests: null,
          status: 'pending',
        },
        {
          reservation_date: '2026-06-07',
          zone: 'planta_baja',
          estimated_guests: 2,
          actual_guests: null,
          status: 'pending',
        },
      ],
      overrides: [],
      defaults,
    })
    expect(r.days['2026-06-07']?.used).toBe(2)
  })

  it('aplica overrides por zona al total del día', () => {
    const r = aggregateMonthCapacity({
      reservations: [],
      overrides: [{ override_date: '2026-06-08', zone: 'planta_alta', capacity: 100 }],
      defaults,
    })
    // PA override 100 + PB default 30 = 130
    expect(r.days['2026-06-08']).toEqual({ used: 0, total: 130 })
  })
})
