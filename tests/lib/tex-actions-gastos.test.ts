/**
 * Las herramientas de Gastos fijos y Sueldos de Tex. Lo que se fija: que armen lo mismo que la ficha,
 * la planilla y los diálogos (pasa su zod), que el motor arme un asiento que cuadra, y que un gasto
 * fijo se pague como lo decide la planilla: un gasto, o un Pago a un organismo o a un proveedor.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/accounting/actions/master', () => ({
  saveRecurringExpense: vi.fn(),
  skipRecurringDue: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/payroll', () => ({
  saveEmployee: vi.fn(),
  saveEmployeeSalary: vi.fn(),
  postPayrollMovement: vi.fn(),
  postPayrollAccrual: vi.fn(),
}))
vi.mock('@/lib/accounting/context', () => ({
  tryLoadPostingContext: vi.fn(),
  loadOpenItems: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/accounts', () => ({ listAccounts: vi.fn() }))
vi.mock('@/lib/accounting/queries/documents', () => ({ listRecurringExpenses: vi.fn() }))
vi.mock('@/lib/accounting/queries/forms', () => ({ getFormDefaults: vi.fn() }))
vi.mock('@/lib/accounting/queries/parties', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/queries/parties')>()),
  searchParties: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/payroll', () => ({ getPayrollReport: vi.fn() }))
vi.mock('@/lib/accounting/queries/recurring', () => ({ listRecurringPayments: vi.fn() }))
vi.mock('@/lib/accounting/queries/treasury', () => ({ listTreasuryAccounts: vi.fn() }))
vi.mock('@/lib/accounting/server/post-document', () => ({
  runPreviewDocument: vi.fn(),
  runPostDocument: vi.fn(),
}))

import { saveRecurringExpense, skipRecurringDue } from '@/lib/accounting/actions/master'
import {
  postPayrollAccrual,
  postPayrollMovement,
  saveEmployee,
  saveEmployeeSalary,
} from '@/lib/accounting/actions/payroll'
import { loadOpenItems } from '@/lib/accounting/context'
import type { PayrollEmployee, PayrollReport } from '@/lib/accounting/payroll'
import { employeeSchema } from '@/lib/accounting/payroll'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { listRecurringExpenses } from '@/lib/accounting/queries/documents'
import { getFormDefaults } from '@/lib/accounting/queries/forms'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import type { RecurringPaymentFacts } from '@/lib/accounting/recurring-status'
import { paymentSchema, quickExpenseSchema, recurringSchema } from '@/lib/accounting/schemas'
import type { PostingContext } from '@/lib/accounting/types'
import {
  employeeValues,
  matchByName,
  noMatchText,
  recurringPaymentValues,
  recurringSavePayload,
  voucherTypeOfPaper,
} from '@/lib/tex/tools/actions/_gastos-values'
import { gastosActionTools, gastosExecutors } from '@/lib/tex/tools/actions/gastos'
import type { TexExecutor } from '@/lib/tex/tools/types'
import { CLIENT_REF, type FixtureResolver, openItemRef, prepare } from './accounting-fixtures'
import {
  asError,
  asPrepared,
  documentPayload,
  entryOf,
  expectBalanced,
  expectWellFormed,
  rowValue,
  runTool,
  stubBar,
  TEX_CTX,
} from './tex-actions-kit'

const META = { clientRef: CLIENT_REF, previewHash: '0'.repeat(64) }
const ROW_ID = '00000000-0000-4000-8000-0000000000a1'
const UPDATED = '2026-10-12T10:00:00.000Z'
const ANA = '00000000-0000-4000-8000-0000000000e1'
const LUIS = '00000000-0000-4000-8000-0000000000e2'

function recurring(
  accountId: string,
  patch: Partial<RecurringExpenseRow> = {},
): RecurringExpenseRow {
  return {
    id: ROW_ID,
    name: 'Alquiler',
    partyId: null,
    partyName: null,
    accountId,
    accountName: 'Alquileres',
    voucherType: null,
    vatRateBp: null,
    amountCents: 85_000_000,
    frequency: 'monthly',
    dueDay: 10,
    nextDueDate: '2026-10-10',
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
    updatedAt: UPDATED,
    monthStatus: 'pending',
    daysToDue: -21,
    ...patch,
  }
}

function employee(patch: Partial<PayrollEmployee> = {}): PayrollEmployee {
  return {
    id: ANA,
    name: 'Ana Ríos',
    payFrequency: 'monthly',
    active: true,
    notes: null,
    salaryCents: 80_000_000,
    advancesCents: 10_000_000,
    paidCents: 0,
    movements: [],
    ...patch,
  }
}

function report(patch: Partial<PayrollReport> = {}): PayrollReport {
  return { month: '2026-10', employees: [employee()], accrual: null, ...patch }
}

function stubRows(rows: RecurringExpenseRow[], facts: Record<string, RecurringPaymentFacts> = {}) {
  vi.mocked(listRecurringExpenses).mockResolvedValue(rows)
  vi.mocked(listRecurringPayments).mockResolvedValue(new Map(Object.entries(facts)))
}

/** El bar de prueba, con los impuestos automáticos y Rentas como en la base. */
function setup(opts: { auto?: boolean; openItems?: Parameters<typeof prepare>[0] } = {}) {
  const prepared = prepare(opts.openItems)
  const parties = new Map(prepared.ctx.parties)
  for (const [id, party] of parties) {
    if (party.name.startsWith('Rentas')) parties.set(id, { ...party, systemKey: 'rentas' })
    if (party.name.startsWith('Personal')) parties.set(id, { ...party, systemKey: 'personal' })
  }
  const ctx: PostingContext = {
    ...prepared.ctx,
    parties,
    settings: {
      ...prepared.ctx.settings,
      taxSettings: opts.auto
        ? { auto: true, iibbBp: 300, municipalBp: 70, bankTaxBp: 60, base: 'invoiced_net' }
        : { auto: false, iibbBp: 300, municipalBp: 70, bankTaxBp: 60, base: 'invoiced_net' },
    },
  }
  stubBar(ctx)
  return { ...prepared, ctx }
}

