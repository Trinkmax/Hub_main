import { describe, expect, it } from 'vitest'
import { detailKey, nextHeld, quickCard, withPending } from '@/lib/pos/floor/quick'
import { deriveSessionState } from '@/lib/pos/table-state'
import type { FloorSession, SessionDetail, SessionItem, SessionTicket } from '@/lib/pos/types'

const NOW = Date.parse('2026-11-25T23:00:00.000Z')
const AGO = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const floor = (over: Partial<FloorSession> = {}): FloorSession => ({
  id: 'mesa-10',
  table_id: 't10',
  opened_at: AGO(60),
  party_size: 2,
  alias: null,
  reservation_id: null,
  bill_requested_at: null,
  total_cents: 5_500_000,
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
  first_order_at: AGO(50),
  ...over,
})

let seq = 0
const item = (
  name: string,
  quantity: number,
  prep: SessionItem['prep_status'],
  over: Partial<SessionItem> = {},
): SessionItem => ({
  id: `item-${++seq}`,
  menu_item_id: `menu-${name}`,
  name,
  quantity,
  unit_price_cents: 100_000,
  line_total_cents: 100_000 * quantity,
  notes: null,
  modifiers: [],
  station_id: null,
  prep_status: prep,
  ready_at: prep === 'ready' ? AGO(3) : null,
  served_at: prep === 'served' ? AGO(10) : null,
  cancelled_at: null,
  cancellation_reason: null,
  ...over,
})

const ticket = (
  id: string,
  course: number,
  items: SessionItem[],
  over: Partial<SessionTicket> = {},
): SessionTicket => ({
  id,
  status: 'accepted',
  course,
  held: false,
  submitted_at: AGO(40),
  fired_at: AGO(40),
  kitchen_seen_at: null,
  ready_at: null,
  served_at: null,
  total_cents: 0,
  items,
  ...over,
})
const held = (id: string, course: number, items: SessionItem[]) =>
  ticket(id, course, items, { held: true, fired_at: null })

const detail = (
  tickets: SessionTicket[],
  sessionId = 'mesa-10',
): Pick<SessionDetail, 'session' | 'tickets'> => ({
  session: {
    id: sessionId,
    status: 'open',
    branch_id: 'cerro',
    table_id: 't10',
    opened_at: AGO(60),
    party_size: 2,
    alias: null,
    note: null,
    bill_requested_at: null,
    total_cents: 0,
    is_practice: false,
    kind: 'table',
    paid_at: null,
  },
  tickets,
})

const card = (session: FloorSession, d: Pick<SessionDetail, 'session' | 'tickets'> | null = null) =>
  quickCard(session, deriveSessionState(session, NOW), d)

describe('la ficha de la mesa: qué manda', () => {
  it('con comida para retirar manda «Servido», aunque todavía no haya llegado el detalle', () => {
    const session = floor({ items_ready: 2, ready_since: AGO(3), items_served: 1 })
    expect(card(session)).toEqual({
      billOn: false,
      primary: { kind: 'serve', units: null, label: '' },
    })
  })

  it('cuando llega el detalle dice cuántas unidades y qué hay que llevar, como la barra de la comanda', () => {
    const session = floor({ items_ready: 2, ready_since: AGO(3) })
    const d = detail([
      ticket('t1', 1, [
        item('Mojito', 2, 'ready'),
        item('Lomo', 1, 'ready'),
        item('Papas', 1, 'preparing'),
      ]),
    ])
    expect(card(session, d).primary).toEqual({
      kind: 'serve',
      units: 3,
      label: '2 Mojito · 1 Lomo',
    })
  })

  it('el detalle de OTRA mesa no completa nada (se cambió de mesa mientras llegaba)', () => {
    const session = floor({ items_ready: 1, ready_since: AGO(1) })
    const other = detail([ticket('t1', 1, [item('Mojito', 5, 'ready')])], 'mesa-11')
    expect(card(session, other).primary).toEqual({ kind: 'serve', units: null, label: '' })
  })

  it('un detalle que quedó viejo (ya no trae nada listo) no inventa unidades: manda el mapa', () => {
    const session = floor({ items_ready: 1, ready_since: AGO(1) })
    const stale = detail([ticket('t1', 1, [item('Mojito', 2, 'preparing')])])
    expect(card(session, stale).primary).toEqual({ kind: 'serve', units: null, label: '' })
  })

  it('lo listo le gana a la cuenta: primero se lleva la comida («Ver cuenta» queda al lado)', () => {
    const session = floor({ items_ready: 1, ready_since: AGO(1), bill_requested_at: AGO(2) })
    const result = card(session)
    expect(result.primary.kind).toBe('serve')
    expect(result.billOn).toBe(true)
  })

  it('si pidieron la cuenta, manda «Cobrar»', () => {
    const session = floor({ items_served: 3, last_served_at: AGO(30), bill_requested_at: AGO(2) })
    expect(card(session)).toEqual({ billOn: true, primary: { kind: 'bill' } })
  })

  it('una tanda esperando con la cocina libre: «Marchar tanda», con su número y lo que lleva', () => {
    const session = floor({ items_served: 2, last_served_at: AGO(15), held_tickets: 1 })
    expect(card(session).primary).toEqual({ kind: 'fire', ticketId: null, number: null, label: '' })
    const d = detail([
      ticket('t1', 1, [item('Empanadas', 2, 'served')]),
      held('t2', 2, [item('Lomo', 2, 'queued'), item('Papas', 1, 'queued')]),
    ])
    expect(card(session, d).primary).toEqual({
      kind: 'fire',
      ticketId: 't2',
      number: 2,
      label: '2 Lomo · 1 Papas',
    })
  })

  it('con la cocina todavía trabajando no ofrece marchar la que espera', () => {
    const session = floor({ items_preparing: 2, waiting_since: AGO(8), held_tickets: 1 })
    expect(card(session).primary).toEqual({ kind: 'add' })
  })

  it('sin nada pendiente manda «Agregar»: recién sentada, en preparación o comiendo', () => {
    expect(card(floor()).primary).toEqual({ kind: 'add' })
    expect(card(floor({ items_queued: 2, waiting_since: AGO(4) })).primary).toEqual({ kind: 'add' })
    expect(card(floor({ items_served: 4, last_served_at: AGO(20) })).primary).toEqual({
      kind: 'add',
    })
  })
})

