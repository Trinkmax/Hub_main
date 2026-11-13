import { describe, expect, it } from 'vitest'
import {
  attentionRank,
  deriveFreeState,
  deriveSessionState,
  formatMinutes,
  formatMinutesTight,
  needsAttention,
  reservationForTable,
  serviceMinutesAt,
  serviceMinutesOf,
  summarize,
  tablesOfLabel,
} from '@/lib/pos/table-state'
import type { FloorReservation, FloorSession } from '@/lib/pos/types'

const NOW = Date.parse('2026-11-13T01:00:00.000Z') // 22:00 en Córdoba
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function session(over: Partial<FloorSession> = {}): FloorSession {
  return {
    id: 's1',
    table_id: 't1',
    opened_at: ago(3),
    party_size: 4,
    alias: null,
    reservation_id: null,
    bill_requested_at: null,
    total_cents: 0,
    is_practice: false,
    kind: 'table',
    customer: null,
    held_tickets: 0,
    items_queued: 0,
    items_preparing: 0,
    items_ready: 0,
    items_served: 0,
    waiting_since: null,
    ready_since: null,
    last_served_at: null,
    first_order_at: null,
    ...over,
  }
}

function reservation(over: Partial<FloorReservation> = {}): FloorReservation {
  return {
    id: 'r1',
    time: '21:00',
    name: 'García',
    guests: 4,
    status: 'pending',
    table_label: '12',
    deposit_cents: 0,
    kind: 'normal',
    comments: null,
    alerts: [],
    customer_id: null,
    event: null,
    ...over,
  }
}

describe('mesa abierta', () => {
  it('recién sentada: sin pedido y sin apuro', () => {
    expect(deriveSessionState(session(), NOW)).toMatchObject({
      key: 'seated',
      urgency: 'none',
      minutes: 3,
    })
  })

  it('sentada hace rato sin pedir: pide atención, y después es tarde', () => {
    expect(deriveSessionState(session({ opened_at: ago(7) }), NOW).urgency).toBe('warn')
    expect(deriveSessionState(session({ opened_at: ago(13) }), NOW).urgency).toBe('late')
  })

  it('esperando comida: el reloj corre desde que salió la tanda más vieja', () => {
    const waiting = session({ items_queued: 2, items_preparing: 1, waiting_since: ago(9) })
    expect(deriveSessionState(waiting, NOW)).toMatchObject({
      key: 'kitchen',
      urgency: 'none',
      minutes: 9,
    })
    expect(deriveSessionState({ ...waiting, waiting_since: ago(14) }, NOW).urgency).toBe('warn')
    expect(deriveSessionState({ ...waiting, waiting_since: ago(22) }, NOW).urgency).toBe('late')
  })

  it('comida lista: gana a todo y siempre pide atención', () => {
    const ready = session({
      items_ready: 2,
      items_preparing: 3,
      ready_since: ago(1),
      waiting_since: ago(25),
      bill_requested_at: ago(10),
    })
    expect(deriveSessionState(ready, NOW)).toMatchObject({
      key: 'ready',
      urgency: 'warn',
      minutes: 1,
    })
    expect(deriveSessionState({ ...ready, ready_since: ago(7) }, NOW).urgency).toBe('late')
  })

  it('pidió la cuenta: gana a esperar comida', () => {
    const bill = session({
      bill_requested_at: ago(2),
      items_queued: 1,
      waiting_since: ago(5),
      items_served: 4,
    })
    expect(deriveSessionState(bill, NOW)).toMatchObject({
      key: 'bill',
      urgency: 'none',
      minutes: 2,
    })
    expect(deriveSessionState({ ...bill, bill_requested_at: ago(5) }, NOW).urgency).toBe('warn')
    expect(deriveSessionState({ ...bill, bill_requested_at: ago(9) }, NOW).urgency).toBe('late')
  })

  it('comiendo: tranquila, y avisa si quedó una tanda por marchar', () => {
    const eating = session({ items_served: 3, last_served_at: ago(12) })
    expect(deriveSessionState(eating, NOW)).toMatchObject({
      key: 'eating',
      urgency: 'none',
      nextCourseDue: false,
    })
    expect(deriveSessionState({ ...eating, held_tickets: 1 }, NOW).nextCourseDue).toBe(true)
  })

  it('todo en espera no es «sin pedido» con apuro', () => {
    const held = session({ opened_at: ago(30), held_tickets: 1 })
    expect(deriveSessionState(held, NOW)).toMatchObject({
      key: 'seated',
      urgency: 'none',
      nextCourseDue: true,
    })
  })

  it('respeta los tiempos del bar', () => {
    const custom = {
      order_warn_minutes: 2,
      kitchen_warn_minutes: 5,
      kitchen_late_minutes: 8,
      ready_warn_minutes: 1,
      bill_warn_minutes: 1,
    }
    const waiting = session({ items_queued: 1, waiting_since: ago(6) })
    expect(deriveSessionState(waiting, NOW, custom).urgency).toBe('warn')
    expect(deriveSessionState(waiting, NOW, null).urgency).toBe('none')
  })
})

