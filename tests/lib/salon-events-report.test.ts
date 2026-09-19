import { describe, expect, it } from 'vitest'
import { type EventMarketingRow, MARKETING_EXPORT_HEADERS } from '@/lib/salon/event-marketing'
import {
  aggregateDayReport,
  aggregateEditions,
  aggregateTemplateReport,
  DAY_EXPORT_HEADERS,
  dayReportToCsv,
  editionDelta,
  eventTitle,
  type ReportEventRow,
  type ReportReservationRow,
  reportExportFilename,
  TEMPLATE_EXPORT_HEADERS,
  templateReportToCsv,
} from '@/lib/salon/events-report'

const HOY = '2026-09-09'

let seq = 0
function res(over: Partial<ReportReservationRow> = {}): ReportReservationRow {
  seq += 1
  return {
    id: `r${seq}`,
    reservation_date: '2026-09-07',
    scheduled_event_id: null,
    estimated_guests: 2,
    actual_guests: null,
    status: 'pending',
    ...over,
  }
}

function ev(over: Partial<ReportEventRow> = {}): ReportEventRow {
  return {
    id: 'ev-ramen',
    template_id: 'tpl-ramen',
    name_override: null,
    event_date: '2026-09-07',
    starts_at_local: '21:00:00',
    capacity: 100,
    template: { id: 'tpl-ramen', name: 'Ramen', color_hex: '#7c3aed' },
    ...over,
  }
}

describe('eventTitle', () => {
  it('prefiere el nombre especial de la edición', () => {
    expect(eventTitle({ name_override: 'Ramen aniversario', template: { name: 'Ramen' } })).toBe(
      'Ramen aniversario',
    )
  })

  it('cae al nombre del formato y normaliza los espacios de más', () => {
    // "Tapeo  y Malbec" existe así en la base.
    expect(eventTitle({ name_override: null, template: { name: 'Tapeo  y Malbec' } })).toBe(
      'Tapeo y Malbec',
    )
  })

  it('nunca queda vacío', () => {
    expect(eventTitle({ name_override: null, template: null })).toBe('Evento')
    expect(eventTitle({ name_override: '   ', template: null })).toBe('Evento')
  })
})

