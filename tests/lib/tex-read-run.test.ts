import { beforeEach, describe, expect, it, vi } from 'vitest'

// Las herramientas corriendo de verdad, con las lecturas simuladas: qué le piden a la base y qué hacen
// con lo que no se pudo resolver. Lo que arman ya lo prueba cada `tex-read-*.test.ts`.

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  getParty: vi.fn(),
  getPartyPosition: vi.fn(),
  searchParties: vi.fn(),
  listParties: vi.fn(),
  getLedger: vi.fn(),
  getTrialBalance: vi.fn(),
  getIvaPosition: vi.fn(),
  getSalesProjection: vi.fn(),
  getPayrollReport: vi.fn(),
  listRecurringExpenses: vi.fn(),
  listRecurringPayments: vi.fn(),
  getTreasuryMovements: vi.fn(),
  listTreasuryAccounts: vi.fn(),
  listAccounts: vi.fn(),
  getWeekPlan: vi.fn(),
  loadFirstOpenDate: vi.fn(),
  getArcaVoucherCard: vi.fn(),
  getImputationFlags: vi.fn(),
  listFiscalYears: vi.fn(),
  getCashFlow: vi.fn(),
  getAccountingSettings: vi.fn(),
}))

vi.mock('@/lib/accounting/queries/documents', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/documents')>()),
  listDocuments: mocks.listDocuments,
  getDocument: mocks.getDocument,
  listRecurringExpenses: mocks.listRecurringExpenses,
}))
vi.mock('@/lib/accounting/queries/parties', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/parties')>()),
  getParty: mocks.getParty,
  getPartyPosition: mocks.getPartyPosition,
  searchParties: mocks.searchParties,
  listParties: mocks.listParties,
}))
vi.mock('@/lib/accounting/queries/books', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/books')>()),
  getLedger: mocks.getLedger,
  getTrialBalance: mocks.getTrialBalance,
  getIvaPosition: mocks.getIvaPosition,
  getImputationFlags: mocks.getImputationFlags,
}))
vi.mock('@/lib/accounting/queries/projection', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/projection')>()),
  getSalesProjection: mocks.getSalesProjection,
}))
vi.mock('@/lib/accounting/queries/payroll', () => ({ getPayrollReport: mocks.getPayrollReport }))
vi.mock('@/lib/accounting/queries/recurring', () => ({
  listRecurringPayments: mocks.listRecurringPayments,
}))
vi.mock('@/lib/accounting/queries/treasury', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/treasury')>()),
  getTreasuryMovements: mocks.getTreasuryMovements,
  listTreasuryAccounts: mocks.listTreasuryAccounts,
  getCashFlow: mocks.getCashFlow,
}))
vi.mock('@/lib/accounting/queries/accounts', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/accounts')>()),
  listAccounts: mocks.listAccounts,
}))
vi.mock('@/lib/accounting/queries/week-plan', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/week-plan')>()),
  getWeekPlan: mocks.getWeekPlan,
}))
vi.mock('@/lib/accounting/queries/periods', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/periods')>()),
  listFiscalYears: mocks.listFiscalYears,
}))
vi.mock('@/lib/accounting/queries/settings', async (actual) => ({
  ...(await actual<typeof import('@/lib/accounting/queries/settings')>()),
  getAccountingSettings: mocks.getAccountingSettings,
}))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadFirstOpenDate: mocks.loadFirstOpenDate,
}))
vi.mock('@/lib/arca/emit-queries', () => ({ getArcaVoucherCard: mocks.getArcaVoucherCard }))

import { texReadTools } from '@/lib/tex/tools/read'
import type { TexToolContext } from '@/lib/tex/tools/types'

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const CTX: TexToolContext = {
  slug: 'hub',
  tenantId: 'tenant-hub',
  tenantName: 'HUB',
  userId: 'user-1',
  isAccountant: false,
  access: { read: true, write: true, admin: false },
  today: '2026-11-05',
}

function run(name: string, input: unknown, ctx: TexToolContext = CTX) {
  const tool = texReadTools.find((t) => t.name === name)
  if (!tool) throw new Error(`No existe ${name}`)
  return tool.run(tool.input.parse(input), ctx)
}