function executor(name: string): TexExecutor {
  const found = gastosExecutors[name]
  if (!found) throw new Error(`falta el ejecutor ${name}`)
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFormDefaults).mockResolvedValue({ treasuryAccountId: null } as never)
})

it('las herramientas se pueden describir para la API', () => {
  expectWellFormed(gastosActionTools, gastosExecutors)
})

describe('preparar_gasto_fijo', () => {
  it('un alta: pregunta lo que falta y manda lo mismo que la ficha', async () => {
    const { f } = setup()
    expect(
      asError(await runTool(gastosActionTools, 'preparar_gasto_fijo', { cuenta: 'x', dia: 1 })),
    ).toContain('cómo se llama')
    expect(
      asError(await runTool(gastosActionTools, 'preparar_gasto_fijo', { nombre: 'Luz', dia: 1 })),
    ).toContain('en qué se gasta')
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_gasto_fijo', { nombre: 'Luz', cuenta: 'x' }),
      ),
    ).toContain('qué día vence')

    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_gasto_fijo', {
        nombre: 'Luz',
        cuenta: f.sys('misc_expenses').code,
        monto: 120_000,
        dia: 15,
        papel: 'factura_a',
        iva: '27',
        caja: 'Banco Nación',
        proveedor: 'Mayorista X',
      }),
    )
    expect(prepared.executor).toBe('gastos.gasto_fijo')
    expect(prepared.payload).toMatchObject({
      name: 'Luz',
      accountId: f.sys('misc_expenses').id,
      amountCents: 12_000_000,
      dueDay: 15,
      // Hoy es 31/10: el 15 de este mes ya pasó.
      nextDueDate: '2026-11-15',
      frequency: 'monthly',
      voucherType: 'factura_a',
      vatRateBp: 2700,
      treasuryAccountId: f.treasury('banco').id,
      partyId: f.party('mayorista').id,
      remindDaysBefore: 5,
      active: true,
      endsOn: null,
      installmentsTotal: null,
      breakdown: [],
    })
    expect(recurringSchema.safeParse(prepared.payload).success).toBe(true)
    expect(prepared.ticket.title).toBe('Nuevo gasto fijo')
    expect(prepared.ticket.subtitle).toBe('Luz')
    expect(rowValue(prepared.ticket, 'Próximo vencimiento')).toBe('15/11/2026')
    expect(rowValue(prepared.ticket, 'Monto')).toBe('$ 120.000')
    expect(prepared.ticket.entry).toEqual([])
  })

  it('la cuenta tiene que servir para un gasto', async () => {
    const { f } = setup()
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_gasto_fijo', {
          nombre: 'Luz',
          cuenta: f.sys('payable_suppliers').code,
          dia: 1,
        }),
      ),
    ).toContain('no sirve para un gasto')
  })

  it('una edición cambia solo lo pedido, con el token de concurrencia y el detalle intacto', async () => {
    const { f } = setup()
    const line = { label: 'Ana', kind: null, amountCents: 1000 }
    stubRows([recurring(f.sys('misc_expenses').id, { breakdown: [line] })])
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_gasto_fijo', { gasto: 'alquiler', dia: 20 }),
    )
    expect(prepared.payload).toMatchObject({
      id: ROW_ID,
      expectedUpdatedAt: UPDATED,
      name: 'Alquiler',
      dueDay: 20,
      // Queda en el mismo mes: no saltea ni repite ninguno (como la planilla).
      nextDueDate: '2026-10-20',
      breakdown: [{ label: 'Ana', kind: null, amountCents: 1000 }],
    })
    expect(recurringSchema.safeParse(prepared.payload).success).toBe(true)
    expect(prepared.ticket.title).toBe('Editar gasto fijo')
    expect(prepared.ticket.rows).toEqual([{ label: 'Próximo vencimiento', value: '20/10/2026' }])
    expect(prepared.ticket.confirmLabel).toBe('Guardar los cambios')
  })

  it('con detalle, el monto es la suma: se cambia en la ficha', async () => {
    const { f } = setup()
    const line = { label: 'Ana', kind: null, amountCents: 1000 }
    stubRows([recurring(f.sys('misc_expenses').id, { breakdown: [line] })])
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_gasto_fijo', { gasto: 'alquiler', monto: 5 }),
      ),
    ).toContain('tiene un detalle')
  })

  it('edición sin nada para cambiar; y nombres que no se pueden elegir solos', async () => {
    const { f } = setup()
    const account = f.sys('misc_expenses').id
    stubRows([
      recurring(account),
      recurring(account, { id: '00000000-0000-4000-8000-0000000000a2', name: 'Alquiler depósito' }),
    ])
    expect(
      asError(await runTool(gastosActionTools, 'preparar_gasto_fijo', { gasto: 'alquiler' })),
    ).toContain('nada para cambiar')
    expect(
      asError(await runTool(gastosActionTools, 'preparar_gasto_fijo', { gasto: 'alq', dia: 5 })),
    ).toContain('Preguntale cuál')
    expect(
      asError(await runTool(gastosActionTools, 'preparar_gasto_fijo', { gasto: 'luz', dia: 5 })),
    ).toContain('No encontré')
  })

  it('las cuotas: de cuántas es y por cuál va, y un total que no da vuelve como error', () => {
    const { f } = prepare()
    const account = f.sys('misc_expenses').id
    const ok = recurringSavePayload(
      null,
      {
        name: 'Licuadora',
        accountId: account,
        dueDay: 10,
        nextDueDate: '2026-11-10',
        installments: { total: 6, current: 2 },
      },
      '2026-10-31',
    )
    expect(ok.errors).toEqual({})
    expect(ok.payload).toMatchObject({ installmentsTotal: 6, endsOn: '2027-03-10' })
    expect(recurringSchema.safeParse(ok.payload).success).toBe(true)

    const bad = recurringSavePayload(
      null,
      { name: 'Licuadora', accountId: account, dueDay: 10, installments: { total: 3, current: 5 } },
      '2026-10-31',
    )
    expect(bad.errors.endsOn).toContain('Vas por una cuota que no existe')
  })

  it('el ejecutor manda el paquete tal cual: en una edición viaja solo lo que está', async () => {
    const { f } = setup()
    const account = f.sys('misc_expenses').id
    stubRows([recurring(account)])
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_gasto_fijo', {
        gasto: 'alquiler',
        monto: 900_000,
      }),
    )
    vi.mocked(saveRecurringExpense).mockResolvedValue({
      ok: true,
      data: { id: ROW_ID } as never,
      message: 'Gasto fijo guardado.',
    })
    const done = await executor('gastos.gasto_fijo').run(prepared.payload, TEX_CTX)
    expect(saveRecurringExpense).toHaveBeenCalledWith('hub', prepared.payload)
    expect(done).toMatchObject({
      ok: true,
      message: 'Gasto fijo guardado.',
      href: `/hub/administracion/compras/gastos-fijos/${ROW_ID}`,
    })
  })

  it('voucherTypeOfPaper: las tarjetas de la ficha', () => {
    expect(voucherTypeOfPaper('factura_a', null)).toBe('factura_a')
    expect(voucherTypeOfPaper('factura_b_c', 'factura_b')).toBe('factura_b')
    expect(voucherTypeOfPaper('factura_b_c', null)).toBe('factura_c')
    expect(voucherTypeOfPaper('tique', null)).toBe('tique')
    expect(voucherTypeOfPaper('sin_factura', null)).toBe('sin_comprobante')
    expect(voucherTypeOfPaper('no_se', 'factura_a')).toBeNull()
  })
})

