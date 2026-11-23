/**
 * Tex en Administración por sucursal (entrega 1). Lo que se fija: lee lo de la sucursal que se mira como cada
 * pantalla; todo lo que prepara en Compras y pagos, Gastos fijos y Caja lleva su sucursal; un gasto fijo se paga
 * siempre desde la suya; mirando «Todas» con dos sucursales pregunta en cuál en vez de preparar; y una caja de
 * otra sucursal se rechaza con el mismo mensaje de los formularios. Sueldos sigue siendo de todo el bar.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/accounting/actions/master', () => ({
  saveParty: vi.fn(),
  saveRecurringExpense: vi.fn(),
  skipRecurringDue: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/week-plan', () => ({ saveWeekBudgets: vi.fn() }))
vi.mock('@/lib/accounting/actions/payroll', () => ({
  saveEmployee: vi.fn(),
  saveEmployeeSalary: vi.fn(),
  postPayrollMovement: vi.fn(),
  postPayrollAccrual: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/documents', () => ({ markTreasuryChecked: vi.fn() }))
vi.mock('@/lib/accounting/context', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/context')>()),
  tryLoadPostingContext: vi.fn(),
  loadPostingCatalog: vi.fn(),
  loadOpenItems: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/accounts', () => ({ listAccounts: vi.fn() }))
vi.mock('@/lib/accounting/queries/documents', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/queries/documents')>()),
  listRecurringExpenses: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/forms', () => ({
  getFormDefaults: vi.fn(),
  findPossibleDuplicate: vi.fn(),
  getTreasuryCheck: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/parties', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/queries/parties')>()),
  searchParties: vi.fn(),
  getParty: vi.fn(),
  listParties: vi.fn(),
  getPartyPosition: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/payroll', () => ({ getPayrollReport: vi.fn() }))
vi.mock('@/lib/accounting/queries/recurring', () => ({ listRecurringPayments: vi.fn() }))
vi.mock('@/lib/accounting/queries/settings', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/queries/settings')>()),
  getAccountingSettings: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/treasury', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/queries/treasury')>()),
  listTreasuryAccounts: vi.fn(),
  listTreasuryBalances: vi.fn(),
  getCashFlow: vi.fn(),
  getCashProjection: vi.fn(),
  getTreasuryMovements: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/week-plan', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/queries/week-plan')>()),
  getWeekPlan: vi.fn(),
}))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadFirstOpenDate: vi.fn(),
  loadDocumentContext: vi.fn(),
}))
vi.mock('@/lib/accounting/server/post-document', () => ({
  runPreviewDocument: vi.fn(),
  runPostDocument: vi.fn(),
}))
vi.mock('@/lib/arca/emit-queries', () => ({ getArcaVoucherCard: vi.fn() }))

import { loadOpenItems, loadPostingCatalog } from '@/lib/accounting/context'
import { ACC_ERRORS } from '@/lib/accounting/errors'
import {
  listDocuments,
  listRecurringExpenses,
  type RecurringExpenseRow,
} from '@/lib/accounting/queries/documents'
import {
  findPossibleDuplicate,
  getFormDefaults,
  getTreasuryCheck,
  type TreasuryCheck,
} from '@/lib/accounting/queries/forms'
import { listParties } from '@/lib/accounting/queries/parties'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { listTreasuryBalances, type TreasuryBalanceRow } from '@/lib/accounting/queries/treasury'
import { getWeekPlan } from '@/lib/accounting/queries/week-plan'
import {
  bankExpenseSchema,
  cashMovementSchema,
  paymentSchema,
  purchaseSchema,
  quickExpenseSchema,
  recurringSchema,
  transferSchema,
  treasuryAdjustmentSchema,
} from '@/lib/accounting/schemas'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { runPreviewDocument } from '@/lib/accounting/server/post-document'
import type { PostingContext } from '@/lib/accounting/types'
import { branchToWrite, matchBranch } from '@/lib/tex/branch'
import { cajasActionTools } from '@/lib/tex/tools/actions/cajas'
import { comprasActionTools } from '@/lib/tex/tools/actions/compras'
import { gastosActionTools } from '@/lib/tex/tools/actions/gastos'
import { cajasReadTools } from '@/lib/tex/tools/read/cajas'
import { comprasReadTools } from '@/lib/tex/tools/read/compras'
import { gastosReadTools } from '@/lib/tex/tools/read/gastos'
import type { TexBranchView, TexPrepared, TexToolContext } from '@/lib/tex/tools/types'
import { CLIENT_REF, prepare } from './accounting-fixtures'
import { catalogOf } from './tex-actions-catalog'
import {
  asError,
  asPrepared,
  documentPayload,
  expectBalanced,
  rowValue,
  runTool,
  stubBar,
  TEX_CTX,
} from './tex-actions-kit'
import { ALTA, CERRO, viewing, viewingAll } from './tex-branch-kit'

const TENANT = TEX_CTX.tenantId
const META = { clientRef: CLIENT_REF, previewHash: '0'.repeat(64) }
const CAJA_CERRO = '00000000-0000-4000-8000-0000000000c9'
const CAJA_CERRO_ACCOUNT = '00000000-0000-4000-8000-0000000000ca'
const LUZ = '00000000-0000-4000-8000-0000000000a1'
const ALQUILER_ALTA = '00000000-0000-4000-8000-0000000000a2'
const ALQUILER_CERRO = '00000000-0000-4000-8000-0000000000a3'
const OTHER_BRANCH = ACC_ERRORS.treasury_other_branch.message
const QUESTION = '¿En qué sucursal? Alta Córdoba o Cerro.'

/** Tex en el panel de un dueño que mira esa sucursal (o «Todas»). */
function as(branch: TexBranchView): TexToolContext {
  return { ...TEX_CTX, branch }
}

