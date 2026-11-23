import { describe, expect, it } from 'vitest'
import { floorLegend, stateTimings, timingWords } from '@/lib/pos/floor/legend'
import { deriveFreeState, deriveSessionState, type Urgency } from '@/lib/pos/table-state'
import {
  DEFAULT_THRESHOLDS,
  type FloorReservation,
  type FloorSession,
  type PosThresholds,
} from '@/lib/pos/types'

const NOW = Date.parse('2026-11-13T01:00:00.000Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function session(over: Partial<FloorSession> = {}): FloorSession {
  return {
    id: 's1',
    table_id: 't1',
    opened_at: ago(0),
    party_size: 2,
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

/** La mesa en cada estado, a los `minutes` de haber entrado en él. */
const AT: Record<'seated' | 'kitchen' | 'ready' | 'bill', (minutes: number) => FloorSession> = {
  seated: (minutes) => session({ opened_at: ago(minutes) }),
  kitchen: (minutes) => session({ items_queued: 1, waiting_since: ago(minutes) }),
  ready: (minutes) => session({ items_ready: 1, ready_since: ago(minutes) }),
  bill: (minutes) => session({ items_served: 1, bill_requested_at: ago(minutes) }),
}

const CUSTOM: PosThresholds = {
  order_warn_minutes: 9,
  kitchen_warn_minutes: 15,
  kitchen_late_minutes: 31,
  ready_warn_minutes: 4,
  bill_warn_minutes: 7,
}

describe('la leyenda dice lo mismo que hace el mapa', () => {
  for (const [name, thresholds] of [
    ['los tiempos de fábrica', DEFAULT_THRESHOLDS],
    ['tiempos propios del bar', CUSTOM],
  ] as const) {
    for (const state of ['seated', 'kitchen', 'ready', 'bill'] as const) {
      it(`${state}, con ${name}`, () => {
        const { warnAt, lateAt } = stateTimings(thresholds)[state]
        const urgencyAt = (minutes: number): Urgency =>
          deriveSessionState(AT[state](minutes), NOW, thresholds).urgency

        // Un minuto antes de ponerse roja todavía no lo está; al minuto justo, sí.
        expect(urgencyAt(lateAt)).toBe('late')
        expect(urgencyAt(lateAt - 1)).not.toBe('late')
        if (warnAt === 0) {
          // «En despacho» avisa desde el primer momento.
          expect(urgencyAt(0)).toBe('warn')
        } else {
          expect(urgencyAt(warnAt)).toBe('warn')
          expect(urgencyAt(warnAt - 1)).toBe('none')
        }
      })
    }
  }

  it('sin ajustes guardados usa los de fábrica', () => {
    expect(stateTimings(null)).toEqual(stateTimings(DEFAULT_THRESHOLDS))
  })

  it('una reserva avisa a los 15 minutos de pasada la hora, como el mapa', () => {
    const reservation: FloorReservation = {
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
    }
    const row = floorLegend(null).find((entry) => entry.key === 'reserved')
    const after = row?.warnAt ?? 0
    expect(deriveFreeState({ reservation, inMinutes: -after }).urgency).toBe('none')
    expect(deriveFreeState({ reservation, inMinutes: -(after + 1) }).urgency).toBe('warn')
  })
})

describe('cómo se lee', () => {
  it('trae los siete estados y la demorada, en el orden del salón', () => {
    expect(floorLegend(null).map((row) => row.key)).toEqual([
      'free',
      'reserved',
      'seated',
      'kitchen',
      'ready',
      'eating',
      'bill',
      'late',
    ])
  })

  it('los tiempos, en una línea', () => {
    const rows = Object.fromEntries(floorLegend(DEFAULT_THRESHOLDS).map((row) => [row.key, row]))
    expect(timingWords(rows.seated ?? { key: 'seated', warnAt: null, lateAt: null })).toBe(
      'Avisa a los 6 min · roja a los 12 min',
    )
    expect(timingWords(rows.kitchen ?? { key: 'kitchen', warnAt: null, lateAt: null })).toBe(
      'Avisa a los 12 min · roja a los 20 min',
    )
    expect(timingWords(rows.ready ?? { key: 'ready', warnAt: null, lateAt: null })).toBe(
      'Avisa enseguida · roja a los 6 min',
    )
    expect(timingWords(rows.bill ?? { key: 'bill', warnAt: null, lateAt: null })).toBe(
      'Avisa a los 4 min · roja a los 8 min',
    )
  })

  it('lo que no tiene reloj no inventa uno', () => {
    for (const key of ['free', 'eating', 'late'] as const) {
      const row = floorLegend(null).find((entry) => entry.key === key)
      expect(row && timingWords(row)).toBeNull()
    }
  })

  it('si el aviso y el rojo caen juntos, dice solo el rojo', () => {
    expect(timingWords({ key: 'kitchen', warnAt: 20, lateAt: 20 })).toBe(
      'Se pone roja a los 20 min',
    )
  })
})
