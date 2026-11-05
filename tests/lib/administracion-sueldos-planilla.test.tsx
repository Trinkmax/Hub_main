import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCell } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/cell-money'
import SueldosPage from '@/app/(manager)/[tenantSlug]/administracion/sueldos/page'
import {
  postPayrollAccrual,
  postPayrollMovement,
  saveEmployee,
  saveEmployeeSalary,
} from '@/lib/accounting/actions/payroll'
import {
  accrualOffer,
  employeeBalanceCents,
  employeeSalarySchema,
  employeeSchema,
  monthTitle,
  owedSentence,
  type PayrollEmployee,
  type PayrollReport,
  parsePayrollMonth,
  parsePayrollReport,
  payrollAccrualValues,
  payrollDetail,
  payrollHref,
  payrollMonths,
  payrollMovementValues,
  payrollTotals,
  personalPartyId,
  settleHint,
} from '@/lib/accounting/payroll'
import { MAX_CENTS } from '@/lib/accounting/schemas'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { bankTaxOf, DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import { prepare } from './accounting-fixtures'

/**
 * La planilla de Sueldos: «lo que más me importa es saber cuánto le debo a fin de mes» (Luciano, 29/10).
 * Lo puro (saldo, totales, parseo del reporte, asientos), que el motor acepte lo que se le manda, el
 * orden de las acciones y lo que ve cada uno en la pantalla.
 */

const TODAY = '2026-11-04'
const NOV = '2026-11'
const SLUG = 'hub'
const NB = String.fromCharCode(160)
const $ = (text: string) => `$${NB}${text}`
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CLIENT_REF = uuid(999)
const HASH = 'a'.repeat(64)

const ui = vi.hoisted(() => ({ readOnly: false }))
const db = vi.hoisted(() => ({
  report: null as unknown,
  fails: false,
  rpc: vi.fn(),
  runPostDocument: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/sueldos',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('notFound')
  },
  redirect: () => {
    throw new Error('redirect')
  },
}))
vi.mock('@/components/administracion/accounting-provider', () => {
  const value = () => ({
    tenantSlug: 'hub',
    today: '2026-11-04',
    access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  })
  return { useAccounting: value, useAccountingOptional: value }
})
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/page-access', () => ({
  requireComprasAccess: async () => ({
    access: { tenant: { id: 'tenant-1' } },
    canWrite: !ui.readOnly,
  }),
}))
vi.mock('@/lib/accounting/queries/payroll', () => ({
  getPayrollReport: async (_tenant: string, month: string) => {
    if (db.fails) throw new Error('sin lectura')
    return db.report ?? { month, employees: [], accrual: null }
  },
}))
vi.mock('@/lib/dates', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  todayInCordoba: () => '2026-11-04',
}))
vi.mock('@/lib/accounting/access', () => ({
  authorizeAccounting: vi.fn(async (_slug: string, need: string) =>
    ui.readOnly && need === 'write'
      ? { ok: false, state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' } }
      : { ok: true, tenantId: 'tenant-1' },
  ),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: db.rpc }),
}))
vi.mock('@/lib/accounting/server/post-document', () => ({
  runPostDocument: db.runPostDocument,
  afterCommit: (_op: string, run: () => unknown) => run(),
  revalidateAdministracion: vi.fn(),
  logFailure: vi.fn(),
  errorName: () => 'error',
}))

beforeEach(() => {
  db.rpc.mockReset()
  db.rpc.mockResolvedValue({ data: { id: uuid(70) }, error: null })
  db.runPostDocument.mockReset()
  db.runPostDocument.mockResolvedValue({ ok: true, result: {}, message: 'Listo.' })
})

afterEach(() => {
  ui.readOnly = false
  db.report = null
  db.fails = false
})

function employee(over: Partial<PayrollEmployee> = {}): PayrollEmployee {
  return {
    id: uuid(1),
    name: 'Martina Ríos',
    payFrequency: 'monthly',
    active: true,
    notes: null,
    salaryCents: 78_000_000,
    advancesCents: 25_000_000,
    paidCents: 0,
    movements: [],
    ...over,
  }
}