describe('aggregateDayReport', () => {
  it('parte la noche en el evento y las reservas normales', () => {
    // El caso que dio el dueño: el Ramen del lunes 7 de septiembre.
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [ev()],
      rows: [
        res({ scheduled_event_id: 'ev-ramen', estimated_guests: 6, actual_guests: 6 }),
        res({ scheduled_event_id: 'ev-ramen', estimated_guests: 5, actual_guests: 5 }),
        res({ scheduled_event_id: 'ev-ramen', estimated_guests: 3, actual_guests: 3 }),
        ...Array.from({ length: 18 }, () =>
          res({ scheduled_event_id: 'ev-ramen', estimated_guests: 2 }),
        ),
        res({ scheduled_event_id: 'ev-ramen', estimated_guests: 2, status: 'cancelled' }),
        res({ scheduled_event_id: 'ev-ramen', estimated_guests: 2, status: 'cancelled' }),
        res({ scheduled_event_id: 'ev-ramen', estimated_guests: 2, status: 'cancelled' }),
        res({ estimated_guests: 12, actual_guests: 13 }),
      ],
    })

    const ramen = r.blocks[0]
    expect(ramen?.title).toBe('Ramen')
    expect(ramen?.guests).toBe(50)
    expect(ramen?.reservations).toBe(21)
    expect(ramen?.avg).toBe(2.4)
    expect(ramen?.attendedGuests).toBe(14)
    expect(ramen?.countedTables).toBe(3)
    expect(ramen?.cancelled).toBe(3)
    expect(ramen?.fallenGuests).toBe(6)

    const sinEvento = r.blocks[1]
    expect(sinEvento?.key).toBe('sin-evento')
    expect(sinEvento?.guests).toBe(12)
    expect(sinEvento?.reservations).toBe(1)
    expect(sinEvento?.avg).toBe(12)
    expect(sinEvento?.attendedGuests).toBe(13)
  })

  it('las canceladas y las no-show NO entran en los tres números', () => {
    // Decisión del dueño, al revés que en el reporte de señas: acá contamos
    // gente que se sentó, y la que no vino no se sentó.
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 4 }),
        res({ estimated_guests: 6, status: 'cancelled' }),
        res({ estimated_guests: 3, status: 'no_show' }),
      ],
    })
    const b = r.blocks[0]
    expect(b?.guests).toBe(4)
    expect(b?.reservations).toBe(1)
    expect(b?.cancelled).toBe(1)
    expect(b?.noShow).toBe(1)
    expect(b?.fallenGuests).toBe(9)
    expect(r.totals).toEqual({ guests: 4, reservations: 1 })
  })

  it('devuelve el bloque "Sin evento" aunque esté en cero', () => {
    // Que la noche haya sido toda del evento es información; esconder el bloque
    // dejaría al dueño sin saber si es cero o si la pantalla se lo comió.
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [ev()],
      rows: [res({ scheduled_event_id: 'ev-ramen', estimated_guests: 4 })],
    })
    expect(r.blocks).toHaveLength(2)
    const plain = r.blocks[1]
    expect(plain?.key).toBe('sin-evento')
    expect(plain?.reservations).toBe(0)
    expect(plain?.avg).toBeNull()
  })

  it('ordena los eventos del día por hora de inicio y deja "Sin evento" al final', () => {
    const r = aggregateDayReport({
      day: '2026-09-03',
      events: [
        ev({
          id: 'a',
          event_date: '2026-09-03',
          starts_at_local: '21:00:00',
          template: { name: 'Pizza libre' },
        }),
        ev({
          id: 'b',
          event_date: '2026-09-03',
          starts_at_local: '13:00:00',
          template: { name: 'Merienda y Arte' },
        }),
      ],
      rows: [],
    })
    expect(r.blocks.map((b) => b.title)).toEqual(['Merienda y Arte', 'Pizza libre', 'Sin evento'])
  })

  it('una reserva de otro día no entra aunque venga en las filas', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 4 }),
        res({ reservation_date: '2026-09-08', estimated_guests: 9 }),
      ],
    })
    expect(r.totals.guests).toBe(4)
  })

  it('una reserva atada a un evento de OTRA fecha cuenta como reserva normal de su día', () => {
    // Nada en el schema obliga a que coincidan; la noche se arma con quién se
    // sienta esa noche.
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [ev()],
      rows: [res({ scheduled_event_id: 'ev-de-otro-dia', estimated_guests: 5 })],
    })
    expect(r.blocks[0]?.guests).toBe(0)
    expect(r.blocks[1]?.guests).toBe(5)
  })

  it('el promedio es null cuando no quedó ninguna reserva en pie', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [res({ estimated_guests: 2, status: 'cancelled' })],
    })
    expect(r.blocks[0]?.avg).toBeNull()
    expect(r.blocks[0]?.guests).toBe(0)
  })

  it('la asistencia NO se completa con el estimado, y las caídas no la ensucian', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 4, actual_guests: 4 }),
        res({ estimated_guests: 6 }),
        // Una cancelada con asistencia cargada: si se contara, el total mentiría.
        res({ estimated_guests: 2, actual_guests: 1, status: 'cancelled' }),
      ],
    })
    const b = r.blocks[0]
    expect(b?.attendedGuests).toBe(4)
    expect(b?.countedTables).toBe(1)
    expect(b?.reservations).toBe(2)
  })

  it('el muro ordena de la mesa más grande a la más chica y manda las caídas al final', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 2 }),
        res({ estimated_guests: 8, status: 'cancelled' }),
        res({ estimated_guests: 6 }),
      ],
    })
    expect(r.blocks[0]?.tables.map((t) => [t.guests, t.state])).toEqual([
      [6, 'open'],
      [2, 'open'],
      [8, 'fallen'],
    ])
  })

  it('suma bien cuando los enteros llegan como string', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [res({ estimated_guests: '7', actual_guests: '7' })],
    })
    expect(r.blocks[0]?.guests).toBe(7)
    expect(r.blocks[0]?.attendedGuests).toBe(7)
  })

  it('guarda la mesa más chica y la más grande para explicar el promedio', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [res({ estimated_guests: 2 }), res({ estimated_guests: 12 })],
    })
    expect(r.blocks[0]?.minParty).toBe(2)
    expect(r.blocks[0]?.maxParty).toBe(12)
    expect(r.blocks[0]?.avg).toBe(7)
  })
})

