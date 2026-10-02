import { describe, expect, it } from 'vitest'
import { eventProfitabilityToCsv } from '@/lib/salon/event-consolidated'
import { buildEventConversion, eventConversionToCsv } from '@/lib/salon/event-conversion'
import {
  aggregateDayReport,
  aggregateEditions,
  aggregateTemplateReport,
  dayReportToCsv,
} from '@/lib/salon/events-report'
import {
  EVENT_IS_PRIVATE_GROUP,
  monthPrivateGroupsNote,
  PRIVATE_GROUP_HAS_MONEY,
  privateEditionsNote,
  privateGroupErrorMessage,
  privateGroupPendingCopy,
  privateOnlyTemplateState,
} from '@/lib/salon/private-groups'
import {
  DAY_0918_EVENTS,
  DAY_0918_PLAIN,
  MERIENDA_EVENTS,
  PIZZA_EVENTS,
  plainRows,
  TODAY,
  toEvents,
  toMarketing,
  toRows,
} from './salon-como-nos-fue-fixtures'

const lines = (csv: string) => csv.replace(/^﻿/, '').split('\r\n')

describe('Por día: el grupo privado es gente de la noche, no un evento', () => {
  const events = toEvents(DAY_0918_EVENTS)
  const rows = [...toRows(DAY_0918_EVENTS), ...plainRows(DAY_0918_PLAIN, '2026-09-18')]
  const day = aggregateDayReport({ day: '2026-09-18', events, rows })

  it('eventos, después los grupos privados, al final «Sin evento»; los totales cuentan a todos', () => {
    expect(day.blocks.map((b) => [b.kind, b.title, b.guests, b.reservations])).toEqual([
      ['event', 'Sushi en pasos', 60, 24],
      ['private', 'Pizza libre', 69, 2],
      ['plain', 'Sin evento', 2, 1],
    ])
    expect(day.totals).toEqual({ guests: 131, reservations: 27 })
  })

  it('la planilla del día lo rotula y no le pone pauta, aunque tenga una fila «No tuvo pauta»', () => {
    const csv = lines(dayReportToCsv(day, toMarketing(DAY_0918_EVENTS)))
    const privada = csv.find((l) => l.includes('Pizza libre'))
    expect(
      privada?.startsWith('2026-09-18;Pizza libre (grupo privado);69;2;34,5;0;0 de 2;0;0;0;'),
    ).toBe(true)
    // Todas las columnas de pauta vacías (la ficha tampoco tiene sección).
    expect(
      privada
        ?.split(';')
        .slice(10)
        .every((c) => c === ''),
    ).toBe(true)
  })

  it('un grupo privado sin nadie (ni en pie ni caído) no se dibuja', () => {
    const vacia = PIZZA_EVENTS.find((e) => e.date === '2026-09-19')
    if (!vacia) throw new Error('fixture')
    const d = aggregateDayReport({ day: '2026-09-19', events: toEvents([vacia]), rows: [] })
    expect(d.blocks.map((b) => b.kind)).toEqual(['plain'])
  })

  it('un grupo privado que se cayó entero sí (la caída es el dato)', () => {
    const caida = PIZZA_EVENTS.find((e) => e.date === '2026-12-05')
    if (!caida) throw new Error('fixture')
    const d = aggregateDayReport({
      day: '2026-12-05',
      events: toEvents([caida]),
      rows: toRows([caida]),
    })
    expect(d.blocks.map((b) => [b.kind, b.cancelled, b.fallenGuests])).toEqual([
      ['private', 1, 60],
      ['plain', 0, 0],
    ])
  })
})

