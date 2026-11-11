import { describe, expect, it } from 'vitest'
import {
  type CountSchedule,
  countWindowDays,
  countWindowsText,
  defaultEventsUntil,
  latestDeliveryOnOrBefore,
  nextCountDate,
} from '@/lib/purchasing/dates'
import {
  eventDeadlines,
  isUrgent,
  needsAction,
  type SupplierDeadline,
  upcomingCounts,
  weekDeadlines,
} from '@/lib/purchasing/deadlines'
import { eventLabel, planEvent } from '@/lib/purchasing/events'
import type {
  CalendarEvent,
  PurItem,
  PurOrder,
  PurOrderLine,
  PurRecipe,
  PurSupplier,
} from '@/lib/purchasing/types'
import { eventsData } from '@/lib/tex/tools/pedidos/_values'

// Noviembre de 2026: dom 08 · lun 09 · mar 10 · mié 11 · jue 12 · vie 13 · sáb 14 · dom 15 · lun 16 …
const WED = '2026-11-11'

/** Lo que pidió Tomás: se cuenta domingo y miércoles; el domingo hasta el jueves, el miércoles hasta el lunes. */
const HUB: CountSchedule = {
  countWeekdays: [0, 3],
  countWindows: { 0: 4, 3: 5 },
  arriveDaysBefore: 2,
}

const supplier = (over: Partial<PurSupplier> = {}): PurSupplier => ({
  id: 's-barracuda',
  name: 'Barracuda',
  contactName: null,
  whatsapp: '5493511234567',
  deliveryWeekdays: [1, 2, 3, 4, 5],
  leadDays: 1,
  notes: null,
  active: true,
  ...over,
})

const item = (over: Partial<PurItem> = {}): PurItem => ({
  id: 'i-langostino',
  code: null,
  name: 'Langostinos',
  brand: null,
  zoneId: null,
  unit: 'kg',
  frequency: 'occasional',
  targetQty: null,
  packLabel: 'Por kg',
  packSize: 1,
  supplierId: 's-barracuda',
  notes: null,
  active: true,
  ...over,
})

const recipe = (lines: PurRecipe['lines']): PurRecipe => ({
  id: 'r-ramen',
  templateId: 't-ramen',
  name: 'Noche de Ramen',
  variant: 'Única',
  baseGuests: 60,
  notes: null,
  active: true,
  lines,
})

const line = (itemId: string | null, over: Partial<PurRecipe['lines'][number]> = {}) => ({
  id: `l-${itemId ?? 'x'}`,
  itemId,
  name: itemId ?? 'Caldo',
  quantity: 2,
  unit: 'kg',
  inHouse: false,
  note: null,
  sortOrder: 1,
  ...over,
})

const event = (date: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `e-${date}`,
  date,
  startsAt: '21:00',
  name: 'Ramen',
  templateId: 't-ramen',
  capacity: 60,
  reservedGuests: 40,
  ...over,
})

const orderLine = (over: Partial<PurOrderLine> = {}): PurOrderLine => ({
  id: 'ol1',
  itemId: 'i-langostino',
  name: 'Langostinos',
  unit: 'kg',
  packLabel: 'Por kg',
  packSize: 1,
  countedQty: null,
  countState: null,
  targetQty: null,
  eventQty: 2,
  eventNames: [],
  inTransitQty: 0,
  suggestedPacks: 2,
  orderedPacks: 2,
  confirmedPacks: null,
  receivedState: null,
  receivedPacks: null,
  addedByHand: false,
  sortOrder: 1,
  ...over,
})

const order = (over: Partial<PurOrder> = {}): PurOrder => ({
  id: 'o1',
  countId: 'c1',
  supplierId: 's-barracuda',
  status: 'sent',
  expectedDate: '2026-11-12',
  supplierNote: null,
  kitchenNote: null,
  message: null,
  sentAt: '2026-11-10T12:00:00Z',
  confirmedAt: null,
  confirmedWithChanges: false,
  receivedAt: null,
  receivedByName: null,
  closedAt: null,
  discardedAt: null,
  discardReason: null,
  createdAt: '2026-11-10T12:00:00Z',
  lines: [],
  ...over,
})

