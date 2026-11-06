import { describe, expect, it } from 'vitest'
import { countByGroup, dataIssues } from '@/lib/purchasing/checks'
import {
  defaultEventsUntil,
  longDayLabel,
  nextDeliveryDate,
  relativeDayLabel,
  weekdaysText,
} from '@/lib/purchasing/dates'
import { computeEventNeeds, planEvent } from '@/lib/purchasing/events'
import {
  buildSuggestion,
  countedQty,
  countSummary,
  itemsForCount,
  stockLevel,
  suggestLine,
  toSubmitPayload,
} from '@/lib/purchasing/suggest'
import type {
  CalendarEvent,
  PurItem,
  PurRecipe,
  PurSupplier,
  PurZone,
} from '@/lib/purchasing/types'
import {
  convertQty,
  formatQty,
  packsFor,
  packsText,
  parseQty,
  unitKey,
} from '@/lib/purchasing/units'
import { claimMessage, differenceText, orderMessage, whatsappLink } from '@/lib/purchasing/whatsapp'

const item = (over: Partial<PurItem> = {}): PurItem => ({
  id: 'i1',
  code: 'INS-001',
  name: 'Bondiola de cerdo',
  brand: null,
  zoneId: 'z1',
  unit: 'kg',
  frequency: 'frequent',
  targetQty: 10,
  packLabel: 'Por kg',
  packSize: 1,
  supplierId: 's1',
  notes: null,
  active: true,
  ...over,
})

const supplier = (over: Partial<PurSupplier> = {}): PurSupplier => ({
  id: 's1',
  name: 'Va Food',
  contactName: 'Juan',
  whatsapp: '5493511234567',
  deliveryWeekdays: [3, 5],
  leadDays: 1,
  notes: null,
  accPartyId: null,
  active: true,
  ...over,
})

const zones: PurZone[] = [
  { id: 'z1', name: 'Freezer carnes y panes', area: 'Planta alta', sortOrder: 10, active: true },
  { id: 'z2', name: 'Cámara de frío', area: 'Planta alta', sortOrder: 20, active: true },
]

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1',
  date: '2026-10-27',
  startsAt: '21:00',
  name: 'Shrek',
  templateId: 't-shrek',
  capacity: 50,
  reservedGuests: 20,
  ...over,
})

const recipe = (over: Partial<PurRecipe> = {}): PurRecipe => ({
  id: 'r1',
  templateId: 't-shrek',
  name: 'Peli y comida: Shrek',
  variant: 'Única',
  baseGuests: 60,
  notes: null,
  active: true,
  lines: [
    {
      id: 'l1',
      itemId: 'i-pata',
      name: 'Pata de pollo',
      quantity: 66,
      unit: 'unidad',
      inHouse: false,
      note: null,
      sortOrder: 1,
    },
    {
      id: 'l2',
      itemId: 'i-ajo',
      name: 'Ajo',
      quantity: 50,
      unit: 'g',
      inHouse: false,
      note: null,
      sortOrder: 2,
    },
    {
      id: 'l3',
      itemId: null,
      name: 'Caldo / fondo',
      quantity: 7,
      unit: 'L',
      inHouse: true,
      note: null,
      sortOrder: 3,
    },
  ],
  ...over,
})