describe('preparar_pago_gasto_fijo', () => {
  it('uno común es un gasto con su gasto fijo, y cuadra', async () => {
    const { ctx, f } = setup()
    stubRows([recurring(f.sys('misc_expenses').id)])
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', {
        gasto: 'Alquiler',
        caja: 'Caja',
      }),
    )
    expect(prepared.executor).toBe('document')
    const payload = documentPayload(prepared)
    expect(payload.form).toBe('quick_expense')
    expect(payload.values).toMatchObject({
      amountCents: 85_000_000,
      treasuryAccountId: f.treasury('caja').id,
      voucher: 'none',
      recurringExpenseId: ROW_ID,
      date: TEX_CTX.today,
      target: { type: 'account', accountId: f.sys('misc_expenses').id },
    })
    expect(quickExpenseSchema.safeParse({ ...payload.values, ...META }).success).toBe(true)
    expectBalanced(prepared, ctx)
    expect(prepared.ticket.total).toEqual({ label: 'Total', value: '$ 850.000' })
    expect(rowValue(prepared.ticket, 'Sale de')).toBe('Caja')
    expect(rowValue(prepared.ticket, 'Papel')).toBe('Remito u otro')
    expect(prepared.ticket.confirmLabel).toBe('Cargar el pago')
  })

  it('sin monto, sin caja o con factura sin número: pregunta lo que falta', async () => {
    const { f } = setup()
    const account = f.sys('misc_expenses').id
    stubRows([recurring(account, { amountCents: null })])
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', {
          gasto: 'Alquiler',
          caja: 'Caja',
        }),
      ),
    ).toContain('no tiene monto')

    stubRows([recurring(account)])
    expect(
      asError(await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', { gasto: 'Alquiler' })),
    ).toContain('Preguntale con qué lo pagó')

    stubRows([recurring(account, { partyId: f.party('mayorista').id, voucherType: 'factura_a' })])
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', {
          gasto: 'Alquiler',
          caja: 'Caja',
        }),
      ),
    ).toContain('Una factura pide el número')
  })

  it('un impuesto que se devenga solo se le paga a Rentas: nunca un gasto, porque quedaría dos veces', async () => {
    const { ctx, f, r } = setup({ auto: true, openItems: { openItems: ['E7.IIBB'] } })
    stubRows([recurring(f.sys('iibb_expense').id, { name: 'Ingresos Brutos', amountCents: null })])
    const item = openItemRef('E7.IIBB', r)
    vi.mocked(loadOpenItems).mockResolvedValue([item])
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', {
        gasto: 'Ingresos Brutos',
        caja: 'Banco Nación',
        fecha: '2026-10-31',
      }),
    )
    expect(loadOpenItems).toHaveBeenCalledWith(TEX_CTX.tenantId, {
      openItemsOf: [{ partyId: f.party('rentas').id }],
    })
    const payload = documentPayload(prepared)
    expect(payload.form).toBe('payment')
    expect(payload.values).toMatchObject({
      partyId: f.party('rentas').id,
      recurringExpenseId: ROW_ID,
      applications: [{ lineId: item.lineId, amountCents: item.openCents }],
      methods: [
        {
          type: 'treasury',
          treasuryAccountId: f.treasury('banco').id,
          amountCents: item.openCents,
          reference: null,
        },
      ],
    })
    expect(paymentSchema.safeParse({ ...payload.values, ...META }).success).toBe(true)
    expectBalanced(prepared, ctx)
    expect(prepared.ticket.title).toBe('Pago')
    expect(prepared.ticket.total).toEqual({ label: 'Pagás', value: '$ 3.800.000' })
    expect(rowValue(prepared.ticket, 'Impuesto al cheque')).toBe('$ 22.800, se anota solo')
    expect(rowValue(prepared.ticket, 'Cómo queda')).toBe('Con esto no le debés más nada.')
  })

  it('con los impuestos apagados, ese mismo gasto fijo se paga como cualquier otro', async () => {
    const { ctx, f } = setup({ auto: false })
    stubRows([recurring(f.sys('iibb_expense').id, { name: 'Ingresos Brutos' })])
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', {
        gasto: 'Ingresos Brutos',
        caja: 'Caja',
      }),
    )
    expect(documentPayload(prepared).form).toBe('quick_expense')
    expect(loadOpenItems).not.toHaveBeenCalled()
    expectBalanced(prepared, ctx)
  })

  it('una factura cargada y sin pagar se le paga al proveedor, y solo esa factura', async () => {
    const { ctx, f, r } = setup({ openItems: { openItems: ['E7.F1', 'E7.F2'] } })
    const invoice = openItemRef('E7.F2', r)
    const other = openItemRef('E7.F1', r)
    stubRows(
      [
        recurring(f.sys('misc_expenses').id, {
          partyId: f.party('cocacola').id,
          partyName: 'Coca-Cola',
          monthStatus: 'loaded',
          loadedDue: '2026-10-10',
          lastDocumentId: invoice.documentId,
          lastDocumentDate: invoice.entryDate,
          nextDueDate: '2026-11-10',
          amountCents: invoice.amountCents,
        }),
      ],
      {
        [ROW_ID]: {
          document: {
            id: invoice.documentId,
            kind: 'purchase',
            accountingDate: invoice.entryDate,
            dueDate: invoice.dueDate,
            totalCents: invoice.amountCents,
            paidCents: 0,
            openCents: invoice.openCents,
          },
          priorOpenCents: 0,
        },
      },
    )
    vi.mocked(loadOpenItems).mockResolvedValue([other, invoice])
    vi.mocked(getFormDefaults).mockResolvedValue({
      treasuryAccountId: f.treasury('banco').id,
    } as never)
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', { gasto: 'Alquiler' }),
    )
    const { values } = documentPayload(prepared)
    expect(values).toMatchObject({
      partyId: f.party('cocacola').id,
      // La cuenta corriente del proveedor no marca el gasto fijo: ya lo marcó la factura.
      recurringExpenseId: null,
      applications: [{ lineId: invoice.lineId, amountCents: invoice.openCents }],
    })
    // La caja de siempre con ese proveedor.
    expect(rowValue(prepared.ticket, 'Sale de')).toBe('Banco Nación')
    expectBalanced(prepared, ctx)
  })

  it('lo ya pagado no se paga de nuevo', async () => {
    const { f } = setup()
    stubRows(
      [
        recurring(f.sys('misc_expenses').id, {
          monthStatus: 'loaded',
          loadedDue: '2026-10-10',
          lastDocumentId: 'd1',
          lastDocumentDate: '2026-10-08',
          nextDueDate: '2026-11-10',
        }),
      ],
      {
        [ROW_ID]: {
          document: {
            id: 'd1',
            kind: 'expense',
            accountingDate: '2026-10-08',
            dueDate: null,
            totalCents: 85_000_000,
            paidCents: 85_000_000,
            openCents: 0,
          },
          priorOpenCents: 0,
        },
      },
    )
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', {
          gasto: 'Alquiler',
          caja: 'Caja',
        }),
      ),
    ).toContain('No hay nada para pagar')
  })

  it('el plan del pago: lo vencido y lo de esta semana; con monto, de lo más viejo a lo más nuevo', () => {
    const { r } = prepare({ openItems: ['E7.F1', 'E7.F2', 'E7.F3'] })
    const items = (['E7.F1', 'E7.F2', 'E7.F3'] as const).map((key) => openItemRef(key, r))
    const base = {
      partyId: r.party('cocacola'),
      items,
      today: '2026-10-14',
      date: '2026-10-14',
      treasuryId: r.treasury('banco'),
      recurringExpenseId: null,
      documentId: null,
    }
    const usual = recurringPaymentValues({ ...base, amountCents: null })
    // F1 vence hoy y F2 en 7 días; F3 queda afuera.
    expect(usual.values.applications?.map((a) => a.lineId)).toEqual([
      r.item('E7.F1'),
      r.item('E7.F2'),
    ])
    expect(usual.debtTotalCents).toBe(50_000_000 + 38_000_000 + 79_950_000)

    const part = recurringPaymentValues({ ...base, amountCents: 60_000_000 })
    expect(part.values.applications).toEqual([
      { lineId: r.item('E7.F1'), amountCents: 50_000_000 },
      { lineId: r.item('E7.F2'), amountCents: 10_000_000 },
    ])
    expect(paymentSchema.safeParse({ ...part.values, ...META }).success).toBe(true)
  })
})

