import { describe, expect, it } from 'vitest'
import type { ParaHoyRow } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/para-hoy'
import { buildProjection, type ProjectionSourceDay } from '@/lib/accounting/projection'
import type { DailyCloseCalendar, RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import type {
  AccSummary,
  SummaryAttentionItem,
  SummaryTreasury,
} from '@/lib/accounting/queries/summary'
import {
  attentionRow,
  fixedDueRow,
  missingCloses,
  paraHoyRow,
  pendientesData,
  type ResumenFacts,
  resumenData,
} from '@/lib/tex/tools/read/resumen'

const TODAY = '2026-11-05'

function treasury(over: Partial<SummaryTreasury> = {}): SummaryTreasury {
  return {
    id: 'caja',
    name: 'Caja',
    kind: 'cash',
    accountCode: null,
    balanceCents: 0,
    pendingWalletCents: 0,
    lastCheckedOn: null,
    lastMovementDate: '2026-11-01',
    ...over,
  }
}

function summary(over: Partial<AccSummary> = {}): AccSummary {
  const treasuries = over.treasuries ?? [treasury({ balanceCents: 500_000_00 })]
  return {
    asOf: TODAY,
    treasuries,
    availableCents: treasuries
      .filter((t) => t.kind !== 'credit_card')
      .reduce((sum, t) => sum + t.balanceCents, 0),
    cardDebtCents: 0,
    pendingWalletCents: 0,
    payables: {
      totalCents: 300_000_00,
      overdueCents: 100_000_00,
      dueWeekCents: 50_000_00,
      partiesRed: 2,
    },
    receivables: { totalCents: 80_000_00, overdueCents: 80_000_00, top: [] },
    ivaMonth: { month: '2026-11-01', toPayCents: 10_000_00, inFavorCents: 0, provisional: true },
    monthToDate: { soldCents: 0, purchasesAndExpensesCents: 200_000_00 },
    attention: [],
    books: {
      lastClosedMonth: null,
      closedBy: null,
      closedAt: null,
      openMonth: null,
      openWarnings: null,
    },
    firstSteps: {
      firstExpense: true,
      firstDailyClose: true,
      accountantAdded: true,
      partnerGranted: true,
    },
    ...over,
  }
}

const SETTINGS = {
  openingStatus: 'posted',
  ivaCondition: 'responsable_inscripto',
} as AccountingSettings

function sourceDay(day: string, over: Partial<ProjectionSourceDay> = {}): ProjectionSourceDay {
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

const PROJECTION = buildProjection(
  [
    sourceDay('2026-11-03', { closes: 1, salonCents: 80_000_00 }),
    sourceDay('2026-11-04', { closes: 1, salonCents: 120_000_00 }),
    sourceDay('2026-11-05'),
    sourceDay('2026-11-06'),
  ],
  { serviceDay: TODAY },
)

function facts(over: Partial<ResumenFacts> = {}): ResumenFacts {
  return {
    today: TODAY,
    canWrite: true,
    summary: summary(),
    settings: SETTINGS,
    projection: PROJECTION,
    recurring: [],
    payments: new Map(),
    payroll: {
      owedCents: 150_000_00,
      salaryCents: 200_000_00,
      advancesCents: 50_000_00,
      paidCents: 0,
    },
    receivables: {
      totalCents: 80_000_00,
      lateCents: 30_000_00,
      weekCents: 20_000_00,
      laterCents: 0,
      walletCents: 30_000_00,
      lateParties: 1,
    },
    ...over,
  }
}

describe('ver_resumen', () => {
  it('la plata de hoy, igual que el panel', () => {
    const data = resumenData(facts())
    expect(data).toMatchObject({
      plata_hoy: '$ 500.000',
      plata_en_palabras: 'Está toda en Caja.',
      cuentas: ['Caja: $ 500.000'],
    })
    expect(data.en_descubierto).toBeUndefined()
  })

  it('un descubierto lo dice, sin esconder el número', () => {
    const data = resumenData(
      facts({ summary: summary({ treasuries: [treasury({ balanceCents: -5_000_00 })] }) }),
    )
    expect(data).toMatchObject({ plata_hoy: '-$ 5.000', en_descubierto: true })
    expect(data.cuentas).toEqual(['Caja: descubierto $ 5.000'])
  })

  it('si el cero no es un dato no afirma $ 0: dice que todavía no sabe', () => {
    const data = resumenData(
      facts({
        summary: summary({
          treasuries: [treasury({ balanceCents: 0, lastMovementDate: null })],
          payables: { totalCents: 0, overdueCents: 0, dueWeekCents: 0, partiesRed: 0 },
        }),
        settings: { ...SETTINGS, openingStatus: 'pending' },
      }),
    )
    expect(data.plata_hoy).toBeUndefined()
    expect(data.plata_en_palabras).toContain('Todavía no sé cuánta plata hay')
    expect(data.le_debes).toContain('Todavía no sé cuánto debés')
  })

  it('lo que se debe, partido en vencido, esta semana y más adelante', () => {
    expect(resumenData(facts()).le_debes).toEqual({
      total: '$ 300.000',
      vencido: '$ 100.000',
      vence_esta_semana: '$ 50.000',
      mas_adelante: '$ 150.000',
      con_algo_vencido: 2,
    })
  })

  it('lo que te deben usa los tramos de Por cobrar: Mercado Pago no está atrasado', () => {
    expect(resumenData(facts()).te_deben).toEqual({
      total: '$ 80.000',
      atrasado: '$ 30.000',
      llega_esta_semana: '$ 20.000',
      en_billetera_falta_contar: '$ 30.000',
    })
  })

  it('si no se pudieron leer los tramos, queda el total y no un atraso que no es', () => {
    expect(resumenData(facts({ receivables: null })).te_deben).toEqual({ total: '$ 80.000' })
  })

  it('las ventas del mes contra el objetivo', () => {
    expect(resumenData(facts()).ventas_del_mes).toMatchObject({
      vendido: '$ 200.000',
      objetivo: '$ 400.000',
      cumplimiento: '50 %',
      objetivo_a_hoy: '$ 200.000',
      falta: '$ 200.000',
    })
  })

  it('lo que no se pudo leer no pasa por cero', () => {
    const data = resumenData(facts({ projection: null, payroll: null, recurring: null }))
    expect(data.ventas_del_mes).toBe('No se pudieron leer.')
    expect(data.falta_de_fijos_y_sueldos).toEqual({})
  })

  it('un mes sin cierres no vendió cero', () => {
    const empty = buildProjection([sourceDay(TODAY)], { serviceDay: TODAY })
    expect(resumenData(facts({ projection: empty })).ventas_del_mes).not.toHaveProperty('vendido')
  })

  it('el IVA del mes dice que es estimado', () => {
    expect(resumenData(facts()).iva_del_mes).toBe(
      'IVA de noviembre: a pagar $ 10.000. Estimado: lo confirma la contadora.',
    )
  })

  it('sin espacios duros en ningún texto', () => {
    expect(JSON.stringify(resumenData(facts()))).not.toContain(' ')
  })
})

function row(over: Partial<ParaHoyRow> = {}): ParaHoyRow {
  return {
    key: 'close',
    title: 'Falta el cierre de ayer',
    detail: 'martes 03/11',
    late: false,
    action: { kind: 'href', href: '/ventas/cierre', label: 'Cargar' },
    retry: false,
    ...over,
  }
}

describe('ver_pendientes', () => {
  it('cada renglón dice a qué pantalla lleva', () => {
    expect(paraHoyRow(row())).toEqual({
      que: 'Falta el cierre de ayer',
      detalle: 'martes 03/11',
      pantalla: 'ventas.cierre',
    })
    expect(paraHoyRow(row({ key: 'plan' })).pantalla).toBe('compras.semana')
    expect(paraHoyRow(row({ key: 'integration' })).pantalla).toBe('importar')
    expect(paraHoyRow(row({ key: 'setup' })).pantalla).toBe('puesta_en_marcha')
  })

  it('lo vencido trae el id para seguir: un proveedor o un gasto fijo', () => {
    const payable = paraHoyRow(
      row({
        key: 'overdue',
        late: true,
        action: { kind: 'sheet', sheet: 'pagar', params: { proveedor: 'coca' }, label: 'Pagar' },
      }),
    )
    expect(payable).toMatchObject({
      vencido: true,
      pantalla: 'compras.proveedores',
      participe_id: 'coca',
    })
    const fixed = paraHoyRow(
      row({
        key: 'overdue',
        action: { kind: 'sheet', sheet: 'gasto', params: { 'gasto-fijo': 'luz' }, label: 'Pagar' },
      }),
    )
    expect(fixed).toMatchObject({ pantalla: 'gastos.fijos', gasto_fijo_id: 'luz' })
  })

  it('lo que no se pudo revisar no lleva a ningún lado', () => {
    const data = paraHoyRow(row({ key: 'integration', action: null, retry: true }))
    expect(data.pantalla).toBeUndefined()
  })

  const attention = (over: Partial<SummaryAttentionItem>): SummaryAttentionItem => ({
    kind: 'payable_overdue',
    refId: null,
    label: 'Coca · Factura A',
    amountCents: 40_00,
    date: '2026-10-20',
    days: 16,
    partyId: 'coca',
    count: null,
    ...over,
  })

  it('un aviso de la base, en palabras y con sus ids', () => {
    expect(attentionRow(attention({ refId: 'linea-1' }))).toEqual({
      que: 'Pago vencido',
      texto: 'Coca · Factura A',
      importe: '$ 40',
      fecha: '20/10/2026',
      dias: 16,
      participe_id: 'coca',
      id: 'linea-1',
    })
  })

  const fixed = (over: Partial<RecurringExpenseRow>) =>
    ({
      id: 'luz',
      name: 'EPEC',
      active: true,
      ended: false,
      monthStatus: 'pending',
      amountCents: 90_00,
      nextDueDate: '2026-11-03',
      daysToDue: -2,
      remindDaysBefore: 5,
      remainingDues: null,
      installmentsTotal: null,
      loadedDue: null,
      ...over,
    }) as RecurringExpenseRow

  it('un gasto fijo que toca', () => {
    expect(fixedDueRow(fixed({}))).toEqual({
      id: 'luz',
      nombre: 'EPEC',
      monto: '$ 90',
      vence: '03/11/2026',
      dias: -2,
      vencido: true,
    })
    expect(fixedDueRow(fixed({ amountCents: null, daysToDue: 2 }))).toMatchObject({
      monto: 'Sin monto',
      dias: 2,
    })
    expect(fixedDueRow(fixed({ daysToDue: 2 })).vencido).toBeUndefined()
  })

  const calendar = {
    days: [
      { date: '2026-11-03', status: 'missing', closes: [], totalCents: null },
      { date: '2026-11-04', status: 'loaded', closes: [], totalCents: 100 },
      { date: '2026-11-05', status: 'pending', closes: [], totalCents: null },
    ],
    firstMissingDate: '2026-10-30',
  } as unknown as DailyCloseCalendar

  it('los cierres que faltan: hoy todavía no falta', () => {
    expect(missingCloses(calendar)).toEqual({
      faltan: 1,
      dias: ['03/11/2026'],
      el_mas_viejo_que_falta: '30/10/2026',
    })
  })

  it('cada cosa en un solo lado: ni los fijos ni los cierres se repiten en los avisos', () => {
    const data = pendientesData({
      rows: [row()],
      summary: summary({
        attention: [
          attention({}),
          attention({ kind: 'payable_due_week', days: 3 }),
          attention({ kind: 'recurring_due', label: 'EPEC' }),
          attention({ kind: 'missing_daily_close', label: 'Faltan cierres del día.' }),
          attention({ kind: 'treasury_unchecked', label: 'Mercado Pago', partyId: null }),
        ],
      }),
      recurring: [fixed({})],
      calendar,
    })
    expect(data.vencimientos?.map((item) => item.que)).toEqual([
      'Pago vencido',
      'Vence esta semana',
    ])
    expect(data.avisos?.map((item) => item.que)).toEqual(['Caja sin contar'])
    expect(data.gastos_fijos?.map((item) => item.id)).toEqual(['luz'])
    expect(data.no_pude_leer).toBeUndefined()
  })

  it('«no hay nada» y «no se pudo mirar» no son lo mismo', () => {
    expect(
      pendientesData({ rows: [], summary: null, recurring: null, calendar: null }).no_pude_leer,
    ).toEqual(['el resumen', 'los gastos fijos', 'los cierres'])
  })

  it('al día, listas vacías y sin nada que falte leer', () => {
    expect(
      pendientesData({
        rows: [],
        summary: summary(),
        recurring: [],
        calendar: { ...calendar, days: [], firstMissingDate: null },
      }),
    ).toEqual({
      para_hoy: [],
      cierres: { faltan: 0, dias: [] },
      vencimientos: [],
      gastos_fijos: [],
      avisos: [],
    })
  })

  it('muchos gastos fijos se cortan y lo dice', () => {
    const many = Array.from({ length: 20 }, (_, i) => fixed({ id: `g${i}` }))
    const data = pendientesData({ rows: [], summary: summary(), recurring: many, calendar })
    expect(data.gastos_fijos).toHaveLength(15)
    expect(data.gastos_fijos_hay_mas).toBe(true)
  })
})