describe('unidades y presentaciones', () => {
  it('reconoce la misma unidad escrita distinto', () => {
    expect(unitKey('Porción')).toBe('porcion')
    expect(unitKey('Lt')).toBe('l')
    expect(unitKey('kgs')).toBe('kg')
  })

  it('convierte solo lo seguro', () => {
    expect(convertQty(500, 'g', 'kg')).toBe(0.5)
    expect(convertQty(1.5, 'L', 'ml')).toBe(1500)
    expect(convertQty(66, 'unidad', 'kg')).toBeNull()
    expect(convertQty(3, null, 'kg')).toBe(3)
  })

  it('redondea hacia arriba a la presentación sin sumar de más por los decimales', () => {
    expect(packsFor(66, 1, 'kg')).toBe(66)
    expect(packsFor(151, 150, 'unidad')).toBe(2)
    expect(packsFor(4.0000001, 1, 'kg')).toBe(4)
    expect(packsFor(0.5, 150, 'unidad')).toBe(1)
    // Sin presentación: enteros si se cuenta por pieza, de a 0,1 si se pesa.
    expect(packsFor(2.31, null, 'kg')).toBe(2.4)
    expect(packsFor(2.31, null, 'atado')).toBe(3)
    expect(packsFor(0, 1, 'kg')).toBe(0)
  })

  it('escribe lo que se pide como lo lee el proveedor', () => {
    expect(packsText({ packs: 66, packLabel: 'Por kg', packSize: 1, unit: 'kg' })).toBe('66 kg')
    expect(packsText({ packs: 2, packLabel: 'Caja x 150 u', packSize: 150, unit: 'unidad' })).toBe(
      '2 × Caja x 150 u',
    )
    expect(packsText({ packs: 3, packLabel: 'x 2 kg', packSize: 2, unit: 'kg' })).toBe('3 × 2 kg')
    expect(packsText({ packs: 4, packLabel: null, packSize: null, unit: 'unidad' })).toBe('4 u')
    expect(packsText({ packs: 2, packLabel: 'Unidad de 4 kg', packSize: 4, unit: 'kg' })).toBe(
      '2 × Unidad de 4 kg',
    )
    expect(packsText({ packs: 1.5, packLabel: null, packSize: null, unit: 'kg' })).toBe('1,5 kg')
  })

  it('lee los números de la cocina', () => {
    expect(parseQty('2,5')).toBe(2.5)
    expect(parseQty(' 3 ')).toBe(3)
    expect(parseQty('')).toBeNull()
    expect(parseQty('-1')).toBeNull()
    expect(parseQty('dos')).toBeNull()
    expect(formatQty(0.25)).toBe('0,25')
  })
})

describe('fechas', () => {
  it('el próximo día de entrega desde mañana', () => {
    // Martes 27/10: entrega miércoles y viernes → miércoles 28/10.
    expect(nextDeliveryDate('2026-10-27', [3, 5])).toBe('2026-10-28')
    // Miércoles 28/10 → viernes 30/10 (el mismo día no cuenta: lo que se pide hoy llega desde mañana).
    expect(nextDeliveryDate('2026-10-28', [3, 5])).toBe('2026-10-30')
    expect(nextDeliveryDate('2026-10-28', [3, 5], 0)).toBe('2026-10-28')
    expect(nextDeliveryDate('2026-10-27', [])).toBeNull()
  })

  it('los eventos del conteo llegan hasta el día antes del próximo conteo', () => {
    // Lunes 26/10, se cuenta lunes y miércoles → hasta el martes 27/10.
    expect(defaultEventsUntil('2026-10-26', [1, 3])).toBe('2026-10-27')
    // Miércoles 28/10 → hasta el domingo 01/11.
    expect(defaultEventsUntil('2026-10-28', [1, 3])).toBe('2026-11-01')
    expect(defaultEventsUntil('2026-10-28', [])).toBe('2026-11-03')
  })

  it('etiquetas', () => {
    expect(relativeDayLabel('2026-10-27', '2026-10-27')).toBe('hoy')
    expect(relativeDayLabel('2026-10-28', '2026-10-27')).toBe('mañana')
    expect(relativeDayLabel('2026-10-29', '2026-10-27')).toBe('jue 29/10')
    expect(longDayLabel('2026-10-28')).toBe('miércoles 28/10')
    expect(weekdaysText([3, 1])).toBe('lunes y miércoles')
    expect(weekdaysText([0, 1, 5])).toBe('lunes, viernes y domingo')
  })
})