/**
 * El bar de prueba con dos locales: «Caja» es de Alta Córdoba y «Caja Cerro» del Cerro; Mercado Pago y el
 * banco, de todo el bar (como los deja la migración).
 */
function twoBranches() {
  const prepared = prepare()
  const { ctx, f } = prepared
  const caja = f.treasury('caja')
  const account = ctx.accounts.get(caja.accountId)
  if (!account) throw new Error('falta la cuenta de la caja')
  const accounts = new Map(ctx.accounts).set(CAJA_CERRO_ACCOUNT, {
    ...account,
    id: CAJA_CERRO_ACCOUNT,
    code: '1.1.01.01.004',
    name: 'Caja Cerro',
  })
  const treasuries = new Map(ctx.treasuries)
    .set(caja.id, { ...caja, branchId: ALTA.id })
    .set(CAJA_CERRO, {
      ...caja,
      id: CAJA_CERRO,
      accountId: CAJA_CERRO_ACCOUNT,
      name: 'Caja Cerro',
      branchId: CERRO.id,
    })
  const bar: PostingContext = {
    ...ctx,
    accounts,
    treasuries,
    settings: {
      ...ctx.settings,
      taxSettings: {
        auto: false,
        iibbBp: 300,
        municipalBp: 70,
        bankTaxBp: 60,
        base: 'invoiced_net',
      },
    },
  }
  stubBar(bar)
  vi.mocked(loadPostingCatalog).mockResolvedValue(catalogOf({ ...f, ctx: bar }, TENANT))
  vi.mocked(loadOpenItems).mockResolvedValue([])
  vi.mocked(loadFirstOpenDate).mockResolvedValue(null)
  vi.mocked(getFormDefaults).mockResolvedValue({ treasuryAccountId: null } as never)
  vi.mocked(findPossibleDuplicate).mockResolvedValue(null)
  vi.mocked(listRecurringExpenses).mockResolvedValue([])
  vi.mocked(listRecurringPayments).mockResolvedValue(new Map())
  vi.mocked(getWeekPlan).mockResolvedValue([])
  return { ...prepared, ctx: bar, cajaAlta: caja.id }
}

/** Un gasto fijo de una sucursal, sin pagar este mes. */
function fixedExpense(
  accountId: string,
  patch: Partial<RecurringExpenseRow> = {},
): RecurringExpenseRow {
  return {
    id: LUZ,
    name: 'Luz',
    branchId: CERRO.id,
    partyId: null,
    partyName: null,
    accountId,
    accountName: 'Gastos varios',
    voucherType: null,
    vatRateBp: null,
    amountCents: 3_000_000,
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
    updatedAt: '2026-10-12T10:00:00.000Z',
    monthStatus: 'pending',
    daysToDue: -21,
    ...patch,
  }
}

function balance(over: Partial<TreasuryBalanceRow>): TreasuryBalanceRow {
  return {
    treasuryId: CAJA_CERRO,
    accountId: CAJA_CERRO_ACCOUNT,
    name: 'Caja Cerro',
    kind: 'cash',
    branchId: CERRO.id,
    accountCode: '1.1.01.01.004',
    alias: null,
    bankName: null,
    allowNegative: false,
    active: true,
    balanceCents: 10_000_000,
    pendingWalletCents: 0,
    lastMovementDate: '2026-10-30',
    lastCheckedOn: null,
    ...over,
  }
}

