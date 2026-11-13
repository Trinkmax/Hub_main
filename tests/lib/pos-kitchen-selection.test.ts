import { describe, expect, it } from 'vitest'
import { buttonForKey, HOLD_MS, holdProgress, pressKind } from '@/lib/pos/kitchen/buttons'
import type { CardStatus, KitchenCard } from '@/lib/pos/kitchen/cards'
import {
  columnsFor,
  estimateTicket,
  fitCount,
  MIN_TICKET_SCALE,
  modeFor,
  nextTicketScale,
  type TicketShape,
  ticketSpan,
  unitFor,
} from '@/lib/pos/kitchen/layout'
import {
  nextSelection,
  railView,
  reconcileSelection,
  restingSelection,
  selectionAfterReady,
  selectionModel,
} from '@/lib/pos/kitchen/selection'
import {
  advanceStations,
  normalizeStations,
  parseStationParam,
  stationParam,
  stationSummary,
  toggleStation,
} from '@/lib/pos/kitchen/stations'
import type { MenuStation } from '@/lib/pos/types'

/** Solo lo que mira el marco: quién es y si está terminada. */
function card(id: string, status: CardStatus = 'queued'): KitchenCard {
  return { id, status } as KitchenCard
}

const model = (carta: [string, CardStatus?][], event: [string, CardStatus?][] = []) =>
  selectionModel(
    carta.map(([id, status]) => card(id, status)),
    event.map(([id, status]) => card(id, status)),
  )

describe('el recorrido de «Siguiente»', () => {
  it('primero el riel, después las listas, después el evento; cada tramo en orden de llegada', () => {
    const m = model(
      [['a', 'ready'], ['b', 'preparing'], ['c'], ['d', 'ready']],
      [['e1'], ['e2', 'ready']],
    )
    expect(m.active).toEqual(['b', 'c'])
    expect(m.done).toEqual(['a', 'd'])
    expect(m.event).toEqual(['e1', 'e2'])
    expect(m.eventOpen).toEqual(['e1'])
    expect(m.order).toEqual(['b', 'c', 'a', 'd', 'e1', 'e2'])
  })

  it('pasa a la siguiente y después de la última vuelve a la primera', () => {
    const order = ['a', 'b', 'c']
    expect(nextSelection(order, 'a')).toBe('b')
    expect(nextSelection(order, 'b')).toBe('c')
    expect(nextSelection(order, 'c')).toBe('a')
  })

  it('sin marco o con uno que ya no existe arranca por la primera', () => {
    expect(nextSelection(['a', 'b'], null)).toBe('a')
    expect(nextSelection(['a', 'b'], 'se-fue')).toBe('a')
  })

  it('con una sola comanda se queda en ella; sin comandas no hay marco', () => {
    expect(nextSelection(['a'], 'a')).toBe('a')
    expect(nextSelection([], 'a')).toBeNull()
  })
})

describe('dónde descansa el marco', () => {
  it('en la comanda más vieja sin terminar', () => {
    expect(restingSelection(model([['a', 'ready'], ['b', 'preparing'], ['c']]))).toBe('b')
  })

  it('la carta va antes que el evento, aunque el evento sea más viejo', () => {
    expect(restingSelection(model([['c1']], [['e1'], ['e2']]))).toBe('c1')
  })

  it('si en la carta no queda nada, la mesa del evento más vieja sin terminar', () => {
    expect(restingSelection(model([['a', 'ready']], [['e1', 'ready'], ['e2']]))).toBe('e2')
  })

  it('si está todo listo igual hay marco: la primera del recorrido', () => {
    expect(
      restingSelection(
        model([
          ['a', 'ready'],
          ['b', 'ready'],
        ]),
      ),
    ).toBe('a')
  })

  it('sin comandas no hay marco', () => {
    expect(restingSelection(model([]))).toBeNull()
  })
})