describe('lo que piden los eventos', () => {
  const items = new Map([
    ['i-pata', item({ id: 'i-pata', name: 'Pata de pollo', unit: 'unidad', targetQty: 0 })],
    ['i-ajo', item({ id: 'i-ajo', name: 'Ajo', unit: 'kg', targetQty: 1 })],
  ])

  it('nunca menos que las personas de la receta; más si hay más reservadas', () => {
    const chico = planEvent({
      event: event({ reservedGuests: 20 }),
      recipes: [recipe()],
      plan: undefined,
      baseGuests: 60,
    })
    expect(chico.guests).toBe(60)
    expect(chico.guestsSource).toBe('recipe')
    expect(chico.factor).toBe(1)
    const lleno = planEvent({
      event: event({ reservedGuests: 81 }),
      recipes: [recipe()],
      plan: undefined,
      baseGuests: 60,
    })
    expect(lleno.guests).toBe(81)
    expect(lleno.guestsSource).toBe('reserved')
    expect(lleno.factor).toBeCloseTo(1.35)
    const fijado = planEvent({
      event: event({ reservedGuests: 81 }),
      recipes: [recipe()],
      plan: { scheduledEventId: 'e1', recipeId: null, guests: 40, skip: false },
      baseGuests: 60,
    })
    expect(fijado.guests).toBe(40)
    expect(fijado.guestsSource).toBe('plan')
  })

  it('suma por insumo, pasa los gramos a kilos y deja lo de producción como recordatorio', () => {
    const r = computeEventNeeds({
      events: [event(), event({ id: 'e2', date: '2026-10-30', reservedGuests: 54 })],
      recipes: [recipe()],
      plans: [],
      items,
      baseGuests: 60,
    })
    expect(r.needs.get('i-pata')?.qty).toBe(132)
    expect(r.needs.get('i-ajo')?.qty).toBe(0.1)
    expect(r.needs.get('i-pata')?.events).toEqual(['Shrek · mar 27/10', 'Shrek · vie 30/10'])
    expect(r.inHouse).toHaveLength(2)
    expect(r.inHouse[0]).toMatchObject({ name: 'Caldo / fondo', qty: 7, unit: 'L' })
  })

  it('con varias variantes y ninguna elegida no suma; elegida, sí', () => {
    const cerdo = recipe({ id: 'rc', templateId: 't-ramen', variant: 'Cerdo' })
    const langostino = recipe({ id: 'rl', templateId: 't-ramen', variant: 'Langostino' })
    const ramen = event({ id: 'e9', name: 'Ramen', templateId: 't-ramen' })
    const sin = computeEventNeeds({
      events: [ramen],
      recipes: [cerdo, langostino],
      plans: [],
      items,
      baseGuests: 60,
    })
    expect(sin.events[0]?.status).toBe('needs_variant')
    expect(sin.needs.size).toBe(0)
    const con = computeEventNeeds({
      events: [ramen],
      recipes: [cerdo, langostino],
      plans: [{ scheduledEventId: 'e9', recipeId: 'rl', guests: null, skip: false }],
      items,
      baseGuests: 60,
    })
    expect(con.events[0]?.recipe?.variant).toBe('Langostino')
    expect(con.needs.get('i-pata')?.qty).toBe(66)
  })

  it('sin receta sale con lo de siempre; un aviso no suma; una fecha salteada tampoco', () => {
    const pizza = planEvent({
      event: event({ templateId: 't-pizza' }),
      recipes: [recipe()],
      plan: undefined,
      baseGuests: 60,
    })
    expect(pizza.status).toBe('no_recipe')
    const aviso = planEvent({
      event: event({ templateId: 't-2x1' }),
      recipes: [recipe({ templateId: 't-2x1', lines: [], notes: 'Revisar pan y carne.' })],
      plan: undefined,
      baseGuests: 60,
    })
    expect(aviso.status).toBe('notice_only')
    expect(aviso.notice).toBe('Revisar pan y carne.')
    const salteada = planEvent({
      event: event(),
      recipes: [recipe()],
      plan: { scheduledEventId: 'e1', recipeId: null, guests: null, skip: true },
      baseGuests: 60,
    })
    expect(salteada.status).toBe('skipped')
  })

  it('no pide insumos desactivados', () => {
    const off = new Map(items)
    off.set('i-pata', item({ id: 'i-pata', unit: 'unidad', active: false }))
    const r = computeEventNeeds({
      events: [event()],
      recipes: [recipe()],
      plans: [],
      items: off,
      baseGuests: 60,
    })
    expect(r.needs.has('i-pata')).toBe(false)
  })
})

describe('qué se cuenta', () => {
  const needs = new Map([['ev', { qty: 3, events: ['Shrek · mar 27/10'] }]])
  it('frecuentes siempre, secundarios una vez por mes, eventuales si un evento los pide', () => {
    const list = itemsForCount({
      items: [
        item({ id: 'f' }),
        item({ id: 's-ya', frequency: 'secondary' }),
        item({ id: 's-no', frequency: 'secondary' }),
        item({ id: 'ev', frequency: 'occasional' }),
        item({ id: 'ev-no', frequency: 'occasional' }),
        item({ id: 'off', active: false }),
      ],
      needs,
      lastCounted: new Map([
        ['s-ya', '2026-10-05'],
        ['s-no', '2026-09-28'],
      ]),
      countDate: '2026-10-26',
    })
    expect(list.map((i) => i.id)).toEqual(['f', 's-no', 'ev'])
  })
})