function check(bookCents: number): TreasuryCheck {
  return {
    bookCents,
    lastAdjustmentDate: '2026-10-01',
    lastCheckedOn: '2026-10-01',
    openWalletItems: [],
    estimates: null,
  }
}

function values(prepared: TexPrepared): Record<string, unknown> {
  return documentPayload(prepared).values
}

beforeEach(() => vi.clearAllMocks())

// ─── Lo puro ─────────────────────────────────────────────────────────────────

describe('la sucursal que dice la persona', () => {
  const both = viewingAll()

  it('se reconoce por el nombre o el nombre corto, sin tildes ni mayúsculas', () => {
    for (const said of ['Cerro', 'cerro', 'CERRO', 'el cerro']) {
      expect(matchBranch(both, said)).toEqual({ ok: true, branch: CERRO })
    }
    for (const said of ['Alta Córdoba', 'alta cordoba', 'ALTA', 'ac', CERRO.id]) {
      const match = matchBranch(both, said)
      expect(match.ok).toBe(true)
    }
    expect(matchBranch(both, 'AC')).toEqual({ ok: true, branch: ALTA })
  })

  it('una que no existe o «todas» vuelven con las que hay', () => {
    expect(matchBranch(both, 'Palermo')).toEqual({
      ok: false,
      message: 'No hay una sucursal «Palermo». Las que hay: Alta Córdoba, Cerro.',
    })
    expect(matchBranch(both, 'todas')).toEqual({
      ok: false,
      message: 'Lo que se carga va a una sola sucursal: ¿Alta Córdoba o Cerro?',
    })
  })

  it('el orden: el gasto fijo, la que dijo, la que mira, la única, la de la caja; si no, pregunta', () => {
    const fixed = { name: 'Luz', branchId: CERRO.id }
    expect(branchToWrite(viewing(ALTA), { fixed })).toEqual({ ok: true, branchId: CERRO.id })
    expect(branchToWrite(viewing(ALTA), { said: ALTA.id, fixed })).toEqual({
      ok: false,
      message: '«Luz» es un gasto fijo de Cerro: se paga desde su sucursal.',
    })
    expect(branchToWrite(viewing(ALTA), { said: CERRO.id })).toEqual({
      ok: true,
      branchId: CERRO.id,
    })
    expect(branchToWrite(viewing(CERRO), { box: ALTA.id })).toEqual({
      ok: true,
      branchId: CERRO.id,
    })
    expect(branchToWrite(viewingAll([ALTA]), {})).toEqual({ ok: true, branchId: ALTA.id })
    expect(branchToWrite(both, { box: CERRO.id })).toEqual({ ok: true, branchId: CERRO.id })
    const asked = branchToWrite(both, {})
    expect(asked.ok).toBe(false)
    if (!asked.ok) expect(asked.message).toContain(QUESTION)
  })
})

// ─── Leer ────────────────────────────────────────────────────────────────────