describe('después de marcar «listo»', () => {
  it('vuelve sola a la más vieja sin terminar', () => {
    // Se terminó «b» estando «a» y «c» pendientes: va a «a».
    expect(selectionAfterReady(model([['a'], ['b', 'preparing'], ['c']]), 'b')).toBe('a')
    // Se terminó la más vieja: pasa a la que le sigue.
    expect(selectionAfterReady(model([['a', 'preparing'], ['b'], ['c']]), 'a')).toBe('b')
  })

  it('si era la última sin terminar, el marco se queda en ella', () => {
    expect(
      selectionAfterReady(
        model([
          ['x', 'ready'],
          ['a', 'preparing'],
        ]),
        'a',
      ),
    ).toBe('a')
  })

  it('en el evento sigue por las mesas del evento', () => {
    const m = model([['c1']], [['e1', 'preparing'], ['e2'], ['e3']])
    expect(selectionAfterReady(m, 'e1')).toBe('e2')
  })

  it('terminado el evento vuelve a la carta, y al revés', () => {
    expect(selectionAfterReady(model([['c1']], [['e1', 'preparing']]), 'e1')).toBe('c1')
    expect(selectionAfterReady(model([['c1', 'preparing']], [['e1']]), 'c1')).toBe('e1')
  })
})

describe('el marco cuando la cola cambia sola', () => {
  it('no se mueve si su comanda sigue, aunque entren otras o cambie de estado', () => {
    const before = ['a', 'b', 'c']
    expect(reconcileSelection(before, model([['a'], ['b'], ['c'], ['d']]), 'b')).toBe('b')
    // «b» pasó a lista desde otra pantalla: cambia de tramo, pero el marco la sigue.
    expect(reconcileSelection(before, model([['a'], ['b', 'ready'], ['c']]), 'b')).toBe('b')
  })

  it('si su comanda se fue, pasa a la que venía después', () => {
    expect(reconcileSelection(['a', 'b', 'c'], model([['a'], ['c']]), 'b')).toBe('c')
  })

  it('si se fueron varias seguidas, a la primera que quede después', () => {
    expect(reconcileSelection(['a', 'b', 'c', 'd'], model([['a'], ['d']]), 'b')).toBe('d')
  })

  it('si era la última, vuelve a donde descansa', () => {
    expect(reconcileSelection(['a', 'b', 'c'], model([['a', 'preparing'], ['b']]), 'c')).toBe('a')
  })

  it('sin marco previo, a donde descansa; sin comandas, sin marco', () => {
    expect(reconcileSelection([], model([['a', 'ready'], ['b']]), null)).toBe('b')
    expect(reconcileSelection(['a'], model([]), 'a')).toBeNull()
  })
})