describe('el pedido sugerido', () => {
  it('Alcanza, Poco y No hay', () => {
    expect(countedQty({ state: 'enough', quantity: null }, 10, 0.5)).toBe(10)
    expect(countedQty({ state: 'low', quantity: null }, 10, 0.5)).toBe(5)
    expect(countedQty({ state: 'low', quantity: 2 }, 10, 0.5)).toBe(2)
    expect(countedQty({ state: 'none', quantity: null }, 10, 0.5)).toBe(0)
    expect(countedQty({ state: 'low', quantity: null }, null, 0.5)).toBeNull()
  })

  it('objetivo + eventos − contado − en camino, a la presentación', () => {
    const l = suggestLine({
      item: item({ targetQty: 15, packSize: 1 }),
      line: { state: 'exact', quantity: 3 },
      need: { qty: 5, events: ['Shrek · mar 27/10'] },
      inTransitQty: 2,
      lowFraction: 0.5,
    })
    expect(l?.needQty).toBe(15)
    expect(l?.suggestedPacks).toBe(15)
    expect(l?.eventNames).toEqual(['Shrek · mar 27/10'])
  })

  it('si alcanza o ya viene en camino, no se pide', () => {
    expect(
      suggestLine({
        item: item(),
        line: { state: 'enough', quantity: null },
        need: undefined,
        inTransitQty: 0,
        lowFraction: 0.5,
      }),
    ).toBeNull()
    expect(
      suggestLine({
        item: item(),
        line: { state: 'none', quantity: null },
        need: undefined,
        inTransitQty: 10,
        lowFraction: 0.5,
      }),
    ).toBeNull()
  })

  it('lo que no se contó no se pide, salvo lo del evento, que va completo', () => {
    expect(
      suggestLine({
        item: item(),
        line: undefined,
        need: undefined,
        inTransitQty: 0,
        lowFraction: 0.5,
      }),
    ).toBeNull()
    const ev = suggestLine({
      item: item({ name: 'Pata de pollo', unit: 'unidad', packSize: null, targetQty: null }),
      line: undefined,
      need: { qty: 66, events: ['Shrek · mar 27/10'] },
      inTransitQty: 0,
      lowFraction: 0.5,
    })
    expect(ev?.countedQty).toBeNull()
    expect(ev?.suggestedPacks).toBe(66)
  })

  it('sin objetivo y sin evento: si falta, lo define quien compra', () => {
    const l = suggestLine({
      item: item({ targetQty: null }),
      line: { state: 'none', quantity: null },
      need: undefined,
      inTransitQty: 0,
      lowFraction: 0.5,
    })
    expect(l?.suggestedPacks).toBeNull()
    expect(l?.needQty).toBeNull()
  })

  it('arma un pedido por proveedor, con la fecha de entrega, y lo sin proveedor al final', () => {
    const orders = buildSuggestion({
      items: [
        item({ id: 'a', name: 'Bondiola', zoneId: 'z2' }),
        item({ id: 'b', name: 'Agua', zoneId: 'z1' }),
        item({ id: 'c', name: 'Café en grano', supplierId: null }),
        item({ id: 'd', name: 'Hielo', supplierId: 's2' }),
      ],
      lines: new Map([
        ['a', { state: 'none' as const, quantity: null }],
        ['b', { state: 'low' as const, quantity: null }],
        ['c', { state: 'none' as const, quantity: null }],
        ['d', { state: 'enough' as const, quantity: null }],
      ]),
      needs: new Map(),
      inTransit: new Map(),
      suppliers: [supplier(), supplier({ id: 's2', name: 'Barracuda' })],
      zones,
      lowFraction: 0.5,
      today: '2026-10-27',
    })
    expect(orders.map((o) => o.supplier?.name ?? null)).toEqual(['Va Food', null])
    expect(orders[0]?.expectedDate).toBe('2026-10-28')
    // Por recorrido: primero el freezer (z1), después la cámara (z2).
    expect(orders[0]?.lines.map((l) => l.item.name)).toEqual(['Agua', 'Bondiola'])
    expect(orders[0]?.lines.map((l) => l.suggestedPacks)).toEqual([5, 10])
    const payload = toSubmitPayload(orders)
    expect(payload[0]?.lines[0]).toMatchObject({
      item_id: 'b',
      ordered_packs: 5,
      count_state: 'low',
      counted_qty: 5,
    })
    expect(payload[1]?.supplier_id).toBeNull()
  })

  it('el resumen cuenta por zona y separa lo que falta contar', () => {
    const s = countSummary({
      items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c', zoneId: 'z2' })],
      lines: new Map([
        ['a', { state: 'exact' as const, quantity: 12 }],
        ['b', { state: 'none' as const, quantity: null }],
      ]),
      needs: new Map(),
    })
    expect(s.counted).toBe(2)
    expect(s.none).toBe(1)
    expect(s.pending.map((i) => i.id)).toEqual(['c'])
    expect(s.zones.get('z1')).toMatchObject({ enough: 1, none: 1 })
    expect(stockLevel({ state: 'exact', quantity: 3 }, 10)).toBe('low')
  })
})