type Setup = {
  events?: CalendarEvent[]
  items?: PurItem[]
  suppliers?: PurSupplier[]
  lines?: PurRecipe['lines']
  orders?: PurOrder[]
  sentCounts?: { id: string; countDate: string; eventsUntil: string }[]
  openCount?: { countDate: string; eventsUntil: string } | null
  lastSent?: string | null
  today?: string
  schedule?: CountSchedule
}

function run(s: Setup = {}) {
  const today = s.today ?? WED
  const items = s.items ?? [item()]
  const suppliers = s.suppliers ?? [supplier()]
  const r = recipe(s.lines ?? items.map((i) => line(i.id)))
  const events = (s.events ?? [event('2026-11-14')]).map((e) =>
    planEvent({ event: e, recipes: [r], plan: undefined, baseGuests: 60 }),
  )
  const schedule = s.schedule ?? HUB
  return eventDeadlines({
    events,
    items: new Map(items.map((i) => [i.id, i])),
    suppliers: new Map(suppliers.map((x) => [x.id, x])),
    orders: s.orders ?? [],
    sentCounts: s.sentCounts ?? [],
    counts: upcomingCounts({
      today,
      schedule,
      openCount: s.openCount ?? null,
      lastSentCountDate: s.lastSent ?? '2026-11-08',
    }),
    arriveDaysBefore: schedule.arriveDaysBefore,
    today,
  })
}

const only = (s: Setup = {}): SupplierDeadline => {
  const rows = run(s)[0]?.suppliers ?? []
  expect(rows).toHaveLength(1)
  const row = rows[0]
  if (!row) throw new Error('sin renglón')
  return row
}

describe('las ventanas de los conteos (lo que pidió Tomás)', () => {
  it('el del domingo cubre hasta el jueves y el del miércoles hasta el lunes', () => {
    expect(defaultEventsUntil('2026-11-15', HUB)).toBe('2026-11-19')
    expect(defaultEventsUntil('2026-11-18', HUB)).toBe('2026-11-23')
    expect(countWindowDays(0, HUB)).toBe(4)
    expect(countWindowDays(3, HUB)).toBe(5)
    expect(countWindowsText(HUB)).toBe(
      'Los domingos cubre los eventos hasta el jueves; los miércoles, hasta el lunes.',
    )
  })

  it('sin ventanas fijadas, la cuenta de los 2 días da lo mismo', () => {
    const calculated = { ...HUB, countWindows: {} }
    expect(defaultEventsUntil('2026-11-15', calculated)).toBe('2026-11-19')
    expect(defaultEventsUntil('2026-11-18', calculated)).toBe('2026-11-23')
  })

  it('un conteo en un día que no es de conteo usa la cuenta', () => {
    // Lunes 16: el próximo es el miércoles 18 → hasta el jueves 19.
    expect(defaultEventsUntil('2026-11-16', HUB)).toBe('2026-11-19')
    expect(nextCountDate('2026-11-16', [0, 3])).toBe('2026-11-18')
    expect(nextCountDate('2026-11-16', [])).toBeNull()
  })

  it('el último día de entrega que llega a tiempo', () => {
    // Martes y jueves: lo que tiene que estar el lunes 16 llega el jueves 12.
    expect(latestDeliveryOnOrBefore('2026-11-16', [2, 4])).toBe('2026-11-12')
    expect(latestDeliveryOnOrBefore('2026-11-12', [2, 4])).toBe('2026-11-12')
    expect(latestDeliveryOnOrBefore('2026-11-12', [])).toBeNull()
  })
})

