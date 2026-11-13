import { describe, expect, it } from 'vitest'
import { clockAt, minutesSince } from '@/lib/pos/order/clock'
import {
  applyOverlay,
  barPrimary,
  countLines,
  lineState,
  NO_OVERLAY,
  newlyReady,
  nextCourse,
  summarizeSession,
  tandaNumbers,
  ticketDisplay,
} from '@/lib/pos/order/tickets'
import type { PrepStatus, SessionDetail, SessionItem, SessionTicket } from '@/lib/pos/types'

const NOW = Date.parse('2026-11-13T01:00:00.000Z') // 22:00 en Córdoba
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

let n = 0
function line(prep_status: PrepStatus = 'queued', over: Partial<SessionItem> = {}): SessionItem {
  n++
  return {
    id: `i${n}`,
    menu_item_id: `m${n}`,
    name: `Producto ${n}`,
    quantity: 1,
    unit_price_cents: 1_000_000,
    line_total_cents: 1_000_000,
    notes: null,
    modifiers: [],
    station_id: null,
    prep_status,
    ready_at: prep_status === 'ready' || prep_status === 'served' ? ago(2) : null,
    served_at: prep_status === 'served' ? ago(1) : null,
    cancelled_at: null,
    cancellation_reason: null,
    ...over,
  }
}

function tanda(items: SessionItem[], over: Partial<SessionTicket> = {}): SessionTicket {
  n++
  return {
    id: `t${n}`,
    status: 'accepted',
    course: 1,
    held: false,
    submitted_at: ago(10),
    fired_at: ago(10),
    kitchen_seen_at: null,
    ready_at: null,
    served_at: null,
    total_cents: items.length * 1_000_000,
    items,
    ...over,
  }
}

const cancelled = (prep: PrepStatus = 'queued') =>
  line(prep, { cancelled_at: ago(3), cancellation_reason: 'Error de carga' })

describe('cómo se lee una tanda', () => {
  it('en espera: cargada, cocina no la ve, ningún tilde', () => {
    const display = ticketDisplay(tanda([line()], { held: true, fired_at: null }), NOW)
    expect(display).toMatchObject({ stage: 'held', ticks: 0, word: 'En espera', minutes: 10 })
  })

  it('enviada: un tilde. Cocina la vio: dos', () => {
    expect(ticketDisplay(tanda([line(), line()]), NOW)).toMatchObject({
      stage: 'sent',
      ticks: 1,
      word: 'Enviada',
      minutes: 10,
      late: false,
    })
    expect(ticketDisplay(tanda([line()], { kitchen_seen_at: ago(9) }), NOW)).toMatchObject({
      stage: 'seen',
      ticks: 2,
      word: 'Cocina lo vio',
    })
  })

  it('en preparación apenas cocina empieza un renglón', () => {
    const display = ticketDisplay(tanda([line('preparing'), line('queued')]), NOW)
    expect(display).toMatchObject({ stage: 'preparing', ticks: 2, word: 'En preparación' })
    expect(display.mixed).toBe(true)
  })

  it('lista cuando todo lo que falta llevar está listo; el reloj corre desde que estuvo', () => {
    const display = ticketDisplay(
      tanda([line('ready', { ready_at: ago(4) }), line('ready', { ready_at: ago(2) })]),
      NOW,
    )
    expect(display).toMatchObject({ stage: 'ready', word: 'Lista', minutes: 4, mixed: false })
    expect(ticketDisplay(tanda([line('ready'), line('served')]), NOW).stage).toBe('ready')
  })

  it('lista en parte: algo para llevar y algo todavía en cocina', () => {
    const display = ticketDisplay(tanda([line('ready'), line('preparing')]), NOW)
    expect(display).toMatchObject({ stage: 'partly_ready', word: 'Lista en parte', late: false })
  })

  it('servida cuando no queda nada por llevar', () => {
    expect(ticketDisplay(tanda([line('served'), line('served')]), NOW)).toMatchObject({
      stage: 'served',
      word: 'Servida',
      minutes: null,
    })
  })

  it('con parte servida y parte sin empezar, sigue en preparación', () => {
    expect(ticketDisplay(tanda([line('served'), line('queued')]), NOW).stage).toBe('preparing')
  })

  it('lo dado de baja no cuenta para el estado', () => {
    const display = ticketDisplay(tanda([line('served'), cancelled()]), NOW)
    expect(display.stage).toBe('served')
    expect(display.counts).toMatchObject({ live: 1, cancelled: 1, served: 1 })
    expect(ticketDisplay(tanda([cancelled(), cancelled()]), NOW).stage).toBe('cancelled')
  })

  it('demorada: pasó en cocina más de lo que el bar tolera (20 minutos si no dice otra cosa)', () => {
    expect(ticketDisplay(tanda([line()], { fired_at: ago(19) }), NOW).late).toBe(false)
    expect(ticketDisplay(tanda([line()], { fired_at: ago(20) }), NOW).late).toBe(true)
    expect(ticketDisplay(tanda([line('preparing')], { fired_at: ago(31) }), NOW)).toMatchObject({
      stage: 'preparing',
      minutes: 31,
      late: true,
    })
    expect(
      ticketDisplay(tanda([line()], { fired_at: ago(25) }), NOW, { kitchen_late_minutes: 30 }).late,
    ).toBe(false)
  })

  it('lo listo nunca es «demorado»: lo que apura ahí es llevarlo', () => {
    expect(
      ticketDisplay(tanda([line('ready'), line('queued')], { fired_at: ago(45) }), NOW).late,
    ).toBe(false)
  })

  it('cuenta los renglones por estado', () => {
    expect(
      countLines(
        tanda([line('queued'), line('preparing'), line('ready'), line('served'), cancelled()]),
      ),
    ).toEqual({ live: 4, queued: 1, preparing: 1, ready: 1, served: 1, cancelled: 1 })
    expect(lineState(cancelled('ready'))).toBe('cancelled')
  })
})

