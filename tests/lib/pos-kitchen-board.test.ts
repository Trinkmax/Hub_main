import { describe, expect, it } from 'vitest'
import {
  assignCodes,
  buildBoard,
  cardForCode,
  homeStationId,
  normalizeView,
  packWall,
  promoteStation,
  viewStations,
  type WallRect,
  wallNeighbor,
  withHomeStation,
} from '@/lib/pos/kitchen/board'
import { glassesFor, stationGoods, stationIcon, stationKind } from '@/lib/pos/kitchen/station-kind'
import type { KitchenItem, KitchenQueue, KitchenTicket, MenuStation } from '@/lib/pos/types'

const NOW = Date.parse('2026-11-27T01:00:00.000Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const COCINA: MenuStation = {
  id: 'st-cocina',
  name: 'Cocina',
  color: '#b45309',
  kind: 'food',
  icon: '🍔',
}
const BARRA: MenuStation = {
  id: 'st-barra',
  name: 'Barra',
  color: '#6d28d9',
  kind: 'drink',
  icon: '🍹',
}
const PIZZA: MenuStation = {
  id: 'st-pizza',
  name: 'Pizzeros',
  color: '#b91c1c',
  kind: 'food',
  icon: '🍕',
}
const STATIONS = [COCINA, BARRA, PIZZA]

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
    station_id: COCINA.id,
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
    party_size: 6,
    kind: 'table',
    event: null,
    alerts: null,
    waiter: 'Sofi',
    items: [item()],
    ...over,
  }
}
function queue(tickets: KitchenTicket[], stations: MenuStation[] = STATIONS): KitchenQueue {
  return {
    now: new Date(NOW).toISOString(),
    branch: { id: 'b1', name: 'Cerro', color: '#14532d' },
    settings: { kitchen_warn_minutes: 12, kitchen_late_minutes: 20 },
    stations,
    tickets,
  }
}

describe('qué estaciones muestra una pantalla', () => {
  it('sin elegir nada son todas, en el orden del bar (el pase)', () => {
    expect(viewStations([], STATIONS).map((s) => s.name)).toEqual(['Cocina', 'Barra', 'Pizzeros'])
  })

  it('la primera de la lista es la grande', () => {
    expect(viewStations([BARRA.id, COCINA.id], STATIONS).map((s) => s.name)).toEqual([
      'Barra',
      'Cocina',
    ])
    expect(viewStations([BARRA.id], STATIONS).map((s) => s.name)).toEqual(['Barra'])
  })

  it('una estación que ya no existe se descarta; si no queda ninguna, son todas', () => {
    expect(viewStations(['otra', PIZZA.id], STATIONS).map((s) => s.name)).toEqual(['Pizzeros'])
    expect(viewStations(['otra'], STATIONS)).toHaveLength(3)
  })

  it('un bar sin estaciones tiene una sola pantalla, con todo', () => {
    const panes = buildBoard(queue([ticket({ items: [item({ station_id: null })] })], []), [], NOW)
    expect(panes).toHaveLength(1)
    expect(panes[0]?.wall).toHaveLength(1)
  })

  it('«todas en su orden» se guarda como lista vacía; otro orden se conserva', () => {
    expect(normalizeView([COCINA.id, BARRA.id, PIZZA.id], STATIONS)).toEqual([])
    expect(normalizeView([BARRA.id, COCINA.id, PIZZA.id], STATIONS)).toEqual([
      BARRA.id,
      COCINA.id,
      PIZZA.id,
    ])
    expect(normalizeView(['x', BARRA.id, BARRA.id], STATIONS)).toEqual([BARRA.id])
    expect(normalizeView(['x'], STATIONS)).toEqual([])
  })

  it('agrandar una estación la pasa adelante y deja las demás', () => {
    expect(promoteStation([], BARRA.id, STATIONS)).toEqual([BARRA.id, COCINA.id, PIZZA.id])
    // Volver a agrandar la primera del bar deja «todas en su orden».
    expect(promoteStation([BARRA.id, COCINA.id, PIZZA.id], COCINA.id, STATIONS)).toEqual([])
    expect(promoteStation([BARRA.id], PIZZA.id, STATIONS)).toEqual([BARRA.id])
  })
})

