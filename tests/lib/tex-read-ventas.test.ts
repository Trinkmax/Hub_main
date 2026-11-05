import { describe, expect, it } from 'vitest'
import { buildProjection, type ProjectionSourceDay } from '@/lib/accounting/projection'
import type { NetByMethodRow } from '@/lib/accounting/queries/books'
import type { DailyCloseCalendar } from '@/lib/accounting/queries/documents'
import type { PartyList, PartyListRow } from '@/lib/accounting/queries/parties'
import type { SalesMethodRow } from '@/lib/accounting/queries/settings'
import {
  daysThatMatter,
  missingClosesData,
  monthFigures,
  netData,
  projectionData,
  projectionDayRow,
  receivablesData,
  salesMethodRow,
} from '@/lib/tex/tools/read/ventas'

const TODAY = '2026-11-05'
const NOV = '2026-11'

function source(day: string, over: Partial<ProjectionSourceDay> = {}): ProjectionSourceDay {
  return {
    day,
    targetCents: 100_000_00,
    note: null,
    closes: 0,
    salonCents: 0,
    deliveryCents: 0,
    eventsCents: 0,
    salonCommissionCents: 0,
    deliveryCommissionCents: 0,
    eventsCommissionCents: 0,
    cashCountedCents: null,
    ...over,
  }
}

const sold = (cents: number): Partial<ProjectionSourceDay> => ({ closes: 1, salonCents: cents })

const MONTH = buildProjection(
  [
    source('2026-11-01', sold(50_000_00)),
    source('2026-11-02', sold(120_000_00)),
    source('2026-11-03'),
    source('2026-11-04', { ...sold(90_000_00), cashCountedCents: 85_000_00 }),
    source('2026-11-05'),
    source('2026-11-06', { targetCents: 300_000_00 }),
    source('2026-11-07'),
    source('2026-11-08'),
    source('2026-11-09'),
  ],
  { serviceDay: TODAY },
)

function dayOf(iso: string) {
  const day = MONTH.days.find((d) => d.day === iso)
  if (!day) throw new Error(iso)
  return day
}