describe('preparar_saltar_gasto_fijo', () => {
  it('«este mes no se paga»: el vencimiento que vio la persona, y solo si corresponde', async () => {
    const { f } = setup()
    const account = f.sys('misc_expenses').id
    stubRows([recurring(account)])
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_saltar_gasto_fijo', { gasto: 'Alquiler' }),
    )
    expect(prepared.executor).toBe('gastos.saltar')
    expect(prepared.payload).toEqual({ id: ROW_ID, dueDate: '2026-10-10' })
    expect(prepared.ticket.confirmLabel).toBe('Saltear este mes')

    vi.mocked(skipRecurringDue).mockResolvedValue({
      ok: true,
      data: { name: 'Alquiler', nextDueDate: '2026-11-10' } as never,
      message: 'Listo: el próximo vencimiento es el 10/11/2026.',
    })
    const done = await executor('gastos.saltar').run(prepared.payload, TEX_CTX)
    expect(skipRecurringDue).toHaveBeenCalledWith('hub', prepared.payload)
    expect(done).toMatchObject({
      ok: true,
      href: '/hub/administracion/gastos-fijos?mes=2026-11',
      point: 'Alquiler',
    })

    stubRows([recurring(account, { active: false })])
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_saltar_gasto_fijo', { gasto: 'Alquiler' }),
      ),
    ).toContain('no se puede saltear')
  })
})

