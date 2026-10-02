import { describe, expect, it } from 'vitest'
import {
  buildEventConsolidated,
  CONSOLIDATED_TITLE,
  eventProfitabilityToCsv,
  PROFITABILITY_EXPORT_HEADERS,
} from '@/lib/salon/event-consolidated'
import {
  buildEventConversion,
  CONVERSION_EXPORT_HEADERS,
  CONVERSION_TITLE,
  eventConversionToCsv,
} from '@/lib/salon/event-conversion'
import { cuadroExport, parseCuadro } from '@/lib/salon/event-cuadros'
import type { EventMarketingRow } from '@/lib/salon/event-marketing'
import {
  aggregateTemplateReport,
  type ReportEventRow,
  type ReportReservationRow,
  reportExportFilename,
} from '@/lib/salon/events-report'
import { BURGER_EVENTS, TODAY, toEvents, toMarketing, toRows } from './salon-como-nos-fue-fixtures'

const lines = (csv: string) => csv.replace(/^﻿/, '').split('\r\n')

// 2x1 Burger Martes con los datos reales del 02/10/2026.
const report = aggregateTemplateReport({
  templateId: BURGER_EVENTS[0]?.tpl ?? '',
  templateName: '2x1 Burger Martes',
  colorHex: '#85ed40',
  today: TODAY,
  events: toEvents(BURGER_EVENTS),
  rows: toRows(BURGER_EVENTS),
})
const marketing = toMarketing(BURGER_EVENTS)

// C4 de los socios (02/10/2026): «Estos cuadritos son la clave, y deberían ser
// exportables ambos […] con el cuadro de la izquierda rentabilidad. Con el
// cuadro de la derecha, conversión.» Pantalla = CSV, cuadro por cuadro.

describe('RENTABILIDAD (el cuadro de la izquierda)', () => {
  it('se llama Rentabilidad y dice qué responde', () => {
    expect(CONSOLIDATED_TITLE).toBe('Rentabilidad')
    const c = buildEventConsolidated({
      templateName: report.templateName,
      editions: report.editions,
      marketing,
    })
    expect(c?.title).toBe('Rentabilidad')
    expect(c?.subtitle).toBe('Cuánto dejó cada fecha: el ingreso, menos el costo y la pauta.')
  })

  it('pantalla = CSV: las mismas filas, el mismo total y sus notas', () => {
    const csv = lines(
      eventProfitabilityToCsv({
        templateName: report.templateName,
        editions: report.editions,
        marketing,
      }),
    )
    expect(csv[0]?.split(';')).toEqual([...PROFITABILITY_EXPORT_HEADERS])
    expect(csv.slice(1)).toEqual([
      '2026-09-29;15;;;;;;;;77,74;;;;sin juzgar: faltan ingreso, costo y dólar',
      '2026-09-22;25;;;;;;;;47,82;;;;sin juzgar: faltan ingreso, costo y dólar',
      '2026-09-15;65;14500;;6500;;942500;422500;520000;105,82;1550;164021;355979;sí',
      '2026-09-08;59;11500;;6800;;678500;401200;277300;53,41;1550;82786;194515;sí',
      '2026-09-01;28;8500;4000;5500;1500;350000;196000;154000;142,25;1600;227600;-73600;no',
      'Total con la cuenta cerrada (3 fechas);152;12230;;;;1971000;1019700;951300;301,48;;474406;476894;2 de 3',
      ';;;;;;;;;;;;;',
      'Las 4 fechas que vienen se juzgan cuando pasen.;;;;;;;;;;;;;',
      'Personas: la gente de la cuenta, contada al cerrar cada mesa —lo reservado en las que quedaron sin cerrar—, así que puede no coincidir con «Conversión».;;;;;;;;;;;;;',
      'Sin la bebida cargada: 15/09 · 08/09. Ahí el resultado sale solo del ingreso y el costo por persona.;;;;;;;;;;;;;',
      'No es la ganancia del bar: no descuenta sueldos, alquiler ni impuestos.;;;;;;;;;;;;;',
    ])
  })

  it('las filas son las de la tabla (ni las que vienen ni las vacías)', () => {
    const c = buildEventConsolidated({
      templateName: report.templateName,
      editions: report.editions,
      marketing,
    })
    expect(c?.rows.map((r) => r.date)).toEqual([
      '2026-09-29',
      '2026-09-22',
      '2026-09-15',
      '2026-09-08',
      '2026-09-01',
    ])
  })

  it('la fila de total cierra: Ingreso − Costo = Margen y Margen − Pauta = Resultado', () => {
    const total = lines(
      eventProfitabilityToCsv({
        templateName: report.templateName,
        editions: report.editions,
        marketing,
      }),
    )
      .find((l) => l.startsWith('Total'))
      ?.split(';')
      .map((c) => Number(c))
    const [, , , , , , ingreso, costo, margen, , , pauta, resultado] = total ?? []
    expect((ingreso ?? 0) - (costo ?? 0)).toBe(margen)
    expect((margen ?? 0) - (pauta ?? 0)).toBe(resultado)
  })

  it('el archivo', () => {
    expect(reportExportFilename('hub', '2x1 Burger Martes-rentabilidad')).toBe(
      'como-nos-fue-hub-2x1-burger-martes-rentabilidad.csv',
    )
  })
})