describe('billableGuests: la gente con la que se hace plata', () => {
  it('mesa cerrada cuenta lo contado y mesa sin cerrar cuenta lo reservado', () => {
    // El caso del Ramen del 7/9: la mayoría de las mesas quedó sin cerrar, así
    // que "asistieron" queda corto y no sirve para multiplicar plata.
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 6, actual_guests: 6 }),
        res({ estimated_guests: 5, actual_guests: 4 }),
        res({ estimated_guests: 2 }),
        res({ estimated_guests: 2 }),
      ],
    })
    const b = r.blocks[0]
    // Reservado 15, contado 10, y la cuenta de la plata: 6 + 4 + 2 + 2 = 14.
    expect(b?.guests).toBe(15)
    expect(b?.attendedGuests).toBe(10)
    expect(b?.billableGuests).toBe(14)
  })

  it('con todas las mesas cerradas es exactamente lo contado', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 4, actual_guests: 5 }),
        res({ estimated_guests: 6, actual_guests: 6 }),
      ],
    })
    expect(r.blocks[0]?.billableGuests).toBe(11)
    expect(r.blocks[0]?.attendedGuests).toBe(11)
  })

  it('sin ninguna mesa cerrada es exactamente lo reservado', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [res({ estimated_guests: 4 }), res({ estimated_guests: 6 })],
    })
    expect(r.blocks[0]?.billableGuests).toBe(10)
    expect(r.blocks[0]?.attendedGuests).toBe(0)
  })

  it('las caídas no suman, ni siquiera con asistencia cargada', () => {
    // Esa gente no se sentó: no consumió, no multiplica plata.
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 4, actual_guests: 4 }),
        res({ estimated_guests: 6, status: 'cancelled' }),
        res({ estimated_guests: 3, actual_guests: 3, status: 'no_show' }),
      ],
    })
    expect(r.blocks[0]?.billableGuests).toBe(4)
    expect(r.blocks[0]?.fallenGuests).toBe(9)
  })

  it('se sentaron más de los que habían reservado: manda lo contado', () => {
    // Pizza libre del 3/9: reservaron 62 y se sentaron 65.
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [res({ estimated_guests: 2, actual_guests: 5 }), res({ estimated_guests: 4 })],
    })
    expect(r.blocks[0]?.guests).toBe(6)
    expect(r.blocks[0]?.billableGuests).toBe(9)
  })

  it('cero cuando no quedó ninguna reserva en pie', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [res({ estimated_guests: 4, status: 'cancelled' })],
    })
    expect(r.blocks[0]?.billableGuests).toBe(0)
  })

  it('las ediciones lo cuentan igual que la vista por día', () => {
    const rows = [
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 6, actual_guests: 6 }),
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 5 }),
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 2, status: 'no_show' }),
    ]
    const dia = aggregateDayReport({ day: '2026-09-07', events: [ev()], rows })
    const ediciones = aggregateEditions({ events: [ev()], rows, today: HOY })
    expect(ediciones[0]?.billableGuests).toBe(11)
    expect(ediciones[0]?.billableGuests).toBe(dia.blocks[0]?.billableGuests)
  })
})