const REPORT: PayrollReport = {
  month: NOV,
  accrual: null,
  employees: [
    employee({
      movements: [
        {
          documentId: uuid(201),
          kind: 'advance',
          date: '2026-11-03',
          amountCents: 15_000_000,
          treasury: 'Caja Efectivo',
        },
        {
          documentId: uuid(202),
          kind: 'advance',
          date: '2026-11-04',
          amountCents: 10_000_000,
          treasury: 'Mercado Pago',
        },
      ],
    }),
    employee({
      id: uuid(2),
      name: 'Joaquín Paz',
      payFrequency: 'biweekly',
      salaryCents: 92_000_000,
      advancesCents: 0,
      paidCents: 46_000_000,
    }),
  ],
}

describe('el saldo y los totales', () => {
  it('saldo = sueldo − adelantos − pagado; puede ser negativo', () => {
    expect(employeeBalanceCents(employee())).toBe(53_000_000)
    expect(employeeBalanceCents(employee({ paidCents: 60_000_000 }))).toBe(-7_000_000)
  })

  it('suma cada columna', () => {
    expect(payrollTotals(REPORT.employees)).toEqual({
      count: 2,
      salaryCents: 170_000_000,
      advancesCents: 25_000_000,
      paidCents: 46_000_000,
      balanceCents: 99_000_000,
      owedCents: 99_000_000,
    })
    expect(payrollTotals([])).toMatchObject({ count: 0, salaryCents: 0, owedCents: 0 })
  })

  it('lo que uno cobró de más no le baja la deuda a otro', () => {
    const totals = payrollTotals([
      employee({ salaryCents: 100, advancesCents: 150 }),
      employee({ id: uuid(2), salaryCents: 100, advancesCents: 0 }),
    ])
    expect(totals.balanceCents).toBe(50)
    expect(totals.owedCents).toBe(100)
  })

  it('el diálogo dice cuánto se le debe', () => {
    expect(owedSentence(53_000_000, NOV)).toBe(`Le debés ${$('530.000')} de noviembre.`)
    expect(owedSentence(0, NOV)).toBe('No le debés nada de noviembre.')
    expect(owedSentence(-7_000_000, NOV)).toBe(`Le pagaste ${$('70.000')} de más en noviembre.`)
  })
})

describe('lo que devuelve `acc_report_payroll`', () => {
  const RAW = {
    month: '2026-11-01',
    employees: [
      {
        id: uuid(1),
        name: 'Martina Ríos',
        pay_frequency: 'biweekly',
        active: true,
        notes: null,
        salary_cents: 78_000_000,
        // `sum()` de la base puede venir como texto.
        advances_cents: '15000000',
        paid_cents: 0,
        movements: [
          {
            document_id: uuid(201),
            kind: 'advance',
            date: '2026-11-03',
            amount_cents: 15_000_000,
            treasury: 'Caja Efectivo',
          },
        ],
      },
    ],
    accrual: { document_id: uuid(300), date: '2026-11-30', amount_cents: 78_000_000 },
  }

  it('lo pasa a la planilla', () => {
    expect(parsePayrollReport(RAW, NOV)).toEqual({
      month: NOV,
      accrual: { documentId: uuid(300), date: '2026-11-30', amountCents: 78_000_000 },
      employees: [
        {
          id: uuid(1),
          name: 'Martina Ríos',
          payFrequency: 'biweekly',
          active: true,
          notes: null,
          salaryCents: 78_000_000,
          advancesCents: 15_000_000,
          paidCents: 0,
          movements: [
            {
              documentId: uuid(201),
              kind: 'advance',
              date: '2026-11-03',
              amountCents: 15_000_000,
              treasury: 'Caja Efectivo',
            },
          ],
        },
      ],
    })
  })

  it('sin empleados ni asiento; una caja que no se sabe', () => {
    expect(parsePayrollReport({ month: '2026-11-01', employees: [], accrual: null }, NOV)).toEqual({
      month: NOV,
      employees: [],
      accrual: null,
    })
    const [first] = RAW.employees
    const movement = first?.movements[0]
    const parsed = parsePayrollReport(
      { ...RAW, employees: [{ ...first, movements: [{ ...movement, treasury: null }] }] },
      NOV,
    )
    expect(parsed?.employees[0]?.movements[0]?.treasury).toBeNull()
  })

  it('lo que no se puede leer no se inventa', () => {
    expect(parsePayrollReport(null, NOV)).toBeNull()
    expect(parsePayrollReport({ employees: 'nada' }, NOV)).toBeNull()
    expect(
      parsePayrollReport({ employees: [{ ...RAW.employees[0], salary_cents: 'mucho' }] }, NOV),
    ).toBeNull()
  })
})