describe('números de tanda', () => {
  const withCourses = (...courses: number[]) => courses.map((course) => ({ course }))

  it('la primera tanda es la 1; cada una que sigue, una más (vaya ahora o quede en espera)', () => {
    expect(nextCourse([])).toBe(1)
    expect(nextCourse(withCourses(1))).toBe(2)
    expect(nextCourse(withCourses(1, 2, 3))).toBe(4)
  })

  it('cuenta las que todavía no confirmó el servidor', () => {
    expect(nextCourse(withCourses(1), [2])).toBe(3)
    expect(nextCourse([], [1, 2])).toBe(3)
  })

  it('si una tanda del medio se dio de baja entera, no se reusa su número', () => {
    expect(nextCourse(withCourses(1, 3))).toBe(4)
  })

  it('el servidor acepta hasta el tiempo 9', () => {
    expect(nextCourse(withCourses(9))).toBe(9)
    expect(nextCourse(withCourses(8), [9, 9])).toBe(9)
  })

  it('el número que se muestra es el tiempo, y si se repite sigue contando', () => {
    expect(tandaNumbers([1, 2, 3])).toEqual([1, 2, 3])
    expect(tandaNumbers([1, 3])).toEqual([1, 3])
    expect(tandaNumbers([1, 2, 2])).toEqual([1, 2, 3])
    expect(tandaNumbers([8, 9, 9, 9])).toEqual([8, 9, 10, 11])
    expect(tandaNumbers([])).toEqual([])
  })
})

describe('la mesa entera', () => {
  it('resume qué hay en cocina, qué está listo y qué espera', () => {
    const ready = line('ready', { quantity: 2, name: 'Mojito' })
    const alsoReady = line('ready', { name: 'Lomo del Chef' })
    const held = tanda([line()], { held: true, fired_at: null })
    const summary = summarizeSession([
      tanda([line('served'), ready, cancelled('ready')]),
      tanda([line('queued'), line('preparing'), alsoReady]),
      held,
      tanda([cancelled()]),
    ])
    expect(summary).toMatchObject({
      inKitchen: 2,
      readyUnits: 3,
      readyItemIds: [ready.id, alsoReady.id],
      // Lo que hay que llevar, para leerlo sin buscar la tanda.
      readyLabel: '2 Mojito · 1 Lomo del Chef',
      servedLines: 1,
      hasOrders: true,
    })
    expect(summary.held.map((t) => t.id)).toEqual([held.id])
  })

  it('una mesa sin tandas vivas no tiene pedidos', () => {
    expect(summarizeSession([])).toMatchObject({ hasOrders: false, readyLabel: '' })
    expect(summarizeSession([tanda([cancelled()])]).hasOrders).toBe(false)
  })
})