describe('aggregateTemplateReport', () => {
  const events = [
    ev({ id: 'e3', event_date: '2026-09-28' }),
    ev({ id: 'e2', event_date: '2026-09-07' }),
    ev({ id: 'e1', event_date: '2026-08-06' }),
    ev({ id: 'e0', event_date: '2026-07-12' }),
  ]
  const rows = [
    res({ scheduled_event_id: 'e3', estimated_guests: 2 }),
    ...Array.from({ length: 20 }, () => res({ scheduled_event_id: 'e2', estimated_guests: 2 })),
    res({ scheduled_event_id: 'e2', estimated_guests: 13 }),
    res({ scheduled_event_id: 'e1', estimated_guests: 2 }),
    res({ scheduled_event_id: 'e1', estimated_guests: 2 }),
  ]
  const report = aggregateTemplateReport({
    templateId: 'tpl-ramen',
    templateName: 'Ramen',
    colorHex: '#7c3aed',
    today: HOY,
    events,
    rows,
  })

  it('devuelve las ediciones de la más nueva a la más vieja, incluidas las vacías', () => {
    expect(report.editions.map((e) => e.date)).toEqual([
      '2026-09-28',
      '2026-09-07',
      '2026-08-06',
      '2026-07-12',
    ])
    expect(report.editions[3]?.reservations).toBe(0)
  })

  it('marca como futura la edición que todavía no pasó', () => {
    expect(report.editions[0]?.isFuture).toBe(true)
    expect(report.editions[1]?.isFuture).toBe(false)
  })

  it('el hero es la última edición PASADA con reservas', () => {
    expect(report.latest?.date).toBe('2026-09-07')
    expect(report.latest?.guests).toBe(53)
    expect(report.latest?.reservations).toBe(21)
    expect(report.latest?.avg).toBe(2.5)
  })

  it('la mejor y el promedio de referencia salen solo de ediciones pasadas con reservas', () => {
    // La futura (2) y la vacía (0) no entran: promedio de 53 y 4.
    expect(report.best).toEqual({ date: '2026-09-07', guests: 53 })
    expect(report.reference).toEqual({ avgGuests: 29, editions: 2 })
  })

  it('la edición de HOY no cuenta como concluida', () => {
    // Una noche que arranca a las 21:00 todavía está vendiendo: no puede ser
    // "la última fecha", ni la mejor, ni entrar en el promedio de referencia.
    const conHoy = aggregateTemplateReport({
      templateId: 'tpl-astral',
      templateName: 'Noche Astral',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'hoy', event_date: HOY }), ev({ id: 'vieja', event_date: '2026-08-26' })],
      rows: [
        ...Array.from({ length: 12 }, () =>
          res({ scheduled_event_id: 'hoy', estimated_guests: 3 }),
        ),
        res({ scheduled_event_id: 'vieja', estimated_guests: 2 }),
      ],
    })
    const hoy = conHoy.editions[0]
    expect(hoy?.date).toBe(HOY)
    expect(hoy?.isTonight).toBe(true)
    expect(hoy?.isFuture).toBe(false)
    // Sus números se muestran igual, pero no contaminan nada comparativo.
    expect(hoy?.guests).toBe(36)
    expect(conHoy.latest?.date).toBe('2026-08-26')
    expect(conHoy.best).toBeNull()
    expect(conHoy.reference).toBeNull()
    expect(editionDelta(conHoy.editions, 0)).toBeNull()
  })

  it('hasPastEditions distingue "no se hizo nunca" de "se hizo y no vendió"', () => {
    const nuncaSeHizo = aggregateTemplateReport({
      templateId: 't',
      templateName: 'Bingo Hub',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'f', event_date: '2026-10-01' })],
      rows: [],
    })
    expect(nuncaSeHizo.hasPastEditions).toBe(false)

    // Sushi libre: seis fechas que ya pasaron, ninguna con reservas en pie.
    const seHizoYNoVendio = aggregateTemplateReport({
      templateId: 't',
      templateName: 'Sushi libre',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'p', event_date: '2026-08-27' })],
      rows: [res({ scheduled_event_id: 'p', estimated_guests: 2, status: 'cancelled' })],
    })
    expect(seHizoYNoVendio.hasPastEditions).toBe(true)
    expect(seHizoYNoVendio.latest).toBeNull()
  })

  it('deja ver que hay una fecha vendiendo aunque ninguna concluida haya tenido reservas', () => {
    // Caso real de Sushi libre: seis fechas pasadas sin una sola reserva y la de
    // hoy con 21. La pantalla necesita distinguir esto de "nunca tuvo reservas",
    // o afirmaría lo contrario de la fila que muestra justo abajo.
    const r = aggregateTemplateReport({
      templateId: 't',
      templateName: 'Sushi libre',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'hoy', event_date: HOY }), ev({ id: 'vieja', event_date: '2026-08-27' })],
      rows: [
        ...Array.from({ length: 21 }, () =>
          res({ scheduled_event_id: 'hoy', estimated_guests: 2 }),
        ),
        res({ scheduled_event_id: 'vieja', estimated_guests: 2, status: 'cancelled' }),
      ],
    })
    expect(r.latest).toBeNull()
    expect(r.hasPastEditions).toBe(true)
    const vendiendo = r.editions.find((e) => (e.isTonight || e.isFuture) && e.reservations > 0)
    expect(vendiendo?.date).toBe(HOY)
    expect(vendiendo?.guests).toBe(42)
    expect(vendiendo?.reservations).toBe(21)
  })

  it('con una sola edición pasada no hay "la mejor" ni promedio de referencia', () => {
    const solo = aggregateTemplateReport({
      templateId: 'tpl-x',
      templateName: 'Sushi en pasos',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'u1', event_date: '2026-09-01' })],
      rows: [res({ scheduled_event_id: 'u1', estimated_guests: 4 })],
    })
    expect(solo.best).toBeNull()
    expect(solo.reference).toBeNull()
    expect(solo.latest?.guests).toBe(4)
  })

  it('un evento sin ninguna fecha devuelve la lista vacía', () => {
    const sinFechas = aggregateTemplateReport({
      templateId: 'tpl-y',
      templateName: 'Merienda Libre',
      colorHex: null,
      today: HOY,
      events: [],
      rows: [],
    })
    expect(sinFechas.editions).toEqual([])
    expect(sinFechas.latest).toBeNull()
  })

  it('normaliza el nombre del formato', () => {
    const r = aggregateTemplateReport({
      templateId: 'tpl-z',
      templateName: 'Tapeo  y Malbec',
      colorHex: null,
      today: HOY,
      events: [],
      rows: [],
    })
    expect(r.templateName).toBe('Tapeo y Malbec')
  })

  it('una reserva sin evento no entra en el reporte del evento', () => {
    const r = aggregateTemplateReport({
      templateId: 'tpl-ramen',
      templateName: 'Ramen',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'e2', event_date: '2026-09-07' })],
      rows: [res({ scheduled_event_id: null, estimated_guests: 99 })],
    })
    expect(r.editions[0]?.guests).toBe(0)
  })
})