const TREASURY = { id: ID, name: 'Banco Nación', kind: 'bank', active: true }
const EMPTY_LEDGER = {
  rows: [],
  nextCursor: null,
  totalRows: 0,
  from: '2026-11-01',
  to: '2026-11-30',
  account: {
    id: ID,
    code: '5.1',
    name: 'Agua',
    normalSide: 'debit',
    postable: true,
    requiresParty: false,
  },
  periodTotals: null,
}
const EMPTY_DOCS = { rows: [], nextCursor: null, totalRows: 0, truncated: false }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listTreasuryAccounts.mockResolvedValue([TREASURY])
  mocks.listAccounts.mockResolvedValue([])
  mocks.loadFirstOpenDate.mockResolvedValue(null)
  mocks.listDocuments.mockResolvedValue(EMPTY_DOCS)
  mocks.searchParties.mockResolvedValue([])
  mocks.getCashFlow.mockResolvedValue([])
  mocks.getAccountingSettings.mockResolvedValue(null)
})

describe('el período', () => {
  it('sin decirlo, el mes en curso', async () => {
    await run('ver_flujo', {})
    expect(mocks.getCashFlow).toHaveBeenCalledWith('tenant-hub', {
      from: '2026-11-01',
      to: '2026-11-30',
    })
  })

  it('un mes que no existe vuelve con su mensaje, sin leer nada', async () => {
    expect(await run('ver_flujo', { mes: '2026-13' })).toEqual({
      kind: 'error',
      message: 'Ese mes no existe. Elegilo de nuevo.',
    })
    expect(mocks.getCashFlow).not.toHaveBeenCalled()
  })

  it('un período con mala forma ni llega a la herramienta', () => {
    const tool = texReadTools.find((t) => t.name === 'ver_flujo')
    expect(tool?.input.safeParse({ mes: 'octubre' }).success).toBe(false)
  })
})

describe('ver_movimientos_caja', () => {
  it('una caja que no se resuelve vuelve con las que hay', async () => {
    expect(await run('ver_movimientos_caja', { caja: 'la de atrás' })).toEqual({
      kind: 'error',
      message: 'No hay una caja llamada «la de atrás». Las que hay: Banco Nación.',
    })
    expect(mocks.getTreasuryMovements).not.toHaveBeenCalled()
  })

  it('por nombre, con el id que resuelve y el período', async () => {
    mocks.getTreasuryMovements.mockResolvedValue(null)
    const result = await run('ver_movimientos_caja', { caja: 'banco', mes: '2026-10' })
    expect(mocks.getTreasuryMovements).toHaveBeenCalledWith('tenant-hub', {
      treasuryId: ID,
      from: '2026-10-01',
      to: '2026-10-31',
      limit: 500,
    })
    expect(result).toEqual({ kind: 'error', message: 'Esa caja ya no está.' })
  })
})

describe('los partícipes', () => {
  const PARTY = {
    id: ID,
    name: 'Coca-Cola FEMSA SA',
    tradeName: 'Coca',
    kind: 'supplier',
    group: 'payables',
    ivaCondition: 'responsable_inscripto',
    active: true,
    paymentTermDays: 0,
    deliveryDays: [],
    commissionBp: null,
    defaultAccountId: null,
    defaultAccountName: null,
    defaultVoucherType: null,
    taxId: null,
    orderLeadDays: null,
  }
  const POSITION = {
    debtCents: 0,
    creditCents: 0,
    netCents: 0,
    group: 'payables',
    aging: { overdueCents: 0, totals: { due_soon: 0 }, nextDueDate: null },
    traffic: { text: 'Sin deuda' },
    debtItems: [],
    creditItems: [],
  }

  it('con un id se lee directo: resolver por nombre solo mira los primeros 50', async () => {
    mocks.getParty.mockResolvedValue(PARTY)
    mocks.getPartyPosition.mockResolvedValue(POSITION)
    const result = await run('ver_participe', { participe: ID })
    expect(result.kind).toBe('data')
    expect(mocks.searchParties).not.toHaveBeenCalled()
    expect(mocks.getPartyPosition).toHaveBeenCalledWith('tenant-hub', {
      partyId: ID,
      group: 'payables',
    })
  })

  it('un nombre ambiguo vuelve para que Tex pregunte', async () => {
    const option = (id: string, name: string) => ({
      id,
      name,
      tradeName: null,
      kind: 'supplier',
      taxId: null,
      ivaCondition: 'sin_datos',
      active: true,
      systemKey: null,
      paymentTermDays: 0,
      defaultAccountId: null,
    })
    mocks.searchParties.mockResolvedValue([option('a', 'Coca Córdoba'), option('b', 'Coca Sur')])
    expect(await run('ver_participe', { participe: 'coca' })).toEqual({
      kind: 'error',
      message: '«coca» puede ser Coca Córdoba, Coca Sur. Preguntale cuál.',
    })
    expect(mocks.getParty).not.toHaveBeenCalled()
  })

  it('un id que no es de este bar no se inventa', async () => {
    mocks.getParty.mockResolvedValue(null)
    expect(await run('ver_participe', { participe: ID })).toMatchObject({ kind: 'error' })
  })

  it('buscar por grupo pide solo esos tipos, y también los inactivos', async () => {
    await run('buscar_participe', { buscar: 'visa', grupo: 'clientes' })
    expect(mocks.searchParties).toHaveBeenCalledWith('tenant-hub', {
      q: 'visa',
      kinds: ['customer', 'card_processor', 'payment_wallet', 'delivery_platform'],
      includeInactive: true,
      limit: 21,
    })
  })
})