describe('el tablero', () => {
  const mixed = () =>
    queue([
      ticket({
        items: [
          item({ name: 'Lomito', quantity: 2 }),
          item({ name: 'Mojito', station_id: BARRA.id, quantity: 4 }),
          item({ name: 'Muzzarella', station_id: PIZZA.id }),
        ],
      }),
      ticket({
        id: 't2',
        session_id: 's2',
        table_label: '7',
        fired_at: ago(2),
        status: 'ready',
        ready_at: ago(1),
        items: [
          item({ name: 'Stella', station_id: BARRA.id, prep_status: 'ready', ready_at: ago(1) }),
        ],
      }),
    ])

  it('cada estación tiene lo suyo: la comida en cocina, la bebida en la barra, la pizza con los pizzeros', () => {
    const [cocina, barra, pizza] = buildBoard(mixed(), [], NOW)
    expect(cocina?.wall.map((c) => c.lines.map((l) => l.name))).toEqual([['Lomito']])
    expect(barra?.wall.map((c) => c.lines.map((l) => l.name))).toEqual([['Mojito']])
    expect(pizza?.wall.map((c) => c.lines.map((l) => l.name))).toEqual([['Muzzarella']])
    expect(cocina?.main).toBe(true)
    expect(barra?.main).toBe(false)
  })

  it('lo listo va aparte (esperando al mozo), y los contadores lo dicen', () => {
    const barra = buildBoard(mixed(), [BARRA.id], NOW)[0]
    expect(barra?.wall.map((c) => c.title)).toEqual(['12'])
    expect(barra?.done.map((c) => c.title)).toEqual(['7'])
    expect(barra?.counts).toEqual({ open: 1, queued: 1, ready: 1 })
  })

  it('al pie de cada comanda, lo que la mesa espera de las otras estaciones, con su dibujo', () => {
    const cocina = buildBoard(mixed(), [COCINA.id], NOW)[0]
    expect(cocina?.wall[0]?.others).toMatchObject([
      { name: 'Barra', icon: '🍹', kind: 'drink', quantity: 4, status: 'queued' },
      { name: 'Pizzeros', icon: '🍕', quantity: 1 },
    ])
  })

  it('trae quién atiende la mesa: a quién llamar cuando sale', () => {
    expect(buildBoard(mixed(), [COCINA.id], NOW)[0]?.wall[0]?.waiter).toBe('Sofi')
  })

  it('lo que no tiene estación (o va a una apagada) sale en la primera, una sola vez', () => {
    const q = queue([
      ticket({
        items: [
          item({ name: 'Suelto', station_id: null }),
          item({ name: 'Viejo', station_id: 'apagada' }),
        ],
      }),
    ])
    expect(homeStationId(STATIONS)).toBe(COCINA.id)
    expect(withHomeStation(q).tickets[0]?.items.map((i) => i.station_id)).toEqual([
      COCINA.id,
      COCINA.id,
    ])
    const [cocina, barra, pizza] = buildBoard(q, [], NOW)
    expect(cocina?.wall[0]?.lines.map((l) => l.name)).toEqual(['Suelto', 'Viejo'])
    expect(barra?.wall).toHaveLength(0)
    expect(pizza?.wall).toHaveLength(0)
    // Si todo ya tiene estación, la cola no se copia.
    const clean = queue([ticket()])
    expect(withHomeStation(clean)).toBe(clean)
  })

  it('una comanda lista hace más de diez minutos ya no se muestra', () => {
    const q = queue([
      ticket({
        status: 'ready',
        ready_at: ago(11),
        items: [item({ prep_status: 'ready', ready_at: ago(11) })],
      }),
    ])
    expect(buildBoard(q, [COCINA.id], NOW)[0]?.done).toHaveLength(0)
  })
})

describe('el número que se teclea', () => {
  const card = (id: string, title: string) => ({ id, title })

  it('es el número de la mesa', () => {
    const codes = assignCodes(new Map(), [card('a', '12'), card('b', '7'), card('c', '104')])
    expect([...codes.entries()]).toEqual([
      ['a', '12'],
      ['b', '7'],
      ['c', '104'],
    ])
    expect(cardForCode(codes, '7')).toBe('b')
    expect(cardForCode(codes, '1')).toBeNull()
    expect(cardForCode(codes, '')).toBeNull()
  })

  it('lo que no tiene número recibe uno propio que empieza en cero, y lo conserva', () => {
    const first = assignCodes(new Map(), [
      card('a', '12'),
      card('m', 'Martín'),
      card('d', 'Delivery'),
    ])
    expect(first.get('m')).toBe('01')
    expect(first.get('d')).toBe('02')
    // Se va «Martín»: el delivery sigue siendo el 02, y lo nuevo toma el lugar libre.
    const later = assignCodes(first, [card('a', '12'), card('d', 'Delivery'), card('n', 'Nico')])
    expect(later.get('d')).toBe('02')
    expect(later.get('n')).toBe('01')
  })

  it('dos comandas con el mismo número de mesa: la primera lo lleva, la otra recibe uno propio', () => {
    const codes = assignCodes(new Map(), [card('nueva', '12'), card('vieja', '12')])
    expect(codes.get('nueva')).toBe('12')
    expect(codes.get('vieja')).toBe('01')
  })

  it('un nombre con cifras raras no se confunde con una mesa', () => {
    const codes = assignCodes(new Map(), [card('a', '012'), card('b', '1234'), card('c', 'B3')])
    expect(new Set(codes.values())).toEqual(new Set(['01', '02', '03']))
  })
})