describe('editionDelta', () => {
  const base = aggregateTemplateReport({
    templateId: 't',
    templateName: 'Ramen',
    colorHex: null,
    today: HOY,
    events: [
      ev({ id: 'f', event_date: '2026-09-28' }),
      ev({ id: 'c', event_date: '2026-09-07' }),
      ev({ id: 'b', event_date: '2026-08-20' }),
      ev({ id: 'a', event_date: '2026-08-06' }),
    ],
    rows: [
      res({ scheduled_event_id: 'f', estimated_guests: 2 }),
      res({ scheduled_event_id: 'c', estimated_guests: 53 }),
      res({ scheduled_event_id: 'a', estimated_guests: 4 }),
    ],
  })

  it('compara contra la edición anterior CON reservas, salteando las vacías', () => {
    // La del 20/08 quedó en cero: la comparación honesta es contra el 06/08.
    expect(editionDelta(base.editions, 1)).toEqual({ diff: 49, againstDate: '2026-08-06' })
  })

  it('la primera fecha no tiene contra qué compararse', () => {
    expect(editionDelta(base.editions, 3)).toBeNull()
  })

  it('una edición futura no se compara: sus números todavía se mueven', () => {
    expect(editionDelta(base.editions, 0)).toBeNull()
  })

  it('una edición sin reservas tampoco', () => {
    expect(editionDelta(base.editions, 2)).toBeNull()
  })
})