describe('qué tramo del riel se ve', () => {
  const active = ['a', 'b', 'c', 'd', 'e', 'f']
  const start = (...args: Parameters<typeof railView>) => railView(...args).start

  it('arranca en la más vieja y muestra las que entran', () => {
    expect(railView(active, 4, 0, 'a')).toEqual({ start: 0, count: 4 })
    expect(railView(active, 4, 0, 'd')).toEqual({ start: 0, count: 4 })
  })

  it('se corre lo justo para mostrar la enmarcada', () => {
    expect(start(active, 4, 0, 'e')).toBe(1)
    expect(start(active, 4, 1, 'f')).toBe(2)
    // Y no vuelve atrás mientras la enmarcada siga a la vista.
    expect(start(active, 4, 2, 'd')).toBe(2)
    expect(start(active, 4, 2, 'a')).toBe(0)
  })

  it('cuando el marco se va del riel (a una lista, al evento), vuelve a la más vieja', () => {
    expect(railView(active, 4, 2, 'lista')).toEqual({ start: 0, count: 4 })
    expect(railView(active, 4, 2, null)).toEqual({ start: 0, count: 4 })
  })

  it('se acomoda cuando se van comandas', () => {
    expect(railView(['a', 'b', 'c'], 4, 2, 'c')).toEqual({ start: 0, count: 3 })
    expect(railView(['a', 'b', 'c', 'd', 'e'], 4, 2, 'e')).toEqual({ start: 1, count: 4 })
    expect(railView([], 4, 3, null)).toEqual({ start: 0, count: 0 })
  })

  it('si entran todas, no hay nada que correr', () => {
    expect(railView(['a', 'b'], 4, 0, 'b')).toEqual({ start: 0, count: 2 })
    expect(railView(active, 99, 5, 'f')).toEqual({ start: 0, count: 6 })
  })

  it('con un solo lugar muestra la enmarcada', () => {
    expect(railView(active, 1, 0, 'c')).toEqual({ start: 2, count: 1 })
    expect(railView(active, 0, 0, 'c')).toEqual({ start: 2, count: 1 })
  })

  describe('con comandas largas, que ocupan dos lugares', () => {
    const wide =
      (...ids: string[]) =>
      (id: string) =>
        ids.includes(id) ? 2 : 1

    it('entran menos', () => {
      expect(railView(active, 4, 0, 'a', wide('b'))).toEqual({ start: 0, count: 3 })
      expect(railView(active, 4, 0, 'a', wide('a', 'b'))).toEqual({ start: 0, count: 2 })
    })

    it('la que no entra entera no se muestra por la mitad', () => {
      // a, b, c ocupan tres lugares; «d» necesita dos y queda uno: espera en la cola.
      expect(railView(active, 4, 0, 'a', wide('d'))).toEqual({ start: 0, count: 3 })
    })

    it('se corre hasta que la enmarcada entra entera', () => {
      expect(railView(active, 4, 0, 'd', wide('d'))).toEqual({ start: 1, count: 3 })
      expect(railView(active, 4, 0, 'f', wide('e'))).toEqual({ start: 3, count: 3 })
    })

    it('al final del riel no deja lugares vacíos de más', () => {
      // Desde «c» entran c, d, e (ancha) = 4 lugares… y falta «f»: lo más a la derecha es «d».
      expect(railView(active, 4, 9, 'f', wide('e'))).toEqual({ start: 3, count: 3 })
    })

    it('en un riel de un solo lugar, la larga ocupa ese lugar', () => {
      expect(railView(active, 1, 0, 'b', wide('b'))).toEqual({ start: 1, count: 1 })
    })
  })
})

const STATIONS: MenuStation[] = [
  { id: 'cocina', name: 'Cocina', color: '#b45309' },
  { id: 'frios', name: 'Fríos', color: '#0e7490' },
  { id: 'barra', name: 'Barra', color: '#6d28d9' },
]

describe('estaciones de la pantalla', () => {
  it('lee `?estaciones=` de la dirección', () => {
    expect(parseStationParam(undefined)).toBeNull()
    expect(parseStationParam(null)).toBeNull()
    expect(parseStationParam('')).toEqual([])
    expect(parseStationParam('barra')).toEqual(['barra'])
    expect(parseStationParam(' cocina , frios,,cocina ')).toEqual(['cocina', 'frios'])
    expect(parseStationParam(['cocina', 'barra'])).toEqual(['cocina', 'barra'])
  })

  it('descarta estaciones que no existen y respeta el orden de la carta', () => {
    expect(normalizeStations(['barra', 'vieja', 'cocina'], STATIONS)).toEqual(['cocina', 'barra'])
  })

  it('todas o ninguna es lo mismo: todas', () => {
    expect(normalizeStations([], STATIONS)).toEqual([])
    expect(normalizeStations(['vieja'], STATIONS)).toEqual([])
    expect(normalizeStations(['barra', 'frios', 'cocina'], STATIONS)).toEqual([])
  })

  it('desde «todas», tocar una deja solo esa', () => {
    expect(toggleStation([], 'barra', STATIONS)).toEqual(['barra'])
  })

  it('después suma y saca', () => {
    expect(toggleStation(['barra'], 'cocina', STATIONS)).toEqual(['cocina', 'barra'])
    expect(toggleStation(['cocina', 'barra'], 'cocina', STATIONS)).toEqual(['barra'])
  })

  it('sacar la última o completar todas vuelve a «todas»', () => {
    expect(toggleStation(['barra'], 'barra', STATIONS)).toEqual([])
    expect(toggleStation(['cocina', 'frios'], 'barra', STATIONS)).toEqual([])
  })

  it('tocar una estación que no existe no cambia nada', () => {
    expect(toggleStation(['barra'], 'vieja', STATIONS)).toEqual(['barra'])
  })

  it('se refleja en la dirección solo cuando no son todas', () => {
    expect(stationParam([])).toBeNull()
    expect(stationParam(['cocina', 'barra'])).toBe('cocina,barra')
  })

  it('se dice en palabras', () => {
    expect(stationSummary([], STATIONS)).toBe('Todas las estaciones')
    expect(stationSummary(['barra'], STATIONS)).toBe('Barra')
    expect(stationSummary(['frios', 'cocina'], STATIONS)).toBe('Cocina + Fríos')
    expect(stationSummary([], [{ id: 'unica', name: 'Parrilla', color: '#000000' }])).toBe(
      'Parrilla',
    )
    expect(stationSummary([], [])).toBe('Todas las estaciones')
  })

  it('al avanzar manda sus estaciones, o nada si son todas', () => {
    expect(advanceStations([])).toBeUndefined()
    expect(advanceStations(['barra'])).toEqual(['barra'])
  })
})

