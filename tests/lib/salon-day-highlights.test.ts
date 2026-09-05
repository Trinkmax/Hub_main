import { describe, expect, it } from 'vitest'
import {
  buildDayHighlights,
  type HighlightEventInput,
  isCelebration,
  usedByEventMap,
} from '@/lib/salon/day-highlights'
import type { ReservationWithJoins } from '@/lib/salon/types'

const PIZZA: HighlightEventInput = {
  id: 'ev-pizza',
  event_date: '2026-09-21',
  starts_at_local: '21:00:00',
  capacity: 140,
  name_override: null,
  template: { name: 'Pizza libre', color_hex: '#e11d48' },
}

function reservation(over: Partial<ReservationWithJoins> = {}): ReservationWithJoins {
  return {
    id: 'r1',
    tenant_id: 't',
    customer_id: null,
    guest_name: 'Lourdes Roldan',
    guest_phone: null,
    guest_email: null,
    kind: 'birthday',
    meal_type: 'dinner',
    reservation_date: '2026-09-21',
    reservation_time_local: '21:00:00',
    reservation_end_time_local: null,
    zone: 'planta_alta',
    scheduled_event_id: 'ev-pizza',
    estimated_guests: 15,
    actual_guests: null,
    cake_count: 1,
    cake_option_id: 'cake-2',
    champagne_count: 1,
    deposit_cents: 0,
    origin: 'whatsapp',
    primary_manager_id: 'm1',
    assistant_manager_id: null,
    comments: null,
    service_alerts: [],
    highlight_comment: false,
    table_label: null,
    status: 'pending',
    arrived_at: null,
    seated_at: null,
    closed_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    arrived_by: null,
    seated_by: null,
    closed_by: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    primary_manager: null,
    assistant_manager: null,
    scheduled_event: {
      id: 'ev-pizza',
      capacity: 140,
      starts_at_local: '21:00:00',
      meal_type: 'dinner',
      template: {
        id: 'tpl',
        name: 'Pizza libre',
        slug: 'pizza-libre',
        color_hex: '#e11d48',
        consume_special_reservations: true,
      },
    },
    customer: null,
    cake_option: {
      id: 'cake-2',
      name: 'Opción 2',
      base: 'Bizcochuelo de chocolate',
      fillings: ['Mousse de chocolate', 'Crema y frutillas'],
    },
    ...over,
  }
}

