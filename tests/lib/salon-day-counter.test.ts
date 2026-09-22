import { describe, expect, it } from 'vitest'
import {
  activeDaySegments,
  counterDayLabel,
  eventUsedById,
  type RangeTotalsRow,
  tallyRangeTotals,
} from '@/lib/salon/day-counter'
import {
  computeDaySegments,
  type DaySegmentCaps,
  type SegmentEventInput,
  type SegmentReservationInput,
} from '@/lib/salon/segments'
import { segmentHeadline } from '@/lib/salon/segments-copy'

// El contador del día de la lista /reservas. Fixtures sintéticos con la forma
// de los días reales del HUB: el jueves 10/09 el viejo contador decía "171 de
// 130" (19 al mediodía + 33 en la merienda + 119 en la cena contra PA + PB).

const DAY = '2026-09-10'
const PIZZA = '3f2b8c1e-5d4a-4b7e-9c61-0a2d4e6f8b10'

let seq = 0
function res(p: Partial<SegmentReservationInput> = {}): SegmentReservationInput {
  seq += 1
  return {
    id: `r${seq}`,
    reservation_date: DAY,
    meal_type: 'dinner',
    reservation_time_local: '21:00:00',
    scheduled_event_id: null,
    zone: 'planta_alta',
    status: 'pending',
    estimated_guests: 2,
    actual_guests: null,
    kind: 'normal',
    cake_count: 0,
    ...p,
  }
}

const PIZZA_EVENT: SegmentEventInput = {
  id: PIZZA,
  event_date: DAY,
  starts_at_local: '21:00:00',
  capacity: 70,
  name_override: null,
  template: { name: 'Pizza libre', color_hex: '#e11d48' },
}

function cap(capacity: number) {
  return { capacity, warnAt: null, warnNote: null, source: 'weekly' as const, overrideReason: null }
}
const CAPS: DaySegmentCaps = { lunch: cap(70), tea_time: cap(120), dinner: cap(120) }

describe('activeDaySegments', () => {
  it('cada servicio contra SU cupo, nunca el total del día contra PA + PB', () => {
    const day = computeDaySegments({
      date: DAY,
      reservations: [
        res({ meal_type: 'lunch', reservation_time_local: '13:00:00', estimated_guests: 19 }),
        res({ meal_type: 'tea_time', reservation_time_local: '16:30:00', estimated_guests: 33 }),
        res({ estimated_guests: 119 }),
      ],
      events: [],
      caps: CAPS,
    })
    const shown = activeDaySegments(day)
    expect(shown.map((s) => segmentHeadline(s, 'short'))).toEqual([
      'Alm 19/70',
      'Mer 33/120',
      'Cena 119/120',
    ])
  })

  it('un servicio sin nada no aparece; uno con un evento programado sí, aunque esté vacío', () => {
    const day = computeDaySegments({
      date: DAY,
      reservations: [
        res({ meal_type: 'lunch', reservation_time_local: '13:00:00', estimated_guests: 4 }),
      ],
      events: [PIZZA_EVENT],
      caps: CAPS,
    })
    expect(activeDaySegments(day).map((s) => s.key)).toEqual(['lunch', 'dinner'])
  })

  it('las canceladas y las que no vinieron no cuentan (un día así queda sin contador)', () => {
    const day = computeDaySegments({
      date: DAY,
      reservations: [res({ status: 'cancelled' }), res({ status: 'no_show' })],
      events: [],
      caps: CAPS,
    })
    expect(activeDaySegments(day)).toEqual([])
  })

  it('una reserva adentro de un evento cuenta en el evento aunque tenga planta', () => {
    // El pedido del 22/09: dentro de Pizza libre se puede elegir Planta Alta.
    // El cupo del servicio no cambia: cuenta por scheduled_event_id, no por zona.
    const day = computeDaySegments({
      date: DAY,
      reservations: [
        res({ scheduled_event_id: PIZZA, zone: 'planta_alta', estimated_guests: 29 }),
        res({ scheduled_event_id: PIZZA, zone: 'event_floating', estimated_guests: 10 }),
        res({ estimated_guests: 6 }),
      ],
      events: [PIZZA_EVENT],
      caps: CAPS,
    })
    const [dinner] = activeDaySegments(day)
    expect(dinner?.eventUsed).toBe(39)
    expect(dinner?.normalUsed).toBe(6)
    expect(dinner && segmentHeadline(dinner, 'short')).toBe('Cena 45/120')
  })
})

describe('eventUsedById', () => {
  it('la gente vendida de cada evento: reales si ya se contaron, sin canceladas', () => {
    const day = computeDaySegments({
      date: DAY,
      reservations: [
        res({ scheduled_event_id: PIZZA, estimated_guests: 10, actual_guests: 8 }),
        res({ scheduled_event_id: PIZZA, zone: 'event_floating', estimated_guests: 5 }),
        res({ scheduled_event_id: PIZZA, estimated_guests: 20, status: 'cancelled' }),
      ],
      events: [PIZZA_EVENT],
      caps: CAPS,
    })
    expect(eventUsedById(day)).toEqual(new Map([[PIZZA, 13]]))
  })

  it('un evento sin reservas vale 0; un día sin eventos da un mapa vacío', () => {
    const withEvent = computeDaySegments({
      date: DAY,
      reservations: [],
      events: [PIZZA_EVENT],
      caps: CAPS,
    })
    expect(eventUsedById(withEvent).get(PIZZA)).toBe(0)
    const empty = computeDaySegments({ date: DAY, reservations: [], events: [], caps: CAPS })
    expect(eventUsedById(empty).size).toBe(0)
  })
})

describe('counterDayLabel', () => {
  it("'jue 10/09', en minúscula para ir en el medio de una frase", () => {
    expect(counterDayLabel('2026-09-10')).toBe('jue 10/09')
  })
})

describe('tallyRangeTotals', () => {
  function row(p: Partial<RangeTotalsRow> = {}): RangeTotalsRow {
    return {
      estimated_guests: 2,
      actual_guests: null,
      scheduled_event_id: null,
      kind: 'normal',
      cake_count: 0,
      ...p,
    }
  }

  it('una reserva de evento con planta cuenta en eventos, no en salón', () => {
    // Antes se separaba por zona: Pizza libre en Planta Alta caía en "salón"
    // aunque siga ocupando cupo del evento.
    const totals = tallyRangeTotals([
      row({ scheduled_event_id: PIZZA, estimated_guests: 29 }),
      row({ scheduled_event_id: PIZZA, estimated_guests: 10 }),
      row({ estimated_guests: 6 }),
    ])
    expect(totals).toEqual({
      reservations: 3,
      guests: 45,
      salon: 6,
      eventos: 39,
      cakes: 0,
      birthdays: 0,
    })
  })

  it('reales si ya se contaron; tortas y cumples aparte', () => {
    const totals = tallyRangeTotals([
      row({ estimated_guests: 10, actual_guests: 8, kind: 'birthday', cake_count: 1 }),
      row({ scheduled_event_id: PIZZA, estimated_guests: 4, cake_count: 2 }),
    ])
    expect(totals).toMatchObject({ guests: 12, salon: 8, eventos: 4, cakes: 3, birthdays: 1 })
  })

  it('sin filas, todo en 0', () => {
    expect(tallyRangeTotals([])).toEqual({
      reservations: 0,
      guests: 0,
      salon: 0,
      eventos: 0,
      cakes: 0,
      birthdays: 0,
    })
  })
})
