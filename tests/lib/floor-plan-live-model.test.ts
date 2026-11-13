import { describe, expect, it } from 'vitest'
import {
  buildLiveEntries,
  liveSummaryLine,
  liveTables,
  pendingByArea,
} from '@/lib/floor-plan/live-model'
import { summarize } from '@/lib/pos/table-state'
import type { FloorElement, FloorReservation, FloorSession, FloorSnapshot } from '@/lib/pos/types'

const NOW = Date.parse('2026-11-12T23:30:00Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

function table(id: string, label: string, areaId = 'salon'): FloorElement {
  return {
    id: `el-${id}`,
    area_id: areaId,
    kind: 'table',
    shape: 'rect',
    x: 0,
    y: 0,
    w: 80,
    h: 80,
    rotation: 0,
    corner_radius: 8,
    z: 10,
    label: null,
    color: null,
    table_id: id,
    table_label: label,
    capacity: 4,
  }
}

function session(tableId: string, over: Partial<FloorSession> = {}): FloorSession {
  return {
    id: `s-${tableId}`,
    table_id: tableId,
    opened_at: minutesAgo(30),
    party_size: 3,
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
    id: 'r-1',
    time: '21:00',
    name: 'Luz',
    guests: 4,
    status: 'pending',
    table_label: '3',
    deposit_cents: 0,
    kind: 'normal',
    comments: null,
    alerts: [],
    customer_id: null,
    event: null,
    ...over,
  }
}

function snapshot(over: Partial<FloorSnapshot> = {}): FloorSnapshot {
  return {
    now: new Date(NOW).toISOString(),
    service_day: '2026-11-12',
    branch: {
      id: 'b',
      name: 'Cerro',
      short_name: null,
      slug: 'cerro',
      color: '#a8452d',
      is_default: false,
    },
    settings: null,
    areas: [
      { id: 'salon', name: 'Salón', position: 0, width: 1200, height: 800 },
      { id: 'terraza', name: 'Terraza', position: 1, width: 1200, height: 800 },
    ],
    elements: [table('t1', '1'), table('t2', '2'), table('t3', '3'), table('t20', '20', 'terraza')],
    loose_tables: [{ id: 'loose', label: 'Barra', capacity: 6 }],
    sessions: [],
    reservations: [],
    ...over,
  }
}

describe('buildLiveEntries', () => {
  it('una entrada por mesa: las del plano con su sector y las sueltas sin sector', () => {
    const entries = buildLiveEntries(snapshot(), NOW, 21 * 60)
    expect(entries.map((e) => [e.label, e.areaId])).toEqual([
      ['1', 'salon'],
      ['2', 'salon'],
      ['3', 'salon'],
      ['20', 'terraza'],
      ['Barra', null],
    ])
    expect(entries.every((e) => e.state.key === 'free')).toBe(true)
  })

  it('la mesa abierta toma el estado de su comanda', () => {
    const entries = buildLiveEntries(
      snapshot({
        sessions: [
          session('t1', { items_queued: 2, waiting_since: minutesAgo(5) }),
          session('t2', { items_ready: 1, ready_since: minutesAgo(1) }),
          session('t20', { bill_requested_at: minutesAgo(2), items_served: 3 }),
        ],
      }),
      NOW,
      21 * 60,
    )
    const byLabel = Object.fromEntries(entries.map((e) => [e.label, e.state.key]))
    expect(byLabel).toEqual({
      '1': 'kitchen',
      '2': 'ready',
      '3': 'free',
      '20': 'bill',
      Barra: 'free',
    })
  })

  it('una reserva por llegar toma su mesa; una lejana solo queda de dato', () => {
    const near = buildLiveEntries(
      snapshot({ reservations: [reservation({ time: '21:20' })] }),
      NOW,
      21 * 60,
    )
    expect(near.find((e) => e.label === '3')?.state.key).toBe('reserved')

    const far = buildLiveEntries(
      snapshot({ reservations: [reservation({ time: '23:30' })] }),
      NOW,
      21 * 60,
    )
    const free = far.find((e) => e.label === '3')
    expect(free?.state.key).toBe('free')
    expect(free?.state.reservation?.name).toBe('Luz')
  })
})

describe('liveTables', () => {
  it('arma lo que pide la maqueta: estado, cuántos son y cómo le dicen', () => {
    const entries = buildLiveEntries(
      snapshot({ sessions: [session('t1', { party_size: 5, alias: 'Los García' })] }),
      NOW,
      21 * 60,
    )
    const tables = liveTables(entries)
    expect(tables.t1).toMatchObject({ partySize: 5, alias: 'Los García' })
    expect(tables.t1?.state.key).toBe('seated')
    expect(tables.t2).toMatchObject({ partySize: null, alias: null })
    expect(Object.keys(tables)).toHaveLength(5)
  })

  it('una mesa abierta en modo práctica lo lleva dicho: el mapa la marca', () => {
    const entries = buildLiveEntries(
      snapshot({
        sessions: [session('t1', { is_practice: true }), session('t2', { is_practice: false })],
      }),
      NOW,
      21 * 60,
    )
    const tables = liveTables(entries)
    expect(tables.t1?.practice).toBe(true)
    expect(tables.t2?.practice).toBe(false)
    // Una mesa libre no es de práctica ni de verdad.
    expect(tables.t3?.practice).toBe(false)
  })
})

describe('pendingByArea', () => {
  it('cuenta por sector las mesas con algo pendiente; las sueltas no suman a ninguno', () => {
    const entries = buildLiveEntries(
      snapshot({
        sessions: [
          session('t1', { items_ready: 1, ready_since: minutesAgo(1) }),
          session('t2', { bill_requested_at: minutesAgo(1), items_served: 2 }),
          session('t3', { items_served: 2, last_served_at: minutesAgo(3) }), // comiendo: nada pendiente
          session('t20', { items_ready: 2, ready_since: minutesAgo(1) }),
          session('loose', { items_ready: 1, ready_since: minutesAgo(1) }),
        ],
      }),
      NOW,
      21 * 60,
    )
    expect(pendingByArea(entries)).toEqual({ salon: 2, terraza: 1 })
  })
})

describe('liveSummaryLine', () => {
  it('el salón en una línea, sin lo que está en cero', () => {
    const entries = buildLiveEntries(
      snapshot({
        sessions: [
          session('t1', { party_size: 4, items_ready: 1, ready_since: minutesAgo(1) }),
          session('t2', { party_size: 2, items_queued: 1, waiting_since: minutesAgo(3) }),
        ],
      }),
      NOW,
      21 * 60,
    )
    const line = liveSummaryLine(
      summarize(entries.map((e) => ({ state: e.state, partySize: e.session?.party_size ?? null }))),
    )
    expect(line).toBe('2 de 5 mesas · 6 personas · 1 para llevar · 1 esperando comida')
  })

  it('singulares y plurales', () => {
    const base = {
      tables: 1,
      open: 1,
      free: 0,
      people: 1,
      waitingFood: 0,
      ready: 0,
      late: 0,
      bill: 1,
      reserved: 0,
    }
    expect(liveSummaryLine(base)).toBe('1 de 1 mesa · 1 persona · 1 pidió la cuenta')
    expect(liveSummaryLine({ ...base, tables: 8, open: 3, people: 9, bill: 2, late: 1 })).toBe(
      '3 de 8 mesas · 9 personas · 2 pidieron la cuenta · 1 con demora',
    )
  })
})