describe('ver_proyeccion', () => {
  it('los números del mes', () => {
    expect(monthFigures(MONTH, NOV)).toMatchObject({
      vendido: '$ 260.000',
      objetivo: '$ 1.100.000',
      cumplimiento: '24 %',
      objetivo_a_hoy: '$ 400.000',
      contra_objetivo_a_hoy: '65 % · 35 % abajo',
      falta: '$ 840.000',
      dias_con_cierre: 3,
    })
  })

  it('un mes sin cierres no vendió cero', () => {
    const empty = buildProjection([source('2026-11-05')], { serviceDay: TODAY })
    expect(monthFigures(empty, NOV).vendido).toBeUndefined()
  })

  it('sin objetivos, no inventa un cumplimiento', () => {
    const data = monthFigures(
      buildProjection([source('2026-11-01', { ...sold(100_00), targetCents: null })], {
        serviceDay: TODAY,
      }),
      NOV,
    )
    expect(data.cumplimiento).toBeUndefined()
    expect(data.objetivo).toBeUndefined()
    expect(data.vendido).toBe('$ 100')
  })

  it('un día con cierre: vendido y cumplimiento', () => {
    expect(projectionDayRow(dayOf('2026-11-02'), 'strong')).toEqual({
      fecha: '02/11/2026',
      dia: 'lun',
      tipo: 'Fuerte',
      objetivo: '$ 100.000',
      vendido: '$ 120.000',
      cumplimiento: '120 % · 20 % arriba',
    })
  })

  it('un día sin cargar no es un cero', () => {
    const row = projectionDayRow(dayOf('2026-11-03'), 'normal')
    expect(row.vendido).toBeUndefined()
    expect(row.cumplimiento).toBe('Sin cierre')
  })

  it('lo que viene solo tiene objetivo', () => {
    const row = projectionDayRow(dayOf('2026-11-06'), 'strong')
    expect(row).toEqual({
      fecha: '06/11/2026',
      dia: 'vie',
      tipo: 'Fuerte',
      objetivo: '$ 300.000',
    })
  })

  it('dice si la caja no coincidió', () => {
    expect(projectionDayRow(dayOf('2026-11-04'), 'normal').caja).toBe('Faltan $ 5.000')
  })

  it('sin objetivo no lleva tipo', () => {
    const row = buildProjection([source('2026-11-01', { targetCents: null })], {
      serviceDay: TODAY,
    }).days[0]
    if (!row) throw new Error('sin día')
    expect(projectionDayRow(row, 'none').tipo).toBeUndefined()
  })

  it('el resumen se queda con los días que importan, y dice por qué', () => {
    const picked = daysThatMatter(MONTH.days).map((p) => [p.day.day, p.por_que])
    expect(picked).toEqual([
      ['2026-11-01', 'el peor contra su objetivo'],
      ['2026-11-02', 'el que más vendió y el mejor contra su objetivo'],
      ['2026-11-03', 'sin cierre'],
      ['2026-11-05', 'hoy'],
      ['2026-11-06', 'lo que viene'],
      ['2026-11-07', 'lo que viene'],
      ['2026-11-08', 'lo que viene'],
    ])
  })

  it('sin objetivos todavía dice qué día vendió más', () => {
    const projection = buildProjection(
      [
        source('2026-11-01', { ...sold(100_00), targetCents: null }),
        source('2026-11-02', { ...sold(300_00), targetCents: null }),
      ],
      { serviceDay: TODAY },
    )
    expect(daysThatMatter(projection.days).map((p) => [p.day.day, p.por_que])).toEqual([
      ['2026-11-02', 'el que más vendió'],
    ])
  })

  it('el mes entero trae todos los días con su tipo', () => {
    const data = projectionData(MONTH, NOV, false)
    expect(data.dias).toHaveLength(9)
    // 300.000 contra un promedio de 122.222: fuerte. Los demás, 100.000: 18 % abajo, flojos.
    expect(data.dias?.find((d) => d.fecha === '06/11/2026')?.tipo).toBe('Fuerte')
    expect(data.dias?.find((d) => d.fecha === '07/11/2026')?.tipo).toBe('Flojo')
    expect(data.mes).toBe('Noviembre 2026')
  })

  it('con resumen, los mismos totales y menos días', () => {
    const full = projectionData(MONTH, NOV, false)
    const short = projectionData(MONTH, NOV, true)
    expect(short.dias).toHaveLength(7)
    expect(short.dias?.[0]).toHaveProperty('por_que')
    expect(short.vendido).toBe(full.vendido)
    expect(short.totales).toEqual(full.totales)
  })

  it('los totales de buildProjection', () => {
    expect(projectionData(MONTH, NOV, true).totales).toEqual({
      venta_bar: '$ 260.000',
      venta_real: '$ 260.000',
      venta_neta: '$ 260.000',
    })
    expect(projectionData(MONTH, NOV, true).caja).toEqual({
      dias_comparados: 1,
      diferencia: 'Faltan $ 5.000',
      dias_sin_contar_lo_que_entro: 2,
    })
  })

  it('un mes de 31 días entra en el tope del ciclo', () => {
    const days = Array.from({ length: 31 }, (_, i) =>
      source(`2026-10-${String(i + 1).padStart(2, '0')}`, {
        ...sold(100_000_00),
        note: 'Evento del día con una nota larga',
        cashCountedCents: 90_000_00,
      }),
    )
    const data = projectionData(buildProjection(days, { serviceDay: TODAY }), '2026-10', false)
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })
})

