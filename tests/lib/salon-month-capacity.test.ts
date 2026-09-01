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

  it('usa actual_guests apenas está cargado, sin esperar el closed', () => {
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
    // closed → 7, seated → 9 (el real ya cargado) = 16. Mismo criterio que el
    // RPC evaluate_day_capacity, para que el mes y el día no discrepen.
    expect(r.days['2026-06-06']?.used).toBe(16)
  })

  it('excluye cancelled/no_show pero SÍ cuenta las reservas de evento', () => {
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
    // 8 del evento + 2 de planta baja = 10. Las canceladas y el no_show, afuera.
    expect(r.days['2026-06-07']?.used).toBe(10)
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

  describe('cubiertos por evento', () => {
    it('cuenta toda reserva colgada del evento, sin importar zona ni estado', () => {
      const r = aggregateMonthCapacity({
        reservations: [
          {
            reservation_date: '2026-08-06',
            zone: 'event_floating',
            estimated_guests: 2,
            actual_guests: null,
            status: 'pending',
            scheduled_event_id: 'ramen',
          },
          {
            reservation_date: '2026-08-06',
            zone: 'event_floating',
            estimated_guests: 2,
            actual_guests: null,
            status: 'pending',
            scheduled_event_id: 'ramen',
          },
          // Mesa del salón sin evento: suma al día, pero no al evento.
          {
            reservation_date: '2026-08-06',
            zone: 'planta_alta',
            estimated_guests: 10,
            actual_guests: null,
            status: 'pending',
            scheduled_event_id: null,
          },
        ],
        overrides: [],
        defaults,
      })
      expect(r.events.ramen).toBe(4)
      // El día suma todo: 2 + 2 del evento + 10 de la mesa a la carta.
      expect(r.days['2026-08-06']?.used).toBe(14)
    })

    it('el comensal real pesa apenas se carga (sin esperar el closed)', () => {
      const r = aggregateMonthCapacity({
        reservations: [
          {
            reservation_date: '2026-08-06',
            zone: 'event_floating',
            estimated_guests: 6,
            actual_guests: 10,
            status: 'seated',
            scheduled_event_id: 'ramen',
          },
        ],
        overrides: [],
        defaults,
      })
      expect(r.events.ramen).toBe(10)
    })

    it('no cuenta canceladas ni no_show', () => {
      const r = aggregateMonthCapacity({
        reservations: [
          {
            reservation_date: '2026-08-06',
            zone: 'event_floating',
            estimated_guests: 4,
            actual_guests: null,
            status: 'cancelled',
            scheduled_event_id: 'ramen',
          },
          {
            reservation_date: '2026-08-06',
            zone: 'event_floating',
            estimated_guests: 3,
            actual_guests: null,
            status: 'no_show',
            scheduled_event_id: 'ramen',
          },
        ],
        overrides: [],
        defaults,
      })
      expect(r.events.ramen).toBeUndefined()
    })

    it('una reserva especial en planta también suma a su evento', () => {
      const r = aggregateMonthCapacity({
        reservations: [
          {
            reservation_date: '2026-08-06',
            zone: 'planta_baja',
            estimated_guests: 8,
            actual_guests: null,
            status: 'pending',
            scheduled_event_id: 'ramen',
          },
        ],
        overrides: [],
        defaults,
      })
      expect(r.events.ramen).toBe(8)
    })
  })
})