describe('CONVERSIÓN (el cuadro de la derecha)', () => {
  it('las fechas de la tira, después las vacías, el total con mensajes, la mejor y el promedio', () => {
    const csv = lines(eventConversionToCsv(report, marketing))
    expect(csv[0]?.split(';')).toEqual([...CONVERSION_EXPORT_HEADERS])
    expect(csv.slice(1)).toEqual([
      '2026-09-29;ya pasó;15;6;2,5;-11;2026-09-22;77,74;54;1,44;11,1;12,96;completa',
      '2026-09-22;ya pasó;26;10;2,6;-36;2026-09-15;47,82;48;1,00;20,8;4,78;completa',
      '2026-09-15;ya pasó;62;23;2,7;6;2026-09-08;105,82;132;0,80;17,4;4,60;completa',
      '2026-09-08;ya pasó;56;14;4,0;28;2026-09-01;53,41;56;0,95;25,0;3,82;completa',
      '2026-09-01;ya pasó;28;10;2,8;;;142,25;86;1,65;11,6;14,23;completa',
      '2026-10-27;todavía no pasó;0;0;;;;;;;;;',
      '2026-10-20;todavía no pasó;0;0;;;;;;;;;',
      '2026-10-13;todavía no pasó;0;0;;;;;;;;;',
      '2026-10-06;todavía no pasó;0;0;;;;;;;;;',
      'Total con mensajes cargados (5 fechas);;;63;;;;427,04;376;1,14;16,8;6,78;',
      'La mejor (2026-09-15);;62;;;;;;;;;;',
      'Promedio de las 5 fechas que ya pasaron con reservas;;37;;;;;;;;;;',
    ])
  })

  it('pantalla = CSV: la tira tiene las mismas fechas, en el mismo orden', () => {
    const c = buildEventConversion(report, marketing)
    expect(c.title).toBe(CONVERSION_TITLE)
    expect(c.title).toBe('Conversión')
    expect(c.subtitle).toBe('Cuánta gente trajo cada fecha y cuánto costó traerla.')
    // Las fechas que no son grupos privados (acá, todas): «9 fechas», no «en el calendario».
    expect(c.countLabel).toBe('9 fechas')
    const dates = lines(eventConversionToCsv(report, marketing))
      .slice(1)
      .map((l) => l.split(';')[0])
    expect(c.rows.map((r) => r.edition.date)).toEqual(dates.slice(0, c.rows.length))
    // Las cuatro que vienen, sin reservas ni pauta: al pie en la tira, como filas en la planilla.
    expect(c.collapsedText).toBe('4 fechas más sin ninguna reserva: 27/10 · 20/10 · 13/10 · 06/10')
    expect(c.bestText).toBe('La mejor: 15/09 con 62 personas · promedio 37 en 5 fechas')
    expect(c.summary?.text).toContain('Pauta en 5 fechas')
    expect(c.withAds).toBe(true)
  })

  it('el archivo', () => {
    expect(reportExportFilename('hub', '2x1 Burger Martes-conversion')).toBe(
      'como-nos-fue-hub-2x1-burger-martes-conversion.csv',
    )
  })
})