describe('CSV', () => {
  const report = aggregateDayReport({
    day: '2026-09-07',
    events: [ev()],
    rows: [
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 6, actual_guests: 6 }),
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 4 }),
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 2, status: 'cancelled' }),
      res({ estimated_guests: 12, actual_guests: 13 }),
    ],
  })

  it('una fila por bloque, con punto y coma y BOM para Excel en español', () => {
    const csv = dayReportToCsv(report)
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.split('\r\n')
    expect(lines[0]).toContain('Personas por reserva')
    expect(lines[1]).toBe('2026-09-07;Ramen;10;2;5,0;6;1 de 2;1;0;2')
    expect(lines[2]).toBe('2026-09-07;Sin evento;12;1;12,0;13;1 de 1;0;0;0')
  })

  it('el promedio va con coma decimal, que es como lo lee Excel en es-AR', () => {
    expect(dayReportToCsv(report)).toContain(';5,0;')
  })

  it('la planilla del evento distingue hoy de una fecha futura', () => {
    const tpl = aggregateTemplateReport({
      templateId: 't',
      templateName: 'Ramen',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'hoy', event_date: HOY }), ev({ id: 'vieja', event_date: '2026-08-01' })],
      rows: [
        res({ scheduled_event_id: 'hoy', estimated_guests: 2 }),
        res({ scheduled_event_id: 'vieja', estimated_guests: 2 }),
      ],
    })
    const lines = templateReportToCsv(tpl).split('\r\n')
    expect(lines[1]?.endsWith(';es hoy')).toBe(true)
    expect(lines[2]?.endsWith(';')).toBe(true)
  })

  it('el nombre del evento lleva apóstrofo si Excel lo leería como fórmula', () => {
    // Lo escribe el staff (nombre especial de la fecha o del formato).
    const day = aggregateDayReport({
      day: '2026-09-07',
      events: [ev({ name_override: '=1+1' })],
      rows: [res({ scheduled_event_id: 'ev-ramen', estimated_guests: 2 })],
    })
    expect(dayReportToCsv(day).split('\r\n')[1]?.split(';')[1]).toBe("'=1+1")

    const tpl = aggregateTemplateReport({
      templateId: 't',
      templateName: 'Ramen',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'vieja', event_date: '2026-08-01', name_override: '-5 de descuento' })],
      rows: [res({ scheduled_event_id: 'vieja', estimated_guests: 2 })],
    })
    expect(templateReportToCsv(tpl).split('\r\n')[1]?.split(';')[1]).toBe("'-5 de descuento")
  })

  it('la planilla del evento marca las fechas que todavía no pasaron', () => {
    const tpl = aggregateTemplateReport({
      templateId: 't',
      templateName: 'Ramen',
      colorHex: null,
      today: HOY,
      events: [ev({ id: 'z', event_date: '2026-09-28' })],
      rows: [res({ scheduled_event_id: 'z', estimated_guests: 2 })],
    })
    const lines = templateReportToCsv(tpl).split('\r\n')
    expect(lines[1]?.endsWith(';sí')).toBe(true)
  })
})