describe('el botón que manda abajo', () => {
  const held = tanda([line()], { held: true, fired_at: null })
  const cooking = tanda([line('preparing')])
  const ready = tanda([line('ready', { quantity: 3 })])
  const served = tanda([line('served')])

  it('con un borrador, enviar gana sobre todo lo demás', () => {
    expect(barPrimary(4, summarizeSession([ready, held]))).toEqual({ kind: 'send', units: 4 })
  })

  it('sin borrador y con algo listo: servido', () => {
    expect(barPrimary(0, summarizeSession([ready, held, cooking]))).toMatchObject({
      kind: 'serve',
      units: 3,
    })
  })

  it('sin nada en cocina y con una tanda en espera: marchar la más vieja', () => {
    const second = tanda([line()], { held: true, fired_at: null, course: 3 })
    expect(barPrimary(0, summarizeSession([served, held, second]))).toEqual({
      kind: 'fire',
      ticketId: held.id,
    })
  })

  it('mientras cocina siga con algo, la que espera no se ofrece abajo', () => {
    expect(barPrimary(0, summarizeSession([cooking, held]))).toEqual({ kind: 'add' })
  })

  it('sin nada pendiente, lo que sigue es agregar', () => {
    expect(barPrimary(0, summarizeSession([]))).toEqual({ kind: 'add' })
    expect(barPrimary(0, summarizeSession([served]))).toEqual({ kind: 'add' })
  })
})

describe('aviso de comida lista', () => {
  it('solo lo que pasó a listo desde la última lectura', () => {
    const a = line('ready')
    const b = line('ready')
    const tickets = [tanda([a, b, line('queued')])]
    expect(newlyReady(new Set(), tickets)).toEqual([a.id, b.id])
    expect(newlyReady(new Set([a.id]), tickets)).toEqual([b.id])
    expect(newlyReady(new Set([a.id, b.id]), tickets)).toEqual([])
  })
})

describe('lo que el mozo acaba de tocar', () => {
  const queued = line('queued')
  const ready = line('ready')
  const gone = cancelled('ready')
  const waiting = tanda([line()], { held: true, fired_at: null })
  const detail: SessionDetail = {
    now: ago(0),
    session: {
      id: 's1',
      status: 'open',
      branch_id: 'b1',
      table_id: 't1',
      opened_at: ago(30),
      party_size: 4,
      alias: 'Martín',
      note: null,
      bill_requested_at: null,
      total_cents: 3_000_000,
      is_practice: false,
      kind: 'table',
      paid_at: null,
    },
    table: { id: 't1', label: '12', capacity: 4, area: 'Salón' },
    reservation: null,
    customer: null,
    tickets: [tanda([queued, ready, gone]), waiting],
  }

  it('sin cambios devuelve lo mismo, sin copiar', () => {
    expect(applyOverlay(detail, NO_OVERLAY, ago(0))).toBe(detail)
  })

  it('servido: el renglón pasa a servido al toque (lo dado de baja no se toca)', () => {
    const next = applyOverlay(detail, { ...NO_OVERLAY, served: [ready.id, gone.id] }, ago(0))
    expect(next.tickets[0]?.items.map((i) => [i.prep_status, i.served_at !== null])).toEqual([
      ['queued', false],
      ['served', true],
      ['ready', false],
    ])
    expect(next.tickets[1]).toBe(waiting)
    expect(summarizeSession(next.tickets).readyUnits).toBe(0)
  })

  it('marchar: la tanda en espera sale ya', () => {
    const next = applyOverlay(detail, { ...NO_OVERLAY, fired: [waiting.id] }, ago(0))
    expect(next.tickets[1]).toMatchObject({ held: false, fired_at: ago(0) })
    expect(ticketDisplay(next.tickets[1] as SessionTicket, NOW).stage).toBe('sent')
  })

  it('cuenta, comensales y nombre', () => {
    const next = applyOverlay(
      detail,
      { ...NO_OVERLAY, bill: true, partySize: 6, alias: null },
      ago(0),
    )
    expect(next.session).toMatchObject({ bill_requested_at: ago(0), party_size: 6, alias: null })
    const off = applyOverlay(
      { ...detail, session: { ...detail.session, bill_requested_at: ago(5) } },
      { ...NO_OVERLAY, bill: false },
      ago(0),
    )
    expect(off.session.bill_requested_at).toBeNull()
    expect(off.session.alias).toBe('Martín')
  })
})

describe('reloj', () => {
  it('la hora es la del bar, no la del celular', () => {
    expect(clockAt('2026-11-13T01:34:00.000Z', 'America/Argentina/Cordoba')).toBe('22:34')
    expect(clockAt('2026-11-13T03:05:00.000Z', 'America/Argentina/Cordoba')).toBe('00:05')
    expect(clockAt('2026-11-13T01:34:00.000Z', 'UTC')).toBe('01:34')
    expect(clockAt(null, 'UTC')).toBe('')
    expect(clockAt('no es una fecha', 'UTC')).toBe('')
  })

  it('minutos enteros, nunca negativos', () => {
    expect(minutesSince(ago(9), NOW)).toBe(9)
    expect(minutesSince(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0)
    expect(minutesSince(null, NOW)).toBeNull()
  })
})