describe('colgar las comandas en el muro', () => {
  const pack = (heights: (number | null)[], columns = 3, room = 500, gap = 10) =>
    packWall(
      heights.map((height, at) => ({ id: `c${at}`, height, span: 1 as const })),
      columns,
      room,
      gap,
    )

  it('la fila de arriba va de izquierda a derecha: lo próximo que tiene que salir', () => {
    const { placed } = pack([100, 100, 100])
    expect(placed.map((p) => [p.column, p.top])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ])
  })

  it('cada una baja a la columna donde hay más lugar', () => {
    const { placed, fits } = pack([300, 100, 200, 150])
    // La cuarta va debajo de la más corta (la segunda), no a esperar.
    expect(placed[3]).toMatchObject({ column: 1, top: 110 })
    expect(fits).toBe(4)
  })

  it('cuando una no entra, esa y las que siguen esperan (el orden no se saltea)', () => {
    const result = pack([400, 400, 400, 200, 50])
    expect(result.fits).toBe(3)
    // Le quedaban 90 de lugar (500 − 400 − 10 de separación).
    expect(result.nextRoom).toBe(90)
  })

  it('una sin medir frena ahí: no se cuelga nada a ciegas', () => {
    const result = pack([100, null, 100])
    expect(result.fits).toBe(1)
    expect(result.nextRoom).toBeNull()
  })

  it('siempre se cuelga al menos una, aunque no entre', () => {
    expect(pack([900]).fits).toBe(1)
  })

  it('una comanda de dos columnas busca dos lugares juntos', () => {
    const { placed } = packWall(
      [
        { id: 'a', height: 200, span: 1 },
        { id: 'larga', height: 250, span: 2 },
        { id: 'c', height: 100, span: 1 },
      ],
      3,
      500,
      10,
    )
    expect(placed[1]).toMatchObject({ id: 'larga', column: 1, top: 0, span: 2 })
    // La que sigue va debajo de la más corta: la primera columna.
    expect(placed[2]).toMatchObject({ column: 0, top: 210 })
  })

  it('en una sola columna, lo de dos columnas ocupa una', () => {
    const { placed } = packWall([{ id: 'a', height: 100, span: 2 }], 1, 500, 10)
    expect(placed[0]).toMatchObject({ column: 0, span: 1 })
  })
})

describe('moverse por el muro con las flechas', () => {
  // Dos columnas: a (arriba) y c (abajo) en la primera; b en la segunda, a la altura de a.
  const rects: WallRect[] = [
    { id: 'a', left: 0, top: 0, width: 100, height: 100 },
    { id: 'b', left: 110, top: 0, width: 100, height: 240 },
    { id: 'c', left: 0, top: 110, width: 100, height: 100 },
  ]

  it('arriba y abajo se quedan en la columna', () => {
    expect(wallNeighbor(rects, 'a', 'down')).toBe('c')
    expect(wallNeighbor(rects, 'c', 'up')).toBe('a')
    expect(wallNeighbor(rects, 'c', 'down')).toBe('c')
  })

  it('izquierda y derecha saltan a la columna de al lado', () => {
    expect(wallNeighbor(rects, 'a', 'right')).toBe('b')
    expect(wallNeighbor(rects, 'c', 'right')).toBe('b')
    // Desde b, la que queda a su altura (el centro de b está más cerca de c).
    expect(wallNeighbor(rects, 'b', 'left')).toBe('c')
    expect(wallNeighbor(rects, 'a', 'left')).toBe('a')
  })

  it('sin marco, arranca en la primera', () => {
    expect(wallNeighbor(rects, null, 'down')).toBe('a')
    expect(wallNeighbor([], null, 'down')).toBeNull()
  })
})

describe('de qué es una estación', () => {
  it('sin tipo conocido es de comida', () => {
    expect(stationKind('drink')).toBe('drink')
    expect(stationKind(null)).toBe('food')
    expect(stationKind('otra')).toBe('food')
  })

  it('el dibujo: el elegido, si no el del nombre, si no el del tipo', () => {
    expect(stationIcon({ name: 'Cocina', kind: 'food', icon: '🍔' })).toBe('🍔')
    expect(stationIcon({ name: 'Pizzeros', kind: 'food', icon: null })).toBe('🍕')
    expect(stationIcon({ name: 'Plancha', kind: 'food', icon: null })).toBe('🍔')
    expect(stationIcon({ name: 'Barra', kind: 'drink', icon: ' ' })).toBe('🍹')
    expect(stationIcon({ name: 'Cocina', kind: null, icon: null })).toBe('🍽️')
    expect(stationIcon(null)).toBe('🍽️')
  })

  it('una mesa de 6 son 6 vasos, solo en una estación de bebidas', () => {
    expect(glassesFor('drink', 6)).toBe(6)
    expect(glassesFor('food', 6)).toBeNull()
    expect(glassesFor('drink', null)).toBeNull()
    expect(glassesFor('drink', 0)).toBeNull()
  })

  it('cómo se nombra lo suyo', () => {
    expect(stationGoods('drink')).toBe('las bebidas')
    expect(stationGoods(null)).toBe('la comida')
  })
})