describe('cómo entra en cada pantalla', () => {
  it('la unidad vale 1 px en la tele de 1920×1080 y acompaña a las demás teles', () => {
    expect(unitFor(1920, 1080)).toBe(1)
    expect(unitFor(1280, 720)).toBeCloseTo(0.6667, 3)
    expect(unitFor(3840, 2160)).toBe(2)
  })

  it('manda la medida que queda más justa', () => {
    expect(unitFor(1920, 900)).toBeCloseTo(0.8333, 3)
    expect(unitFor(1600, 1200)).toBeCloseTo(0.8333, 3)
  })

  it('tiene piso y techo', () => {
    expect(unitFor(390, 844)).toBe(0.6)
    expect(unitFor(7680, 4320)).toBe(2.4)
    expect(unitFor(0, 0)).toBe(1)
  })

  it('el celular (o una pantalla muy baja) es una lista; lo demás, riel', () => {
    expect(modeFor(390, 844)).toBe('list')
    expect(modeFor(844, 390)).toBe('list')
    expect(modeFor(1024, 768)).toBe('rail')
    expect(modeFor(1920, 1080)).toBe('rail')
    expect(modeFor(0, 0)).toBe('rail')
  })

  it('en la tele entran cuatro comandas; con el evento al lado, tres', () => {
    expect(columnsFor(1872, 1)).toBe(4)
    // 1920 menos el evento (570) y los márgenes (48).
    expect(columnsFor(1302, 1)).toBe(3)
    // La misma tele a 720: mismas cuatro.
    expect(columnsFor(1248, 1280 / 1920)).toBe(4)
  })

  it('en una tablet entran menos, y siempre al menos una', () => {
    // 1024 de ancho: la unidad queda en su piso (0,6) y entran tres, no cuatro apretadas.
    expect(columnsFor(1024 - 29, 0.6)).toBe(3)
    expect(columnsFor(800 - 29, 0.6)).toBe(3)
    expect(columnsFor(720 - 29, 0.6)).toBe(2)
    expect(columnsFor(300, 0.6)).toBe(1)
    expect(columnsFor(0, 1)).toBe(1)
    expect(columnsFor(9000, 1)).toBe(6)
  })

  it('una comanda que no entra achica sus renglones hasta entrar, con un piso', () => {
    // 1000 de alto, 200 son encabezado; entran 760: los renglones tienen que bajar a ~0,69.
    const first = nextTicketScale(1, 1000, 760, 200)
    expect(first).toBeLessThan(0.7)
    expect(first).toBeGreaterThan(0.66)
    // Si entra, no se toca.
    expect(nextTicketScale(1, 700, 760, 200)).toBe(1)
    // Si todavía no entra, sigue bajando de a poco.
    expect(nextTicketScale(0.69, 770, 760, 200)).toBeLessThan(0.69)
    // Nunca por debajo del piso.
    expect(nextTicketScale(0.52, 3000, 760, 200)).toBe(MIN_TICKET_SCALE)
    expect(nextTicketScale(1, 900, 150, 200)).toBe(MIN_TICKET_SCALE)
  })
})

