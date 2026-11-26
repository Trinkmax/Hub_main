import { describe, expect, it } from 'vitest'
import {
  ageLevel,
  elapsedMinutes,
  elapsedText,
  formatElapsed,
  kitchenThresholds,
} from '@/lib/pos/kitchen/age'
import {
  advanceTarget,
  applyItemsMove,
  buildCards,
  buildTableCards,
  hasExpired,
  itemsToMove,
  kitchenAlerts,
  knownTickets,
  NO_CATEGORY_LABEL,
  newArrivals,
  PRIORITY_LABEL,
  READY_LINGER_MS,
  showsStation,
  totalsOf,
  undoTarget,
  unseenTickets,
} from '@/lib/pos/kitchen/cards'
import type { KitchenItem, KitchenQueue, KitchenTicket, PrepStatus } from '@/lib/pos/types'

const NOW = Date.parse('2026-11-13T01:00:00.000Z') // 22:00 en Córdoba
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const COCINA = 'st-cocina'
const FRIOS = 'st-frios'
const BARRA = 'st-barra'

let serial = 0
function item(over: Partial<KitchenItem> = {}): KitchenItem {
  serial += 1
  return {
    id: `i${serial}`,
    menu_item_id: `m-${over.name ?? 'lomito'}`,
    name: 'Lomito',
    quantity: 1,
    notes: null,
    modifiers: [],
    station_id: COCINA,
    prep_status: 'queued',
    started_at: null,
    ready_at: null,
    ...over,
  }
}

function ticket(over: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: 't1',
    session_id: 's1',
    status: 'accepted',
    course: 1,
    fired_at: ago(5),
    ready_at: null,
    kitchen_seen_at: ago(5),
    is_practice: false,
    table_label: '12',
    area: 'Salón',
    alias: null,
    party_size: 4,
    kind: 'table',
    event: null,
    alerts: null,
    items: [item()],
    ...over,
  }
}

function queue(tickets: KitchenTicket[], over: Partial<KitchenQueue> = {}): KitchenQueue {
  return {
    now: new Date(NOW).toISOString(),
    branch: { id: 'b1', name: 'Cerro', color: '#14532d' },
    settings: { kitchen_warn_minutes: 12, kitchen_late_minutes: 20 },
    stations: [
      { id: COCINA, name: 'Cocina', color: '#b45309' },
      { id: FRIOS, name: 'Fríos', color: '#0e7490' },
      { id: BARRA, name: 'Barra', color: '#6d28d9' },
    ],
    tickets,
    ...over,
  }
}

const one = (t: KitchenTicket, filter: string[] = []) => buildCards(queue([t]), filter)[0]

describe('qué muestra cada pantalla', () => {
  it('sin filtro muestra todo; con filtro, solo sus estaciones', () => {
    expect(showsStation([], BARRA)).toBe(true)
    expect(showsStation([COCINA], BARRA)).toBe(false)
    expect(showsStation([COCINA, BARRA], BARRA)).toBe(true)
  })

  it('lo que no tiene estación va a todas las pantallas (igual que la base al avanzar)', () => {
    expect(showsStation([BARRA], null)).toBe(true)
  })

  it('los renglones de otras estaciones quedan en una línea al pie, en unidades', () => {
    const card = one(
      ticket({
        items: [
          item({ name: 'Lomito', quantity: 2 }),
          item({ name: 'Negroni', station_id: BARRA, quantity: 2, prep_status: 'ready' }),
          item({ name: 'Mojito', station_id: BARRA, quantity: 1, prep_status: 'ready' }),
        ],
      }),
      [COCINA],
    )
    expect(card?.lines.map((l) => l.name)).toEqual(['Lomito'])
    expect(card?.others).toEqual([
      {
        stationId: BARRA,
        name: 'Barra',
        color: '#6d28d9',
        kind: null,
        icon: null,
        quantity: 3,
        status: 'ready',
      },
    ])
  })

  it('el pie dice el estado del renglón más atrasado de esa estación', () => {
    const card = one(
      ticket({
        items: [
          item(),
          item({ station_id: BARRA, prep_status: 'ready' }),
          item({ station_id: BARRA, prep_status: 'preparing' }),
          item({ station_id: FRIOS, prep_status: 'served' }),
        ],
      }),
      [COCINA],
    )
    expect(card?.others.map((o) => [o.name, o.status])).toEqual([
      ['Fríos', 'served'],
      ['Barra', 'preparing'],
    ])
  })

  it('una estación que ya no existe en la carta se nombra igual', () => {
    const card = one(ticket({ items: [item(), item({ station_id: 'st-vieja' })] }), [COCINA])
    expect(card?.others[0]).toMatchObject({ name: 'Otra estación', color: null, quantity: 1 })
  })

  it('si nada de la tanda es de esta pantalla, no hay comanda', () => {
    const cards = buildCards(queue([ticket({ items: [item({ station_id: BARRA })] })]), [COCINA])
    expect(cards).toEqual([])
  })

  it('si ya se llevaron todo lo de esta pantalla, la comanda se va aunque otra estación siga', () => {
    const t = ticket({
      status: 'preparing',
      items: [
        item({ prep_status: 'served' }),
        item({ station_id: BARRA, prep_status: 'preparing' }),
      ],
    })
    expect(buildCards(queue([t]), [COCINA])).toEqual([])
    expect(buildCards(queue([t]), [BARRA])).toHaveLength(1)
  })
})