describe('los conteos que vienen', () => {
  it('hoy es miércoles y todavía no se contó: el de hoy, el del domingo, el del miércoles…', () => {
    const counts = upcomingCounts({
      today: WED,
      schedule: HUB,
      openCount: null,
      lastSentCountDate: '2026-11-08',
      days: 8,
    })
    expect(counts).toEqual([
      { date: '2026-11-11', until: '2026-11-16', open: false },
      { date: '2026-11-15', until: '2026-11-19', open: false },
      { date: '2026-11-18', until: '2026-11-23', open: false },
    ])
  })

  it('si el de hoy ya se mandó, el próximo es el domingo', () => {
    const counts = upcomingCounts({
      today: WED,
      schedule: HUB,
      openCount: null,
      lastSentCountDate: WED,
      days: 7,
    })
    expect(counts[0]?.date).toBe('2026-11-15')
  })

  it('el abierto va primero, con la ventana que eligió la cocina', () => {
    const counts = upcomingCounts({
      today: WED,
      schedule: HUB,
      openCount: { countDate: WED, eventsUntil: '2026-11-17' },
      lastSentCountDate: '2026-11-08',
      days: 5,
    })
    expect(counts).toEqual([
      { date: WED, until: '2026-11-17', open: true },
      { date: '2026-11-15', until: '2026-11-19', open: false },
    ])
  })
})

describe('cuándo pedir lo de cada evento', () => {
  it('sábado 14: tiene que llegar el jueves 12 → pedir hoy, y el conteo de hoy lo trae', () => {
    const row = only()
    expect(row.mustArriveBy).toBe('2026-11-12')
    expect(row.deliveryDay).toBe('2026-11-12')
    expect(row.orderBy).toBe(WED)
    expect(row.status).toBe('count')
    expect(row.countDate).toBe(WED)
    expect(row.arrives).toBe('2026-11-12')
    expect(needsAction(row)).toBe(false)
  })

  it('viernes 13: tenía que pedirse ayer; pedido hoy llega el jueves, un día antes', () => {
    const row = only({ events: [event('2026-11-13')] })
    expect(row.orderBy).toBe('2026-11-10')
    expect(row.status).toBe('late')
    expect(row.arrives).toBe('2026-11-12')
    expect(isUrgent(row, WED)).toBe(true)
  })

  it('viernes 20 con un proveedor que pide 2 días: ningún conteo llega, hay que pedirlo aparte', () => {
    const carnes = supplier({ id: 's-carnes', name: 'Carnes La Recta', leadDays: 2 })
    const row = only({
      events: [event('2026-11-20')],
      suppliers: [carnes],
      items: [item({ id: 'i-bondiola', name: 'Bondiola', supplierId: 's-carnes' })],
    })
    // Tiene que llegar el miércoles 18 → pedir hasta el lunes 16. El domingo cubre hasta el jueves y el
    // miércoles llega tarde.
    expect(row.mustArriveBy).toBe('2026-11-18')
    expect(row.orderBy).toBe('2026-11-16')
    expect(row.status).toBe('todo')
    expect(needsAction(row)).toBe(true)
    expect(isUrgent(row, WED)).toBe(false)
  })

  it('el mismo viernes 20, con un proveedor que trae en el día: lo trae el conteo del miércoles', () => {
    const row = only({
      events: [event('2026-11-20')],
      suppliers: [supplier({ deliveryWeekdays: [3], leadDays: 0 })],
    })
    expect(row.orderBy).toBe('2026-11-18')
    expect(row.status).toBe('count')
    expect(row.countDate).toBe('2026-11-18')
  })

  it('hoy es el último día y no hay conteo que lo traiga: pedir hoy', () => {
    // Viernes 20 con entrega martes y jueves, 1 día: llega el martes 17 → pedir el lunes 16.
    const row = only({
      today: '2026-11-16',
      lastSent: '2026-11-15',
      events: [event('2026-11-20')],
      suppliers: [supplier({ deliveryWeekdays: [2, 4] })],
    })
    expect(row.deliveryDay).toBe('2026-11-17')
    expect(row.orderBy).toBe('2026-11-16')
    expect(row.status).toBe('today')
  })

  it('sin días de entrega: supone que lo trae cualquier día y lo avisa', () => {
    const row = only({ suppliers: [supplier({ deliveryWeekdays: [] })] })
    expect(row.noDays).toBe(true)
    expect(row.deliveryDay).toBe('2026-11-12')
    expect(row.orderBy).toBe(WED)
    expect(row.arrives).toBeNull()
  })

  it('lo que no tiene proveedor, o lo tiene desactivado, va aparte', () => {
    const rows =
      run({
        items: [
          item({ id: 'a', name: 'Fideos', supplierId: null }),
          item({ id: 'b', name: 'Alga nori', supplierId: 's-off' }),
          item(),
        ],
        suppliers: [supplier(), supplier({ id: 's-off', name: 'Otro', active: false })],
      })[0]?.suppliers ?? []
    expect(rows.map((r) => r.supplier?.name ?? null)).toEqual(['Barracuda', null])
    expect(rows[1]?.status).toBe('no_supplier')
    expect(rows[1]?.items.map((i) => i.name)).toEqual(['Alga nori', 'Fideos'])
  })

  it('lo que se hace en el local, lo que no tiene insumo y lo desactivado no se pide', () => {
    const rows =
      run({
        items: [item(), item({ id: 'off', active: false })],
        lines: [
          line('i-langostino'),
          line(null, { inHouse: true }),
          line(null),
          line('off'),
          line('i-langostino', { id: 'repetido' }),
        ],
      })[0]?.suppliers ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]?.items).toHaveLength(1)
  })

  it('una fecha que no suma (sin elegir variante) no tiene renglones', () => {
    const other = { ...recipe([line('i-langostino')]), id: 'r2', variant: 'Cerdo' }
    const planned = planEvent({
      event: event('2026-11-14'),
      recipes: [recipe([line('i-langostino')]), other],
      plan: undefined,
      baseGuests: 60,
    })
    const [row] = eventDeadlines({
      events: [planned],
      items: new Map([[item().id, item()]]),
      suppliers: new Map([[supplier().id, supplier()]]),
      orders: [],
      sentCounts: [],
      counts: [],
      arriveDaysBefore: 2,
      today: WED,
    })
    expect(planned.status).toBe('needs_variant')
    expect(row?.suppliers).toEqual([])
    expect(row?.mustArriveBy).toBe('2026-11-12')
  })
})