describe('Por evento: Pizza libre después del paso de datos', () => {
  const report = aggregateTemplateReport({
    templateId: PIZZA_EVENTS[0]?.tpl ?? '',
    templateName: 'Pizza libre',
    colorHex: '#e32400',
    today: TODAY,
    events: toEvents(PIZZA_EVENTS),
    rows: toRows(PIZZA_EVENTS),
  })
  const marketing = toMarketing(PIZZA_EVENTS)

  it('quedan las dos noches con pauta; las 14 privadas se cuentan aparte', () => {
    expect(
      report.editions.map((e) => [e.date, e.guests, e.reservations, e.billableGuests]),
    ).toEqual([
      ['2026-09-21', 104, 25, 106],
      ['2026-09-03', 62, 17, 65],
    ])
    expect(report.privateEditions).toBe(14)
    expect(report.best).toEqual({ date: '2026-09-21', guests: 104 })
    expect(report.reference).toEqual({ avgGuests: 83, editions: 2 })
    expect(privateEditionsNote(report.privateEditions)).toBe(
      'No cuentan 14 fechas de grupo privado: ocupan lugar en el salón, pero no son eventos. Se ven en «Por día».',
    )
    expect(privateEditionsNote(1)).toBe(
      'No cuenta 1 fecha de grupo privado: ocupa lugar en el salón, pero no es un evento. Se ve en «Por día».',
    )
    expect(privateEditionsNote(0)).toBeNull()
  })

  it('aggregateEditions descarta un privado aunque la query lo deje pasar (la red)', () => {
    const eds = aggregateEditions({
      events: toEvents(PIZZA_EVENTS),
      rows: toRows(PIZZA_EVENTS),
      today: TODAY,
    })
    expect(eds).toHaveLength(2)
  })

  it('Merienda Libre: todas privadas → ninguna edición', () => {
    const m = aggregateTemplateReport({
      templateId: MERIENDA_EVENTS[0]?.tpl ?? '',
      templateName: 'Merienda Libre',
      colorHex: null,
      today: TODAY,
      events: toEvents(MERIENDA_EVENTS),
      rows: toRows(MERIENDA_EVENTS),
    })
    expect(m.editions).toEqual([])
    expect(m.privateEditions).toBe(4)
    // Por link directo: decir «todavía no le pusiste fecha» sería falso.
    expect(privateOnlyTemplateState(m.templateName, m.privateEditions)).toEqual({
      title: 'Todas las fechas de Merienda Libre son de grupos privados',
      description:
        'Sus 4 fechas están marcadas «Grupo privado»: ocupan lugar en el salón, pero no son eventos y no salen en este reporte. Su gente se ve en «Por día».',
    })
  })

  it('RENTABILIDAD de Pizza libre: dos ✓, total que cierra y la nota de los privados', () => {
    const csv = lines(
      eventProfitabilityToCsv({
        templateName: report.templateName,
        editions: report.editions,
        marketing,
        privateNote: privateEditionsNote(report.privateEditions),
      }),
    )
    expect(csv.slice(1, 4)).toEqual([
      '2026-09-21;106;16000;;7400;;1696000;784400;911600;159,00;1600;254400;657200;sí',
      '2026-09-03;65;12000;4000;5400;1400;1040000;442000;598000;155,26;1600;248416;349584;sí',
      'Total con la cuenta cerrada (2 fechas);171;14480;;;;2736000;1226400;1509600;314,26;;502816;1006784;2 de 2',
    ])
    expect(csv.at(-1)).toBe(
      'No cuentan 14 fechas de grupo privado: ocupan lugar en el salón, pero no son eventos. Se ven en «Por día».;;;;;;;;;;;;;',
    )
  })

  it('CONVERSIÓN de Pizza libre', () => {
    const csv = lines(eventConversionToCsv(report, marketing))
    expect(csv.slice(1, 6)).toEqual([
      '2026-09-21;ya pasó;104;25;4,2;42;2026-09-03;159,00;156;1,02;16,0;6,36;completa',
      '2026-09-03;ya pasó;62;17;3,6;;;155,26;173;0,90;9,8;9,13;completa',
      'Total con mensajes cargados (2 fechas);;;42;;;;314,26;329;0,96;12,8;7,48;',
      'La mejor (2026-09-21);;104;;;;;;;;;;',
      'Promedio de las 2 fechas que ya pasaron con reservas;;83;;;;;;;;;;',
    ])
    expect(csv.at(-1)).toBe(
      'No cuentan 14 fechas de grupo privado: ocupan lugar en el salón, pero no son eventos. Se ven en «Por día».;;;;;;;;;;;;',
    )
  })

  it('el cuadro cuenta las fechas del evento, no las del calendario', () => {
    const c = buildEventConversion(report, marketing)
    expect(c.countLabel).toBe('2 fechas')
    expect(c.rows.map((r) => r.edition.date)).toEqual(['2026-09-21', '2026-09-03'])
  })
})

describe('Pauta: el mes sin los grupos privados', () => {
  it('se nombran al pie, en orden y con su concordancia', () => {
    expect(
      monthPrivateGroupsNote([
        { eventId: 'd', date: '2026-09-30', title: 'Merienda Libre' },
        { eventId: 'a', date: '2026-09-17', title: 'Pizza libre' },
        { eventId: 'b', date: '2026-09-18', title: 'Pizza libre' },
        { eventId: 'c', date: '2026-09-19', title: 'Pizza libre' },
      ]),
    ).toBe(
      'No cuentan 4 fechas de grupo privado: Pizza libre 17/09 · Pizza libre 18/09 · Pizza libre 19/09 · Merienda Libre 30/09. Ocupan lugar en el salón, pero no son eventos: se ven en «Por día».',
    )
    expect(
      monthPrivateGroupsNote([{ eventId: 'd', date: '2026-09-30', title: 'Merienda Libre' }]),
    ).toBe(
      'No cuenta 1 fecha de grupo privado: Merienda Libre 30/09. Ocupa lugar en el salón, pero no es un evento: se ve en «Por día».',
    )
    expect(monthPrivateGroupsNote([])).toBeNull()
  })

  it('el botón de los pendientes: el nombre accesible contiene lo que se ve', () => {
    const copy = privateGroupPendingCopy('Merienda Libre', '2026-09-30')
    expect(copy.label).toBe('Grupo privado')
    expect(copy.ariaLabel).toBe('Merienda Libre 30/09: grupo privado')
    expect(copy.ariaLabel.toLowerCase()).toContain(copy.label.toLowerCase())
    expect(copy.toast).toBe(
      'Merienda Libre 30/09 quedó como grupo privado: sale de los reportes de eventos.',
    )
    expect(copy.undoneToast).toBe('Listo: volvió a contar como evento.')
  })
})

describe('Los errores de los triggers, en palabras', () => {
  it('marcar privada una fecha con plata (desde el calendario)', () => {
    expect(
      privateGroupErrorMessage(
        'private_group_has_money (P0001) — from trigger scheduled_events_private_group_no_money',
      ),
    ).toBe(PRIVATE_GROUP_HAS_MONEY)
  })

  it('cargar plata en una fecha que ya es privada', () => {
    expect(privateGroupErrorMessage('event_is_private_group')).toBe(EVENT_IS_PRIVATE_GROUP)
  })

  it('cualquier otro error no es de estos', () => {
    expect(privateGroupErrorMessage('duplicate key value')).toBeNull()
    expect(privateGroupErrorMessage(null)).toBeNull()
  })
})