describe('las lecturas usan la sucursal que se mira, como cada pantalla', () => {
  it('ver_cajas: las de esa sucursal y las de todo el bar, cada una diciendo de dónde es', async () => {
    twoBranches()
    vi.mocked(getAccountingSettings).mockResolvedValue(null)
    vi.mocked(listTreasuryBalances).mockResolvedValue([
      balance({}),
      balance({ treasuryId: 'mp', name: 'Mercado Pago', kind: 'wallet', branchId: null }),
    ])
    const cerro = await runTool(cajasReadTools, 'ver_cajas', {}, as(viewing(CERRO)))
    expect(listTreasuryBalances).toHaveBeenCalledWith(TENANT, {
      asOf: TEX_CTX.today,
      branchId: CERRO.id,
    })
    expect(cerro).toMatchObject({
      kind: 'data',
      data: {
        sucursal: 'Cerro',
        cajas: [{ nombre: 'Caja Cerro' }, { nombre: 'Mercado Pago', sucursal: 'Todo el bar' }],
      },
    })
    if (cerro.kind === 'data') {
      const [own] = (cerro.data as { cajas: Array<Record<string, unknown>> }).cajas
      expect(own?.sucursal).toBeUndefined()
    }

    const all = await runTool(cajasReadTools, 'ver_cajas', {}, as(viewingAll()))
    expect(listTreasuryBalances).toHaveBeenLastCalledWith(TENANT, {
      asOf: TEX_CTX.today,
      branchId: null,
    })
    expect(all).toMatchObject({
      data: { sucursal: 'Todas', cajas: [{ nombre: 'Caja Cerro', sucursal: 'Cerro' }, {}] },
    })
  })

  it('ver_gastos_fijos: los de esa sucursal, sus pagos y su fila de sueldos', async () => {
    twoBranches()
    vi.mocked(getPayrollReport).mockResolvedValue({
      month: '2026-10',
      employees: [],
      accrual: null,
    })
    await runTool(gastosReadTools, 'ver_gastos_fijos', {}, as(viewing(CERRO)))
    expect(listRecurringExpenses).toHaveBeenCalledWith(TENANT, {
      includeInactive: true,
      today: TEX_CTX.today,
      branch: { ids: [CERRO.id] },
    })
    expect(listRecurringPayments).toHaveBeenCalledWith(TENANT, CERRO.id)
    expect(getPayrollReport).toHaveBeenCalledWith(TENANT, '2026-10', CERRO.id)
  })

  it('ver_gastos_fijos en «Todas»: cada renglón con su sucursal y la parte de cada una', async () => {
    const { f } = twoBranches()
    const account = f.sys('misc_expenses').id
    vi.mocked(listRecurringExpenses).mockResolvedValue([
      fixedExpense(account),
      fixedExpense(account, { id: ALQUILER_ALTA, name: 'Alquiler', branchId: ALTA.id }),
    ])
    vi.mocked(getPayrollReport).mockResolvedValue({
      month: '2026-10',
      employees: [],
      accrual: null,
    })
    const result = await runTool(gastosReadTools, 'ver_gastos_fijos', {}, as(viewingAll()))
    expect(listRecurringPayments).toHaveBeenCalledWith(TENANT, null)
    expect(result.kind).toBe('data')
    if (result.kind !== 'data') return
    const data = result.data as {
      sucursal: string
      faltan: Array<{ nombre: string; sucursal?: string }>
      por_sucursal: Array<{ sucursal: string; total_del_mes: string }>
    }
    expect(data.sucursal).toBe('Todas')
    expect(data.faltan.map((row) => [row.nombre, row.sucursal])).toEqual(
      expect.arrayContaining([
        ['Luz', 'Cerro'],
        ['Alquiler', 'Alta Córdoba'],
      ]),
    )
    expect(data.por_sucursal).toEqual([
      expect.objectContaining({ sucursal: 'Alta Córdoba', total_del_mes: '$ 30.000' }),
      expect.objectContaining({ sucursal: 'Cerro', total_del_mes: '$ 30.000' }),
    ])
  })

  it('ver_sueldos sigue siendo de todo el bar', async () => {
    twoBranches()
    vi.mocked(getPayrollReport).mockResolvedValue({
      month: '2026-10',
      employees: [],
      accrual: null,
    })
    await runTool(gastosReadTools, 'ver_sueldos', {}, as(viewing(CERRO)))
    expect(getPayrollReport).toHaveBeenCalledWith(TENANT, '2026-10')
  })

  it('Compras y pagos por sucursal; ventas y asientos, de todo el bar', async () => {
    twoBranches()
    vi.mocked(listDocuments).mockResolvedValue({
      rows: [],
      nextCursor: null,
      totalRows: 0,
      truncated: false,
    } as never)
    vi.mocked(listParties).mockResolvedValue({
      rows: [],
      totals: { debtCents: 0, overdueCents: 0, dueSoonCents: 0, creditCents: 0 },
      asOf: TEX_CTX.today,
    } as never)
    const ctx = as(viewing(CERRO))

    await runTool(comprasReadTools, 'buscar_comprobantes', { tipo: 'compras' }, ctx)
    expect(listDocuments).toHaveBeenLastCalledWith(
      TENANT,
      expect.objectContaining({ branch: { ids: [CERRO.id] } }),
    )
    const sales = await runTool(comprasReadTools, 'buscar_comprobantes', { tipo: 'cierres' }, ctx)
    expect(listDocuments).toHaveBeenLastCalledWith(
      TENANT,
      expect.objectContaining({ branch: { ids: null } }),
    )
    expect(sales).toMatchObject({ data: { sucursal: 'Todo el bar' } })

    expect(await runTool(comprasReadTools, 'ver_deudas', {}, ctx)).toMatchObject({
      data: { sucursal: 'Cerro' },
    })
    expect(listParties).toHaveBeenCalledWith(TENANT, {
      group: 'payables',
      asOf: TEX_CTX.today,
      branchId: CERRO.id,
    })

    await runTool(comprasReadTools, 'ver_plan_semana', { semana: '2026-10-28' }, ctx)
    expect(getWeekPlan).toHaveBeenCalledWith(TENANT, '2026-10-26', CERRO.id)
  })
})

