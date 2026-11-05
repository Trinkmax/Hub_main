import { describe, expect, it } from 'vitest'
import { buildSheet } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla'
import { sheetTotals } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import { type PayrollEmployee, payrollTotals } from '@/lib/accounting/payroll'
import { type RecurringExpenseRow, recurringMonthStatus } from '@/lib/accounting/queries/documents'
import type { RecurringPaymentFacts } from '@/lib/accounting/recurring-status'
import { daysBetween } from '@/lib/dates'
import { employeeRow, payrollData, sheetData, sheetRow } from '@/lib/tex/tools/read/gastos'

const TODAY = '2026-11-05'
const NOV = '2026-11'

function fixed(
  over: Partial<RecurringExpenseRow> & { id: string; name: string },
): RecurringExpenseRow {
  const row = {
    partyId: null,
    partyName: null,
    accountId: 'cuenta',
    accountName: 'Alquiler',
    voucherType: null,
    vatRateBp: null,
    amountCents: 100_000_00,
    frequency: 'monthly' as const,
    dueDay: 10,
    nextDueDate: '2026-11-10',
    remindDaysBefore: 5,
    treasuryAccountId: null,
    treasuryName: null,
    active: true,
    lastDocumentId: null,
    lastDocumentDate: null,
    notes: null,
    endsOn: null,
    remainingDues: null,
    installmentsTotal: null,
    skippedDue: null,
    loadedDue: null,
    ended: false,
    breakdown: [],
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  }
  return {
    ...row,
    monthStatus: over.monthStatus ?? recurringMonthStatus({ ...row, today: TODAY }),
    daysToDue: daysBetween(TODAY, row.nextDueDate),
  }
}

const paid = (id: string, cents: number): [string, RecurringPaymentFacts] => [
  id,
  {
    document: {
      id: `doc-${id}`,
      kind: 'expense',
      accountingDate: '2026-11-02',
      dueDate: null,
      totalCents: cents,
      paidCents: cents,
      openCents: 0,
    },
    priorOpenCents: 0,
  },
]

const ROWS = [
  fixed({ id: 'alquiler', name: 'Alquiler', nextDueDate: '2026-11-10' }),
  fixed({ id: 'luz', name: 'EPEC', amountCents: 30_000_00, nextDueDate: '2026-11-03' }),
  fixed({ id: 'gas', name: 'Gas', amountCents: null, nextDueDate: '2026-11-20' }),
  // Ya se cargó el de este mes y se pagó: el próximo vencimiento es el de diciembre.
  fixed({
    id: 'internet',
    name: 'Internet',
    amountCents: 20_000_00,
    nextDueDate: '2026-12-02',
    dueDay: 2,
    lastDocumentId: 'doc-internet',
    lastDocumentDate: '2026-11-02',
    loadedDue: '2026-11-02',
    monthStatus: 'loaded',
  }),
  fixed({
    id: 'seguro',
    name: 'Seguro',
    frequency: 'yearly',
    nextDueDate: '2027-03-10',
    monthStatus: 'upcoming',
  }),
  fixed({ id: 'pausado', name: 'Pausado', active: false }),
]
const PAYMENTS = new Map([paid('internet', 20_000_00)])

function sheetFor(month = NOV) {
  return buildSheet(ROWS, PAYMENTS, { month, today: TODAY })
}

const employee = (over: Partial<PayrollEmployee> = {}): PayrollEmployee => ({
  id: 'emp-1',
  name: 'Martina Ríos',
  payFrequency: 'monthly',
  active: true,
  notes: 'Tiene el DNI 11.111.111',
  salaryCents: 800_000_00,
  advancesCents: 100_000_00,
  paidCents: 200_000_00,
  movements: [],
  ...over,
})

