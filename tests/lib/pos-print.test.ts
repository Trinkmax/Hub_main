// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildShiftReport, type ShiftReport } from '@/lib/pos/cash/report'
import type { Shift, ShiftSnapshot, ShiftSummary } from '@/lib/pos/cash/types'
import { buildCards } from '@/lib/pos/kitchen/cards'
import { billDoc } from '@/lib/pos/print/bill'
import { comandaDoc } from '@/lib/pos/print/comanda'
import {
  type PrintDoc,
  type PrintLine,
  ticketDateTime,
  ticketMoney,
  ticketTime,
} from '@/lib/pos/print/doc'
import { escapeHtml, renderPrintJob } from '@/lib/pos/print/html'
import { shiftDoc } from '@/lib/pos/print/shift'
import {
  comandaDocs,
  DEFAULT_PRINTER,
  duePrints,
  PRINTED_KEEP_MAX,
  PRINTED_KEEP_MS,
  parsePrinted,
  parsePrinter,
  printCards,
  rememberPrinted,
  reprintCard,
  setAuto,
} from '@/lib/pos/print/station'
import type {
  KitchenItem,
  KitchenQueue,
  KitchenTicket,
  SessionDetail,
  SessionItem,
} from '@/lib/pos/types'
import { sampleNightClosed, TIME_ZONE } from './pos-cashbox-samples'
import { discount, line, makeBill, payment, pesos } from './pos-pay-fixtures'

/**
 * Lo que sale por la comandera: la comanda de cocina, la cuenta de la mesa y el cierre de caja; y qué
 * imprime sola la compu que tiene la impresora, sin repetir ni saltear.
 */

const NOW = Date.parse('2026-11-17T01:00:00.000Z') // 22:00 en Córdoba
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const PLANCHA = 'st-plancha'
const PIZZAS = 'st-pizzas'

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
    station_id: PLANCHA,
    prep_status: 'queued',
    started_at: null,
    ready_at: null,
    ...over,
  }
}
const mod = (label: string) => ({ id: label, label, group: 'Aclaraciones', delta_cents: 0 })