describe('preparar_empleado', () => {
  it('un alta con su sueldo: los dos pasos, en orden', async () => {
    setup()
    vi.mocked(getPayrollReport).mockResolvedValue(report())
    expect(asError(await runTool(gastosActionTools, 'preparar_empleado', {}))).toContain(
      'cómo se llama',
    )
    expect(
      asError(await runTool(gastosActionTools, 'preparar_empleado', { nombre: 'ana ríos' })),
    ).toContain('Ya hay un empleado')

    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_empleado', {
        nombre: 'Luis Paz',
        frecuencia: 'quincenal',
        sueldo: 900_000,
      }),
    )
    expect(prepared.executor).toBe('gastos.empleado')
    expect(prepared.payload).toEqual({
      employee: {
        id: null,
        name: 'Luis Paz',
        payFrequency: 'biweekly',
        active: true,
        notes: null,
      },
      employeeId: null,
      salary: { month: '2026-10', salaryCents: 90_000_000 },
    })
    expect(rowValue(prepared.ticket, 'Sueldo')).toBe('$ 900.000 desde octubre')
    expect(prepared.ticket.confirmLabel).toBe('Agregar el empleado')

    vi.mocked(saveEmployee).mockResolvedValue({
      ok: true,
      data: { id: LUIS },
      message: 'Empleado agregado.',
    })
    vi.mocked(saveEmployeeSalary).mockResolvedValue({
      ok: true,
      data: undefined,
      message: 'Sueldo guardado.',
    })
    const done = await executor('gastos.empleado').run(prepared.payload, TEX_CTX)
    expect(saveEmployeeSalary).toHaveBeenCalledWith('hub', {
      employeeId: LUIS,
      month: '2026-10',
      salaryCents: 90_000_000,
    })
    expect(done).toMatchObject({
      ok: true,
      message: 'Empleado agregado.',
      href: '/hub/administracion/sueldos?mes=2026-10',
      point: 'Luis Paz',
    })
  })

  it('si el empleado se guarda y el sueldo no, lo dice', async () => {
    vi.mocked(saveEmployee).mockResolvedValue({ ok: true, data: { id: LUIS }, message: 'Listo.' })
    vi.mocked(saveEmployeeSalary).mockResolvedValue({
      ok: false,
      code: 'error',
      message: 'No se pudo.',
    })
    const done = await executor('gastos.empleado').run(
      {
        employee: {
          id: null,
          name: 'Luis Paz',
          payFrequency: 'monthly',
          active: true,
          notes: null,
        },
        employeeId: null,
        salary: { month: '2026-10', salaryCents: 100 },
      },
      TEX_CTX,
    )
    expect(done).toEqual({
      ok: false,
      kind: 'failed',
      message: 'Se guardó el empleado, pero no el sueldo. No se pudo.',
    })
  })

  it('cambiar solo el sueldo no toca al empleado; devengado el mes, no se puede', async () => {
    setup()
    vi.mocked(getPayrollReport).mockResolvedValue(report())
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_empleado', { empleado: 'Ana', sueldo: 950_000 }),
    )
    expect(prepared.payload).toEqual({
      employee: null,
      employeeId: ANA,
      salary: { month: '2026-10', salaryCents: 95_000_000 },
    })
    vi.mocked(saveEmployeeSalary).mockResolvedValue({
      ok: true,
      data: undefined,
      message: 'Sueldo guardado.',
    })
    await executor('gastos.empleado').run(prepared.payload, TEX_CTX)
    expect(saveEmployee).not.toHaveBeenCalled()

    vi.mocked(getPayrollReport).mockResolvedValue(
      report({ accrual: { documentId: 'd1', date: '2026-10-31', amountCents: 100 } }),
    )
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_empleado', { empleado: 'Ana', sueldo: 950_000 }),
      ),
    ).toContain('ya están devengados')
  })

  it('dar de baja conserva lo demás y avisa; sin cambios, pregunta', async () => {
    setup()
    vi.mocked(getPayrollReport).mockResolvedValue(report())
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_empleado', { empleado: 'Ana', activo: false }),
    )
    expect(prepared.payload).toMatchObject({
      employee: { id: ANA, name: 'Ana Ríos', payFrequency: 'monthly', active: false },
    })
    expect(prepared.ticket.confirmLabel).toBe('Dar de baja')
    expect(prepared.ticket.warnings.map((w) => w.key)).toEqual(['employee_leaving'])
    expect(
      asError(await runTool(gastosActionTools, 'preparar_empleado', { empleado: 'Ana' })),
    ).toContain('nada para cambiar')
  })

  it('employeeValues arma lo que valida el formulario', () => {
    const alta = employeeValues(null, { name: 'Luis Paz' })
    expect(employeeSchema.safeParse(alta).success).toBe(true)
    expect(employeeValues(employee(), {})).toBeNull()
    expect(employeeValues(employee(), { frequency: 'biweekly' })).toMatchObject({
      id: ANA,
      payFrequency: 'biweekly',
    })
  })
})

