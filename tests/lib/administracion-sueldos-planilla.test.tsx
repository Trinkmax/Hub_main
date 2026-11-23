import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCell } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/cell-money'
import SueldosPage from '@/app/(manager)/[tenantSlug]/administracion/sueldos/page'
import {
  postPayrollAccrual,
  postPayrollMovement,
  saveEmployee,
  saveEmployeeSalary,
  saveEmployeeSalaryParts,
} from '@/lib/accounting/actions/payroll'
import {
  accrualOffer,
  employeeBalanceCents,
  employeeParts,
  employeeSalaryPartsSchema,
  employeeSalarySchema,
  employeeSchema,
  monthTitle,
  movementWords,
  owedSentence,
  type PayrollEmployee,
  type PayrollReport,
  parsePayrollMonth,
  parsePayrollReport,
  payrollAccrualValues,
  payrollBranchId,
  payrollDetail,
  payrollExtras,
  payrollHref,
  payrollMonths,
  payrollMovementTargetSchema,
  payrollMovementValues,
  payrollTotals,
  pendingCashMonth,
  pendingCashSums,
  periodOfShortcut,
  periodWords,
  personalPartyId,
  settleHint,
  shortcutOfPeriod,
  suggestOffBooks,
} from '@/lib/accounting/payroll'
import type { PosCashPending } from '@/lib/accounting/pos-cash'
import { MAX_CENTS } from '@/lib/accounting/schemas'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { bankTaxOf, DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import { prepare } from './accounting-fixtures'

/**
 * La planilla de Sueldos: «lo que más me importa es saber cuánto le debo a fin de mes» (Luciano, 29/10).
 * Lo puro (saldo, totales, parseo del reporte, asientos), que el motor acepte lo que se le manda, el
 * orden de las acciones y lo que ve cada uno en la pantalla.
 *
 * Y lo del 22/11/2026: el sueldo en blanco y en negro, las horas extra, las fechas que cubre un pago y
 * lo que salió de la caja del salón (que cuenta desde que sale y se pasa a los libros desde la bandeja).
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
  pendingCash: [] as unknown[],
  cashFails: false,
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
vi.mock('@/lib/accounting/queries/pos-cash', () => ({
  listPosCashPending: async () => {
    if (db.cashFails) throw new Error('sin lectura')
    return db.pendingCash
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
  db.pendingCash = []
  db.cashFails = false
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
          // Sin la sucursal en la respuesta (la base de antes): vacía.
          branchId: null,
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
    expect(calls).toEqual(['acc_payroll_prepare', 'cash_movement'])
    expect(db.rpc).toHaveBeenCalledWith('acc_payroll_prepare', {
      p_tenant_id: 'tenant-1',
      p_client_ref: CLIENT_REF,
      p_employee_id: uuid(1),
      p_month: '2026-11-01',
      p_kind: 'advance',
      // Sin decirlo: en blanco y sin fechas.
      p_off_books: false,
      p_period_from: null,
      p_period_to: null,
    })
    // Al motor le llega el movimiento pelado: los datos del empleado no cambian el hash.
    expect(db.runPostDocument).toHaveBeenCalledWith(SLUG, 'cash_movement', movement)
  })

  it('horas extra en negro, con las fechas que cubre: se anota todo y al motor no le llega nada de eso', async () => {
    await postPayrollMovement(SLUG, {
      ...movement,
      ...target,
      kind: 'overtime',
      offBooks: true,
      periodFrom: '2026-11-01',
      periodTo: '2026-11-15',
    })
    expect(db.rpc).toHaveBeenCalledWith('acc_payroll_prepare', {
      p_tenant_id: 'tenant-1',
      p_client_ref: CLIENT_REF,
      p_employee_id: uuid(1),
      p_month: '2026-11-01',
      p_kind: 'overtime',
      p_off_books: true,
      p_period_from: '2026-11-01',
      p_period_to: '2026-11-15',
    })
    expect(db.runPostDocument).toHaveBeenCalledWith(SLUG, 'cash_movement', movement)
  })

  it('la sucursal del comprobante sí viaja con el movimiento (es parte de lo que se guarda)', async () => {
    await postPayrollMovement(SLUG, { ...movement, branchId: uuid(40), ...target })
    expect(db.runPostDocument).toHaveBeenCalledWith(SLUG, 'cash_movement', {
      ...movement,
      branchId: uuid(40),
    })
  })

  it('un retiro de la caja del salón: se anota, se ata al comprobante y recién ahí se guarda', async () => {
    const calls: string[] = []
    db.rpc.mockImplementation(async (fn: string) => {
      calls.push(fn)
      return { data: null, error: null }
    })
    db.runPostDocument.mockImplementation(async (_slug: string, form: string) => {
      calls.push(form)
      return { ok: true, result: {}, message: 'Listo.' }
    })
    await postPayrollMovement(SLUG, { ...movement, ...target, posCashId: uuid(500) })
    expect(calls).toEqual(['acc_payroll_prepare', 'acc_pos_cash_link', 'cash_movement'])
    expect(db.rpc).toHaveBeenCalledWith('acc_pos_cash_link', {
      p_tenant_id: 'tenant-1',
      p_movement_id: uuid(500),
      p_client_ref: CLIENT_REF,
    })
    expect(db.runPostDocument).toHaveBeenCalledWith(SLUG, 'cash_movement', movement)
  })

  it('si el retiro ya tiene comprobante (lo pasó otro), no se guarda de nuevo', async () => {
    db.rpc.mockImplementation(async (fn: string) =>
      fn === 'acc_pos_cash_link'
        ? { data: null, error: { code: 'P0001', message: 'pos_cash_already_passed' } }
        : { data: null, error: null },
    )
    const result = await postPayrollMovement(SLUG, {
      ...movement,
      ...target,
      posCashId: uuid(500),
    })
    expect(result).toMatchObject({ ok: false, code: 'conflict' })
    if (!result.ok) expect(result.message).toContain('ya tiene su comprobante')
    expect(db.runPostDocument).not.toHaveBeenCalled()
  })

  it('con la base de antes: un adelanto común se anota por la función de siempre', async () => {
    const calls: string[] = []
    db.rpc.mockImplementation(async (fn: string) => {
      calls.push(fn)
      return fn === 'acc_payroll_prepare'
        ? { data: null, error: { code: 'PGRST202', message: 'no existe' } }
        : { data: null, error: null }
    })
    const result = await postPayrollMovement(SLUG, { ...movement, ...target })
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['acc_payroll_prepare', 'acc_payroll_prepare_movement'])
    expect(db.rpc).toHaveBeenLastCalledWith('acc_payroll_prepare_movement', {
      p_tenant_id: 'tenant-1',
      p_client_ref: CLIENT_REF,
      p_employee_id: uuid(1),
      p_month: '2026-11-01',
      p_kind: 'advance',
    })
  })

  it('con la base de antes: lo nuevo (horas extra, en negro, fechas) avisa y no guarda nada a medias', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'no existe' } })
    for (const extra of [
      { kind: 'overtime' as const },
      { offBooks: true },
      { periodFrom: '2026-11-01', periodTo: '2026-11-15' },
    ]) {
      db.rpc.mockClear()
      const result = await postPayrollMovement(SLUG, { ...movement, ...target, ...extra })
      expect(result.ok).toBe(false)
      expect(db.rpc).toHaveBeenCalledTimes(1)
    }
    expect(db.runPostDocument).not.toHaveBeenCalled()
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
      { ...target, offBooks: 'si' },
      { ...target, periodFrom: '2026-11-31' },
      // El «hasta» antes del «desde».
      { ...target, periodFrom: '2026-11-16', periodTo: '2026-11-01' },
      { ...target, posCashId: 'x' },
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

  it('el sueldo en dos partes: lo que va en blanco y lo que va en negro', async () => {
    const result = await saveEmployeeSalaryParts(SLUG, {
      employeeId: uuid(1),
      month: NOV,
      declaredCents: 40_000_000,
      offBooksCents: 30_000_000,
    })
    expect(result).toMatchObject({ ok: true, message: 'Sueldo guardado.' })
    expect(db.rpc).toHaveBeenCalledWith('acc_save_employee_salary_parts', {
      p_tenant_id: 'tenant-1',
      p_employee_id: uuid(1),
      p_month: '2026-11-01',
      p_declared_cents: 40_000_000,
      p_off_books_cents: 30_000_000,
    })
  })

  it('con la base de antes: todo en blanco va por la función de siempre; con parte en negro, avisa', async () => {
    db.rpc.mockImplementation(async (fn: string) =>
      fn === 'acc_save_employee_salary_parts'
        ? { data: null, error: { code: 'PGRST202', message: 'no existe' } }
        : { data: null, error: null },
    )
    const plain = await saveEmployeeSalaryParts(SLUG, {
      employeeId: uuid(1),
      month: NOV,
      declaredCents: 78_000_000,
      offBooksCents: 0,
    })
    expect(plain.ok).toBe(true)
    expect(db.rpc).toHaveBeenLastCalledWith('acc_save_employee_salary', {
      p_tenant_id: 'tenant-1',
      p_employee_id: uuid(1),
      p_month: '2026-11-01',
      p_salary_cents: 78_000_000,
    })
    db.rpc.mockClear()
    const split = await saveEmployeeSalaryParts(SLUG, {
      employeeId: uuid(1),
      month: NOV,
      declaredCents: 40_000_000,
      offBooksCents: 30_000_000,
    })
    expect(split.ok).toBe(false)
    expect(db.rpc).toHaveBeenCalledTimes(1)
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

// ─── Pedido de los socios del 22/11/2026 ─────────────────────────────────────

describe('en blanco y en negro', () => {
  const split = employee({
    salaryCents: 70_000_000,
    salaryOffBooksCents: 30_000_000,
    advancesCents: 10_000_000,
    paidCents: 25_000_000,
    settledOffBooksCents: 10_000_000,
  })

  it('sin parte en negro no hay nada que separar', () => {
    expect(employeeParts(employee())).toBeNull()
    // Un pago marcado «en negro» sin parte en negro en el sueldo: se lee en el movimiento, no acá
    // (sería «pagaste $ 30.000 de $ 0»).
    expect(employeeParts(employee({ settledOffBooksCents: 3_000_000 }))).toBeNull()
    expect(suggestOffBooks(employee(), 'payment')).toBe(false)
    expect(suggestOffBooks(employee(), 'overtime')).toBe(false)
  })

  it('cuánto falta de cada parte, con lo que ya tiene comprobante', () => {
    expect(employeeParts(split)).toEqual({
      // En blanco: 400.000 de sueldo; de los 350.000 pagados, 100.000 fueron en negro.
      declared: { salaryCents: 40_000_000, settledCents: 25_000_000, owedCents: 15_000_000 },
      offBooks: { salaryCents: 30_000_000, settledCents: 10_000_000, owedCents: 20_000_000 },
      unassignedCents: 0,
    })
    // El saldo de siempre no cambia: es el total.
    expect(employeeBalanceCents(split)).toBe(35_000_000)
  })

  it('lo que salió de la caja todavía no dice de qué parte es: no se le resta a ninguna', () => {
    const withCash = employee({
      ...split,
      // El parser ya sumó los 50.000 de la caja a los adelantos.
      advancesCents: 15_000_000,
      pendingCash: [
        {
          id: uuid(500),
          purpose: 'advance',
          amountCents: 5_000_000,
          date: '2026-11-03',
          branchId: null,
          byName: 'Luz',
          periodFrom: null,
          periodTo: null,
        },
      ],
    })
    const parts = employeeParts(withCash)
    expect(parts?.declared.owedCents).toBe(15_000_000)
    expect(parts?.offBooks.owedCents).toBe(20_000_000)
    expect(parts?.unassignedCents).toBe(5_000_000)
    expect(employeeBalanceCents(withCash)).toBe(30_000_000)
  })

  it('una parte en negro más grande que el sueldo se recorta al total', () => {
    const odd = employee({ salaryCents: 100, salaryOffBooksCents: 500, advancesCents: 0 })
    expect(employeeParts(odd)?.offBooks.salaryCents).toBe(100)
    expect(employeeParts(odd)?.declared.salaryCents).toBe(0)
  })

  it('se propone la parte a la que más le falta; las horas extra, en negro solo si todo el sueldo lo es', () => {
    expect(suggestOffBooks(split, 'payment')).toBe(true)
    expect(suggestOffBooks(split, 'advance')).toBe(true)
    expect(suggestOffBooks(split, 'overtime')).toBe(false)
    const paidOff = employee({ ...split, settledOffBooksCents: 30_000_000, paidCents: 45_000_000 })
    expect(suggestOffBooks(paidOff, 'payment')).toBe(false)
    const allOff = employee({ salaryCents: 50_000_000, salaryOffBooksCents: 50_000_000 })
    expect(suggestOffBooks(allOff, 'overtime')).toBe(true)
  })

  it('lo que se suma además de las cuatro columnas', () => {
    expect(payrollExtras(REPORT.employees)).toEqual({
      overtimeCents: 0,
      salaryOffBooksCents: 0,
      pendingCashCents: 0,
      pendingCashCount: 0,
      pendingAdvancesCents: 0,
      pendingPaidCents: 0,
    })
    expect(
      payrollExtras([
        split,
        employee({
          id: uuid(2),
          overtimeCents: 4_000_000,
          pendingCash: [
            {
              id: uuid(501),
              purpose: 'salary',
              amountCents: 2_000_000,
              date: '2026-11-03',
              branchId: null,
              byName: null,
              periodFrom: null,
              periodTo: null,
            },
          ],
        }),
      ]),
    ).toEqual({
      overtimeCents: 4_000_000,
      salaryOffBooksCents: 30_000_000,
      pendingCashCents: 2_000_000,
      pendingCashCount: 1,
      pendingAdvancesCents: 0,
      pendingPaidCents: 2_000_000,
    })
  })

  it('el borde: dos partes de cero al tope, y la suma también', () => {
    const ok = { employeeId: uuid(1), month: NOV, declaredCents: 0, offBooksCents: 0 }
    expect(employeeSalaryPartsSchema.safeParse(ok).success).toBe(true)
    expect(employeeSalaryPartsSchema.safeParse({ ...ok, declaredCents: MAX_CENTS }).success).toBe(
      true,
    )
    for (const bad of [
      { ...ok, declaredCents: -1 },
      { ...ok, offBooksCents: 1.5 },
      { ...ok, declaredCents: MAX_CENTS, offBooksCents: 1 },
      { ...ok, month: '2026-13' },
    ]) {
      expect(employeeSalaryPartsSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('las fechas que cubre un pago', () => {
  it('los atajos: las dos quincenas y el mes', () => {
    expect(periodOfShortcut(NOV, 'first_half')).toEqual({ from: '2026-11-01', to: '2026-11-15' })
    expect(periodOfShortcut(NOV, 'second_half')).toEqual({ from: '2026-11-16', to: '2026-11-30' })
    expect(periodOfShortcut('2027-02', 'second_half')).toEqual({
      from: '2027-02-16',
      to: '2027-02-28',
    })
    expect(periodOfShortcut(NOV, 'month')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('unas fechas se reconocen como su atajo; otras, como fechas a mano', () => {
    expect(shortcutOfPeriod(NOV, { from: '2026-11-16', to: '2026-11-30' })).toBe('second_half')
    expect(shortcutOfPeriod(NOV, { from: '2026-11-01', to: '2026-11-30' })).toBe('month')
    expect(shortcutOfPeriod(NOV, { from: '2026-11-03', to: '2026-11-09' })).toBeNull()
    expect(shortcutOfPeriod(NOV, { from: null, to: null })).toBeNull()
  })

  it('como se dicen', () => {
    expect(periodWords('2026-11-01', '2026-11-15')).toBe('1 al 15 nov')
    expect(periodWords('2026-11-01', '2026-11-30')).toBe('todo noviembre')
    expect(periodWords('2026-10-28', '2026-11-03')).toBe('28 oct al 3 nov')
    expect(periodWords('2026-11-07', '2026-11-07')).toBe('7 nov')
    expect(periodWords('2026-11-05', null)).toBe('desde el 5 nov')
    expect(periodWords(null, '2026-11-20')).toBe('hasta el 20 nov')
    expect(periodWords(null, null)).toBeNull()
    expect(periodWords('no', undefined)).toBeNull()
  })

  it('un movimiento como se lee en el detalle', () => {
    expect(
      movementWords({
        kind: 'payment',
        offBooks: true,
        periodFrom: '2026-11-01',
        periodTo: '2026-11-15',
      }),
    ).toBe('Pago · 1 al 15 nov · en negro')
    expect(movementWords({ kind: 'advance' })).toBe('Adelanto')
    expect(movementWords({ kind: 'overtime', offBooks: false })).toBe('Horas extra')
  })

  it('el borde: sin decir nada, en blanco y sin fechas', () => {
    const parsed = payrollMovementTargetSchema.safeParse({
      employeeId: uuid(1),
      month: NOV,
      kind: 'overtime',
      clientRef: CLIENT_REF,
      direction: 'out',
      amountCents: 100,
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      offBooks: false,
      periodFrom: null,
      periodTo: null,
      posCashId: null,
      // Lo que no es del destino sigue de largo, para el esquema del movimiento.
      amountCents: 100,
    })
  })
})

describe('las horas extra y la sucursal, para el motor', () => {
  const { r, ctx } = prepare()
  const partyId = personalPartyId(ctx)
  const today = ctx.today

  it('horas extra: D Sueldos y jornales / H la caja, sin partícipe, y el motor lo acepta', () => {
    const values = payrollMovementValues(
      {
        kind: 'overtime',
        employeeName: 'Martina Ríos',
        month: NOV,
        treasuryAccountId: r.treasury('caja'),
        amountCents: 4_500_000,
        date: today,
        personalPartyId: partyId,
      },
      ctx,
    )
    expect(values).toEqual({
      treasuryAccountId: r.treasury('caja'),
      direction: 'out',
      counterpartAccountId: ctx.sys.salaries.id,
      partyId: null,
      amountCents: 4_500_000,
      date: today,
      shortcut: 'other',
      detail: 'Horas extra · Martina Ríos · noviembre',
    })
    const preview = previewDocumentForm('cash_movement', values, ctx)
    if (!preview.ok) throw new Error(preview.message)
    const lines = preview.preview.flatMap((entry) => entry.lines)
    expect(lines.find((line) => line.debitCents === 4_500_000)?.accountId).toBe(ctx.sys.salaries.id)
    expect(lines.find((line) => line.creditCents === 4_500_000)?.accountId).toBe(
      r.treasuryAccount('caja'),
    )
    // No toca Sueldos a pagar: no baja lo que se le debe.
    expect(lines.some((line) => line.accountId === ctx.sys.payroll_payable.id)).toBe(false)
  })

  it('el detalle de cada movimiento', () => {
    expect(payrollDetail('overtime', 'Joaquín Paz', NOV)).toBe(
      'Horas extra · Joaquín Paz · noviembre',
    )
  })

  it('la sucursal: la de la caja si tiene; si es de todo el bar, la de la persona; si no, la decide la base', () => {
    expect(payrollBranchId({ branchId: 'cerro' }, { branchId: 'alta' })).toBe('cerro')
    expect(payrollBranchId({ branchId: null }, { branchId: 'alta' })).toBe('alta')
    expect(payrollBranchId(undefined, { branchId: null })).toBeNull()
    const base = {
      kind: 'advance' as const,
      employeeName: 'Ana',
      month: NOV,
      treasuryAccountId: r.treasury('caja'),
      amountCents: 100,
      date: today,
      personalPartyId: partyId,
    }
    expect(payrollMovementValues({ ...base, branchId: 'cerro' }, ctx)).toMatchObject({
      branchId: 'cerro',
    })
    // Sin sucursal la clave no viaja: el hash es el de siempre.
    expect('branchId' in payrollMovementValues(base, ctx)).toBe(false)
  })
})

describe('lo que salió de la caja del salón cuenta desde que sale', () => {
  const RAW = {
    employees: [
      {
        id: uuid(1),
        name: 'Martina Ríos',
        pay_frequency: 'monthly',
        active: true,
        notes: null,
        salary_cents: 70_000_000,
        salary_off_books_cents: 30_000_000,
        advances_cents: 10_000_000,
        paid_cents: 0,
        overtime_cents: 4_000_000,
        settled_off_books_cents: '10000000',
        movements: [
          {
            document_id: uuid(201),
            kind: 'advance',
            date: '2026-11-03',
            amount_cents: 10_000_000,
            treasury: 'Caja Efectivo',
            off_books: true,
            period_from: '2026-11-01',
            period_to: '2026-11-15',
          },
          {
            document_id: uuid(202),
            kind: 'overtime',
            date: '2026-11-08',
            amount_cents: 4_000_000,
            treasury: 'Caja Efectivo',
            off_books: false,
            period_from: null,
            period_to: null,
          },
        ],
        pending_cash: [
          {
            id: uuid(500),
            purpose: 'advance',
            amount_cents: 5_000_000,
            date: '2026-11-21',
            branch_id: uuid(40),
            by_name: ' Luz ',
            period_from: null,
            period_to: null,
          },
          {
            id: uuid(501),
            purpose: 'salary',
            amount_cents: 20_000_000,
            date: '2026-11-22',
            branch_id: uuid(40),
            by_name: null,
            period_from: '2026-11-16',
            period_to: '2026-11-22',
          },
          {
            id: uuid(502),
            purpose: 'overtime',
            amount_cents: 1_500_000,
            date: '2026-11-22',
            branch_id: null,
            by_name: 'Luz',
            period_from: null,
            period_to: null,
          },
        ],
      },
    ],
    accrual: null,
  }

  it('los adelantos, lo pagado, las horas extra y el saldo ya los cuentan', () => {
    const [parsed] = parsePayrollReport(RAW, NOV)?.employees ?? []
    expect(parsed).toMatchObject({
      salaryCents: 70_000_000,
      salaryOffBooksCents: 30_000_000,
      // 100.000 con comprobante + 50.000 de la caja.
      advancesCents: 15_000_000,
      paidCents: 20_000_000,
      overtimeCents: 5_500_000,
      settledOffBooksCents: 10_000_000,
    })
    expect(parsed ? employeeBalanceCents(parsed) : null).toBe(35_000_000)
    expect(parsed?.pendingCash).toEqual([
      {
        id: uuid(500),
        purpose: 'advance',
        amountCents: 5_000_000,
        date: '2026-11-21',
        branchId: uuid(40),
        byName: 'Luz',
        periodFrom: null,
        periodTo: null,
      },
      expect.objectContaining({ id: uuid(501), purpose: 'salary', periodFrom: '2026-11-16' }),
      expect.objectContaining({ id: uuid(502), purpose: 'overtime', branchId: null }),
    ])
    expect(parsed?.movements[0]).toMatchObject({
      offBooks: true,
      periodFrom: '2026-11-01',
      periodTo: '2026-11-15',
    })
    // Un movimiento en blanco y sin fechas queda como siempre (sin claves de más).
    expect(parsed?.movements[1]).toEqual({
      documentId: uuid(202),
      kind: 'overtime',
      date: '2026-11-08',
      amountCents: 4_000_000,
      treasury: 'Caja Efectivo',
    })
    expect(pendingCashSums(parsed?.pendingCash)).toEqual({
      advance: 5_000_000,
      salary: 20_000_000,
      overtime: 1_500_000,
      total: 26_500_000,
      count: 3,
    })
    // Y los totales de la pantalla (y del Resumen, y de Gastos fijos) salen de ahí.
    expect(payrollTotals(parsed ? [parsed] : [])).toMatchObject({
      advancesCents: 15_000_000,
      paidCents: 20_000_000,
      owedCents: 35_000_000,
    })
  })

  it('a qué mes se propone pasar cada retiro', () => {
    const base = { purpose: 'advance' as const, date: '2026-12-03', periodFrom: null }
    // Un adelanto es del mes en que salió.
    expect(pendingCashMonth(base)).toBe('2026-12')
    // Un sueldo pagado la primera semana es del mes anterior; después del 10, del mes.
    expect(pendingCashMonth({ ...base, purpose: 'salary' })).toBe('2026-11')
    expect(pendingCashMonth({ ...base, purpose: 'salary', date: '2026-12-18' })).toBe('2026-12')
    expect(pendingCashMonth({ ...base, purpose: 'salary', date: '2027-01-05' })).toBe('2026-12')
    // Si la caja anotó qué fechas cubre, mandan esas.
    expect(
      pendingCashMonth({
        ...base,
        purpose: 'salary',
        date: '2026-12-18',
        periodFrom: '2026-11-16',
      }),
    ).toBe('2026-11')
    expect(pendingCashMonth({ ...base, purpose: 'overtime' })).toBe('2026-12')
  })

  it('un retiro que no se entiende tira toda la lectura (no se muestra un saldo a medias)', () => {
    const [first] = RAW.employees
    expect(
      parsePayrollReport(
        { ...RAW, employees: [{ ...first, pending_cash: [{ id: uuid(1), purpose: 'regalo' }] }] },
        NOV,
      ),
    ).toBeNull()
  })
})

describe('la pantalla, con lo del 22/11', () => {
  const textOf = (html: string) =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;| /g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  const page = async (search: Record<string, string> = {}) =>
    renderToStaticMarkup(
      await SueldosPage({
        params: Promise.resolve({ tenantSlug: SLUG }),
        searchParams: Promise.resolve(search),
      }),
    )

  const cash = (over: Partial<PosCashPending> = {}): PosCashPending => ({
    id: uuid(500),
    at: '2026-11-03T23:10:00Z',
    date: '2026-11-03',
    shiftLabel: 'Noche',
    branchId: uuid(40),
    branchName: 'Cerro',
    purpose: 'advance',
    amountCents: 5_000_000,
    reason: 'Adelanto de sueldo · Martina Ríos',
    partyId: null,
    partyName: null,
    employeeId: uuid(1),
    employeeName: 'Martina Ríos',
    periodFrom: null,
    periodTo: null,
    byName: 'Luz',
    hasPhoto: false,
    ...over,
  })

  const RICH: PayrollReport = {
    month: NOV,
    accrual: null,
    employees: [
      employee({
        salaryCents: 70_000_000,
        salaryOffBooksCents: 30_000_000,
        // 100.000 con comprobante (en negro) + 50.000 de la caja.
        advancesCents: 15_000_000,
        settledOffBooksCents: 10_000_000,
        overtimeCents: 4_000_000,
        pendingCash: [
          {
            id: uuid(500),
            purpose: 'advance',
            amountCents: 5_000_000,
            date: '2026-11-03',
            branchId: uuid(40),
            byName: 'Luz',
            periodFrom: null,
            periodTo: null,
          },
        ],
        movements: [
          {
            documentId: uuid(201),
            kind: 'advance',
            date: '2026-11-02',
            amountCents: 10_000_000,
            treasury: 'Caja Efectivo',
            offBooks: true,
            periodFrom: '2026-11-01',
            periodTo: '2026-11-15',
          },
        ],
      }),
      employee({ id: uuid(2), name: 'Joaquín Paz', advancesCents: 0 }),
    ],
  }

  it('las horas extra tienen su columna, su botón y su total arriba (solo si hubo)', async () => {
    db.report = REPORT
    const plain = await page()
    expect(textOf(plain)).toContain('Horas extra')
    expect(plain).toContain('aria-label="Horas extra de Martina Ríos"')
    // Sin horas extra en el mes, arriba siguen los cuatro números de siempre.
    expect(plain.match(/<section aria-label="Totales"[\s\S]*?<\/section>/)?.[0]).not.toContain(
      'Horas extra',
    )
    db.report = RICH
    const html = await page()
    const totals = html.match(/<section aria-label="Totales"[\s\S]*?<\/section>/)?.[0] ?? ''
    expect(textOf(totals)).toMatch(/Horas extra \$ ?40\.000/)
    // No cambian lo que se le debe: 700.000 − 150.000.
    expect(textOf(totals)).toMatch(/Le debés a fin de mes \$ ?1\.330\.000/)
  })

  it('el sueldo con parte en negro: el total, sus dos partes abajo, y se abre para cambiarlo', async () => {
    db.report = RICH
    const html = await page()
    const text = textOf(html)
    expect(text).toMatch(/En blanco \$ ?400\.000 · En negro \$ ?300\.000/)
    // Con partes, el total no se escribe en la celda: una sola celda queda (la de Joaquín).
    expect((html.match(/data-cell="sueldo"/g) ?? []).length).toBe(1)
    expect(html).toMatch(/aria-label="Sueldo de Martina Ríos: \$[^"]*700\.000\.[^"]*Cambiar"/)
    // Quien no usa «en negro» tiene su celda de siempre, con la apertura al lado.
    expect(html).toContain('aria-label="Partir el sueldo de Joaquín Paz en blanco y en negro"')
    expect(
      textOf(html.match(/<section aria-label="Totales"[\s\S]*?<\/section>/)?.[0] ?? ''),
    ).toMatch(
      // El contador escribe el número dos veces (el que se ve y el que leen los lectores).
      /Sueldos del mes (\$ ?1\.480\.000 )+\$ ?300\.000 en negro/,
    )
  })

  it('lo de la caja del salón: la bandeja arriba y su marca en la planilla', async () => {
    db.report = RICH
    db.pendingCash = [
      cash(),
      // Uno de otro mes: se puede pasar igual, y ofrece ir a su mes.
      cash({
        id: uuid(510),
        date: '2026-10-30',
        at: '2026-10-30T23:00:00Z',
        purpose: 'salary',
        employeeId: uuid(2),
        employeeName: 'Joaquín Paz',
        amountCents: 20_000_000,
        periodFrom: '2026-10-16',
        periodTo: '2026-10-31',
      }),
      // Los de proveedores no son de esta pantalla.
      cash({ id: uuid(520), purpose: 'supplier', employeeId: null, employeeName: null }),
    ]
    const html = await page()
    const tray = html.match(/<section aria-label="De la caja del salón"[\s\S]*?<\/section>/)?.[0]
    expect(tray).toBeDefined()
    const text = textOf(tray ?? '')
    expect(text).toContain('2 retiros')
    expect(text).toMatch(/\$ ?250\.000/)
    expect(text).toContain('falta pasarlos a los libros')
    // Los más viejos primero.
    expect(text.indexOf('Joaquín Paz')).toBeLessThan(text.indexOf('Martina Ríos'))
    expect(text).toContain('Pago de sueldo · 16 al 31 oct · lo anotó Luz')
    expect(text).toContain('Adelanto de sueldo · lo anotó Luz')
    expect((tray?.match(/>Pasar a noviembre</g) ?? []).length).toBe(2)
    expect(tray).toContain(`href="/${SLUG}/administracion/sueldos?mes=2026-10"`)
    // Parece de octubre (cubre del 16 al 31): se ofrece ir a ese mes.
    expect(text).toContain('¿De octubre?')
    expect((tray?.match(/>Descartar</g) ?? []).length).toBe(2)
    // En la planilla, los adelantos ya lo cuentan, con su marca.
    expect(textOf(html)).toMatch(/\$ ?150\.000 \$ ?50\.000 de la caja/)
    expect(
      textOf(html.match(/<section aria-label="Totales"[\s\S]*?<\/section>/)?.[0] ?? ''),
    ).toMatch(/Adelantos (\$ ?150\.000 )+\$ ?50\.000 de la caja/)
  })

  it('sin retiros que esperen, no hay bandeja; si no se puede leer, la planilla sigue', async () => {
    db.report = REPORT
    expect(await page()).not.toContain('De la caja del salón')
    db.cashFails = true
    const html = await page()
    expect(html).not.toContain('De la caja del salón')
    expect(textOf(html)).toContain('Martina Ríos')
  })

  it('la contadora no ve la bandeja ni la apertura en blanco y en negro', async () => {
    ui.readOnly = true
    db.report = RICH
    db.pendingCash = [cash()]
    const html = await page()
    const text = textOf(html)
    expect(html).not.toContain('aria-label="De la caja del salón"')
    expect(text).not.toContain('En negro')
    expect(text).not.toContain('en negro')
    // El total y lo que se le debe, sí.
    expect(text).toMatch(/\$ ?700\.000/)
    expect(html).not.toContain('<input')
    for (const button of html.match(/<button\b[^>]*>/g) ?? []) {
      expect(button).toContain('aria-controls=')
    }
  })
})