describe('reservas sobre la mesa', () => {
  it('lee la etiqueta libre: una mesa, varias, con espacios', () => {
    expect(tablesOfLabel('12')).toEqual(['12'])
    expect(tablesOfLabel(' 12 + 13 ')).toEqual(['12', '13'])
    expect(tablesOfLabel('Barra')).toEqual(['barra'])
    expect(tablesOfLabel(null)).toEqual([])
  })

  it('las horas de la madrugada van después de la medianoche', () => {
    expect(serviceMinutesOf('21:00')).toBe(21 * 60)
    expect(serviceMinutesOf('00:30')).toBe(24 * 60 + 30)
    expect(serviceMinutesOf('04:59')).toBe(28 * 60 + 59)
    expect(serviceMinutesOf('05:00')).toBe(5 * 60)
    expect(serviceMinutesOf('25:00')).toBeNull()
    expect(serviceMinutesAt(new Date(NOW))).toBe(22 * 60)
    expect(serviceMinutesAt(new Date('2026-11-13T04:30:00.000Z'))).toBe(25 * 60 + 30)
  })

  it('una reserva cercana toma su mesa', () => {
    const match = reservationForTable('12', [reservation({ time: '22:20' })], 22 * 60)
    expect(match?.inMinutes).toBe(20)
    expect(deriveFreeState(match)).toMatchObject({
      key: 'reserved',
      urgency: 'none',
      reservationIn: 20,
    })
  })

  it('una reserva lejana deja la mesa libre, pero avisa a qué hora viene', () => {
    const match = reservationForTable('12', [reservation({ time: '23:30' })], 22 * 60)
    const state = deriveFreeState(match)
    expect(state.key).toBe('free')
    expect(state.reservationIn).toBe(90)
    expect(state.reservation?.name).toBe('García')
  })

  it('si ya llegaron o se pasó la hora, pide atención', () => {
    const arrived = reservationForTable(
      '12',
      [reservation({ status: 'arrived', time: '21:30' })],
      22 * 60,
    )
    expect(deriveFreeState(arrived)).toMatchObject({ key: 'reserved', urgency: 'warn' })
    const late = reservationForTable('12', [reservation({ time: '21:40' })], 22 * 60)
    expect(deriveFreeState(late)).toMatchObject({ key: 'reserved', urgency: 'warn', minutes: 20 })
    const gone = reservationForTable('12', [reservation({ time: '20:00' })], 22 * 60)
    expect(deriveFreeState(gone).key).toBe('free')
  })

  it('elige la más próxima, y la que ya llegó gana', () => {
    const list = [
      reservation({ id: 'a', time: '23:00' }),
      reservation({ id: 'b', time: '22:10' }),
      reservation({ id: 'c', time: '21:00', status: 'arrived' }),
      reservation({ id: 'd', time: '22:05', table_label: '13' }),
    ]
    expect(reservationForTable('12', list, 22 * 60)?.reservation.id).toBe('c')
    expect(reservationForTable('12', list.slice(0, 2), 22 * 60)?.reservation.id).toBe('b')
    expect(reservationForTable('13', list, 22 * 60)?.reservation.id).toBe('d')
    expect(reservationForTable('99', list, 22 * 60)).toBeNull()
    expect(deriveFreeState(null).key).toBe('free')
  })
})

describe('qué miro primero', () => {
  it('ordena por lo que no puede esperar', () => {
    const states = {
      readyLate: deriveSessionState(session({ items_ready: 1, ready_since: ago(9) }), NOW),
      kitchenLate: deriveSessionState(session({ items_queued: 1, waiting_since: ago(30) }), NOW),
      ready: deriveSessionState(session({ items_ready: 1, ready_since: ago(0) }), NOW),
      bill: deriveSessionState(session({ bill_requested_at: ago(1) }), NOW),
      kitchen: deriveSessionState(session({ items_queued: 1, waiting_since: ago(2) }), NOW),
      eating: deriveSessionState(session({ items_served: 1, last_served_at: ago(2) }), NOW),
      free: deriveFreeState(null),
    }
    const order = Object.entries(states)
      .sort((a, b) => attentionRank(a[1]) - attentionRank(b[1]))
      .map(([name]) => name)
    expect(order).toEqual([
      'readyLate',
      'kitchenLate',
      'ready',
      'bill',
      'kitchen',
      'eating',
      'free',
    ])
  })

  it('cuenta lo pendiente de cada sector', () => {
    expect(
      needsAttention(deriveSessionState(session({ items_ready: 1, ready_since: ago(0) }), NOW)),
    ).toBe(true)
    expect(needsAttention(deriveSessionState(session({ bill_requested_at: ago(0) }), NOW))).toBe(
      true,
    )
    expect(
      needsAttention(deriveSessionState(session({ items_queued: 1, waiting_since: ago(1) }), NOW)),
    ).toBe(false)
    expect(
      needsAttention(deriveSessionState(session({ items_served: 1, held_tickets: 1 }), NOW)),
    ).toBe(true)
    expect(needsAttention(deriveFreeState(null))).toBe(false)
  })

  it('resume el salón en una línea', () => {
    const summary = summarize([
      {
        state: deriveSessionState(session({ items_queued: 1, waiting_since: ago(25) }), NOW),
        partySize: 4,
      },
      {
        state: deriveSessionState(session({ items_queued: 1, waiting_since: ago(2) }), NOW),
        partySize: 2,
      },
      {
        state: deriveSessionState(session({ items_ready: 1, ready_since: ago(1) }), NOW),
        partySize: 6,
      },
      { state: deriveSessionState(session({ bill_requested_at: ago(1) }), NOW), partySize: null },
      { state: deriveFreeState(null), partySize: null },
      { state: deriveFreeState({ reservation: reservation(), inMinutes: 10 }), partySize: null },
    ])
    expect(summary).toEqual({
      tables: 6,
      open: 4,
      free: 1,
      people: 12,
      waitingFood: 2,
      ready: 1,
      late: 1,
      bill: 1,
      reserved: 1,
    })
  })
})

describe('relojes', () => {
  it('minutos y horas', () => {
    expect(formatMinutes(null)).toBe('')
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(12)).toBe('12 min')
    expect(formatMinutes(65)).toBe('1 h 05')
    expect(formatMinutesTight(12)).toBe('12′')
    expect(formatMinutesTight(125)).toBe('2h05')
  })
})