describe('buildDayHighlights', () => {
  it('el cumpleaños sube al mismo nivel que el evento, no queda adentro', () => {
    // El caso real: lunes 21/09, Pizza libre, y un cumple de 15 metido adentro.
    const highlights = buildDayHighlights({
      events: [PIZZA],
      reservations: [
        reservation(),
        reservation({
          id: 'r2',
          kind: 'normal',
          guest_name: 'Cristina Vergara',
          cake_count: 0,
          cake_option_id: null,
          cake_option: null,
        }),
      ],
    })
    expect(highlights).toHaveLength(2)
    expect(highlights.map((h) => h.kind)).toEqual(['event', 'birthday'])
  })

  it('el cumple conserva su zona real aunque venga a un evento', () => {
    const [, cumple] = buildDayHighlights({ events: [PIZZA], reservations: [reservation()] })
    if (cumple?.kind === 'event') throw new Error('esperaba una celebración')
    expect(cumple?.zoneLabel).toBe('Planta Alta')
    // Y dice a qué evento viene: ese es el dato que se perdía.
    expect(cumple?.eventName).toBe('Pizza libre')
  })

  it('lleva el id crudo de la torta además del objeto (Realtime no manda joins)', () => {
    const [, cumple] = buildDayHighlights({ events: [PIZZA], reservations: [reservation()] })
    if (cumple?.kind === 'event') throw new Error('esperaba una celebración')
    expect(cumple?.cakeOptionId).toBe('cake-2')
  })

  it('lleva la torta elegida, no solo que hay torta', () => {
    const [, cumple] = buildDayHighlights({ events: [PIZZA], reservations: [reservation()] })
    if (cumple?.kind === 'event') throw new Error('esperaba una celebración')
    expect(cumple?.cakeCount).toBe(1)
    expect(cumple?.cake?.name).toBe('Opción 2')
    expect(cumple?.cake?.base).toBe('Bizcochuelo de chocolate')
  })

  it('una reserva de zona event_floating muestra el nombre del evento como lugar', () => {
    const [, cumple] = buildDayHighlights({
      events: [PIZZA],
      reservations: [reservation({ zone: 'event_floating' })],
    })
    if (cumple?.kind === 'event') throw new Error('esperaba una celebración')
    expect(cumple?.zoneLabel).toBe('Pizza libre')
  })

  it('las canceladas y las que no vinieron no son hitos: no hay nada que preparar', () => {
    const highlights = buildDayHighlights({
      events: [],
      reservations: [
        reservation({ id: 'a', status: 'cancelled' }),
        reservation({ id: 'b', status: 'no_show' }),
        reservation({ id: 'c' }),
      ],
    })
    expect(highlights).toHaveLength(1)
    expect(highlights[0]?.id).toBe('c')
  })

  it('una reserva normal SIN torta no es un hito', () => {
    const highlights = buildDayHighlights({
      events: [],
      reservations: [
        reservation({ kind: 'normal', cake_count: 0, cake_option_id: null, cake_option: null }),
      ],
    })
    expect(highlights).toEqual([])
  })

  it('una reserva normal CON torta sí: la torta la hace el bar igual', () => {
    // Caso real: 28/05, kind='normal', 2 tortas. El calendario del mes ya la
    // contaba y el día no la mostraba — la torta se perdía por no ser cumpleaños.
    const highlights = buildDayHighlights({
      events: [],
      reservations: [reservation({ kind: 'normal', cake_count: 2 })],
    })
    expect(highlights).toHaveLength(1)
    expect(highlights[0]?.kind).toBe('cake')
  })

  it('las especiales sí (no son una mesa más)', () => {
    const highlights = buildDayHighlights({
      events: [],
      reservations: [reservation({ kind: 'special' })],
    })
    expect(highlights[0]?.kind).toBe('special')
  })

  it('ordena por hora, y a igual hora el evento va primero', () => {
    const highlights = buildDayHighlights({
      events: [PIZZA],
      reservations: [
        reservation({ id: 'tarde', reservation_time_local: '23:00:00' }),
        reservation({ id: 'mismo', reservation_time_local: '21:00:00' }),
      ],
    })
    expect(highlights.map((h) => h.id)).toEqual(['ev-pizza', 'mismo', 'tarde'])
  })

  it('el evento trae sus cubiertos vendidos desde los buckets del RPC', () => {
    const [ev] = buildDayHighlights({
      events: [PIZZA],
      reservations: [],
      usedByEvent: usedByEventMap([
        { bucket: 'zone:planta_alta', used: 15 },
        { bucket: 'event:ev-pizza', used: 20 },
      ]),
    })
    if (ev?.kind !== 'event') throw new Error('esperaba un evento')
    expect(ev.used).toBe(20)
    expect(ev.capacity).toBe(140)
  })

  it('un evento sin buckets arranca en 0, no en NaN', () => {
    const [ev] = buildDayHighlights({ events: [PIZZA], reservations: [] })
    if (ev?.kind !== 'event') throw new Error('esperaba un evento')
    expect(ev.used).toBe(0)
  })

  it('el nombre puntual del evento le gana al del formato', () => {
    const [ev] = buildDayHighlights({
      events: [{ ...PIZZA, name_override: 'Pizza libre + DJ' }],
      reservations: [],
    })
    expect(ev?.title).toBe('Pizza libre + DJ')
  })
})

describe('usedByEventMap', () => {
  it('ignora los buckets de zona', () => {
    const map = usedByEventMap([
      { bucket: 'zone:planta_alta', used: 15 },
      { bucket: 'zone:event_floating', used: 8 },
      { bucket: 'event:abc', used: 22 },
    ])
    expect(map.size).toBe(1)
    expect(map.get('abc')).toBe(22)
  })
})

describe('isCelebration', () => {
  it('cumpleaños y especiales sí, normales no', () => {
    expect(isCelebration({ kind: 'birthday' })).toBe(true)
    expect(isCelebration({ kind: 'special' })).toBe(true)
    expect(isCelebration({ kind: 'normal' })).toBe(false)
  })
})