describe('CSV con pauta', () => {
  function pauta(over: Partial<EventMarketingRow> = {}): EventMarketingRow {
    return {
      scheduledEventId: 'ev-ramen',
      adSpendUsdCents: 10_000,
      messages: 20,
      reach: null,
      revenueArsCents: null,
      usdArsRate: null,
      revenuePerGuestArsCents: null,
      costPerGuestArsCents: null,
      notes: null,
      updatedAt: '2026-09-08T15:00:00Z',
      updatedByName: 'Nacho B.',
      ...over,
    }
  }

  const day = aggregateDayReport({
    day: '2026-09-07',
    events: [ev()],
    rows: [
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 6, actual_guests: 6 }),
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 4 }),
      res({ scheduled_event_id: 'ev-ramen', estimated_guests: 2, status: 'cancelled' }),
      res({ estimated_guests: 12, actual_guests: 13 }),
    ],
  })

  it('sin pauta la planilla del día queda exactamente como antes', () => {
    const lines = dayReportToCsv(day).split('\r\n')
    expect(lines[0]?.split(';')).toHaveLength(DAY_EXPORT_HEADERS.length)
    expect(lines[0]).not.toContain('Pauta USD')
  })

  it('con pauta suma las columnas de pauta, con los mismos números que la pantalla', () => {
    const lines = dayReportToCsv(day, { 'ev-ramen': pauta() }).split('\r\n')
    expect(lines[0]?.replace('\uFEFF', '').split(';')).toEqual([
      ...DAY_EXPORT_HEADERS,
      ...MARKETING_EXPORT_HEADERS,
    ])
    // US$ 100 / 20 mensajes / 2 reservas en pie (10 personas). Las ocho últimas
    // son la cuenta de la noche: esta fila no tiene ingreso ni costo por
    // persona, así que van vacías (incluida «Personas del cálculo»).
    expect(lines[1]).toBe(
      '2026-09-07;Ramen;10;2;5,0;6;1 de 2;1;0;2;100,00;20;;5,00;10,0;50,00;10,00;;;;;;;;;;;;;',
    )
  })

  it('"Sin evento" y un evento sin fila llevan las columnas de pauta vacías', () => {
    const conFila = dayReportToCsv(day, { 'ev-ramen': pauta() }).split('\r\n')
    expect(conFila[2]?.split(';').slice(DAY_EXPORT_HEADERS.length)).toEqual(
      MARKETING_EXPORT_HEADERS.map(() => ''),
    )
    const sinFila = dayReportToCsv(day, {}).split('\r\n')
    expect(sinFila[1]?.split(';').slice(DAY_EXPORT_HEADERS.length)).toEqual(
      MARKETING_EXPORT_HEADERS.map(() => ''),
    )
  })

  it('"No tuvo pauta" escribe 0,00 y la nota lleva la guarda de fórmulas', () => {
    const sinPauta = dayReportToCsv(day, {
      'ev-ramen': pauta({ adSpendUsdCents: 0, messages: null }),
    }).split('\r\n')
    expect(sinPauta[1]?.split(';')[DAY_EXPORT_HEADERS.length]).toBe('0,00')

    const nota = dayReportToCsv(day, { 'ev-ramen': pauta({ notes: '=1+1' }) }).split('\r\n')
    expect(nota[1]?.split(';').at(-1)).toBe("'=1+1")
  })

  it('en la planilla del evento, hoy y lo futuro llevan lo cargado pero no los cocientes', () => {
    const tpl = aggregateTemplateReport({
      templateId: 't',
      templateName: 'Ramen',
      colorHex: null,
      today: HOY,
      events: [
        ev({ id: 'futura', event_date: '2026-09-28' }),
        ev({ id: 'hoy', event_date: HOY }),
        ev({ id: 'vieja', event_date: '2026-08-01' }),
        ev({ id: 'sin-fila', event_date: '2026-07-01' }),
      ],
      rows: [
        res({ scheduled_event_id: 'hoy', estimated_guests: 2 }),
        res({ scheduled_event_id: 'vieja', estimated_guests: 2 }),
      ],
    })
    const marketing = {
      hoy: pauta({ scheduledEventId: 'hoy', adSpendUsdCents: 6_000, messages: 12 }),
      vieja: pauta({ scheduledEventId: 'vieja', adSpendUsdCents: 1_000, messages: 5 }),
    }
    const lines = templateReportToCsv(tpl, marketing).split('\r\n')
    const pautaDe = (i: number) => lines[i]?.split(';').slice(TEMPLATE_EXPORT_HEADERS.length)

    expect(lines[0]?.replace('\uFEFF', '').split(';')).toEqual([
      ...TEMPLATE_EXPORT_HEADERS,
      ...MARKETING_EXPORT_HEADERS,
    ])
    expect(pautaDe(1)).toEqual(MARKETING_EXPORT_HEADERS.map(() => ''))
    expect(pautaDe(2)).toEqual([
      '60,00',
      '12',
      ...Array(MARKETING_EXPORT_HEADERS.length - 2).fill(''),
    ])
    expect(pautaDe(3)).toEqual([
      '10,00',
      '5',
      '',
      '2,00',
      '20,0',
      '10,00',
      '5,00',
      // La cuenta de la noche sale entera o no sale: esta fila no tiene ingreso
      // ni costo por persona, así que sus ocho columnas van vacías —también
      // «Personas del cálculo», que sin cuenta es un número colgado.
      ...Array(MARKETING_EXPORT_HEADERS.length - 7).fill(''),
    ])
    expect(pautaDe(4)).toEqual(MARKETING_EXPORT_HEADERS.map(() => ''))
    // Las columnas de siempre no se mueven.
    expect(lines[2]?.split(';')[TEMPLATE_EXPORT_HEADERS.length - 1]).toBe('es hoy')
  })
})