describe('una comanda larga ocupa dos lugares', () => {
  const line = (name: string, modifiers: string[] = [], notes: string | null = null) => ({
    name,
    modifiers,
    notes,
  })
  const shape = (over: Partial<TicketShape> = {}): TicketShape => ({
    strips: 0,
    meta: true,
    labels: 0,
    footer: false,
    lines: [line('Clasicas'), line('Lomito')],
    ...over,
  })
  /** El riel de la tele: comandas de 453 de ancho y 770 de alto libre. */
  const COLUMN = 453
  const ROOM = 770

  it('la cuenta crece con los renglones, las aclaraciones y los avisos', () => {
    const base = estimateTicket(shape(), COLUMN)
    const more = estimateTicket(
      shape({ lines: [line('Clasicas'), line('Lomito'), line('Papas')] }),
      COLUMN,
    )
    const marked = estimateTicket(
      shape({ lines: [line('Clasicas', ['Jugoso']), line('Lomito')] }),
      COLUMN,
    )
    const alert = estimateTicket(shape({ strips: 1 }), COLUMN)
    expect(more.body).toBeGreaterThan(base.body)
    expect(marked.body).toBeGreaterThan(base.body)
    expect(alert.fixed).toBe(base.fixed + 50)
    expect(alert.body).toBe(base.body)
  })

  it('un nombre largo ocupa dos renglones en una comanda angosta', () => {
    const narrow = estimateTicket(shape({ lines: [line('Lomo Completo Premium')] }), 400)
    const wide = estimateTicket(shape({ lines: [line('Lomo Completo Premium')] }), 900)
    expect(narrow.body).toBeGreaterThan(wide.body)
  })

  it('una nota larga se parte en varios renglones', () => {
    const short = estimateTicket(shape({ lines: [line('Lomito', [], 'sin sal')] }), COLUMN)
    const long = estimateTicket(
      shape({ lines: [line('Lomito', [], 'cortada al medio, para compartir entre tres')] }),
      COLUMN,
    )
    expect(long.body).toBeGreaterThan(short.body)
  })

  it('la comanda de siempre ocupa un lugar', () => {
    const usual = shape({
      labels: 2,
      lines: [
        line('Clasica SIMPLE', ['Jugoso', 'Sin lechuga']),
        line('Clasicas'),
        line('Clasica DOBLE', ['Extra cheddar']),
        line('Negroni'),
      ],
    })
    expect(ticketSpan(usual, COLUMN, ROOM, 4)).toBe(1)
  })

  it('la mesa de doce, con once renglones, ocupa dos', () => {
    const big = shape({
      labels: 3,
      lines: [
        line('Clasica SIMPLE', ['Jugoso', 'Sin lechuga']),
        line('Clasica DOBLE', ['Extra cheddar', 'Sin cebolla']),
        line('Cheddar, Bacon y Verdeo'),
        line('Lomo Completo Premium', ['A punto'], 'sin mayonesa'),
        line('Papas con cheddar'),
        line('Muzzarella'),
        line('Prosciuto e funghi', ['Sin aceitunas']),
        line('1/2 Especial'),
        line('Ensalada César', ['Sin crutones']),
        line('Mojito'),
        line('Negroni'),
      ],
    })
    expect(ticketSpan(big, COLUMN, ROOM, 4)).toBe(2)
  })

  it('por un poco de más no se le dan dos lugares: se achica apenas', () => {
    const lines = Array.from({ length: 8 }, () => line('Lomito'))
    const { fixed, body } = estimateTicket(shape({ lines }), COLUMN)
    expect(fixed + body).toBeGreaterThan(ROOM)
    expect(ticketSpan(shape({ lines }), COLUMN, ROOM, 4)).toBe(1)
  })

  it('en un riel de un solo lugar no hay dos lugares que ocupar', () => {
    const lines = Array.from({ length: 20 }, () => line('Lomito'))
    expect(ticketSpan(shape({ lines }), COLUMN, ROOM, 1)).toBe(1)
    expect(ticketSpan(shape({ lines }), COLUMN, 0, 4)).toBe(1)
  })
})