describe('WhatsApp', () => {
  const lines = [
    { name: 'Pata de pollo', packs: 66, packLabel: 'Por kg', packSize: 1, unit: 'kg' },
    { name: 'Kanikama', packs: 2, packLabel: 'Paquete x 1 kg', packSize: 1, unit: 'kg' },
    { name: 'Lo que no viene', packs: 0, packLabel: null, packSize: null, unit: 'kg' },
  ]

  it('el pedido, con la fecha de entrega y la nota', () => {
    const text = orderMessage({
      senderName: 'HUB',
      contactName: 'Juan',
      expectedDate: '2026-10-28',
      lines,
      note: 'Entregar antes de las 11',
    })
    expect(text).toBe(
      '¡Hola Juan! Te escribo de HUB. Te paso el pedido para el miércoles 28/10:\n\n' +
        '• Pata de pollo: 66 kg\n• Kanikama: 2 × Paquete x 1 kg\n\nEntregar antes de las 11\n\n' +
        '¿Me confirmás que llega ese día? ¡Gracias!',
    )
  })

  it('sin fecha pregunta cuándo; sin número no hay link', () => {
    const text = orderMessage({
      senderName: 'HUB',
      contactName: null,
      expectedDate: null,
      lines,
      note: null,
    })
    expect(text.startsWith('¡Hola! Te escribo de HUB. Te paso el pedido:')).toBe(true)
    expect(text.endsWith('¿Me confirmás disponibilidad y día de entrega? ¡Gracias!')).toBe(true)
    expect(whatsappLink(null, text)).toBeNull()
    expect(whatsappLink('5493511234567', 'Hola')).toBe('https://wa.me/5493511234567?text=Hola')
  })

  it('el reclamo de lo que faltó', () => {
    const claim = {
      name: 'Mejillones',
      packs: 3,
      packLabel: null,
      packSize: null,
      unit: 'kg',
      receivedPacks: 0,
    }
    expect(differenceText(claim)).toBe('llegó 0 de 3 kg')
    const text = claimMessage({
      senderName: 'HUB',
      contactName: null,
      receivedDate: '2026-10-27',
      lines: [claim],
    })
    expect(text).toContain('En el pedido que llegó el martes 27/10 hubo diferencias:')
    expect(text).toContain('• Mejillones: pedimos 3 kg y no llegó')
  })
})

describe('datos para corregir', () => {
  it('avisa lo que falta y se vacía cuando está todo', () => {
    const issues = dataIssues({
      items: [
        item({ id: 'a', supplierId: null }),
        item({ id: 'b', targetQty: null, packSize: null }),
        item({ id: 'pata', name: 'Pata de pollo', unit: 'kg' }),
      ],
      suppliers: [supplier({ whatsapp: null, deliveryWeekdays: [] })],
      recipes: [
        recipe({
          lines: [
            {
              id: 'x1',
              itemId: 'pata',
              name: 'Pata de pollo',
              quantity: 66,
              unit: 'unidad',
              inHouse: false,
              note: null,
              sortOrder: 1,
            },
            {
              id: 'x2',
              itemId: null,
              name: 'Hielo',
              quantity: 10,
              unit: 'kg',
              inHouse: false,
              note: null,
              sortOrder: 2,
            },
            {
              id: 'x3',
              itemId: 'a',
              name: 'Wasabi',
              quantity: null,
              unit: 'unidad',
              inHouse: false,
              note: null,
              sortOrder: 3,
            },
          ],
        }),
      ],
      upcoming: [],
    })
    const text = issues.map((i) => i.text)
    expect(text).toContain('Va Food: faltan el WhatsApp y los días de entrega.')
    expect(text).toContain('Bondiola de cerdo: falta el proveedor.')
    expect(text).toContain('Bondiola de cerdo: es frecuente y no tiene stock objetivo.')
    expect(text).toContain(
      'Peli y comida: Shrek: «Pata de pollo» está en u y en la lista se cuenta en kg.',
    )
    expect(text).toContain('Peli y comida: Shrek: «Hielo» no está en la lista de insumos.')
    expect(text).toContain('Peli y comida: Shrek: «Bondiola de cerdo» no tiene cantidad.')
    expect(countByGroup(issues)).toMatchObject({ proveedores: 1, recetas: 3 })

    const ok = dataIssues({ items: [item()], suppliers: [supplier()], recipes: [], upcoming: [] })
    expect(ok).toEqual([])
  })
})