// ─── Preparar en una sucursal ────────────────────────────────────────────────

describe('lo que se prepara mirando una sucursal lleva esa sucursal', () => {
  it('un gasto: la sucursal en el comprobante y en el tique, y una caja de ahí', async () => {
    const { ctx, f } = twoBranches()
    const prepared = asPrepared(
      await runTool(
        comprasActionTools,
        'preparar_gasto',
        { monto: 5000, cuenta: f.sys('misc_expenses').code },
        as(viewing(CERRO)),
      ),
    )
    // Sin decir con qué: la caja que propone la hoja entre las del Cerro (nunca la de Alta Córdoba).
    expect(values(prepared)).toMatchObject({ branchId: CERRO.id, treasuryAccountId: CAJA_CERRO })
    expect(quickExpenseSchema.safeParse({ ...values(prepared), ...META }).success).toBe(true)
    expectBalanced(prepared, ctx)
    expect(prepared.ticket.rows[0]).toEqual({ label: 'Sucursal', value: 'Cerro' })
    expect(prepared.ticket.warnings).toEqual([])
  })

  it('una compra a deber y un pago a cuenta, en la sucursal que se mira', async () => {
    const { ctx } = twoBranches()
    const compra = asPrepared(
      await runTool(
        comprasActionTools,
        'preparar_compra',
        {
          proveedor: 'coca',
          papel: 'factura_a',
          punto_de_venta: 3,
          numero: 1290,
          fecha: '2026-10-03',
          total: 860_000,
          cuenta: 'bebidas sin alcohol',
        },
        as(viewing(CERRO)),
      ),
    )
    expect(documentPayload(compra).form).toBe('purchase')
    expect(values(compra).branchId).toBe(CERRO.id)
    expect(purchaseSchema.safeParse({ ...values(compra), ...META }).success).toBe(true)
    expectBalanced(compra, ctx)

    const pago = asPrepared(
      await runTool(
        comprasActionTools,
        'preparar_pago',
        { proveedor: 'Mayorista X', monto: 1000, que_paga: 'a_cuenta', caja: 'Banco Nación' },
        as(viewing(CERRO)),
      ),
    )
    expect(values(pago).branchId).toBe(CERRO.id)
    expect(paymentSchema.safeParse({ ...values(pago), ...META }).success).toBe(true)
    // La nota del Plan de la semana es la de esa sucursal, como la hoja «Pago».
    expect(getWeekPlan).toHaveBeenCalledWith(TENANT, '2026-10-26', CERRO.id)
  })

  it('una caja de otra sucursal se rechaza con el mensaje de los formularios', async () => {
    const { f } = twoBranches()
    const message = asError(
      await runTool(
        comprasActionTools,
        'preparar_gasto',
        { monto: 5000, cuenta: f.sys('misc_expenses').code, caja: 'Caja' },
        as(viewing(CERRO)),
      ),
    )
    expect(message.startsWith(OTHER_BRANCH)).toBe(true)
    expect(message).toContain('En Cerro sirven: Mercado Pago SAS, Banco Nación, Caja Cerro.')
    expect(runPreviewDocument).not.toHaveBeenCalled()

    expect(
      asError(
        await runTool(
          cajasActionTools,
          'preparar_movimiento',
          { que: 'socio_saco', caja: 'Caja', quien: 'Máximo', monto: 1000 },
          as(viewing(CERRO)),
        ),
      ).startsWith(OTHER_BRANCH),
    ).toBe(true)

    vi.mocked(getTreasuryCheck).mockResolvedValue(check(15_000_000))
    expect(
      asError(
        await runTool(
          cajasActionTools,
          'preparar_arqueo',
          { caja: 'Caja', hay: 150_000 },
          as(viewing(CERRO)),
        ),
      ).startsWith(OTHER_BRANCH),
    ).toBe(true)
  })

  it('Caja: el movimiento y los gastos del banco llevan la sucursal; el banco sirve en todas', async () => {
    const { ctx } = twoBranches()
    const movement = asPrepared(
      await runTool(
        cajasActionTools,
        'preparar_movimiento',
        { que: 'socio_saco', caja: 'Caja Cerro', quien: 'Máximo', monto: 1000 },
        as(viewing(CERRO)),
      ),
    )
    expect(values(movement)).toMatchObject({ branchId: CERRO.id, treasuryAccountId: CAJA_CERRO })
    expect(cashMovementSchema.safeParse({ ...values(movement), ...META }).success).toBe(true)
    expectBalanced(movement, ctx)

    const bank = asPrepared(
      await runTool(
        cajasActionTools,
        'preparar_gasto_bancario',
        { caja: 'Banco Nación', comisiones: 1000 },
        as(viewing(CERRO)),
      ),
    )
    expect(values(bank).branchId).toBe(CERRO.id)
    expect(bankExpenseSchema.safeParse({ ...values(bank), ...META }).success).toBe(true)
    expect(rowValue(bank.ticket, 'Sucursal')).toBe('Cerro')
  })

  it('una diferencia al contar queda en la sucursal; si coincide, no hace falta sucursal', async () => {
    twoBranches()
    vi.mocked(getTreasuryCheck).mockResolvedValue(check(15_000_000))
    const short = asPrepared(
      await runTool(
        cajasActionTools,
        'preparar_arqueo',
        { caja: 'Caja Cerro', hay: 140_000 },
        as(viewing(CERRO)),
      ),
    )
    expect(documentPayload(short).form).toBe('treasury_adjustment')
    expect(values(short).branchId).toBe(CERRO.id)
    expect(treasuryAdjustmentSchema.safeParse({ ...values(short), ...META }).success).toBe(true)

    // Mirando «Todas», una caja de todo el bar que coincide se verifica sin preguntar nada.
    const same = asPrepared(
      await runTool(
        cajasActionTools,
        'preparar_arqueo',
        { caja: 'Banco Nación', hay: 150_000 },
        as(viewingAll()),
      ),
    )
    expect(same.executor).toBe('cajas.arqueo_coincide')
    // Con diferencia, hay un comprobante: pregunta en qué sucursal.
    expect(
      asError(
        await runTool(
          cajasActionTools,
          'preparar_arqueo',
          { caja: 'Banco Nación', hay: 140_000, motivo: 'otra' },
          as(viewingAll()),
        ),
      ),
    ).toContain(QUESTION)
  })

  it('«Mover plata» es de la caja de donde sale, aunque se mire otra sucursal', async () => {
    const { ctx } = twoBranches()
    const prepared = asPrepared(
      await runTool(
        cajasActionTools,
        'preparar_transferencia',
        { desde: 'Caja Cerro', hacia: 'Banco Nación', monto: 2000 },
        as(viewing(ALTA)),
      ),
    )
    expect(values(prepared).branchId).toBe(CERRO.id)
    expect(transferSchema.safeParse({ ...values(prepared), ...META }).success).toBe(true)
    expectBalanced(prepared, ctx)
    expect(prepared.ticket.warnings.map((w) => w.title)).toContain(
      'Queda en Cerro, no en Alta Córdoba, que es la que estás mirando.',
    )
  })

  it('un gasto fijo nuevo queda en la sucursal que se mira', async () => {
    const { f } = twoBranches()
    const prepared = asPrepared(
      await runTool(
        gastosActionTools,
        'preparar_gasto_fijo',
        { nombre: 'Gas', cuenta: f.sys('misc_expenses').code, dia: 15, caja: 'Caja Cerro' },
        as(viewing(CERRO)),
      ),
    )
    expect(prepared.payload).toMatchObject({ branchId: CERRO.id, treasuryAccountId: CAJA_CERRO })
    expect(recurringSchema.safeParse(prepared.payload).success).toBe(true)
    expect(prepared.ticket.rows[0]).toEqual({ label: 'Sucursal', value: 'Cerro' })

    // Su caja de siempre también tiene que ser de ahí o de todo el bar.
    expect(
      asError(
        await runTool(
          gastosActionTools,
          'preparar_gasto_fijo',
          { nombre: 'Gas', cuenta: f.sys('misc_expenses').code, dia: 15, caja: 'Caja' },
          as(viewing(CERRO)),
        ),
      ).startsWith(OTHER_BRANCH),
    ).toBe(true)
  })
})