describe('estado de la comanda', () => {
  const statusOf = (statuses: PrepStatus[], filter: string[] = []) =>
    one(ticket({ items: statuses.map((prep_status) => item({ prep_status })) }), filter)?.status

  it('es el del renglón más atrasado: si falta uno, la mesa no sale', () => {
    expect(statusOf(['queued', 'queued'])).toBe('queued')
    expect(statusOf(['preparing', 'queued'])).toBe('queued')
    expect(statusOf(['preparing', 'ready'])).toBe('preparing')
    expect(statusOf(['ready', 'ready'])).toBe('ready')
  })

  it('lo ya entregado no cuenta para el estado, pero sigue en la comanda', () => {
    const card = one(
      ticket({ items: [item({ prep_status: 'served' }), item({ prep_status: 'ready' })] }),
    )
    expect(card?.status).toBe('ready')
    expect(card?.lines.map((l) => l.status)).toEqual(['served', 'ready'])
  })

  it('solo mira los renglones de esta pantalla', () => {
    const t = ticket({
      items: [item({ prep_status: 'ready' }), item({ station_id: BARRA, prep_status: 'queued' })],
    })
    expect(one(t, [COCINA])?.status).toBe('ready')
    expect(one(t, [BARRA])?.status).toBe('queued')
    expect(one(t)?.status).toBe('queued')
  })

  it('lista desde su último renglón terminado', () => {
    const card = one(
      ticket({
        items: [
          item({ prep_status: 'ready', ready_at: ago(4) }),
          item({ prep_status: 'ready', ready_at: ago(2) }),
        ],
      }),
    )
    expect(card?.doneMs).toBe(Date.parse(ago(2)))
  })

  it('sin hora en los renglones usa la de la tanda', () => {
    const card = one(ticket({ ready_at: ago(3), items: [item({ prep_status: 'ready' })] }))
    expect(card?.doneMs).toBe(Date.parse(ago(3)))
  })

  it('lo listo se deja de mostrar a los diez minutos, aunque la tanda siga abierta por otra estación', () => {
    const t = ticket({
      status: 'preparing',
      items: [
        item({ prep_status: 'ready', ready_at: ago(11) }),
        item({ station_id: BARRA, prep_status: 'preparing' }),
      ],
    })
    const card = one(t, [COCINA])
    expect(card).toBeDefined()
    if (!card) return
    expect(hasExpired(card, NOW)).toBe(true)
    expect(hasExpired(card, Date.parse(ago(11)) + READY_LINGER_MS)).toBe(false)
  })

  it('lo que no está listo no vence nunca', () => {
    const card = one(ticket({ fired_at: ago(90) }))
    expect(card && hasExpired(card, NOW)).toBe(false)
  })
})