describe('buscar_comprobantes', () => {
  it('sin filtros: los vigentes del mes, con y sin factura', async () => {
    await run('buscar_comprobantes', {})
    expect(mocks.listDocuments).toHaveBeenCalledWith('tenant-hub', {
      from: '2026-11-01',
      to: '2026-11-30',
      kinds: undefined,
      partyId: null,
      invoice: 'todos',
      status: 'posted',
      q: null,
      limit: 200,
    })
  })

  it('cada filtro va a su parámetro', async () => {
    mocks.getParty.mockResolvedValue({ id: ID, name: 'Coca', tradeName: null })
    await run('buscar_comprobantes', {
      mes: '2026-10',
      tipo: 'pagos',
      participe: ID,
      factura: 'sin',
      estado: 'impagos',
      texto: 'hielo',
    })
    expect(mocks.listDocuments).toHaveBeenCalledWith('tenant-hub', {
      from: '2026-10-01',
      to: '2026-10-31',
      kinds: ['payment'],
      partyId: ID,
      invoice: 'sin',
      status: 'unpaid',
      q: 'hielo',
      limit: 200,
    })
  })

  it('un proveedor que no se resuelve corta antes de leer', async () => {
    expect(await run('buscar_comprobantes', { participe: 'nadie' })).toMatchObject({
      kind: 'error',
    })
    expect(mocks.listDocuments).not.toHaveBeenCalled()
  })
})

describe('ver_comprobante', () => {
  it('uno que no está lo dice', async () => {
    mocks.getDocument.mockResolvedValue(null)
    expect(await run('ver_comprobante', { id: ID })).toEqual({
      kind: 'error',
      message: 'Ese comprobante no está.',
    })
  })

  it('si no se puede leer ARCA, sigue como la pantalla', async () => {
    mocks.getDocument.mockResolvedValue({
      id: ID,
      seq: 1,
      kind: 'sales_invoice',
      title: 'Factura B',
      status: 'posted',
      voucherType: 'factura_b',
      partyId: null,
      partyName: null,
      issueDate: '2026-11-01',
      accountingDate: '2026-11-01',
      dueDate: null,
      description: '',
      notes: null,
      totalCents: 100,
      openCents: null,
      paymentStatus: 'none',
      period: { id: 'p', month: '2026-11-01', kind: 'month', status: 'open' },
      lines: [],
      entry: null,
      allocations: [],
      bundleSiblings: [],
      reversedBy: null,
      replacedBy: null,
      undoUntil: '2026-01-01T00:00:00Z',
    })
    mocks.getArcaVoucherCard.mockRejectedValue(new Error('caído'))
    mocks.getImputationFlags.mockResolvedValue([])
    const result = await run('ver_comprobante', { id: ID })
    expect(result).toMatchObject({
      kind: 'data',
      data: { anular: { se_puede: true } },
    })
  })
})

describe('ver_mayor', () => {
  it('con un id no resuelve por nombre: un grupo también tiene mayor', async () => {
    mocks.getLedger.mockResolvedValue(EMPTY_LEDGER)
    const result = await run('ver_mayor', { cuenta: ID })
    expect(result.kind).toBe('data')
    expect(mocks.getLedger).toHaveBeenCalledWith(
      'tenant-hub',
      expect.objectContaining({ accountId: ID, partyId: null }),
    )
  })

  it('por nombre usa solo las cuentas imputables', async () => {
    mocks.listAccounts.mockResolvedValue([
      { id: 'grupo', code: '5', name: 'Agua', active: true, postable: false },
      { id: 'agua', code: '5.1', name: 'Agua', active: true, postable: true },
    ])
    mocks.getLedger.mockResolvedValue(EMPTY_LEDGER)
    await run('ver_mayor', { cuenta: 'agua' })
    expect(mocks.getLedger).toHaveBeenCalledWith(
      'tenant-hub',
      expect.objectContaining({ accountId: 'agua' }),
    )
  })

  it('una cuenta que no existe vuelve para buscarla', async () => {
    expect(await run('ver_mayor', { cuenta: 'nada' })).toEqual({
      kind: 'error',
      message: 'No hay una cuenta «nada». Buscala con buscar_cuenta.',
    })
    mocks.getLedger.mockResolvedValue({ ...EMPTY_LEDGER, account: null })
    expect(await run('ver_mayor', { cuenta: ID })).toEqual({
      kind: 'error',
      message: 'No hay esa cuenta. Buscala con buscar_cuenta.',
    })
  })
})