describe('preparar_movimiento_sueldo', () => {
  function balanced(ctx: PostingContext, r: FixtureResolver, cents: number) {
    return {
      treasuryAccountId: r.treasury('caja'),
      direction: 'out',
      counterpartAccountId: ctx.sys.payroll_payable.id,
      partyId: r.party('personal'),
      amountCents: cents,
    }
  }

  it('adelanto de sueldo: D Sueldos a pagar [Personal] / H la caja, por su acción', async () => {
    const { ctx, r } = setup()
    vi.mocked(getPayrollReport).mockResolvedValue(report())
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_movimiento_sueldo', {
        empleado: 'Ana',
        tipo: 'adelanto',
        monto: 50_000,
        caja: 'Caja',
      }),
    )
    expect(prepared.executor).toBe('gastos.movimiento_sueldo')
    const payload = prepared.payload as ReturnType<typeof documentPayload> & Record<string, unknown>
    expect(payload).toMatchObject({
      employeeId: ANA,
      employeeName: 'Ana Ríos',
      month: '2026-10',
      kind: 'advance',
    })
    expect(payload.values).toMatchObject({
      ...balanced(ctx, r, 5_000_000),
      shortcut: 'other',
      detail: 'Adelanto · Ana Ríos · octubre',
    })
    expectBalanced(prepared, ctx)
    expect(entryOf(prepared.ticket)).toEqual([
      [
        `${ctx.sys.payroll_payable.name} · ${ctx.parties.get(r.party('personal'))?.name}`,
        '$ 50.000',
        null,
      ],
      ['Caja', null, '$ 50.000'],
    ])
    expect(prepared.ticket.confirmLabel).toBe('Registrar el adelanto')
    expect(rowValue(prepared.ticket, 'Saldo')?.replace(/\s/g, ' ')).toBe(
      'Le debés $ 700.000 de octubre.',
    )

    // El ejecutor deja anotado a quién corresponde y sigue el camino de todo comprobante.
    vi.mocked(postPayrollMovement).mockResolvedValue({
      ok: true,
      message: 'Listo',
      result: {
        bundle_id: 'b',
        replayed: false,
        documents: [
          {
            ref: 'd1',
            id: 'doc-1',
            seq: 1,
            entry_id: 'e',
            provisional_number: null,
            lines: [],
          },
        ],
        allocations: [],
      },
    })
    const done = await executor('gastos.movimiento_sueldo').run(payload, TEX_CTX)
    expect(postPayrollMovement).toHaveBeenCalledWith(
      'hub',
      expect.objectContaining({
        employeeId: ANA,
        month: '2026-10',
        kind: 'advance',
        previewHash: payload.previewHash,
        clientRef: payload.values.clientRef,
        direction: 'out',
      }),
    )
    expect(done).toMatchObject({
      ok: true,
      documentId: 'doc-1',
      href: '/hub/administracion/sueldos?mes=2026-10',
      point: 'Ana Ríos',
    })
    if (done.ok) expect(done.undoUntil).not.toBeNull()
  })

  it('los avisos que solo ve la base y lo que cambió vuelven al tique, con lo nuevo', async () => {
    const payload = {
      values: { clientRef: 'x' },
      previewHash: 'h',
      warningsAck: ['a'],
      month: '2026-10',
      employeeId: ANA,
      employeeName: 'Ana Ríos',
      kind: 'payment',
    }
    vi.mocked(postPayrollMovement).mockResolvedValue({
      ok: false,
      code: 'needs_confirmation',
      message: 'Confirmá.',
      warnings: [{ key: 'treasury_negative', message: 'Caja quedaría en negativo.' }] as never,
    })
    const review = await executor('gastos.movimiento_sueldo').run(payload, TEX_CTX)
    expect(review).toMatchObject({
      ok: false,
      kind: 'review',
      payload: { warningsAck: ['a', 'treasury_negative'] },
    })

    vi.mocked(postPayrollMovement).mockResolvedValue({
      ok: false,
      code: 'preview_stale',
      message: 'Cambió algo.',
      hash: 'nuevo',
      preview: [],
    })
    const stale = await executor('gastos.movimiento_sueldo').run(payload, TEX_CTX)
    expect(stale).toMatchObject({ ok: false, kind: 'review', payload: { previewHash: 'nuevo' } })

    expect(await executor('gastos.movimiento_sueldo').run({ roto: true }, TEX_CTX)).toMatchObject({
      ok: false,
      kind: 'failed',
    })
  })

  it('un pago sin monto es lo que se le debe; un adelanto sin monto o sin caja, pregunta', async () => {
    const { ctx, r } = setup()
    vi.mocked(getPayrollReport).mockResolvedValue(report())
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_movimiento_sueldo', {
        empleado: 'Ana',
        tipo: 'pago',
        caja: 'Caja',
      }),
    )
    expect(documentPayload(prepared).values).toMatchObject({
      ...balanced(ctx, r, 70_000_000),
      detail: 'Pago de sueldo · Ana Ríos · octubre',
    })
    expect(prepared.ticket.confirmLabel).toBe('Registrar el pago')
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_movimiento_sueldo', {
          empleado: 'Ana',
          tipo: 'adelanto',
          caja: 'Caja',
        }),
      ),
    ).toContain('de cuánto fue')
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_movimiento_sueldo', {
          empleado: 'Ana',
          tipo: 'adelanto',
          monto: 1000,
        }),
      ),
    ).toContain('con qué lo pagó')
  })

  it('un sueldo no sale de la tarjeta de la empresa', async () => {
    const { ctx: base, f } = setup()
    const card = {
      ...f.treasury('banco'),
      id: '00000000-0000-4000-8000-000000000f03',
      name: 'Visa empresa',
      kind: 'credit_card' as const,
    }
    stubBar({ ...base, treasuries: new Map(base.treasuries).set(card.id, card) })
    vi.mocked(getPayrollReport).mockResolvedValue(report())
    expect(
      asError(
        await runTool(gastosActionTools, 'preparar_movimiento_sueldo', {
          empleado: 'Ana',
          tipo: 'adelanto',
          monto: 1000,
          caja: 'Visa empresa',
        }),
      ),
    ).toContain('no sirve para esto')
  })
})