describe('la tanda que se marcharía', () => {
  it('es la más vieja de las que esperan, y lo dado de baja no figura', () => {
    const d = detail([
      ticket('t1', 1, [item('Empanadas', 2, 'served')]),
      held('t2', 2, [
        item('Lomo', 2, 'queued'),
        item('Papas', 1, 'queued', { cancelled_at: AGO(1) }),
      ]),
      held('t3', 3, [item('Flan', 2, 'queued')]),
    ])
    expect(nextHeld(d)).toEqual({ ticketId: 't2', number: 2, label: '2 Lomo' })
  })

  it('no hay ninguna esperando', () => {
    expect(nextHeld(detail([ticket('t1', 1, [item('Empanadas', 2, 'served')])]))).toBeNull()
  })

  it('una tanda en espera con todo dado de baja no cuenta', () => {
    const d = detail([held('t2', 2, [item('Lomo', 2, 'queued', { cancelled_at: AGO(1) })])])
    expect(nextHeld(d)).toBeNull()
  })
})

describe('lo que se acaba de tocar se ve al instante en el mapa', () => {
  const nowIso = new Date(NOW).toISOString()

  it('«Servido»: lo listo pasa a servido y la mesa queda comiendo', () => {
    const before = floor({ items_ready: 3, ready_since: AGO(3), items_served: 1 })
    const after = withPending(before, 'serve', nowIso)
    expect(after).toMatchObject({
      items_ready: 0,
      items_served: 4,
      ready_since: null,
      last_served_at: nowIso,
    })
    expect(deriveSessionState(before, NOW).key).toBe('ready')
    expect(deriveSessionState(after, NOW).key).toBe('eating')
  })

  it('«Servido» con algo todavía en cocina: la mesa vuelve a «en preparación»', () => {
    const before = floor({
      items_ready: 1,
      ready_since: AGO(2),
      items_preparing: 2,
      waiting_since: AGO(9),
    })
    expect(deriveSessionState(withPending(before, 'serve', nowIso), NOW).key).toBe('kitchen')
  })

  it('«Marchar tanda»: una menos esperando y la mesa pasa a «en preparación»', () => {
    const before = floor({ items_served: 2, last_served_at: AGO(15), held_tickets: 2 })
    const after = withPending(before, 'fire', nowIso)
    expect(after.held_tickets).toBe(1)
    expect(after.waiting_since).toBe(nowIso)
    expect(deriveSessionState(after, NOW).key).toBe('kitchen')
  })

  it('si la base ya lo tiene hecho (llegó la lectura nueva), no lo aplica dos veces', () => {
    const served = floor({ items_ready: 0, items_served: 4, last_served_at: AGO(1) })
    expect(withPending(served, 'serve', nowIso)).toBe(served)
    const fired = floor({ held_tickets: 0, items_queued: 2, waiting_since: AGO(1) })
    expect(withPending(fired, 'fire', nowIso)).toBe(fired)
  })

  it('sin nada tocado, la mesa es la misma', () => {
    const session = floor({ items_ready: 2 })
    expect(withPending(session, undefined, nowIso)).toBe(session)
  })
})

describe('cuándo volver a leer el detalle de la mesa elegida', () => {
  it('cambia cuando sale algo de cocina, se sirve, se carga, se marcha una tanda o piden la cuenta', () => {
    const base = floor({ items_preparing: 2 })
    const key = detailKey(base)
    expect(detailKey({ ...base, items_preparing: 1, items_ready: 1 })).not.toBe(key)
    expect(detailKey({ ...base, items_served: 1 })).not.toBe(key)
    expect(detailKey({ ...base, total_cents: base.total_cents + 1 })).not.toBe(key)
    expect(detailKey({ ...base, held_tickets: 1 })).not.toBe(key)
    expect(detailKey({ ...base, bill_requested_at: AGO(0) })).not.toBe(key)
  })

  it('no cambia porque pase el tiempo ni porque cambie otra cosa de la mesa', () => {
    const base = floor({ items_preparing: 2 })
    expect(detailKey({ ...base, party_size: 6, alias: 'Cumple' })).toBe(detailKey(base))
  })
})