describe('ver_cierres_faltantes', () => {
  const calendar: DailyCloseCalendar = {
    month: '2026-11-01',
    days: [
      { date: '2026-11-01', status: 'loaded', closes: [], totalCents: 100_00 },
      { date: '2026-11-02', status: 'missing', closes: [], totalCents: null },
      { date: '2026-11-03', status: 'missing', closes: [], totalCents: null },
      { date: '2026-11-04', status: 'pending', closes: [], totalCents: null },
      { date: '2026-11-05', status: 'future', closes: [], totalCents: null },
    ],
    soldCents: 100_00,
    loadedDays: 1,
    missingDays: 2,
    firstMissingDate: '2026-10-28',
    serviceDay: '2026-11-04',
    booksStartDate: '2026-10-12',
  }

  it('qué días faltan, con el más viejo aunque sea del mes pasado', () => {
    expect(missingClosesData(calendar)).toEqual({
      mes: 'Noviembre 2026',
      faltan: 2,
      dias: [
        { fecha: '02/11/2026', dia: 'lun' },
        { fecha: '03/11/2026', dia: 'mar' },
      ],
      el_mas_viejo_que_falta: '28/10/2026',
      cargados: 1,
      vendido: '$ 100',
      hoy_se_carga_despues: true,
      libros_desde: '12/10/2026',
    })
  })

  it('sin faltantes, lista vacía', () => {
    expect(
      missingClosesData({ ...calendar, days: [], missingDays: 0, firstMissingDate: null }),
    ).toMatchObject({ faltan: 0, dias: [] })
  })
})

function payer(over: Partial<PartyListRow> = {}): PartyListRow {
  return {
    partyId: 'visa',
    partyName: 'Visa SA',
    partyKind: 'card_processor',
    taxId: null,
    tradeName: 'Visa',
    active: true,
    systemKey: null,
    debtCents: 100_00,
    creditCents: 0,
    netCents: 100_00,
    notDueCents: 0,
    dueSoonCents: 0,
    overdue1to30Cents: 0,
    overdue31to60Cents: 0,
    overdue60PlusCents: 0,
    noDueCents: 0,
    overdueCents: 0,
    oldestDueDate: null,
    nextDueDate: '2026-11-08',
    lastIncreaseDate: null,
    trafficLight: 'yellow',
    trafficText: '',
    ...over,
  }
}

function list(rows: PartyListRow[]): PartyList {
  return {
    rows,
    asOf: TODAY,
    totals: {
      debtCents: rows.reduce((sum, r) => sum + r.debtCents, 0),
      overdueCents: rows.reduce((sum, r) => sum + r.overdueCents, 0),
      dueSoonCents: rows.reduce((sum, r) => sum + r.dueSoonCents, 0),
      creditCents: rows.reduce((sum, r) => sum + r.creditCents, 0),
      count: rows.length,
    },
  }
}

describe('ver_por_cobrar', () => {
  const mpBox = { id: 'caja-mp', name: 'Mercado Pago', bankPartyId: 'mp', active: true }

  it('Mercado Pago nunca está atrasado: ya está en la app, falta contarla', () => {
    const data = receivablesData(
      list([
        payer({ dueSoonCents: 100_00 }),
        payer({
          partyId: 'mp',
          tradeName: 'Mercado Pago',
          partyKind: 'payment_wallet',
          debtCents: 500_00,
          overdueCents: 500_00,
          oldestDueDate: '2026-10-20',
        }),
        payer({
          partyId: 'rappi',
          tradeName: 'Rappi',
          partyKind: 'delivery_platform',
          debtCents: 300_00,
          overdueCents: 200_00,
          oldestDueDate: '2026-10-20',
        }),
      ]),
      [mpBox],
      TODAY,
    )
    expect(data).toMatchObject({
      total: '$ 900',
      atrasado: '$ 200',
      llega_esta_semana: '$ 100',
      mas_adelante: '$ 100',
      en_billetera_falta_contar: '$ 500',
      cuantos: 3,
    })
    expect(data.filas).toEqual([
      { id: 'visa', nombre: 'Visa', tipo: 'Tarjetas', te_debe: '$ 100', llega: 'En 3 días' },
      {
        id: 'mp',
        nombre: 'Mercado Pago',
        tipo: 'Billetera',
        te_debe: '$ 500',
        llega: 'Falta contarla',
      },
      {
        id: 'rappi',
        nombre: 'Rappi',
        tipo: 'Plataforma',
        te_debe: '$ 300',
        llega: 'Atrasado',
        detalle: '$ 200 · 16 días tarde',
      },
    ])
  })

  it('una billetera sin caja propia sí se puede atrasar', () => {
    const data = receivablesData(
      list([
        payer({
          partyId: 'modo',
          partyKind: 'payment_wallet',
          overdueCents: 100_00,
          oldestDueDate: '2026-11-01',
        }),
      ]),
      [mpBox],
      TODAY,
    )
    expect(data.atrasado).toBe('$ 100')
    expect(data.en_billetera_falta_contar).toBeUndefined()
  })

  it('los que no deben nada no van', () => {
    const data = receivablesData(
      list([payer({ debtCents: 0 }), payer({ partyId: 'b', debtCents: 0, creditCents: 10_00 })]),
      [],
      TODAY,
    )
    expect(data.filas?.map((row) => row.id)).toEqual(['b'])
    expect(data.filas?.[0]).toMatchObject({ a_favor: '$ 10' })
    expect(data.filas?.[0]?.llega).toBeUndefined()
    expect(data.total).toBe('$ 0')
  })
})