describe('la comanda', () => {
  it('va en orden de llegada, sin importar el estado', () => {
    const cards = buildCards(
      queue([
        ticket({ id: 'c', fired_at: ago(2) }),
        ticket({ id: 'a', fired_at: ago(9), items: [item({ prep_status: 'ready' })] }),
        ticket({ id: 'b', fired_at: ago(6), items: [item({ prep_status: 'preparing' })] }),
      ]),
      [],
    )
    expect(cards.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('dos tandas que salieron a la vez se ordenan por id, como en la base', () => {
    const at = ago(4)
    const cards = buildCards(
      queue([ticket({ id: 'z', fired_at: at }), ticket({ id: 'k', fired_at: at })]),
      [],
    )
    expect(cards.map((c) => c.id)).toEqual(['k', 'z'])
  })

  it('el número de mesa va enorme; una etiqueta larga pide menos lugar', () => {
    expect(one(ticket({ table_label: '7' }))).toMatchObject({
      title: '7',
      titleFit: 'big',
      spoken: 'la mesa 7',
      where: 'Salón',
    })
    expect(one(ticket({ table_label: 'VIP 2' }))?.titleFit).toBe('mid')
    expect(one(ticket({ table_label: 'Barra alta' }))).toMatchObject({
      titleFit: 'small',
      spoken: 'la mesa Barra alta',
    })
  })

  it('sin mesa manda el nombre de quien pidió', () => {
    const quick = one(ticket({ table_label: null, area: null, kind: 'quick', alias: ' Martín ' }))
    expect(quick).toMatchObject({
      title: 'Martín',
      spoken: 'el pedido de Martín',
      where: 'Mostrador',
      alias: null,
    })
    const delivery = one(ticket({ table_label: null, area: null, kind: 'delivery', alias: null }))
    expect(delivery).toMatchObject({ title: 'Delivery', spoken: 'el delivery', where: null })
    const loose = one(ticket({ table_label: ' ', kind: 'table', alias: null }))
    expect(loose).toMatchObject({ title: 'Sin mesa', spoken: 'el pedido sin mesa' })
  })

  it('la segunda tanda de una mesa se nombra distinto de la primera', () => {
    expect(one(ticket({ table_label: '13', course: 1 }))?.spoken).toBe('la mesa 13')
    expect(one(ticket({ table_label: '13', course: 2 }))?.spoken).toBe('la tanda 2 de la mesa 13')
    const quick = ticket({ table_label: null, kind: 'quick', alias: 'Martín', course: 3 })
    expect(one(quick)?.spoken).toBe('la tanda 3 del pedido de Martín')
  })

  it('lleva las aclaraciones y la nota de cada renglón', () => {
    const card = one(
      ticket({
        items: [
          item({
            modifiers: [
              { id: 'o1', label: 'Jugoso', group: 'Punto', delta_cents: 0 },
              { id: 'o2', label: ' Sin lechuga ', group: 'Sin', delta_cents: 0 },
            ],
            notes: '  para compartir ',
          }),
        ],
      }),
    )
    expect(card?.lines[0]).toMatchObject({
      modifiers: ['Jugoso', 'Sin lechuga'],
      notes: 'para compartir',
    })
  })

  it('si mezcla estaciones, junta los renglones por estación y les pone el rótulo', () => {
    const card = one(
      ticket({
        items: [
          item({ name: 'Muzzarella' }),
          item({ name: 'Negroni', station_id: BARRA }),
          item({ name: 'Lomo' }),
          item({ name: 'Pan', station_id: null }),
        ],
      }),
    )
    expect(card?.groups.map((g) => [g.label, g.lines.map((l) => l.name)])).toEqual([
      ['Cocina', ['Muzzarella', 'Lomo']],
      ['Barra', ['Negroni']],
      ['Sin estación', ['Pan']],
    ])
  })

  it('de una sola estación no lleva rótulo', () => {
    const card = one(ticket({ items: [item(), item()] }))
    expect(card?.groups).toHaveLength(1)
    expect(card?.groups[0]?.label).toBeNull()
  })

  it('personas y tanda con valores sanos', () => {
    expect(one(ticket({ party_size: 0, course: 0 }))).toMatchObject({ partySize: null, course: 1 })
    expect(one(ticket({ party_size: 8, course: 2 }))).toMatchObject({ partySize: 8, course: 2 })
  })

  it('«cocina lo vio» no cambia lo que se dibuja; el estado sí', () => {
    const base = ticket({ kitchen_seen_at: null })
    const seen = { ...base, kitchen_seen_at: ago(1) }
    const started = {
      ...base,
      items: base.items.map((i) => ({ ...i, prep_status: 'preparing' as const })),
    }
    expect(one(base)?.seen).toBe(false)
    expect(one(seen)?.seen).toBe(true)
    expect(one(base)?.signature).toBe(one(seen)?.signature)
    expect(one(base)?.signature).not.toBe(one(started)?.signature)
  })

  it('marca las mesas de práctica', () => {
    expect(one(ticket({ is_practice: true }))?.isPractice).toBe(true)
    expect(one(ticket())?.isPractice).toBe(false)
  })
})

describe('productos iguales, juntos', () => {
  const mod = (label: string) => ({ id: label, label, group: 'Aclaraciones', delta_cents: 0 })
  const linesOf = (items: KitchenItem[]) => {
    const [card] = buildCards(queue([ticket({ items })]), [])
    return card?.lines ?? []
  }

  it('dos renglones del mismo producto, sin aclaraciones: uno solo con la suma', () => {
    const lines = linesOf([
      item({ name: 'Cheese Burger' }),
      item({ name: 'Lomito' }),
      item({ name: 'Cheese Burger', quantity: 2 }),
    ])
    expect(lines.map((line) => [line.quantity, line.name])).toEqual([
      [3, 'Cheese Burger'],
      [1, 'Lomito'],
    ])
    expect(lines[0]?.variants).toEqual([])
    expect(lines[0]?.itemIds).toHaveLength(2)
  })

  it('todas con la misma aclaración: va una sola vez, en el renglón', () => {
    const [line] = linesOf([
      item({ name: 'Cheese Burger', modifiers: [mod('Sin cebolla')] }),
      item({ name: 'Cheese Burger', modifiers: [mod('Sin cebolla')] }),
    ])
    expect(line).toMatchObject({ quantity: 2, modifiers: ['Sin cebolla'], variants: [] })
  })

  it('el mismo producto pedido distinto: un renglón, y cada forma con su cantidad', () => {
    const [line, other] = linesOf([
      item({ name: 'Cheese Burger' }),
      item({ name: 'Cheese Burger', modifiers: [mod('Sin TACC')] }),
      item({ name: 'Cheese Burger', modifiers: [mod('Papas rústicas')], notes: 'bien cocida' }),
      item({ name: 'Cheese Burger', modifiers: [mod('Sin TACC')], quantity: 2 }),
    ])
    expect(other).toBeUndefined()
    expect(line).toMatchObject({ quantity: 5, name: 'Cheese Burger', modifiers: [], notes: null })
    // La que va sin nada queda última: lo que hay que mirar son las aclaraciones.
    expect(line?.variants).toEqual([
      { quantity: 3, modifiers: ['Sin TACC'], notes: null },
      { quantity: 1, modifiers: ['Papas rústicas'], notes: 'bien cocida' },
      { quantity: 1, modifiers: [], notes: null },
    ])
  })

  it('las mismas aclaraciones en otro orden o con otra mayúscula son la misma forma', () => {
    const [line] = linesOf([
      item({
        name: 'Lomito',
        modifiers: [mod('Jugoso'), mod('Sin lechuga')],
        notes: 'Para compartir',
      }),
      item({
        name: 'Lomito',
        modifiers: [mod('sin lechuga'), mod('Jugoso')],
        notes: 'para compartir',
      }),
    ])
    expect(line).toMatchObject({ quantity: 2, variants: [] })
    expect(line?.modifiers).toEqual(['Jugoso', 'Sin lechuga'])
  })

  it('lo que ya salió no se junta con lo que falta: la marca de listo sigue siendo verdad', () => {
    const lines = linesOf([
      item({ name: 'Lomito', prep_status: 'ready', ready_at: ago(1) }),
      item({ name: 'Lomito', prep_status: 'preparing' }),
    ])
    expect(lines.map((line) => [line.quantity, line.status])).toEqual([
      [1, 'ready'],
      [1, 'preparing'],
    ])
  })

  it('el mismo producto en dos estaciones queda en la suya', () => {
    const [card] = buildCards(
      queue([
        ticket({
          items: [
            item({ name: 'Papas', station_id: COCINA }),
            item({ name: 'Papas', station_id: FRIOS }),
            item({ name: 'Papas', station_id: COCINA }),
          ],
        }),
      ]),
      [],
    )
    expect(card?.groups.map((group) => group.lines.map((line) => line.quantity))).toEqual([
      [2],
      [1],
    ])
  })

  it('los totales de la tira cuentan igual que antes de juntar', () => {
    const cards = buildCards(
      queue([
        ticket({
          items: [
            item({ name: 'Cheese Burger' }),
            item({ name: 'Cheese Burger', modifiers: [mod('Sin cebolla')], quantity: 2 }),
          ],
        }),
      ]),
      [],
    )
    expect(totalsOf(cards)).toEqual([
      { menuItemId: 'm-Cheese Burger', name: 'Cheese Burger', quantity: 3 },
    ])
  })
})

describe('avisos de la mesa', () => {
  it('en castellano, lo de salud primero', () => {
    expect(kitchenAlerts(['vegan', 'allergy', 'celiac'])).toEqual([
      { key: 'celiac', label: 'Celíaco · sin TACC', critical: true },
      { key: 'allergy', label: 'Alergia', critical: true },
      { key: 'vegan', label: 'Vegano', critical: false },
    ])
    expect(kitchenAlerts(['vegetarian'])[0]).toMatchObject({
      label: 'Vegetariano',
      critical: false,
    })
  })

  it('lo que es del salón no va a la cocina', () => {
    expect(kitchenAlerts(['baby_seat', 'reduced_mobility'])).toEqual([])
  })

  it('un aviso desconocido se muestra igual, y fuerte', () => {
    expect(kitchenAlerts(['sin_lactosa'])).toEqual([
      { key: 'sin_lactosa', label: 'sin lactosa', critical: true },
    ])
  })

  it('sin avisos, repetidos o basura', () => {
    expect(kitchenAlerts(null)).toEqual([])
    expect(kitchenAlerts([])).toEqual([])
    expect(kitchenAlerts(['celiac', 'celiac', ''])).toHaveLength(1)
  })

  it('llegan a la comanda', () => {
    expect(one(ticket({ alerts: ['celiac'] }))?.alerts.map((a) => a.key)).toEqual(['celiac'])
  })
})

describe('avanzar y deshacer', () => {
  it('avanzar: nuevo → en preparación → listo, y ahí termina', () => {
    expect(advanceTarget('queued')).toBe('preparing')
    expect(advanceTarget('preparing')).toBe('ready')
    expect(advanceTarget('ready')).toBeNull()
  })

  it('deshacer: un paso para atrás; lo nuevo no tiene a dónde volver', () => {
    expect(undoTarget('ready')).toBe('preparing')
    expect(undoTarget('preparing')).toBe('queued')
    expect(undoTarget('queued')).toBeNull()
  })

  const ids = (q: KitchenQueue) => new Set(q.tickets.flatMap((t) => t.items.map((i) => i.id)))

  it('mueve al instante los renglones pedidos que no están servidos, con sus horas', () => {
    const q = queue([
      ticket({ items: [item(), item({ prep_status: 'served' }), item({ station_id: BARRA })] }),
    ])
    const at = ago(0)
    const started = applyItemsMove(q, ids(q), { to: 'preparing' }, at)
    expect(started.tickets[0]?.items.map((i) => i.prep_status)).toEqual([
      'preparing',
      'served',
      'preparing',
    ])
    expect(started.tickets[0]?.items[0]?.started_at).toBe(at)
    expect(started.tickets[0]?.status).toBe('preparing')

    const ready = applyItemsMove(started, ids(q), { to: 'ready' }, at)
    expect(ready.tickets[0]?.items.map((i) => i.prep_status)).toEqual(['ready', 'served', 'ready'])
    expect(ready.tickets[0]?.items[0]?.ready_at).toBe(at)
    expect(ready.tickets[0]).toMatchObject({ status: 'ready', ready_at: at })
    expect(buildCards(ready, [])[0]?.status).toBe('ready')
  })

  it('mover los de una estación no toca los de otra', () => {
    const bar = item({ station_id: BARRA })
    const q = queue([ticket({ items: [item(), bar] })])
    const next = applyItemsMove(q, new Set([bar.id]), { to: 'ready' }, ago(0))
    expect(next.tickets[0]?.items.map((i) => i.prep_status)).toEqual(['queued', 'ready'])
    // La tanda no está lista: cocina todavía no empezó.
    expect(next.tickets[0]?.status).toBe('preparing')
    expect(buildCards(next, [BARRA])[0]?.status).toBe('ready')
    expect(buildCards(next, [COCINA])[0]?.status).toBe('queued')
  })

  it('deshacer saca las horas que ya no valen', () => {
    const q = queue([
      ticket({
        status: 'ready',
        ready_at: ago(1),
        items: [item({ prep_status: 'ready', started_at: ago(6), ready_at: ago(1) })],
      }),
    ])
    const back = applyItemsMove(q, ids(q), { to: 'preparing' }, ago(0))
    expect(back.tickets[0]?.items[0]).toMatchObject({
      prep_status: 'preparing',
      started_at: ago(6),
      ready_at: null,
    })
    expect(back.tickets[0]).toMatchObject({ status: 'preparing', ready_at: null })

    const fresh = applyItemsMove(back, ids(q), { to: 'queued' }, ago(0))
    expect(fresh.tickets[0]?.items[0]).toMatchObject({ prep_status: 'queued', started_at: null })
    expect(fresh.tickets[0]?.status).toBe('accepted')
  })

  it('pasar de estación: llega como nuevo, salvo que además se diga un paso', () => {
    const cooking = item({ prep_status: 'preparing', started_at: ago(3) })
    const q = queue([ticket({ status: 'preparing', items: [cooking] })])
    const moved = applyItemsMove(q, new Set([cooking.id]), { stationId: BARRA }, ago(0))
    expect(moved.tickets[0]?.items[0]).toMatchObject({
      station_id: BARRA,
      prep_status: 'queued',
      started_at: null,
    })
    const kept = applyItemsMove(
      q,
      new Set([cooking.id]),
      { stationId: BARRA, to: 'preparing' },
      ago(0),
    )
    expect(kept.tickets[0]?.items[0]).toMatchObject({ station_id: BARRA, prep_status: 'preparing' })
    // A la estación en la que ya está: nada cambia.
    expect(applyItemsMove(q, new Set([cooking.id]), { stationId: COCINA }, ago(0))).toBe(q)
  })

  it('si no hay nada que mover devuelve la misma cola', () => {
    const q = queue([ticket({ items: [item({ prep_status: 'preparing' })] })])
    expect(applyItemsMove(q, ids(q), { to: 'preparing' }, ago(0))).toBe(q)
    expect(applyItemsMove(q, new Set(['otro']), { to: 'ready' }, ago(0))).toBe(q)
    expect(applyItemsMove(q, new Set(), { to: 'ready' }, ago(0))).toBe(q)
    expect(applyItemsMove(q, ids(q), {}, ago(0))).toBe(q)
  })

  it('no toca las otras tandas', () => {
    const other = ticket({ id: 't2' })
    const first = ticket()
    const q = queue([first, other])
    const mine = new Set(first.items.map((i) => i.id))
    expect(applyItemsMove(q, mine, { to: 'preparing' }, ago(0)).tickets[1]).toBe(other)
  })

  it('qué renglones mueve una comanda: al avanzar los atrasados, al volver los de su paso', () => {
    const q = queue([
      ticket({
        items: [
          item({ id: 'a' }),
          item({ id: 'b', name: 'Papas', prep_status: 'preparing' }),
          item({ id: 'c', name: 'Flan', prep_status: 'ready' }),
          item({ id: 'd', name: 'Agua', prep_status: 'served' }),
        ],
      }),
    ])
    const card = buildTableCards(q, [])[0]
    if (!card) throw new Error('sin comanda')
    expect(card.status).toBe('queued')
    expect(itemsToMove(card, 'preparing')).toEqual(['a'])
    expect(itemsToMove(card, 'ready').sort()).toEqual(['a', 'b'])
    const cooking = buildTableCards(
      applyItemsMove(q, new Set(['a']), { to: 'preparing' }, ago(0)),
      [],
    )[0]
    if (!cooking) throw new Error('sin comanda')
    expect(cooking.status).toBe('preparing')
    // Volver atrás: los que están en «en preparación»; lo listo y lo entregado no se tocan.
    expect(itemsToMove(cooking, 'queued').sort()).toEqual(['a', 'b'])
  })
})

describe('la tira de totales', () => {
  it('suma por producto entre todas las comandas, de más a menos', () => {
    const cards = buildCards(
      queue([
        ticket({
          id: 'a',
          items: [item({ name: 'Bacon', quantity: 5 }), item({ name: 'Papas', quantity: 1 })],
        }),
        ticket({
          id: 'b',
          items: [
            item({ name: 'Bacon', quantity: 3, prep_status: 'preparing' }),
            item({ name: 'Lomito', quantity: 5 }),
            item({ name: 'Papas', quantity: 2 }),
          ],
        }),
      ]),
      [],
    )
    expect(totalsOf(cards).map((t) => `${t.quantity} ${t.name}`)).toEqual([
      '8 Bacon',
      '5 Lomito',
      '3 Papas',
    ])
  })

  it('solo lo que falta: lo listo y lo entregado no cuentan', () => {
    const cards = buildCards(
      queue([
        ticket({
          items: [
            item({ name: 'Bacon', quantity: 2 }),
            item({ name: 'Bacon', quantity: 4, prep_status: 'ready' }),
            item({ name: 'Papas', quantity: 1, prep_status: 'served' }),
          ],
        }),
      ]),
      [],
    )
    expect(totalsOf(cards)).toEqual([{ menuItemId: 'm-Bacon', name: 'Bacon', quantity: 2 }])
  })

  it('solo las estaciones de esta pantalla', () => {
    const q = queue([
      ticket({
        items: [
          item({ name: 'Lomito', quantity: 2 }),
          item({ name: 'Negroni', quantity: 3, station_id: BARRA }),
        ],
      }),
    ])
    expect(totalsOf(buildCards(q, [BARRA])).map((t) => t.name)).toEqual(['Negroni'])
    expect(totalsOf(buildCards(q, [])).map((t) => t.name)).toEqual(['Negroni', 'Lomito'])
  })

  it('a igual cantidad, por nombre', () => {
    const cards = buildCards(
      queue([ticket({ items: [item({ name: 'Ñoquis' }), item({ name: 'Bacon' })] })]),
      [],
    )
    expect(totalsOf(cards).map((t) => t.name)).toEqual(['Bacon', 'Ñoquis'])
  })

  it('sin comandas no hay nada', () => {
    expect(totalsOf([])).toEqual([])
  })
})

describe('el reloj', () => {
  it('cuenta minutos enteros y nunca da negativo', () => {
    expect(elapsedMinutes(Date.parse(ago(7)), NOW)).toBe(7)
    expect(elapsedMinutes(NOW - 119_000, NOW)).toBe(1)
    expect(elapsedMinutes(NOW + 60_000, NOW)).toBe(0)
    expect(elapsedMinutes(Number.NaN, NOW)).toBe(0)
  })

  it('ámbar y rojo a los minutos configurados', () => {
    const settings = { kitchen_warn_minutes: 12, kitchen_late_minutes: 20 }
    expect(ageLevel(11, settings)).toBe('ok')
    expect(ageLevel(12, settings)).toBe('warn')
    expect(ageLevel(19, settings)).toBe('warn')
    expect(ageLevel(20, settings)).toBe('late')
  })

  it('sin configuración usa 12 y 20', () => {
    expect(kitchenThresholds(null)).toEqual({ warn: 12, late: 20 })
    expect(ageLevel(12, null)).toBe('warn')
    expect(ageLevel(20, null)).toBe('late')
  })

  it('con minutos propios del bar', () => {
    const settings = { kitchen_warn_minutes: 5, kitchen_late_minutes: 8 }
    expect(ageLevel(4, settings)).toBe('ok')
    expect(ageLevel(5, settings)).toBe('warn')
    expect(ageLevel(8, settings)).toBe('late')
  })

  it('una configuración al revés o rota no rompe el reloj', () => {
    expect(kitchenThresholds({ kitchen_warn_minutes: 20, kitchen_late_minutes: 10 })).toEqual({
      warn: 10,
      late: 20,
    })
    expect(kitchenThresholds({ kitchen_warn_minutes: 0, kitchen_late_minutes: -3 })).toEqual({
      warn: 12,
      late: 20,
    })
  })

  it('se escribe corto', () => {
    expect(formatElapsed(0)).toEqual({ value: '0', unit: 'min' })
    expect(formatElapsed(59)).toEqual({ value: '59', unit: 'min' })
    expect(formatElapsed(65)).toEqual({ value: '1 h 05', unit: '' })
    expect(elapsedText(7)).toBe('7 min')
    expect(elapsedText(125)).toBe('2 h 05')
  })
})

describe('lo que acaba de entrar', () => {
  const cardsOf = (...tickets: KitchenTicket[]) => buildCards(queue(tickets), [])

  it('al prender la pantalla no entró nada: ya estaba', () => {
    expect(newArrivals(null, cardsOf(ticket({ id: 'a' }), ticket({ id: 'b' })))).toEqual([])
  })

  it('detecta las tandas que no estaban en la lectura anterior', () => {
    const before = new Set(['a'])
    const cards = cardsOf(
      ticket({ id: 'a', fired_at: ago(5) }),
      ticket({ id: 'b', fired_at: ago(1) }),
      ticket({ id: 'c', fired_at: ago(0) }),
    )
    expect(newArrivals(before, cards)).toEqual(['b', 'c'])
  })

  it('cambiar de estado no es entrar de nuevo', () => {
    const before = new Set(['a'])
    const cards = cardsOf(ticket({ id: 'a', items: [item({ prep_status: 'preparing' })] }))
    expect(newArrivals(before, cards)).toEqual([])
  })

  it('lo que aparece ya listo no suena', () => {
    const cards = cardsOf(ticket({ id: 'z', items: [item({ prep_status: 'ready' })] }))
    expect(newArrivals(new Set(), cards)).toEqual([])
  })

  it('«cocina lo vio»: avisa una sola vez por tanda', () => {
    const cards = cardsOf(
      ticket({ id: 'a', kitchen_seen_at: null }),
      ticket({ id: 'b', kitchen_seen_at: ago(1) }),
      ticket({ id: 'c', kitchen_seen_at: null }),
    )
    expect(unseenTickets(cards, new Set())).toEqual(['a', 'c'])
    expect(unseenTickets(cards, new Set(['a']))).toEqual(['c'])
    expect(unseenTickets(cards, new Set(['a', 'c']))).toEqual([])
  })
})

// ─── Una comanda por mesa, por rubro y con lo que sale primero (22/11/2026) ──

const PIZZA = { category_id: 'c-pizza', category: 'Pizza', category_order: 1003 }
const MILAS = { category_id: 'c-milas', category: 'Tablas y milanesas', category_order: 1001 }
const TRAGOS = { category_id: 'c-tragos', category: 'Tragos', category_order: 2001 }

describe('una comanda por mesa (la tele)', () => {
  const table = (...tickets: KitchenTicket[]) => buildTableCards(queue(tickets), [])

  it('dos tandas de la misma mesa van en una sola comanda; en el papel siguen siendo dos', () => {
    const tickets = [
      ticket({ id: 't1', session_id: 's1', fired_at: ago(9), items: [item({ name: 'Lomito' })] }),
      ticket({
        id: 't2',
        session_id: 's1',
        course: 2,
        fired_at: ago(2),
        items: [item({ name: 'Flan' })],
      }),
    ]
    const cards = table(...tickets)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ id: 's1', ticketIds: ['t1', 't2'], spoken: 'la mesa 12' })
    expect(cards[0]?.lines.map((l) => l.name)).toEqual(['Lomito', 'Flan'])
    expect(buildCards(queue(tickets), [])).toHaveLength(2)
  })

  it('cada mesa tiene la suya, por orden de llegada', () => {
    const cards = table(
      ticket({ id: 'b1', session_id: 'sB', table_label: '7', fired_at: ago(3) }),
      ticket({ id: 'a1', session_id: 'sA', table_label: '4', fired_at: ago(8) }),
      ticket({ id: 'b2', session_id: 'sB', table_label: '7', fired_at: ago(1) }),
    )
    expect(cards.map((c) => [c.title, c.ticketIds])).toEqual([
      ['4', ['a1']],
      ['7', ['b1', 'b2']],
    ])
  })

  it('el mismo producto pedido en dos tandas sin empezar se suma: x3', () => {
    const [card] = table(
      ticket({ id: 't1', items: [item({ name: 'Muzza', quantity: 2 })] }),
      ticket({ id: 't2', fired_at: ago(1), items: [item({ name: 'Muzza', quantity: 1 })] }),
    )
    expect(card?.lines).toHaveLength(1)
    expect(card?.lines[0]).toMatchObject({ name: 'Muzza', quantity: 3, fresh: false })
    expect(card?.grew).toBe(false)
  })

  it('dar por listo un renglón suelto de la misma tanda no es «se sumó»', () => {
    // La barra tilda la cerveza antes de empezar los tragos: todo salió junto, nadie sumó nada.
    const [card] = table(
      ticket({
        id: 't1',
        fired_at: ago(6),
        items: [
          item({ name: 'Stella', quantity: 2, prep_status: 'ready', ready_at: ago(2) }),
          item({ name: 'Mojito', quantity: 4 }),
        ],
      }),
    )
    expect(card?.status).toBe('queued')
    expect(card?.grew).toBe(false)
    expect(card?.lines.find((line) => line.name === 'Mojito')?.fresh).toBe(false)
  })

  it('lo que se suma a una mesa ya empezada queda aparte y marcado como nuevo', () => {
    const [card] = table(
      ticket({
        id: 't1',
        status: 'preparing',
        fired_at: ago(10),
        items: [item({ name: 'Muzza', quantity: 2, prep_status: 'preparing' })],
      }),
      ticket({
        id: 't2',
        fired_at: ago(1),
        items: [item({ name: 'Muzza' }), item({ name: 'Fugazza' })],
      }),
    )
    // Falta empezar algo: la comanda vuelve a pedir «Empezar», y dice que creció.
    expect(card?.status).toBe('queued')
    expect(card?.grew).toBe(true)
    expect(card?.lines.map((l) => [l.name, l.quantity, l.status, l.fresh])).toEqual([
      ['Muzza', 2, 'preparing', false],
      ['Muzza', 1, 'queued', true],
      ['Fugazza', 1, 'queued', true],
    ])
  })

  it('el reloj corre desde la tanda más vieja que falta terminar', () => {
    const [card] = table(
      ticket({
        id: 't1',
        status: 'ready',
        fired_at: ago(20),
        ready_at: ago(3),
        items: [item({ name: 'Lomito', prep_status: 'ready', ready_at: ago(3) })],
      }),
      ticket({ id: 't2', fired_at: ago(4), items: [item({ name: 'Flan' })] }),
    )
    expect(card?.firedAt).toBe(ago(4))
    expect(card?.status).toBe('queued')
  })

  it('una tanda de la que ya se llevaron todo no vuelve a la comanda', () => {
    const [card] = table(
      ticket({
        id: 't1',
        fired_at: ago(30),
        items: [item({ name: 'Papas', prep_status: 'served' })],
      }),
      ticket({ id: 't2', fired_at: ago(2), items: [item({ name: 'Flan' })] }),
    )
    expect(card?.ticketIds).toEqual(['t2'])
    expect(card?.lines.map((l) => l.name)).toEqual(['Flan'])
  })

  it('«cocina lo vio» se avisa por tanda, aunque la comanda sea una', () => {
    const cards = table(
      ticket({ id: 't1', kitchen_seen_at: ago(5) }),
      ticket({ id: 't2', fired_at: ago(1), kitchen_seen_at: null }),
    )
    expect(cards[0]?.seen).toBe(false)
    expect(unseenTickets(cards, new Set())).toEqual(['t2'])
  })

  it('una mesa que ya tenía comanda y pide algo más también avisa', () => {
    const before = knownTickets(table(ticket({ id: 't1' })))
    const after = table(ticket({ id: 't1' }), ticket({ id: 't2', fired_at: ago(0) }))
    expect(newArrivals(before, after)).toEqual(['s1'])
    expect(newArrivals(knownTickets(after), after)).toEqual([])
  })
})

describe('por rubro, y lo que sale primero arriba', () => {
  it('junta pizzas con pizzas y milanesas con milanesas, en el orden de la carta', () => {
    const card = one(
      ticket({
        items: [
          item({ name: 'Muzza', ...PIZZA }),
          item({ name: 'Mila napo', ...MILAS }),
          item({ name: 'Fugazza', ...PIZZA }),
          item({ name: 'Mila a caballo', ...MILAS }),
        ],
      }),
    )
    expect(card?.groups.map((g) => [g.label, g.lines.map((l) => l.name)])).toEqual([
      ['Tablas y milanesas', ['Mila napo', 'Mila a caballo']],
      ['Pizza', ['Muzza', 'Fugazza']],
    ])
  })

  it('un solo rubro no lleva rótulo', () => {
    const card = one(
      ticket({ items: [item({ name: 'Muzza', ...PIZZA }), item({ name: 'Fugazza', ...PIZZA })] }),
    )
    expect(card?.groups.map((g) => g.label)).toEqual([null])
  })

  it('lo que sale primero va arriba de todo, con su rótulo, aunque sea lo único', () => {
    const card = one(
      ticket({
        items: [
          item({ name: 'Muzza', ...PIZZA }),
          item({ name: 'Rabas', ...MILAS, priority: true }),
          item({ name: 'Negroni', ...TRAGOS }),
        ],
      }),
    )
    expect(card?.groups.map((g) => [g.label, g.priority, g.lines.map((l) => l.name)])).toEqual([
      [PRIORITY_LABEL, true, ['Rabas']],
      ['Pizza', false, ['Muzza']],
      ['Tragos', false, ['Negroni']],
    ])
    const alone = one(ticket({ items: [item({ name: 'Rabas', ...MILAS, priority: true })] }))
    expect(alone?.groups.map((g) => [g.label, g.priority])).toEqual([[PRIORITY_LABEL, true]])
  })

  it('lo que quedó sin rubro va al final, como «Otros»', () => {
    const card = one(
      ticket({ items: [item({ name: 'Cubiertos' }), item({ name: 'Muzza', ...PIZZA })] }),
    )
    expect(card?.groups.map((g) => [g.label, g.lines.map((l) => l.name)])).toEqual([
      ['Pizza', ['Muzza']],
      [NO_CATEGORY_LABEL, ['Cubiertos']],
    ])
  })

  it('en la comanda de la mesa, los rubros juntan lo de todas las tandas', () => {
    const [card] = buildTableCards(
      queue([
        ticket({ id: 't1', items: [item({ name: 'Muzza', ...PIZZA })] }),
        ticket({
          id: 't2',
          fired_at: ago(1),
          items: [item({ name: 'Mila napo', ...MILAS }), item({ name: 'Fugazza', ...PIZZA })],
        }),
      ]),
      [],
    )
    expect(card?.groups.map((g) => [g.label, g.lines.map((l) => l.name)])).toEqual([
      ['Tablas y milanesas', ['Mila napo']],
      ['Pizza', ['Muzza', 'Fugazza']],
    ])
  })

  it('si la cola no trae rubros (la función anterior), la comanda se arma como siempre', () => {
    const card = one(ticket({ items: [item({ name: 'Muzza' }), item({ name: 'Lomo' })] }))
    expect(card?.groups).toHaveLength(1)
    expect(card?.groups[0]?.label).toBeNull()
    expect(card?.lines.map((l) => [l.category, l.priority])).toEqual([
      [null, false],
      [null, false],
    ])
  })
})