describe('los meses', () => {
  it('`?mes=`: cualquier mes real; si no, el de hoy', () => {
    expect(parsePayrollMonth('2026-08', TODAY)).toBe('2026-08')
    for (const bad of ['2026-13', 'noviembre', '', null, undefined]) {
      expect(parsePayrollMonth(bad, TODAY)).toBe(NOV)
    }
  })

  it('la barra: el pasado, este y el que viene; el que vino por link se suma', () => {
    expect(payrollMonths(TODAY, NOV)).toEqual(['2026-10', NOV, '2026-12'])
    expect(payrollMonths(TODAY, '2026-08')).toEqual(['2026-08', '2026-10', NOV, '2026-12'])
    expect(payrollMonths('2026-12-20', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01'])
  })

  it('las palabras', () => {
    expect(monthTitle(NOV)).toBe('Noviembre')
    expect(settleHint(NOV)).toBe('1.ª semana de diciembre')
    expect(settleHint('2026-12')).toBe('1.ª semana de enero')
    expect(payrollHref('hub')).toBe('/hub/administracion/sueldos')
    expect(payrollHref('hub', NOV)).toBe('/hub/administracion/sueldos?mes=2026-11')
  })
})

describe('«Devengar»: cuándo se ofrece', () => {
  it('con total, en este mes o en uno pasado, y con fecha de fin de mes', () => {
    expect(accrualOffer(REPORT, TODAY)).toEqual({
      kind: 'ready',
      totalCents: 170_000_000,
      date: '2026-11-30',
    })
    expect(accrualOffer({ ...REPORT, month: '2026-10' }, TODAY)).toMatchObject({
      kind: 'ready',
      date: '2026-10-31',
    })
  })

  it('no se ofrece de nuevo si ya se devengó', () => {
    const accrual = { documentId: uuid(300), date: '2026-11-30', amountCents: 170_000_000 }
    expect(accrualOffer({ ...REPORT, accrual }, TODAY)).toEqual({ kind: 'done', accrual })
  })

  it('sin total no se puede', () => {
    expect(accrualOffer({ ...REPORT, employees: [] }, TODAY)).toEqual({ kind: 'no_total' })
    expect(accrualOffer({ ...REPORT, employees: [employee({ salaryCents: 0 })] }, TODAY)).toEqual({
      kind: 'no_total',
    })
  })

  it('un mes que no empezó: el motor no acepta un asiento después del fin del mes en curso', () => {
    expect(accrualOffer({ ...REPORT, month: '2026-12' }, TODAY)).toEqual({ kind: 'future' })
  })
})

describe('lo que se le manda al motor', () => {
  const { r, ctx } = prepare()
  const partyId = personalPartyId(ctx)
  const treasury = r.treasury('caja')
  const today = ctx.today

  it('el partícipe «Personal», por su clave o por su cuenta', () => {
    expect(partyId).toBe(r.party('personal'))
    const parties = new Map(
      [...ctx.parties].map(([id, party]) => [
        id,
        id === partyId ? { ...party, systemKey: 'personal' } : party,
      ]),
    )
    expect(personalPartyId({ ...ctx, parties })).toBe(partyId)
    expect(personalPartyId({ ...ctx, parties: new Map() })).toBeNull()
  })

  it('el detalle dice qué fue, a quién y de qué mes', () => {
    expect(payrollDetail('advance', ' Martina Ríos ', NOV)).toBe(
      'Adelanto · Martina Ríos · noviembre',
    )
    expect(payrollDetail('payment', 'Joaquín Paz', '2026-12')).toBe(
      'Pago de sueldo · Joaquín Paz · diciembre',
    )
  })

  it('un adelanto: D Sueldos a pagar [Personal] / H la caja, y el motor lo acepta', () => {
    const values = payrollMovementValues(
      {
        kind: 'advance',
        employeeName: 'Martina Ríos',
        month: NOV,
        treasuryAccountId: treasury,
        amountCents: 15_000_000,
        date: today,
        personalPartyId: partyId,
      },
      ctx,
    )
    expect(values).toEqual({
      treasuryAccountId: treasury,
      direction: 'out',
      counterpartAccountId: ctx.sys.payroll_payable.id,
      partyId,
      amountCents: 15_000_000,
      date: today,
      shortcut: 'other',
      detail: 'Adelanto · Martina Ríos · noviembre',
    })
    const preview = previewDocumentForm('cash_movement', values, ctx)
    if (!preview.ok) throw new Error(preview.message)
    const lines = preview.preview.flatMap((entry) => entry.lines)
    const debit = lines.find((line) => line.debitCents === 15_000_000)
    const credit = lines.find((line) => line.creditCents === 15_000_000)
    expect(debit?.accountId).toBe(ctx.sys.payroll_payable.id)
    expect(credit?.accountId).toBe(r.treasuryAccount('caja'))
  })

  it('desde el banco, el impuesto al cheque viaja en el mismo envío, en otro documento', () => {
    const taxed = { ...ctx, settings: { ...ctx.settings, taxSettings: DEFAULT_TAX_SETTINGS } }
    const preview = previewDocumentForm(
      'cash_movement',
      payrollMovementValues(
        {
          kind: 'advance',
          employeeName: 'Martina Ríos',
          month: NOV,
          treasuryAccountId: r.treasury('banco'),
          amountCents: 10_000_000,
          date: today,
          personalPartyId: partyId,
        },
        taxed,
      ),
      taxed,
    )
    if (!preview.ok) throw new Error(preview.message)
    // Por eso la lectura deja solo el `cash_movement`: el adelanto es de $ 100.000, no de $ 100.600.
    expect(preview.preview).toHaveLength(2)
    expect(
      bankTaxOf(10_000_000, taxed.treasuries.get(r.treasury('banco')), DEFAULT_TAX_SETTINGS),
    ).toBe(60_000)
  })

  it('sin importe o sin caja, el formulario lo marca', () => {
    const preview = previewDocumentForm(
      'cash_movement',
      payrollMovementValues(
        {
          kind: 'payment',
          employeeName: 'Martina Ríos',
          month: NOV,
          treasuryAccountId: null,
          amountCents: null,
          date: today,
          personalPartyId: partyId,
        },
        ctx,
      ),
      ctx,
    )
    expect(preview.ok).toBe(false)
    if (preview.ok) return
    expect(Object.keys(preview.fieldErrors ?? {})).toEqual(
      expect.arrayContaining(['treasuryAccountId', 'amountCents']),
    )
  })

  it('devengar: D Sueldos y jornales / H Sueldos a pagar [Personal], y el motor lo acepta', () => {
    const month = today.slice(0, 7)
    const values = payrollAccrualValues(
      { month, totalCents: 170_000_000, personalPartyId: partyId ?? '' },
      ctx,
    )
    expect(values.entryKind).toBe('payroll')
    expect(values.date.slice(0, 7)).toBe(month)
    expect(values.lines).toEqual([
      expect.objectContaining({
        accountId: ctx.sys.salaries.id,
        debitCents: 170_000_000,
        creditCents: null,
        partyId: null,
      }),
      expect.objectContaining({
        accountId: ctx.sys.payroll_payable.id,
        debitCents: null,
        creditCents: 170_000_000,
        partyId,
      }),
    ])
    const preview = previewDocumentForm('manual_entry', values, ctx)
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('los bordes (zod)', () => {
  it('un empleado: nombre de 2 a 80 letras y una frecuencia que exista', () => {
    expect(employeeSchema.safeParse({ name: '  Ana  ', payFrequency: 'monthly' }).data).toEqual({
      id: null,
      name: 'Ana',
      payFrequency: 'monthly',
      active: true,
      notes: null,
    })
    const short = employeeSchema.safeParse({ name: 'A', payFrequency: 'monthly' })
    expect(short.error?.issues[0]?.message).toBe('Escribí el nombre.')
    expect(
      employeeSchema.safeParse({ name: 'x'.repeat(81), payFrequency: 'monthly' }).success,
    ).toBe(false)
    expect(employeeSchema.safeParse({ name: 'Ana', payFrequency: 'semanal' }).success).toBe(false)
    expect(
      employeeSchema.safeParse({ id: 'x', name: 'Ana', payFrequency: 'monthly' }).success,
    ).toBe(false)
  })

  it('un sueldo: centavos enteros, de cero al tope de los formularios, en un mes real', () => {
    const ok = { employeeId: uuid(1), month: NOV, salaryCents: 0 }
    expect(employeeSalarySchema.safeParse(ok).success).toBe(true)
    expect(employeeSalarySchema.safeParse({ ...ok, salaryCents: MAX_CENTS }).success).toBe(true)
    for (const bad of [
      { ...ok, salaryCents: -1 },
      { ...ok, salaryCents: 1.5 },
      { ...ok, salaryCents: MAX_CENTS + 1 },
      { ...ok, month: '2026-13' },
      { ...ok, employeeId: 'x' },
    ]) {
      expect(employeeSalarySchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('las acciones', () => {
  const movement = {
    treasuryAccountId: uuid(10),
    direction: 'out' as const,
    counterpartAccountId: uuid(11),
    partyId: uuid(12),
    amountCents: 15_000_000,
    date: TODAY,
    shortcut: 'other' as const,
    detail: 'Adelanto · Martina Ríos · noviembre',
    clientRef: CLIENT_REF,
    previewHash: HASH,
    warningsAck: [],
  }
  const target = { employeeId: uuid(1), month: NOV, kind: 'advance' as const }

  it('un adelanto: primero anota a quién corresponde, y después el camino de siempre', async () => {
    const calls: string[] = []
    db.rpc.mockImplementation(async (fn: string) => {
      calls.push(fn)
      return { data: null, error: null }
    })
    db.runPostDocument.mockImplementation(async (_slug: string, form: string) => {
      calls.push(form)
      return { ok: true, result: {}, message: 'Listo.' }
    })
    const result = await postPayrollMovement(SLUG, { ...movement, ...target })
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['acc_payroll_prepare_movement', 'cash_movement'])
    expect(db.rpc).toHaveBeenCalledWith('acc_payroll_prepare_movement', {
      p_tenant_id: 'tenant-1',
      p_client_ref: CLIENT_REF,
      p_employee_id: uuid(1),
      p_month: '2026-11-01',
      p_kind: 'advance',
    })
    // Al motor le llega el movimiento pelado: los datos del empleado no cambian el hash.
    expect(db.runPostDocument).toHaveBeenCalledWith(SLUG, 'cash_movement', movement)
  })

  it('si no se pudo anotar, no se guarda el comprobante', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'no' } })
    const result = await postPayrollMovement(SLUG, { ...movement, ...target })
    expect(result.ok).toBe(false)
    expect(db.runPostDocument).not.toHaveBeenCalled()
  })

  it('lo que no valida no llega a la base', async () => {
    for (const bad of [
      { ...target, employeeId: 'x' },
      { ...target, month: 'noviembre' },
      { ...target, kind: 'regalo' },
    ]) {
      // A propósito: es lo que zod tiene que rechazar, aunque el tipo no lo deje escribir.
      const result = await postPayrollMovement(SLUG, {
        ...movement,
        ...(bad as unknown as typeof target),
      })
      expect(result).toMatchObject({ ok: false, code: 'invalid' })
    }
    // Un adelanto siempre es plata que sale.
    const entering = await postPayrollMovement(SLUG, { ...movement, ...target, direction: 'in' })
    expect(entering).toMatchObject({ ok: false, code: 'invalid' })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(db.runPostDocument).not.toHaveBeenCalled()
  })

  it('la contadora no carga adelantos, ni sueldos, ni empleados', async () => {
    ui.readOnly = true
    expect(await postPayrollMovement(SLUG, { ...movement, ...target })).toMatchObject({
      ok: false,
      code: 'forbidden',
    })
    expect(
      await saveEmployeeSalary(SLUG, { employeeId: uuid(1), month: NOV, salaryCents: 100 }),
    ).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await saveEmployee(SLUG, { name: 'Ana', payFrequency: 'monthly' })).toMatchObject({
      ok: false,
      code: 'forbidden',
    })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('devengar: anota el mes y guarda el asiento', async () => {
    const entry = {
      entryKind: 'payroll' as const,
      date: '2026-11-30',
      description: 'Sueldos de noviembre de 2026',
      lines: [],
      correctsDocumentId: null,
      clientRef: CLIENT_REF,
      previewHash: HASH,
      warningsAck: [],
    }
    await postPayrollAccrual(SLUG, { ...entry, month: NOV })
    expect(db.rpc).toHaveBeenCalledWith('acc_payroll_prepare_accrual', {
      p_tenant_id: 'tenant-1',
      p_client_ref: CLIENT_REF,
      p_month: '2026-11-01',
    })
    expect(db.runPostDocument).toHaveBeenCalledWith(SLUG, 'manual_entry', entry)
  })

  it('el sueldo es de ese mes en adelante', async () => {
    const result = await saveEmployeeSalary(SLUG, {
      employeeId: uuid(1),
      month: NOV,
      salaryCents: 78_000_000,
    })
    expect(result).toMatchObject({ ok: true, message: 'Sueldo guardado.' })
    expect(db.rpc).toHaveBeenCalledWith('acc_save_employee_salary', {
      p_tenant_id: 'tenant-1',
      p_employee_id: uuid(1),
      p_month: '2026-11-01',
      p_salary_cents: 78_000_000,
    })
  })

  it('un empleado nuevo devuelve su id; el mismo camino lo edita o le da de baja', async () => {
    const created = await saveEmployee(SLUG, { name: ' Ana ', payFrequency: 'biweekly' })
    expect(created).toMatchObject({
      ok: true,
      data: { id: uuid(70) },
      message: 'Empleado agregado.',
    })
    expect(db.rpc).toHaveBeenLastCalledWith('acc_save_employee', {
      p_tenant_id: 'tenant-1',
      p_employee: { id: null, name: 'Ana', pay_frequency: 'biweekly', active: true, notes: null },
    })
    const edited = await saveEmployee(SLUG, {
      id: uuid(1),
      name: 'Ana',
      payFrequency: 'monthly',
      active: false,
    })
    expect(edited).toMatchObject({ ok: true, message: 'Empleado guardado.' })
    expect(db.rpc.mock.lastCall?.[1]).toMatchObject({
      p_employee: { id: uuid(1), active: false },
    })
  })
})

describe('la celda del sueldo', () => {
  it('lee pesos; lo que no se entiende no se guarda', () => {
    expect(readCell('780.000')).toEqual({ kind: 'save', cents: 78_000_000 })
    expect(readCell('1.234,50')).toEqual({ kind: 'save', cents: 123_450 })
    expect(readCell('0')).toEqual({ kind: 'save', cents: 0 })
    expect(readCell('doce').kind).toBe('error')
    expect(readCell('-5').kind).toBe('error')
  })

  it('vaciarla no es cero: el sueldo vuelve a lo que había; el monto de un gasto queda sin monto', () => {
    expect(readCell('  ')).toEqual({ kind: 'revert' })
    expect(readCell('', { emptyAllowed: true })).toEqual({ kind: 'save', cents: null })
    expect(readCell('0', { minCents: 1 }).kind).toBe('error')
  })
})

describe('la pantalla', () => {
  /** El texto que se lee en pantalla: sin etiquetas, con el espacio duro de la plata como espacio. */
  const textOf = (html: string) =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;| /g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length
  const page = async (search: Record<string, string> = {}) =>
    renderToStaticMarkup(
      await SueldosPage({
        params: Promise.resolve({ tenantSlug: SLUG }),
        searchParams: Promise.resolve(search),
      }),
    )

  it('el totalizador: lo que más importa es cuánto le debés a fin de mes', async () => {
    db.report = REPORT
    const html = await page()
    const text = textOf(html)
    for (const label of ['Sueldos del mes', 'Adelantos', 'Pagado', 'Le debés a fin de mes']) {
      expect(text, label).toContain(label)
    }
    expect(text).toMatch(/\$ ?1\.700\.000/)
    expect(text).toMatch(/\$ ?990\.000/)
    expect(text).toContain('1.ª semana de diciembre')
    expect(html).toContain('<h1 class="sr-only">Sueldos</h1>')
    expect(html).toMatch(/aria-current="page"[^>]*>Noviembre</)
    expect(html).toContain(`href="/${SLUG}/administracion/sueldos?mes=2026-10"`)
  })

  it('una fila por empleado, con su sueldo en una celda y el total con doble raya', async () => {
    db.report = REPORT
    const html = await page()
    const text = textOf(html)
    expect(text).toContain('Martina Ríos Mensual')
    expect(text).toContain('Joaquín Paz Quincenal')
    expect(count(html, /data-cell="sueldo"/g)).toBe(2)
    expect(html).toContain('aria-label="Sueldo de Martina Ríos"')
    expect(html).toContain('value="780.000"')
    expect(html).toContain('aria-label="Adelanto a Martina Ríos"')
    expect(html).toContain('aria-label="Pagar el sueldo de Martina Ríos"')
    expect(html).toContain('adm-double-rule')
    expect(text).toMatch(/Total \$ ?1\.700\.000 \$ ?250\.000 \$ ?460\.000 \$ ?990\.000/)
    expect(text).toContain('Devengar noviembre')
    expect(text).toContain('Agregar empleado')
    // Se abre tocando la fila: el nombre es el botón.
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Martina Ríos</)
  })

  it('un sueldo sin cargar pide la celda, no dice «$ 0»', async () => {
    db.report = {
      ...REPORT,
      employees: [employee({ salaryCents: 0, advancesCents: 0, movements: [] })],
    }
    const html = await page()
    expect(html).toContain('placeholder="Poner sueldo"')
    expect(textOf(html)).toContain('Para devengar noviembre, cargá los sueldos.')
    expect(textOf(html)).not.toContain('Devengar noviembre ')
  })

  it('devengado: el sello, el link al asiento, y los sueldos de ese mes de solo lectura', async () => {
    db.report = {
      ...REPORT,
      accrual: { documentId: uuid(300), date: '2026-11-30', amountCents: 170_000_000 },
    }
    const html = await page()
    const text = textOf(html)
    expect(text).toContain('Devengado')
    expect(text).toContain('Ver el asiento')
    expect(html).toContain(`href="/${SLUG}/administracion/comprobantes/${uuid(300)}"`)
    expect(html).not.toContain('data-cell="sueldo"')
    expect(text).not.toContain('Devengar noviembre')
    // Adelantar y pagar se sigue pudiendo: es lo normal después de devengar.
    expect(html).toContain('aria-label="Pagar el sueldo de Martina Ríos"')
    expect(text).toContain('Agregar empleado')
  })

  it('el mes que viene no se puede devengar todavía', async () => {
    db.report = { ...REPORT, month: '2026-12' }
    const text = textOf(await page({ mes: '2026-12' }))
    expect(text).not.toContain('Devengar')
    expect(text).toContain('1.ª semana de enero')
  })

  it('el equipo vacío: una oración y un botón, adentro de la planilla, sin «$ 0»', async () => {
    const html = await page()
    const text = textOf(html)
    expect(text).toContain('Todavía no cargaste a tu equipo.')
    expect(text).toContain('Agregar empleado')
    expect(text).not.toMatch(/\$\s?0(?![\d.,])/)
    expect(text).not.toContain('Total')
    expect(text).not.toContain('Devengar')
  })

  it('si no se pudo leer: el mes, el motivo y reintentar', async () => {
    db.fails = true
    const text = textOf(await page())
    expect(text).toContain('La planilla de sueldos')
    expect(text).toContain('Reintentar')
    expect(text).toContain('Noviembre')
  })

  it('la contadora ve todo, sin nada que escriba', async () => {
    ui.readOnly = true
    db.report = REPORT
    const html = await page()
    const text = textOf(html)
    expect(text).toContain('Solo lectura')
    expect(text).toContain('Martina Ríos')
    expect(text).toMatch(/\$ ?780\.000/)
    expect(html).not.toContain('<input')
    for (const label of ['Adelanto a', 'Pagar el sueldo', 'Devengar', 'Agregar empleado']) {
      expect(html, label).not.toContain(label)
    }
    // El único botón abre la fila para mirar sus movimientos.
    for (const button of html.match(/<button\b[^>]*>/g) ?? []) {
      expect(button).toContain('aria-controls=')
    }
    // Si está devengado, también ve el asiento.
    db.report = {
      ...REPORT,
      accrual: { documentId: uuid(300), date: '2026-11-30', amountCents: 170_000_000 },
    }
    expect(textOf(await page())).toContain('Ver el asiento')
    // Y con el equipo vacío, nada para agregar.
    db.report = null
    const empty = await page()
    expect(textOf(empty)).toContain('Todavía no hay empleados cargados.')
    expect(empty).not.toContain('<button')
  })
})