describe('ver_lo_que_llego', () => {
  const net = (over: Partial<NetByMethodRow> = {}): NetByMethodRow => ({
    methodId: 'visa',
    methodName: 'Visa',
    channel: 'salon',
    soldCents: 1_000_00,
    commissionCents: 30_00,
    commissionVatCents: 6_00,
    withholdingsCents: 10_00,
    otherChargesCents: 4_00,
    unexplainedCents: 0,
    creditedCents: 800_00,
    pendingCents: 150_00,
    discountBp: 532,
    ...over,
  })

  it('vendido, lo que llegó, lo que se quedaron y lo que falta', () => {
    const data = netData([net()], 'Octubre 2026')
    expect(data).toMatchObject({
      periodo: 'Octubre 2026',
      vendido: '$ 1.000',
      llego: '$ 800',
      se_quedaron: '$ 50',
      en_camino: '$ 150',
    })
    expect(data.filas).toEqual([
      {
        medio: 'Visa',
        medio_id: 'visa',
        canal: 'Salón',
        vendido: '$ 1.000',
        llego: '$ 800',
        comision: '$ 36',
        retenciones: '$ 10',
        otros_descuentos: '$ 4',
        descuento: '5,32 %',
        en_camino: '$ 150',
      },
    ])
  })

  it('un medio sin nada no va', () => {
    const empty = net({
      methodId: 'nada',
      soldCents: 0,
      creditedCents: 0,
      pendingCents: 0,
      discountBp: null,
    })
    expect(netData([net(), empty], 'Octubre 2026').filas).toHaveLength(1)
  })
})

describe('ver_medios_de_cobro', () => {
  const method = (over: Partial<SalesMethodRow> = {}): SalesMethodRow => ({
    id: 'visa',
    name: 'Visa',
    kind: 'receivable',
    channel: 'salon',
    treasuryAccountId: null,
    treasuryName: null,
    partyId: 'p',
    partyName: 'Visa SA',
    settlementDays: 10,
    sort: 1,
    active: true,
    systemKey: null,
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  })

  it('con su id, y qué pasa con lo cobrado', () => {
    expect(salesMethodRow(method())).toEqual({
      id: 'visa',
      nombre: 'Visa',
      como: 'Te lo pagan después',
      canal: 'Salón',
      quien_paga: 'Visa SA',
      dias_para_acreditar: 10,
    })
    expect(
      salesMethodRow(
        method({
          kind: 'treasury',
          treasuryName: 'Caja',
          partyName: null,
          settlementDays: 0,
        }),
      ),
    ).toEqual({
      id: 'visa',
      nombre: 'Visa',
      como: 'Entra entero a una caja',
      canal: 'Salón',
      caja: 'Caja',
    })
  })
})
