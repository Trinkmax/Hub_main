import { describe, expect, it } from 'vitest'
import {
  aggregateDayReport,
  aggregateTemplateReport,
  dayReportToCsv,
  editionDelta,
  eventTitle,
  type ReportEventRow,
  type ReportReservationRow,
  reportExportFilename,
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