describe('CONVERSIÓN: la segunda línea de cada fecha y su fila dicen lo mismo (V6)', () => {
  // Cinco fechas que ya pasaron, todas con pauta: las tres en que la línea no
  // dice cocientes (sin los mensajes, 0 mensajes, ninguna reserva en pie) y dos
  // con la cuenta de Meta (una con más reservas que mensajes). Antes la
  // planilla traía cocientes que la pantalla no mostraba: el costo por reserva
  // sin los mensajes o con 0, y el costo por mensaje y un 0 % de cierre sin
  // reservas en pie.
  const TPL = { id: 'tpl-z', name: 'Formato Z', color_hex: '#123456' }
  const ev = (id: string, date: string): ReportEventRow => ({
    id,
    template_id: TPL.id,
    name_override: null,
    event_date: date,
    starts_at_local: '21:00:00',
    capacity: 60,
    private_group: false,
    template: TPL,
  })
  const res = (eventId: string, date: string, count: number, guests: number) =>
    Array.from(
      { length: count },
      (_, i): ReportReservationRow => ({
        id: `${eventId}-${i}`,
        reservation_date: date,
        scheduled_event_id: eventId,
        estimated_guests: guests,
        actual_guests: null,
        status: 'pending',
        table_label: null,
      }),
    )
  const ads = (id: string, cents: number, messages: number | null): EventMarketingRow => ({
    scheduledEventId: id,
    adSpendUsdCents: cents,
    messages,
    reach: null,
    revenueArsCents: null,
    usdArsRate: null,
    revenuePerGuestArsCents: null,
    costPerGuestArsCents: null,
    drinkRevenuePerGuestArsCents: null,
    drinkCostPerGuestArsCents: null,
    notes: null,
    updatedAt: '2026-09-30T10:00:00Z',
    updatedByName: null,
  })
  const z = aggregateTemplateReport({
    templateId: TPL.id,
    templateName: TPL.name,
    colorHex: TPL.color_hex,
    today: TODAY,
    events: [
      ev('a', '2026-09-28'),
      ev('b', '2026-09-21'),
      ev('c', '2026-09-14'),
      ev('d', '2026-09-07'),
      ev('e', '2026-08-31'),
    ],
    rows: [
      ...res('a', '2026-09-28', 6, 3),
      ...res('b', '2026-09-21', 4, 2),
      ...res('d', '2026-09-07', 5, 4),
      ...res('e', '2026-08-31', 8, 2),
    ],
  })
  const zMarketing = {
    a: ads('a', 5000, null),
    b: ads('b', 3000, 0),
    c: ads('c', 2500, 12),
    d: ads('d', 4000, 40),
    e: ads('e', 6000, 5),
  }
  const csv = lines(eventConversionToCsv(z, zMarketing))
  const col = (header: string) => CONVERSION_EXPORT_HEADERS.indexOf(header)
  const cellsOf = (date: string) => csv.find((l) => l.startsWith(`${date};`))?.split(';') ?? []
  /** De «Pauta USD» a «Estado de la pauta»: las columnas de la segunda línea. */
  const adsCells = (date: string) => cellsOf(date).slice(col('Pauta USD'))

  it('sin los mensajes, con 0 o sin reservas en pie: la pauta y los mensajes, sin cocientes', () => {
    expect(adsCells('2026-09-28')).toEqual(['50,00', '', '', '', '', 'faltan los mensajes'])
    expect(adsCells('2026-09-21')).toEqual(['30,00', '0', '', '', '', 'completa'])
    expect(adsCells('2026-09-14')).toEqual(['25,00', '12', '', '', '', 'completa'])
    // Con la cuenta de Meta, los tres (el cierre vacío: más reservas que mensajes).
    expect(adsCells('2026-09-07')).toEqual(['40,00', '40', '1,00', '12,5', '8,00', 'completa'])
    expect(adsCells('2026-08-31')).toEqual(['60,00', '5', '12,00', '', '7,50', 'completa'])
  })

  it('celda por celda: un cociente está en la planilla si y solo si la línea lo dice', () => {
    // Cómo se lee en la línea cada celda de cociente de la planilla.
    const SAID = [
      { header: 'Costo por mensaje USD', marker: ' a US$ ', said: (v: string) => ` a US$ ${v} ` },
      { header: '% de cierre', marker: '% de cierre', said: (v: string) => `${v} % de cierre` },
      {
        header: 'Costo por reserva USD',
        marker: 'por reserva',
        said: (v: string) => `US$ ${v} por reserva`,
      },
    ]
    const c = buildEventConversion(z, zMarketing)
    expect(c.rows.map((r) => r.edition.date)).toEqual([
      '2026-09-28',
      '2026-09-21',
      '2026-09-14',
      '2026-09-07',
      '2026-08-31',
    ])
    for (const r of c.rows) {
      const text = (r.marketingLine?.text ?? '').replace(/ /g, ' ')
      const cells = cellsOf(r.edition.date)
      for (const { header, marker, said } of SAID) {
        const value = cells[col(header)] ?? ''
        if (value === '') expect(text, `${r.edition.date} · ${header}`).not.toContain(marker)
        else expect(text, `${r.edition.date} · ${header}`).toContain(said(value))
      }
    }
  })
})

describe('los dos botones «Exportar»', () => {
  const input = { tenantSlug: 'hub', templateId: 'tpl-1', templateName: '2x1  Burger Martes' }

  it('cada uno pide SU cuadro', () => {
    expect(cuadroExport('rentabilidad', input).href).toBe(
      '/api/como-nos-fue/export?slug=hub&vista=evento&evento=tpl-1&cuadro=rentabilidad',
    )
    expect(cuadroExport('conversion', input).href).toBe(
      '/api/como-nos-fue/export?slug=hub&vista=evento&evento=tpl-1&cuadro=conversion',
    )
  })

  it('a la vista son iguales; para el lector, no (y contienen lo que se ve)', () => {
    const r = cuadroExport('rentabilidad', input)
    const c = cuadroExport('conversion', input)
    expect(r.label).toBe('Exportar')
    expect(c.label).toBe('Exportar')
    expect(r.ariaLabel).toBe('Exportar Rentabilidad de 2x1 Burger Martes')
    expect(c.ariaLabel).toBe('Exportar Conversión de 2x1 Burger Martes')
    expect(r.ariaLabel.startsWith(r.label)).toBe(true)
  })

  it('un link viejo sin cuadro no adivina', () => {
    expect(parseCuadro(null)).toBeNull()
    expect(parseCuadro('')).toBeNull()
    expect(parseCuadro('todo')).toBeNull()
    expect(parseCuadro('rentabilidad')).toBe('rentabilidad')
    expect(parseCuadro('conversion')).toBe('conversion')
  })
})