describe('ver_sumas_y_saldos', () => {
  it('un nivel fuera de rango ni llega', () => {
    const tool = texReadTools.find((t) => t.name === 'ver_sumas_y_saldos')
    expect(tool?.input.safeParse({ nivel: 9 }).success).toBe(false)
  })
})

describe('ver_gastos_fijos', () => {
  it('solo este mes o el que viene, como la pantalla', async () => {
    expect(await run('ver_gastos_fijos', { mes: '2026-09' })).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('este mes y el que viene'),
    })
    expect(mocks.listRecurringExpenses).not.toHaveBeenCalled()
  })

  it('si los sueldos no se pueden leer, la planilla sale igual y lo dice', async () => {
    mocks.listRecurringExpenses.mockResolvedValue([])
    mocks.listRecurringPayments.mockResolvedValue(new Map())
    mocks.getPayrollReport.mockRejectedValue(new Error('caído'))
    expect(await run('ver_gastos_fijos', {})).toMatchObject({
      kind: 'data',
      data: { sueldos: 'No se pudieron leer: el total no los cuenta.' },
    })
    expect(mocks.listRecurringExpenses).toHaveBeenCalledWith('tenant-hub', {
      includeInactive: true,
      today: '2026-11-05',
    })
  })
})

describe('ver_sueldos', () => {
  it('un mes que no existe no llega a la base', async () => {
    expect(await run('ver_sueldos', { mes: '2026-00' })).toEqual({
      kind: 'error',
      message: 'Ese mes no existe. Elegilo de nuevo.',
    })
    expect(mocks.getPayrollReport).not.toHaveBeenCalled()
  })
})

describe('ver_plan_semana', () => {
  it('cualquier día de la semana lleva a su lunes', async () => {
    mocks.getWeekPlan.mockResolvedValue([])
    await run('ver_plan_semana', { semana: '2026-11-05' })
    expect(mocks.getWeekPlan).toHaveBeenCalledWith('tenant-hub', '2026-11-02')
    await run('ver_plan_semana', {})
    expect(mocks.getWeekPlan).toHaveBeenLastCalledWith('tenant-hub', '2026-11-02')
  })
})

describe('ver_proyeccion', () => {
  it('el mes pedido entero', async () => {
    mocks.getSalesProjection.mockResolvedValue([])
    await run('ver_proyeccion', { mes: '2026-10', resumen: true })
    expect(mocks.getSalesProjection).toHaveBeenCalledWith('tenant-hub', {
      from: '2026-10-01',
      to: '2026-10-31',
    })
  })
})

describe('ver_estado_de_meses', () => {
  it('un mes sin libros lo dice en vez de pedir el cierre de un mes que no existe', async () => {
    mocks.listFiscalYears.mockResolvedValue([
      {
        id: 'fy',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'open',
        periods: [],
      },
    ])
    mocks.getAccountingSettings.mockResolvedValue({
      booksStartDate: '2026-10-12',
      openingStatus: 'posted',
      cuit: null,
    })
    expect(await run('ver_estado_de_meses', { mes: '2026-05' })).toMatchObject({
      kind: 'data',
      data: {
        ejercicio: { desde: '01/01/2026', hasta: '31/12/2026', estado: 'Abierto' },
        mes_mirado: {
          mes: '2026-05',
          estado: 'Mayo 2026 no tiene libros: Administración arranca el 12/10/2026.',
        },
      },
    })
  })

  it('un mes cerrado dice cuándo, sin quién', async () => {
    mocks.listFiscalYears.mockResolvedValue([
      {
        id: 'fy',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'open',
        periods: [
          {
            id: 'oct',
            fiscalYearId: 'fy',
            kind: 'month',
            month: '2026-10-01',
            startsOn: '2026-10-01',
            endsOn: '2026-10-31',
            status: 'closed',
            closedAt: '2026-11-02T15:00:00Z',
            closedByName: 'Franco',
            entriesCount: 80,
          },
        ],
      },
    ])
    const result = await run('ver_estado_de_meses', { mes: '2026-10' })
    expect(result).toMatchObject({
      kind: 'data',
      data: {
        mes_mirado: { mes: '2026-10', estado: 'Cerrado', cerrado_el: '02/11/2026', asientos: 80 },
      },
    })
    expect(JSON.stringify(result)).not.toContain('Franco')
  })
})