// ─── «Todas» ─────────────────────────────────────────────────────────────────

describe('mirando «Todas» con dos sucursales', () => {
  it('sin sucursal pregunta en vez de preparar; con ella (como la diga), prepara ahí', async () => {
    const { f } = twoBranches()
    const input = { monto: 5000, cuenta: f.sys('misc_expenses').code, caja: 'Mercado Pago SAS' }
    const asked = asError(
      await runTool(comprasActionTools, 'preparar_gasto', input, as(viewingAll())),
    )
    expect(asked).toContain(QUESTION)
    expect(runPreviewDocument).not.toHaveBeenCalled()

    for (const [said, branch] of [
      ['cerro', CERRO],
      ['ALTA CORDOBA', ALTA],
      ['AC', ALTA],
    ] as const) {
      const prepared = asPrepared(
        await runTool(
          comprasActionTools,
          'preparar_gasto',
          { ...input, sucursal: said },
          as(viewingAll()),
        ),
      )
      expect(values(prepared).branchId).toBe(branch.id)
      expect(rowValue(prepared.ticket, 'Sucursal')).toBe(branch.name)
    }

    expect(
      asError(
        await runTool(
          comprasActionTools,
          'preparar_gasto',
          { ...input, sucursal: 'Palermo' },
          as(viewingAll()),
        ),
      ),
    ).toBe('No hay una sucursal «Palermo». Las que hay: Alta Córdoba, Cerro.')
  })

  it('las demás preguntan igual: compra, pago, Caja y un gasto fijo nuevo', async () => {
    const { f } = twoBranches()
    const ctx = as(viewingAll())
    const cases: Array<[typeof comprasActionTools, string, Record<string, unknown>]> = [
      [
        comprasActionTools,
        'preparar_compra',
        { proveedor: 'coca', papel: 'sin_comprobante', total: 1000, cuenta: 'bebidas sin alcohol' },
      ],
      [comprasActionTools, 'preparar_pago', { proveedor: 'Mayorista X', monto: 1000 }],
      [cajasActionTools, 'preparar_gasto_bancario', { caja: 'Banco Nación', comisiones: 1000 }],
      [
        cajasActionTools,
        'preparar_movimiento',
        { que: 'socio_puso', caja: 'Banco Nación', quien: 'Máximo', monto: 1000 },
      ],
      [
        cajasActionTools,
        'preparar_transferencia',
        { desde: 'Banco Nación', hacia: 'Mercado Pago SAS', monto: 1000 },
      ],
      [
        gastosActionTools,
        'preparar_gasto_fijo',
        { nombre: 'Gas', cuenta: f.sys('misc_expenses').code, dia: 15 },
      ],
    ]
    for (const [tools, name, input] of cases) {
      expect(asError(await runTool(tools, name, input, ctx)), name).toContain(QUESTION)
    }
    expect(runPreviewDocument).not.toHaveBeenCalled()

    const fixed = asPrepared(
      await runTool(
        gastosActionTools,
        'preparar_gasto_fijo',
        { nombre: 'Gas', cuenta: f.sys('misc_expenses').code, dia: 15, sucursal: 'Cerro' },
        ctx,
      ),
    )
    expect(fixed.payload).toMatchObject({ branchId: CERRO.id })
  })

  it('con la caja de un local no hace falta preguntar: es la de esa caja', async () => {
    const { f } = twoBranches()
    const prepared = asPrepared(
      await runTool(
        comprasActionTools,
        'preparar_gasto',
        { monto: 5000, cuenta: f.sys('misc_expenses').code, caja: 'Caja Cerro' },
        as(viewingAll()),
      ),
    )
    expect(values(prepared)).toMatchObject({ branchId: CERRO.id, treasuryAccountId: CAJA_CERRO })
  })

  it('con una sola sucursal nunca pregunta ni la nombra', async () => {
    const { f } = twoBranches()
    for (const branch of [viewingAll([ALTA]), viewing(ALTA, [ALTA])]) {
      const prepared = asPrepared(
        await runTool(
          comprasActionTools,
          'preparar_gasto',
          { monto: 5000, cuenta: f.sys('misc_expenses').code, caja: 'Mercado Pago SAS' },
          as(branch),
        ),
      )
      expect(values(prepared).branchId).toBe(ALTA.id)
      expect(rowValue(prepared.ticket, 'Sucursal')).toBeUndefined()
    }
  })
})