describe('la tira de totales entra en dos renglones', () => {
  it('si entran todos, van todos', () => {
    expect(fitCount([100, 100, 100], 400, 20, 2, 60)).toBe(3)
    expect(fitCount([300, 300, 300], 700, 20, 2, 60)).toBe(3)
  })

  it('si no entran, guarda lugar para el «+N» en el último renglón', () => {
    // Renglón 1: 300 + 300. Renglón 2: 300 + 300 no deja lugar para el «+N» (60): queda uno solo.
    expect(fitCount([300, 300, 300, 300, 300], 660, 20, 2, 60)).toBe(3)
    // Con un «+N» más angosto entra el cuarto.
    expect(fitCount([300, 300, 300, 300, 300], 660, 20, 2, 10)).toBe(4)
  })

  it('en un solo renglón', () => {
    // 200 + 200 = 420; con un «+N» de 80 se pasa de 500: queda uno. Con uno de 50, entran los dos.
    expect(fitCount([200, 200, 200], 500, 20, 1, 80)).toBe(1)
    expect(fitCount([200, 200, 200], 500, 20, 1, 50)).toBe(2)
    expect(fitCount([200, 200], 500, 20, 1, 80)).toBe(2)
  })

  it('sin lugar no entra ninguno', () => {
    expect(fitCount([200], 0, 20, 2, 50)).toBe(0)
    expect(fitCount([], 500, 20, 2, 50)).toBe(0)
  })
})

describe('los dos botones', () => {
  it('«Siguiente»: flecha derecha, N o Tab', () => {
    for (const key of ['ArrowRight', 'n', 'N', 'Tab']) expect(buttonForKey(key)).toBe('next')
  })

  it('«Avanzar»: Enter, espacio o A', () => {
    for (const key of ['Enter', ' ', 'a', 'A']) expect(buttonForKey(key)).toBe('advance')
  })

  it('ninguna otra tecla hace nada', () => {
    for (const key of ['ArrowLeft', 'Escape', 'b', '1', 'Backspace']) {
      expect(buttonForKey(key)).toBeNull()
    }
  })

  it('con Ctrl, Alt o ⌘ es un atajo del navegador, no un botón', () => {
    expect(buttonForKey('a', { ctrl: true })).toBeNull()
    expect(buttonForKey('n', { meta: true })).toBeNull()
    expect(buttonForKey('Enter', { alt: true })).toBeNull()
  })

  it('Mayúscula + Tab queda libre para entrar a los controles con el teclado', () => {
    expect(buttonForKey('Tab', { shift: true })).toBeNull()
    expect(buttonForKey('N', { shift: true })).toBe('next')
  })

  it('un toque avanza; mantenido 700 ms o más, deshace', () => {
    expect(HOLD_MS).toBe(700)
    expect(pressKind(80)).toBe('tap')
    expect(pressKind(699)).toBe('tap')
    expect(pressKind(700)).toBe('hold')
    expect(pressKind(1500)).toBe('hold')
  })

  it('el progreso de la pulsación va de 0 a 1', () => {
    expect(holdProgress(0)).toBe(0)
    expect(holdProgress(-5)).toBe(0)
    expect(holdProgress(350)).toBe(0.5)
    expect(holdProgress(700)).toBe(1)
    expect(holdProgress(2000)).toBe(1)
  })
})