describe('reportExportFilename', () => {
  it('usa el día tal cual', () => {
    expect(reportExportFilename('hub', '2026-09-07')).toBe('como-nos-fue-hub-2026-09-07.csv')
  })

  it('limpia tildes y espacios del nombre del evento', () => {
    expect(reportExportFilename('hub', 'Tapeo y Malbec')).toBe(
      'como-nos-fue-hub-tapeo-y-malbec.csv',
    )
    expect(reportExportFilename('hub', 'Noche Astral · Pareja')).toBe(
      'como-nos-fue-hub-noche-astral-pareja.csv',
    )
  })

  it('nunca queda sin nombre', () => {
    expect(reportExportFilename('hub', '···')).toBe('como-nos-fue-hub-reporte.csv')
  })
})

describe('aggregateEditions', () => {
  const events = [
    ev({ id: 'e3', event_date: '2026-09-28' }),
    ev({ id: 'hoy', event_date: HOY }),
    ev({ id: 'e1', event_date: '2026-08-06', template: null }),
  ]
  const rows = [
    res({ scheduled_event_id: 'e3', estimated_guests: 2 }),
    res({ scheduled_event_id: 'hoy', estimated_guests: 4, actual_guests: 5 }),
    res({ scheduled_event_id: 'hoy', estimated_guests: 3, status: 'no_show' }),
    res({ scheduled_event_id: 'e1', estimated_guests: 6, actual_guests: 6 }),
    res({ scheduled_event_id: null, estimated_guests: 99 }),
    res({ scheduled_event_id: 'de-otro-template', estimated_guests: 99 }),
  ]

  it('cuenta cada edición exactamente igual que el reporte del evento', () => {
    const editions = aggregateEditions({ events, rows, today: HOY, colorHex: '#7c3aed' })
    const tpl = aggregateTemplateReport({
      templateId: 'tpl-ramen',
      templateName: 'Ramen',
      colorHex: '#7c3aed',
      today: HOY,
      events,
      rows,
    })
    expect(editions).toEqual(tpl.editions)
  })

  it('ordena de la más nueva a la más vieja y marca hoy y futuras', () => {
    const editions = aggregateEditions({ events, rows, today: HOY })
    expect(editions.map((e) => [e.date, e.isFuture, e.isTonight])).toEqual([
      ['2026-09-28', true, false],
      [HOY, false, true],
      ['2026-08-06', false, false],
    ])
    expect(editions[1]?.guests).toBe(4)
    expect(editions[1]?.noShow).toBe(1)
  })

  it('el color de respaldo solo entra cuando el evento no trae el de su template', () => {
    const conRespaldo = aggregateEditions({ events, rows, today: HOY, colorHex: '#000000' })
    expect(conRespaldo.map((e) => e.colorHex)).toEqual(['#7c3aed', '#7c3aed', '#000000'])
    const sinRespaldo = aggregateEditions({ events, rows, today: HOY })
    expect(sinRespaldo[2]?.colorHex).toBeNull()
  })
})

describe('mesas del muro: nombre y motivo de la caída', () => {
  it('recorta el nombre de mesa y un nombre en blanco es null', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 6, table_label: '  12 ' }),
        res({ estimated_guests: 4, table_label: '   ' }),
        res({ estimated_guests: 2 }),
        res({ estimated_guests: 1, table_label: null }),
      ],
    })
    expect(r.blocks[0]?.tables.map((t) => t.label)).toEqual(['12', null, null, null])
  })

  it('una caída dice si la cancelaron o no vino; una mesa en pie no tiene motivo', () => {
    const r = aggregateDayReport({
      day: '2026-09-07',
      events: [],
      rows: [
        res({ estimated_guests: 5, actual_guests: 5 }),
        res({ estimated_guests: 4 }),
        res({ estimated_guests: 3, status: 'cancelled', table_label: '7' }),
        res({ estimated_guests: 2, status: 'no_show' }),
      ],
    })
    expect(r.blocks[0]?.tables.map((t) => [t.guests, t.state, t.fallenReason, t.label])).toEqual([
      [5, 'counted', null, null],
      [4, 'open', null, null],
      [3, 'fallen', 'cancelled', '7'],
      [2, 'fallen', 'no_show', null],
    ])
  })
})