// ─── Un gasto fijo se paga desde su sucursal ─────────────────────────────────

describe('un gasto fijo se paga siempre desde su sucursal', () => {
  it('pagado mirando otra sucursal, queda en la suya (el caso del 22/11)', async () => {
    const { ctx, f } = twoBranches()
    vi.mocked(listRecurringExpenses).mockResolvedValue([fixedExpense(f.sys('misc_expenses').id)])
    const prepared = asPrepared(
      await runTool(
        gastosActionTools,
        'preparar_pago_gasto_fijo',
        { gasto: 'Luz', caja: 'Caja Cerro' },
        as(viewing(ALTA)),
      ),
    )
    expect(documentPayload(prepared).form).toBe('quick_expense')
    expect(values(prepared)).toMatchObject({
      branchId: CERRO.id,
      recurringExpenseId: LUZ,
      treasuryAccountId: CAJA_CERRO,
    })
    expect(quickExpenseSchema.safeParse({ ...values(prepared), ...META }).success).toBe(true)
    expectBalanced(prepared, ctx)
    expect(prepared.ticket.rows[0]).toEqual({ label: 'Sucursal', value: 'Cerro' })
    expect(prepared.ticket.warnings.map((w) => w.title)).toContain(
      'Queda en Cerro, no en Alta Córdoba, que es la que estás mirando.',
    )
  })

  it('sale de una caja de su sucursal o de todo el bar: nunca de la que se mira', async () => {
    const { f } = twoBranches()
    vi.mocked(listRecurringExpenses).mockResolvedValue([fixedExpense(f.sys('misc_expenses').id)])
    const ctx = as(viewing(ALTA))
    expect(
      asError(
        await runTool(
          gastosActionTools,
          'preparar_pago_gasto_fijo',
          { gasto: 'Luz', caja: 'Caja' },
          ctx,
        ),
      ).startsWith(OTHER_BRANCH),
    ).toBe(true)
    expect(
      asError(await runTool(gastosActionTools, 'preparar_pago_gasto_fijo', { gasto: 'Luz' }, ctx)),
    ).toBe('Preguntale con qué lo pagó: Mercado Pago SAS, Banco Nación, Caja Cerro.')
    expect(
      asError(
        await runTool(
          gastosActionTools,
          'preparar_pago_gasto_fijo',
          { gasto: 'Luz', caja: 'Caja Cerro', sucursal: 'Alta Córdoba' },
          ctx,
        ),
      ),
    ).toBe('«Luz» es un gasto fijo de Cerro: se paga desde su sucursal.')
  })

  it('también como gasto o como pago con gasto_fijo: va a la sucursal del gasto fijo', async () => {
    const { f } = twoBranches()
    vi.mocked(listRecurringExpenses).mockResolvedValue([fixedExpense(f.sys('misc_expenses').id)])
    const gasto = asPrepared(
      await runTool(
        comprasActionTools,
        'preparar_gasto',
        { gasto_fijo: 'Luz', caja: 'Banco Nación' },
        as(viewing(ALTA)),
      ),
    )
    expect(values(gasto)).toMatchObject({ branchId: CERRO.id, recurringExpenseId: LUZ })
  })

  it('dos con el mismo nombre: el de la sucursal que se mira; en «Todas», pregunta cuál', async () => {
    const { f } = twoBranches()
    const account = f.sys('misc_expenses').id
    vi.mocked(listRecurringExpenses).mockResolvedValue([
      fixedExpense(account, { id: ALQUILER_ALTA, name: 'Alquiler', branchId: ALTA.id }),
      fixedExpense(account, { id: ALQUILER_CERRO, name: 'Alquiler', branchId: CERRO.id }),
    ])
    const prepared = asPrepared(
      await runTool(
        gastosActionTools,
        'preparar_pago_gasto_fijo',
        { gasto: 'Alquiler', caja: 'Banco Nación' },
        as(viewing(CERRO)),
      ),
    )
    expect(values(prepared)).toMatchObject({
      branchId: CERRO.id,
      recurringExpenseId: ALQUILER_CERRO,
    })
    expect(
      asError(
        await runTool(
          gastosActionTools,
          'preparar_pago_gasto_fijo',
          { gasto: 'Alquiler', caja: 'Banco Nación' },
          as(viewingAll()),
        ),
      ),
    ).toBe('«Alquiler» puede ser Alquiler (Alta Córdoba), Alquiler (Cerro). Preguntale cuál.')
    const told = asPrepared(
      await runTool(
        gastosActionTools,
        'preparar_pago_gasto_fijo',
        { gasto: 'Alquiler', caja: 'Banco Nación', sucursal: 'alta' },
        as(viewingAll()),
      ),
    )
    expect(values(told)).toMatchObject({ branchId: ALTA.id, recurringExpenseId: ALQUILER_ALTA })
  })
})