function ticket(over: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: 't1',
    session_id: 's1',
    status: 'accepted',
    course: 1,
    fired_at: ago(5),
    ready_at: null,
    kitchen_seen_at: null,
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

function queue(tickets: KitchenTicket[]): KitchenQueue {
  return {
    now: new Date(NOW).toISOString(),
    branch: { id: 'b1', name: 'Cerro', color: '#14532d' },
    settings: { kitchen_warn_minutes: 12, kitchen_late_minutes: 20 },
    stations: [
      { id: PLANCHA, name: 'Plancha', color: '#b45309' },
      { id: PIZZAS, name: 'Pizzas', color: '#0e7490' },
    ],
    tickets,
  }
}

const textOf = (doc: PrintDoc): string =>
  doc.lines
    .map((entry: PrintLine) => {
      if (entry.kind === 'text' || entry.kind === 'banner') return entry.text
      if (entry.kind === 'row') return `${entry.left} | ${entry.right}`
      if (entry.kind === 'item') {
        const variants = entry.variants.map((v) => `${v.qty} ${v.marks.join(', ')}`).join(' / ')
        return [entry.qty, entry.name, entry.marks.join(', '), variants].filter(Boolean).join(' ')
      }
      if (entry.kind === 'blank') return `${entry.label}: ____`
      return ''
    })
    .filter(Boolean)
    .join('\n')

const CONTEXT = { branch: 'Cerro', timeZone: TIME_ZONE, stationLabel: null }

describe('la comanda en papel', () => {
  it('arriba, la mesa; los productos iguales juntos y cada aclaración debajo', () => {
    const [card] = buildCards(
      queue([
        ticket({
          course: 2,
          items: [
            item({ name: 'Cheese Burger' }),
            item({ name: 'Cheese Burger' }),
            item({ name: 'Lomito', modifiers: [mod('Sin TACC')] }),
            item({ name: 'Lomito', modifiers: [mod('Papas rústicas')], notes: 'bien cocido' }),
          ],
        }),
      ]),
      [],
    )
    if (!card) throw new Error('sin comanda')
    const text = textOf(comandaDoc(card, CONTEXT))
    expect(text).toContain('Mesa 12')
    expect(text).toContain('Salón · 4 personas · Tanda 2')
    expect(text).toContain('Pedido 21:55')
    expect(text).toContain('x2 Cheese Burger')
    expect(text).toContain('x2 Lomito x1 Sin TACC / x1 Papas rústicas, «bien cocido»')
    expect(text).toContain('4 productos')
  })

  it('entre varias formas, la que no lleva nada dice «Común»', () => {
    const [card] = buildCards(
      queue([
        ticket({
          items: [item({ name: 'Lomito' }), item({ name: 'Lomito', modifiers: [mod('Jugoso')] })],
        }),
      ]),
      [],
    )
    if (!card) throw new Error('sin comanda')
    expect(textOf(comandaDoc(card, CONTEXT))).toContain('x2 Lomito x1 Jugoso / x1 Común')
  })

  it('un aviso de salud va en una franja; la práctica también', () => {
    const [card] = buildCards(
      queue([ticket({ alerts: ['celiac', 'vegetarian'], is_practice: true })]),
      [],
    )
    if (!card) throw new Error('sin comanda')
    const doc = comandaDoc(card, CONTEXT)
    const banners = doc.lines.filter((entry) => entry.kind === 'banner').map((entry) => entry.text)
    expect(banners).toEqual(['Práctica · no cocinar', 'Celíaco · sin TACC'])
    expect(textOf(doc)).toContain('Vegetariano')
  })

  it('sin mesa manda el nombre, o qué clase de pedido es', () => {
    const [named] = buildCards(
      queue([ticket({ table_label: null, alias: 'Martín', kind: 'quick' })]),
      [],
    )
    const [delivery] = buildCards(
      queue([ticket({ table_label: null, alias: null, kind: 'delivery', area: null })]),
      [],
    )
    if (!named || !delivery) throw new Error('sin comanda')
    expect(comandaDoc(named, CONTEXT).title).toBe('Comanda Martín')
    expect(comandaDoc(delivery, CONTEXT).title).toBe('Comanda Delivery')
  })

  it('la reimpresión lo dice, y la comandera de una estación lleva su nombre', () => {
    const [card] = buildCards(queue([ticket()]), [PLANCHA])
    if (!card) throw new Error('sin comanda')
    const text = textOf(comandaDoc(card, { ...CONTEXT, stationLabel: 'Plancha', reprint: true }))
    expect(text.split('\n')[0]).toBe('Plancha · Cerro')
    expect(text).toContain('Reimpresión')
  })
})

describe('el tique dibujado', () => {
  it('escapa todo lo que viene escrito a mano', () => {
    expect(escapeHtml(`<b>"Tom & Jerry's"</b>`)).toBe(
      '&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/b&gt;',
    )
    const [card] = buildCards(
      queue([ticket({ items: [item({ name: 'Lomo <script>', notes: '<img src=x>' })] })]),
      [],
    )
    if (!card) throw new Error('sin comanda')
    const html = renderPrintJob({ paper: 80, docs: [comandaDoc(card, CONTEXT)] })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('Lomo &lt;script&gt;')
  })

  it('el ancho sale del rollo: 72 mm en el de 80 y 48 en el de 58', () => {
    const doc: PrintDoc = { title: 'Prueba', lines: [{ kind: 'text', text: 'Hola' }] }
    expect(renderPrintJob({ paper: 80, docs: [doc] })).toContain('width: 72mm')
    expect(renderPrintJob({ paper: 58, docs: [doc] })).toContain('width: 48mm')
  })

  it('varios tiques van en el mismo trabajo, uno por hoja', () => {
    const doc: PrintDoc = { title: 'Prueba', lines: [{ kind: 'rule' }] }
    const html = renderPrintJob({ paper: 80, docs: [doc, doc, doc] })
    expect(html.match(/<section class="ticket">/g)).toHaveLength(3)
  })

  it('plata y horas como se leen en un tique', () => {
    expect(ticketMoney(1_250_000)).toBe('$ 12.500')
    expect(ticketMoney(1_250_050)).toBe('$ 12.500,50')
    expect(ticketMoney(-500_000)).toBe('−$ 5.000')
    expect(ticketMoney(0)).toBe('$ 0')
    expect(ticketTime('2026-11-17T01:05:00.000Z', TIME_ZONE)).toBe('22:05')
    expect(ticketDateTime('2026-11-17T01:05:00.000Z', TIME_ZONE)).toBe('16/11/2026 22:05')
    expect(ticketTime('no es una fecha', TIME_ZONE)).toBe('')
  })
})

describe('la compu que tiene la comandera', () => {
  const on = setAuto(DEFAULT_PRINTER, true, NOW - 10 * 60_000)

  it('apagada no imprime nada', () => {
    expect(duePrints(queue([ticket()]), DEFAULT_PRINTER, {})).toEqual([])
  })

  it('imprime lo que salió a cocina desde que se prendió, en orden de llegada', () => {
    const due = duePrints(
      queue([
        ticket({ id: 'viejo', fired_at: ago(30) }),
        ticket({ id: 'b', fired_at: ago(2) }),
        ticket({ id: 'a', fired_at: ago(6) }),
      ]),
      on,
      {},
    )
    expect(due.map((entry) => entry.key)).toEqual(['a', 'b'])
  })

  it('lo impreso no se repite', () => {
    const tickets = [ticket({ id: 'a', fired_at: ago(6) }), ticket({ id: 'b', fired_at: ago(2) })]
    const log = rememberPrinted({}, ['a'], NOW)
    expect(duePrints(queue(tickets), on, log).map((entry) => entry.key)).toEqual(['b'])
  })

  it('una comandera de una estación imprime solo lo suyo, con su nombre arriba', () => {
    const tickets = [
      ticket({
        id: 'mixta',
        items: [item({ name: 'Lomito' }), item({ name: 'Muzza', station_id: PIZZAS })],
      }),
      ticket({ id: 'pizza', items: [item({ name: 'Muzza', station_id: PIZZAS })] }),
    ]
    const due = duePrints(queue(tickets), { ...on, stations: [PLANCHA] }, {})
    expect(due.map((entry) => entry.key)).toEqual(['mixta'])
    expect(due[0]?.stationLabel).toBe('Plancha')
    expect(due[0]?.card.lines.map((entry) => entry.name)).toEqual(['Lomito'])
    expect(due[0]?.card.others.map((other) => other.name)).toEqual(['Pizzas'])
  })

  it('una estación que ya no existe no deja a la comandera muda: imprime todo', () => {
    const due = duePrints(queue([ticket()]), { ...on, stations: ['borrada'] }, {})
    expect(due).toHaveLength(1)
    expect(due[0]?.stationLabel).toBeNull()
  })

  it('un tique por estación: la comanda mixta sale en dos, cada una con lo suyo', () => {
    const mixed = ticket({
      id: 'mixta',
      items: [item({ name: 'Lomito' }), item({ name: 'Muzza', station_id: PIZZAS })],
    })
    const parts = printCards(queue([mixed]), { ...on, splitByStation: true })
    expect(parts.map((part) => [part.key, part.stationLabel])).toEqual([
      [`mixta:${PLANCHA}`, 'Plancha'],
      [`mixta:${PIZZAS}`, 'Pizzas'],
    ])
    expect(parts.map((part) => part.card.lines.map((entry) => entry.name))).toEqual([
      ['Lomito'],
      ['Muzza'],
    ])
    // La de una sola estación sale entera, anotada con su estación.
    const [single] = printCards(queue([ticket({ id: 'sola' })]), { ...on, splitByStation: true })
    expect(single?.key).toBe(`sola:${PLANCHA}`)
  })

  it('las copias repiten el tique', () => {
    const due = duePrints(queue([ticket()]), on, {})
    expect(comandaDocs(due, { branch: 'Cerro', timeZone: TIME_ZONE, copies: 2 })).toHaveLength(2)
    expect(comandaDocs(due, { branch: 'Cerro', timeZone: TIME_ZONE })).toHaveLength(1)
  })

  it('prender anota desde cuándo; apagar lo borra', () => {
    expect(on).toMatchObject({ auto: true, since: NOW - 10 * 60_000 })
    expect(setAuto(on, true, NOW)).toBe(on)
    expect(setAuto(on, false, NOW)).toMatchObject({ auto: false, since: null })
  })

  it('lo guardado en el dispositivo se lee sin confiar en su forma', () => {
    expect(parsePrinter(null)).toEqual(DEFAULT_PRINTER)
    expect(parsePrinter('x')).toEqual(DEFAULT_PRINTER)
    expect(
      parsePrinter({ auto: true, paper: 58, stations: ['a', 'a', 7], copies: 2, since: 5 }),
    ).toEqual({
      auto: true,
      paper: 58,
      stations: ['a'],
      splitByStation: false,
      copies: 2,
      since: 5,
    })
    // Prendida sin fecha imprimiría toda la cola: la fecha no se inventa, queda sin imprimir nada.
    expect(duePrints(queue([ticket()]), parsePrinter({ auto: true }), {})).toEqual([])
    expect(parsePrinter({ paper: 100, copies: 9 })).toMatchObject({ paper: 80, copies: 1 })
    expect(parsePrinted({ a: 1, b: 'x', c: Number.NaN })).toEqual({ a: 1 })
    expect(parsePrinted([1, 2])).toEqual({})
  })

  it('lo impreso se olvida después de un día y medio, y nunca pasa de mil', () => {
    const old = rememberPrinted(
      { viejo: NOW - PRINTED_KEEP_MS - 1, ayer: NOW - 1000 },
      ['nuevo'],
      NOW,
    )
    expect(Object.keys(old).sort()).toEqual(['ayer', 'nuevo'])
    const many: Record<string, number> = {}
    for (let i = 0; i < PRINTED_KEEP_MAX + 50; i++) many[`t${i}`] = NOW - i
    const kept = rememberPrinted(many, ['último'], NOW)
    expect(Object.keys(kept)).toHaveLength(PRINTED_KEEP_MAX)
    expect(kept.último).toBe(NOW)
    expect(kept[`t${PRINTED_KEEP_MAX + 49}`]).toBeUndefined()
  })
})

describe('volver a imprimir una tanda desde la comanda del mozo', () => {
  const sessionItem = (over: Partial<SessionItem> = {}): SessionItem => ({
    id: `si-${over.name ?? 'lomito'}-${over.prep_status ?? 'queued'}`,
    menu_item_id: `m-${over.name ?? 'lomito'}`,
    name: 'Lomito',
    quantity: 1,
    unit_price_cents: 1_400_000,
    line_total_cents: 1_400_000,
    notes: null,
    modifiers: [],
    station_id: PLANCHA,
    prep_status: 'queued',
    ready_at: null,
    served_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    ...over,
  })
  const detail = (items: SessionItem[], firedAt: string | null = ago(8)): SessionDetail => ({
    now: new Date(NOW).toISOString(),
    session: {
      id: 's1',
      status: 'open',
      branch_id: 'b1',
      table_id: 'tb7',
      opened_at: ago(40),
      party_size: 3,
      alias: null,
      note: null,
      bill_requested_at: null,
      total_cents: 0,
      is_practice: false,
      kind: 'table',
      paid_at: null,
    },
    table: { id: 'tb7', label: '7', capacity: 4, area: 'Terraza' },
    reservation: null,
    customer: null,
    tickets: [
      {
        id: 'tk1',
        status: 'accepted',
        course: 1,
        held: firedAt === null,
        submitted_at: ago(9),
        fired_at: firedAt,
        kitchen_seen_at: null,
        ready_at: null,
        served_at: null,
        total_cents: 0,
        items,
      },
    ],
  })

  it('sale la tanda entera, con los iguales juntos y sin lo dado de baja', () => {
    const card = reprintCard(
      detail([
        sessionItem({ name: 'Cheese Burger' }),
        sessionItem({ name: 'Cheese Burger', id: 'otro', station_id: PIZZAS }),
        sessionItem({ name: 'Flan', cancelled_at: ago(2) }),
      ]),
      'tk1',
    )
    expect(card?.title).toBe('7')
    expect(card?.where).toBe('Terraza')
    expect(card?.lines.map((entry) => [entry.quantity, entry.name])).toEqual([[2, 'Cheese Burger']])
    expect(card?.groups).toHaveLength(1)
  })

  it('una tanda que ya se entregó entera igual se puede reimprimir', () => {
    const card = reprintCard(detail([sessionItem({ prep_status: 'served' })]), 'tk1')
    expect(card?.lines).toHaveLength(1)
  })

  it('no hay nada que imprimir si la tanda no existe, no se marchó o quedó vacía', () => {
    expect(reprintCard(detail([sessionItem()]), 'otra')).toBeNull()
    expect(reprintCard(detail([sessionItem()], null), 'tk1')).toBeNull()
    expect(reprintCard(detail([sessionItem({ cancelled_at: ago(1) })]), 'tk1')).toBeNull()
  })
})

describe('la cuenta en papel', () => {
  const context = { barName: 'HUB!', branch: 'Cerro', timeZone: TIME_ZONE }

  it('los productos juntos, el total y que no es una factura', () => {
    const bill = makeBill({
      lines: [line('Mojito', 2, 8000), line('Mojito', 2, 8000), line('Lomito', 1, 14000)],
    })
    const text = textOf(billDoc(bill, context))
    expect(text).toContain('HUB!')
    expect(text).toContain('Mesa 12 · 4 personas')
    expect(text).toContain('4 Mojito | $ 32.000')
    expect(text).toContain('$ 8.000 c/u')
    expect(text).toContain('1 Lomito | $ 14.000')
    expect(text).toContain('TOTAL | $ 46.000')
    expect(text).toContain('Entre 4 | $ 11.500 c/u')
    expect(text).toContain('Documento no válido como factura')
    // Sin descuentos ni seña no hace falta repetir el consumo.
    expect(text).not.toContain('Consumo |')
  })

  it('con descuento y seña se ve de dónde sale el total', () => {
    const bill = makeBill({
      lines: [line('Lomito', 2, 14000)],
      discounts: [discount('amount', pesos(3000), { reason: 'Demora', amount_cents: pesos(3000) })],
      depositPesos: 5000,
    })
    const text = textOf(billDoc(bill, context))
    expect(text).toContain('Consumo | $ 28.000')
    expect(text).toContain('Descuento · Demora | −$ 3.000')
    expect(text).toContain('Seña | −$ 5.000')
    expect(text).toContain('TOTAL | $ 20.000')
  })

  it('si el detalle de los descuentos no da la suma, va una sola línea con el total descontado', () => {
    const bill = makeBill({
      lines: [line('Lomito', 2, 14000)],
      discounts: [discount('amount', pesos(3000))],
    })
    const text = textOf(billDoc(bill, context))
    expect(text).toContain('Descuentos | −$ 3.000')
    expect(text).toContain('TOTAL | $ 25.000')
  })

  it('con una parte cobrada dice cuánto falta, y el alias si quieren transferir', () => {
    const bill = makeBill({
      lines: [line('Lomito', 2, 14000)],
      payments: [payment('cash', 10000, { payer_label: 'Parte 1 de 2' })],
      overrides: { settings: { transfer_alias: 'hub.cerro', transfer_holder: 'HUB SAS' } },
    })
    const text = textOf(billDoc(bill, context))
    expect(text).toContain('Pagado · Efectivo · Parte 1 de 2 | $ 10.000')
    expect(text).toContain('FALTA | $ 18.000')
    expect(text).toContain('Alias: hub.cerro')
    expect(text).toContain('HUB SAS')
    expect(text).not.toContain('Entre 4')
  })

  it('una mesa de práctica lo dice en una franja', () => {
    const bill = makeBill({
      lines: [line('Lomito', 1, 14000)],
      overrides: { session: { is_practice: true } },
    })
    const banners = billDoc(bill, context)
      .lines.filter((entry) => entry.kind === 'banner')
      .map((entry) => entry.text)
    expect(banners).toEqual(['Práctica · no es una cuenta de verdad'])
  })
})

describe('el cierre de caja en papel', () => {
  function reportOf(snapshot: ShiftSnapshot): ShiftReport {
    const shift = snapshot.shift as Shift
    return buildShiftReport({
      branchName: snapshot.branch.name,
      shift,
      summary: (shift.summary ?? snapshot.live) as ShiftSummary,
      timeZone: TIME_ZONE,
      registersCount: snapshot.registers.length,
    })
  }

  it('dice lo mismo que el resumen de la pantalla y deja lugar para firmar', () => {
    const report = reportOf(sampleNightClosed())
    const doc = shiftDoc(report, {
      barName: 'HUB!',
      timeZone: TIME_ZONE,
      printedAt: '2026-11-17T05:10:00.000Z',
      printedBy: 'Caro',
    })
    const text = textOf(doc)
    expect(doc.title).toBe('Cierre de caja')
    expect(text).toContain('Cierre de caja')
    expect(text).toContain(report.meta)
    for (const section of report.sections) {
      expect(text).toContain(section.title)
      for (const entry of section.lines) expect(text).toContain(entry.label)
    }
    expect(text).toContain('Arqueo: ')
    expect(text).toContain('Contó: ____')
    expect(text).toContain('Controló: ____')
    expect(text).toContain('Impreso 17/11/2026 02:10 por Caro')
  })
})