describe('ver_gastos_fijos', () => {
  it('un renglón con su id, monto y vencimiento', () => {
    const luz = sheetFor().items.find((item) => item.row.id === 'luz')
    expect(luz && sheetRow(luz)).toEqual({
      id: 'luz',
      nombre: 'EPEC',
      estado: 'Vencido',
      vence: '03/11/2026',
      monto: '$ 30.000',
      falta: '$ 30.000',
    })
  })

  it('uno sin monto lo dice', () => {
    const gas = sheetFor().items.find((item) => item.row.id === 'gas')
    expect(gas && sheetRow(gas)).toMatchObject({
      estado: 'Sin monto',
      monto: 'Variable: todavía sin monto',
    })
  })

  it('cuáles faltan y cuáles se pagaron', () => {
    const sheet = sheetFor()
    const data = sheetData(sheet, sheetTotals(sheet, null), null)
    expect(data.faltan?.map((row) => row.id)).toEqual(['luz', 'alquiler', 'gas'])
    expect(data.pagados?.map((row) => row.id)).toEqual(['internet'])
    expect(data.pagados?.[0]).toMatchObject({
      estado: 'Pagado',
      pagado: '$ 20.000',
      comprobante_id: 'doc-internet',
    })
    expect(data).toMatchObject({
      mes: 'Noviembre 2026',
      total_del_mes: '$ 150.000',
      pagado: '$ 20.000',
      falta_pagar: '$ 130.000',
      vencido: '$ 30.000',
      sin_monto: 1,
      vencen_mas_adelante: 1,
      pausados_o_terminados: 1,
    })
  })

  it('los totales son los de la pantalla: suman los sueldos', () => {
    const sheet = sheetFor()
    const salaries = payrollTotals([employee()])
    const data = sheetData(sheet, sheetTotals(sheet, salaries), salaries)
    expect(data).toMatchObject({
      total_del_mes: '$ 950.000',
      pagado: '$ 320.000',
      falta_pagar: '$ 630.000',
      sueldos: { total: '$ 800.000', falta: '$ 500.000' },
    })
    // Los fijos solos, como dice el Resumen.
    expect(data.fijos).toMatchObject({ pagado: '$ 20.000', falta: '$ 130.000' })
  })

  it('si los sueldos no se pudieron leer, lo dice', () => {
    const sheet = sheetFor()
    expect(sheetData(sheet, sheetTotals(sheet, null), null).sueldos).toBe(
      'No se pudieron leer: el total no los cuenta.',
    )
  })

  it('los salteados van aparte', () => {
    const rows = [
      fixed({
        id: 'salteado',
        name: 'Salteado',
        nextDueDate: '2026-12-10',
        skippedDue: '2026-11-10',
        monthStatus: 'skipped',
      }),
    ]
    const sheet = buildSheet(rows, new Map(), { month: NOV, today: TODAY })
    const data = sheetData(sheet, sheetTotals(sheet, null), null)
    expect(data.este_mes_no_se_pagan).toEqual([{ id: 'salteado', nombre: 'Salteado' }])
    expect(data.faltan).toEqual([])
  })

  it('sin nada que sume, no dice $ 0', () => {
    const sheet = buildSheet([], new Map(), { month: NOV, today: TODAY })
    const data = sheetData(sheet, sheetTotals(sheet, null), null)
    expect(data.total_del_mes).toBeUndefined()
    expect(data.falta_pagar).toBeUndefined()
    expect(data.oracion).toBe('Todavía no cargaste gastos fijos.')
  })

  it('con las dos listas llenas entra entero en el tope del ciclo', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      fixed({
        id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        name: `Un gasto fijo con un nombre bien largo número ${i}`,
        partyName: 'Distribuidora de bebidas del centro SRL',
        treasuryName: 'Banco de la Nación Argentina',
      }),
    )
    const loaded = many.map((row) => ({
      ...row,
      monthStatus: 'loaded' as const,
      lastDocumentId: 'doc',
      lastDocumentDate: '2026-11-02',
      loadedDue: '2026-11-02',
    }))
    const payments = new Map([paid('7c9e6679-7425-40de-944b-e07fc1f90ae7', 100_000_00)])
    const sheet = buildSheet([...many, ...loaded], payments, { month: NOV, today: TODAY })
    const data = sheetData(sheet, sheetTotals(sheet, null), null)
    expect(data.faltan_hay_mas).toBe(true)
    expect(data.pagados_hay_mas).toBe(true)
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })

  it('una lista larga se corta y lo dice', () => {
    const many = Array.from({ length: 45 }, (_, i) => fixed({ id: `g${i}`, name: `Gasto ${i}` }))
    const sheet = buildSheet(many, new Map(), { month: NOV, today: TODAY })
    const data = sheetData(sheet, sheetTotals(sheet, null), null)
    expect(data.faltan).toHaveLength(40)
    expect(data.faltan_hay_mas).toBe(true)
  })
})

describe('ver_sueldos', () => {
  it('empleado, sueldo, adelantos, pagado y saldo', () => {
    expect(employeeRow(employee())).toEqual({
      id: 'emp-1',
      empleado: 'Martina Ríos',
      cobra: 'Mensual',
      sueldo: '$ 800.000',
      adelantos: '$ 100.000',
      pagado: '$ 200.000',
      saldo: '$ 500.000',
    })
  })

  it('si se le pagó de más, se dice con palabras', () => {
    expect(employeeRow(employee({ paidCents: 900_000_00 })).saldo).toBe(
      'le pagaste $ 200.000 de más',
    )
  })

  it('no lleva sus notas (CLAUDE.md §9)', () => {
    expect(JSON.stringify(employeeRow(employee()))).not.toContain('DNI')
  })

  it('los totales de la planilla y si ya se devengó', () => {
    const report = { month: NOV, employees: [employee()], accrual: null }
    expect(payrollData(report, TODAY)).toMatchObject({
      mes: 'Noviembre 2026',
      sueldos: '$ 800.000',
      adelantos: '$ 100.000',
      pagado: '$ 200.000',
      le_debes_a_fin_de_mes: '$ 500.000',
      devengado: false,
      cuantos: 1,
      hay_mas: false,
    })
    expect(
      payrollData(
        {
          ...report,
          accrual: { documentId: 'doc-9', date: '2026-11-30', amountCents: 800_000_00 },
        },
        TODAY,
      ).devengado,
    ).toEqual({ comprobante_id: 'doc-9', total: '$ 800.000' })
  })

  it('lo que uno cobró de más no le baja la deuda a otro', () => {
    const data = payrollData(
      {
        month: NOV,
        accrual: null,
        employees: [employee({ paidCents: 900_000_00 }), employee({ id: 'emp-2', paidCents: 0 })],
      },
      TODAY,
    )
    expect(data.le_debes_a_fin_de_mes).toBe('$ 700.000')
  })
})