describe('lo que ya está pedido', () => {
  const label = eventLabel(event('2026-11-13'))
  const withEvent = (over: Partial<PurOrderLine> = {}) => [
    orderLine({ eventNames: [label], ...over }),
  ]

  it('mandado y llega a tiempo', () => {
    const row = only({
      events: [event('2026-11-13')],
      orders: [order({ expectedDate: WED, lines: withEvent() })],
    })
    expect(row.status).toBe('ordered')
    expect(row.arrives).toBe(WED)
    expect(row.orderId).toBe('o1')
  })

  it('mandado, pero llega el jueves: un día tarde', () => {
    const row = only({
      events: [event('2026-11-13')],
      orders: [order({ lines: withEvent() })],
    })
    expect(row.status).toBe('ordered_late')
    expect(row.arrives).toBe('2026-11-12')
    expect(isUrgent(row, WED)).toBe(true)
  })

  it('ya llegó: cuenta el día en que la cocina lo recibió', () => {
    const row = only({
      events: [event('2026-11-13')],
      orders: [
        order({
          status: 'completed',
          expectedDate: '2026-11-12',
          receivedAt: '2026-11-10T15:00:00Z',
          lines: withEvent({ receivedState: 'ok' }),
        }),
      ],
    })
    expect(row.status).toBe('ordered')
    expect(row.arrives).toBe('2026-11-10')
  })

  it('lo que no llegó no cuenta como pedido', () => {
    const row = only({
      events: [event('2026-11-13')],
      orders: [
        order({ status: 'with_differences', lines: withEvent({ receivedState: 'missing' }) }),
      ],
    })
    expect(row.status).toBe('late')
  })

  it('en un pedido para revisar: llega a tiempo si se manda hoy', () => {
    const row = only({
      orders: [
        order({
          status: 'draft',
          sentAt: null,
          expectedDate: '2026-11-12',
          lines: [orderLine({ eventNames: [eventLabel(event('2026-11-14'))] })],
        }),
      ],
    })
    expect(row.status).toBe('draft')
    expect(row.orderBy).toBe(WED)
    expect(isUrgent(row, WED)).toBe(true)
    expect(isUrgent(row, '2026-11-10')).toBe(false)
  })

  it('en un pedido para revisar que ya no llega a tiempo', () => {
    const row = only({
      events: [event('2026-11-13')],
      orders: [order({ status: 'draft', sentAt: null, lines: withEvent() })],
    })
    expect(row.status).toBe('draft_late')
  })

  it('sacado del pedido (0) no cuenta', () => {
    const row = only({
      events: [event('2026-11-13')],
      orders: [order({ status: 'draft', sentAt: null, lines: withEvent({ orderedPacks: 0 }) })],
    })
    expect(row.status).toBe('late')
  })

  it('un pedido de otro proveedor, o de otro evento, no cuenta', () => {
    const row = only({
      events: [event('2026-11-13')],
      orders: [
        order({ supplierId: 's-otro', lines: withEvent() }),
        order({ id: 'o2', lines: [orderLine({ eventNames: ['Shrek · sáb 14/11'] })] }),
      ],
    })
    expect(row.status).toBe('late')
  })

  it('lo vio el conteo del domingo y no hizo falta pedirlo', () => {
    const row = only({
      events: [event('2026-11-12')],
      sentCounts: [{ id: 'c-dom', countDate: '2026-11-08', eventsUntil: '2026-11-12' }],
    })
    expect(row.status).toBe('counted')
    expect(row.countDate).toBe('2026-11-08')
  })

  it('pero si ese pedido se descartó con «Hoy no pido», vuelve a avisar', () => {
    const row = only({
      events: [event('2026-11-12')],
      sentCounts: [{ id: 'c-dom', countDate: '2026-11-08', eventsUntil: '2026-11-12' }],
      orders: [
        order({ countId: 'c-dom', status: 'discarded', discardReason: 'skipped', lines: [] }),
      ],
    })
    expect(row.status).toBe('late')
  })
})