describe('preparar_devengar_sueldos', () => {
  it('el asiento del mes, con fecha de fin de mes y por su acción', async () => {
    const { ctx, f } = setup()
    vi.mocked(getPayrollReport).mockResolvedValue(
      report({ employees: [employee(), employee({ id: LUIS, name: 'Luis', salaryCents: 0 })] }),
    )
    const prepared = asPrepared(
      await runTool(gastosActionTools, 'preparar_devengar_sueldos', { mes: '2026-10' }),
    )
    expect(prepared.executor).toBe('gastos.devengar')
    const payload = documentPayload(prepared)
    expect(payload.form).toBe('manual_entry')
    expect(payload.values).toMatchObject({
      entryKind: 'payroll',
      date: '2026-10-31',
      description: 'Sueldos de octubre de 2026',
    })
    expectBalanced(prepared, ctx)
    expect(prepared.ticket.total).toEqual({ label: 'Total', value: '$ 800.000' })
    expect(rowValue(prepared.ticket, 'Empleados')).toBe('1')
    expect(prepared.ticket.confirmLabel).toBe('Devengar octubre')
    expect(prepared.ticket.warnings.map((w) => w.key)).toContain('accrual_once')
    expect(entryOf(prepared.ticket)[0]).toEqual([f.sys('salaries').name, '$ 800.000', null])

    vi.mocked(postPayrollAccrual).mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'Ese mes está cerrado.',
    })
    const failed = await executor('gastos.devengar').run(prepared.payload, TEX_CTX)
    expect(postPayrollAccrual).toHaveBeenCalledWith(
      'hub',
      expect.objectContaining({ month: '2026-10', entryKind: 'payroll' }),
    )
    expect(failed).toEqual({ ok: false, kind: 'failed', message: 'Ese mes está cerrado.' })
  })

  it('devengado, sin sueldos o de un mes que no empezó: no hay tique', async () => {
    setup()
    vi.mocked(getPayrollReport).mockResolvedValue(
      report({ accrual: { documentId: 'd1', date: '2026-10-31', amountCents: 100 } }),
    )
    expect(asError(await runTool(gastosActionTools, 'preparar_devengar_sueldos', {}))).toContain(
      'ya están devengados',
    )
    vi.mocked(getPayrollReport).mockResolvedValue(
      report({ employees: [employee({ salaryCents: 0 })] }),
    )
    expect(asError(await runTool(gastosActionTools, 'preparar_devengar_sueldos', {}))).toContain(
      'cargar los sueldos',
    )
    vi.mocked(getPayrollReport).mockResolvedValue(report({ month: '2026-12' }))
    expect(
      asError(await runTool(gastosActionTools, 'preparar_devengar_sueldos', { mes: '2026-12' })),
    ).toContain('todavía no empezó')
  })
})

describe('buscar por nombre', () => {
  const rows = [
    { id: ANA, name: 'Ana Ríos' },
    { id: LUIS, name: 'Anabel Ruiz' },
  ]

  it('por id, por nombre sin tildes, por parte; con dos opciones no elige', () => {
    expect(matchByName(rows, LUIS)).toMatchObject({ ok: true, value: { name: 'Anabel Ruiz' } })
    expect(matchByName(rows, 'ana rios')).toMatchObject({ ok: true, value: { id: ANA } })
    expect(matchByName(rows, 'ruiz')).toMatchObject({ ok: true, value: { id: LUIS } })
    const many = matchByName(rows, 'ana')
    if (many.ok) throw new Error('no tenía que elegir')
    expect(noMatchText(many, 'ana')).toBe('«ana» puede ser Ana Ríos, Anabel Ruiz. Preguntale cuál.')
    const none = matchByName(rows, 'Pedro')
    if (none.ok) throw new Error('no tenía que encontrar')
    expect(noMatchText(none, 'Pedro')).toContain('Los que hay: Ana Ríos, Anabel Ruiz')
  })
})