describe('lo de la semana', () => {
  it('las fechas de los próximos 7 días y, más adelante, lo que hay que pedir aparte esta semana', () => {
    const lejos = supplier({ id: 's-lejos', name: 'Importado', leadDays: 6 })
    const all = run({
      events: [
        event('2026-11-14'),
        event('2026-11-20', { id: 'e-20', name: 'Pasta' }),
        event('2026-11-24', { id: 'e-24', name: 'Sushi', templateId: 't-sushi' }),
      ],
      suppliers: [supplier(), lejos],
      items: [item(), item({ id: 'i-wasabi', name: 'Wasabi', supplierId: 's-lejos' })],
    })
    const week = weekDeadlines(all, WED)
    // El 14 está en la semana. El 20 y el 24 quedan afuera, salvo por lo que hay que pedir aparte antes del
    // 17: para el 20, al Importado (6 días) hay que pedirle el jueves 12. El 24 no tiene receta.
    expect(week.map((e) => e.planned.event.date)).toEqual(['2026-11-14', '2026-11-20'])
  })
})

describe('lo que ve Tex', () => {
  it('cada evento con hasta cuándo pedirle a cada proveedor', () => {
    const carnes = supplier({ id: 's-carnes', name: 'Carnes La Recta', leadDays: 2 })
    const all = run({
      events: [event('2026-11-13'), event('2026-11-20', { id: 'e-20' })],
      suppliers: [supplier(), carnes],
      items: [item(), item({ id: 'i-bondiola', name: 'Bondiola', supplierId: 's-carnes' })],
    })
    const data = eventsData(all, WED)
    expect(data[0]).toMatchObject({
      tiene_que_llegar_hasta: 'hoy',
      proveedores: [
        { proveedor: 'Carnes La Recta', estado: expect.stringContaining('tarde') },
        { proveedor: 'Barracuda', estado: expect.stringContaining('pedido hoy llega mañana') },
      ],
    })
    expect(data[1]?.proveedores).toEqual([
      {
        proveedor: 'Carnes La Recta',
        insumos: 1,
        estado: 'pedirlo aparte hasta lun 16/11 (ningún conteo llega a tiempo)',
      },
      {
        proveedor: 'Barracuda',
        insumos: 1,
        estado: 'pedirlo aparte hasta mar 17/11 (ningún conteo llega a tiempo)',
      },
    ])
  })
})
