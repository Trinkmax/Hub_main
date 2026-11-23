// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Administración por sucursal, lo que solo se ve armado:
 *
 * - La tira de pago de un gasto fijo paga en la sucursal DEL GASTO FIJO (nunca en la que se mira: el 22/11 un
 *   pago hecho con el Cerro elegido quedó pagado también en Alta Córdoba) y ofrece las cajas de esa sucursal y
 *   las de todo el bar.
 * - La parte de cada sucursal en el totalizador de «Todas» sale de la misma cuenta del totalizador.
 */

const ui = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/gastos-fijos',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/administracion/accounting-provider', () => {
  const value = () => ({
    tenantSlug: 'hub',
    today: '2026-11-23',
    access: { read: true, write: true, admin: true },
    readOnly: false,
    openAction: () => {},
    closeAction: () => {},
  })
  return { useAccounting: value, useAccountingOptional: value }
})
vi.mock('@/lib/accounting/actions/documents', () => ({
  postQuickExpense: vi.fn(),
  undoDocument: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/master', () => ({ rememberRecurringSupplier: vi.fn() }))
vi.mock('@/components/administracion/foto-qr/foto-panel', () => ({ FotoQrButton: () => null }))
// Lo que arma la tira para guardar: se mira con qué sucursal y con qué caja.
vi.mock(
  '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense',
  async (original) => {
    const actual =
      await original<
        typeof import('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense')
      >()
    return {
      ...actual,
      buildQuickExpenseValues: (state: Parameters<typeof actual.buildQuickExpenseValues>[0]) => {
        ui.calls.push(state as unknown as Record<string, unknown>)
        return actual.buildQuickExpenseValues(state)
      },
    }
  },
)

import type { SheetData } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import { PayStrip } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/pay-strip'
import {
  buildSheet,
  sheetTotalsByBranch,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla'
import { sheetTotals } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import type { PayrollEmployee } from '@/lib/accounting/payroll'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { buildCoreFixture } from './accounting-core-context'

const AC_ID = '6011ae59-1a30-4119-a45b-4152b1ba10ed'
const CERRO_ID = '6380c468-cf88-495c-a0f3-85e42279a355'
const ROW_ID = '00000000-0000-4000-8000-0000000000e1'
const TODAY = '2026-11-23'

function fixture() {
  const f = buildCoreFixture()
  const account = f.sys('purchases_soft_drinks')
  const caja = f.treasury('caja')
  const mp = f.treasury('mp')
  const banco = f.treasury('banco')
  const sheetTreasury = (t: typeof caja, branchId: string | null) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    balanceCents: t.balanceCents,
    active: true,
    allowNegative: false,
    branchId,
  })
  const data: SheetData = {
    ctx: f.ctx,
    firstOpenDate: null,
    booksStartDate: '2026-01-01',
    today: TODAY,
    // La caja en efectivo es del Cerro; Mercado Pago y el banco, de todo el bar.
    treasuries: [
      sheetTreasury(caja, CERRO_ID),
      sheetTreasury(mp, null),
      sheetTreasury(banco, null),
    ],
    parties: [],
    accounts: [...f.ctx.accounts.values()].map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      postable: a.postable,
      active: a.active,
      purchaseSelectable: a.purchaseSelectable,
      requiresParty: a.requiresParty,
      isTreasury: a.isTreasury,
      systemKey: a.systemKey,
      description: a.description,
    })),
    suggestions: [],
    recurring: [
      {
        id: ROW_ID,
        name: 'Alquiler',
        branchId: AC_ID,
        partyId: null,
        accountId: account.id,
        voucherType: null,
        vatRateBp: null,
        amountCents: 50_000_000,
        // La caja de siempre es la del Cerro: pagando en Alta Córdoba no se propone.
        treasuryAccountId: caja.id,
        nextDueDate: '2026-11-25',
        pending: true,
      },
    ],
    balances: null,
    iibbJurisdictionCode: 904,
  }
  const row = {
    id: ROW_ID,
    name: 'Alquiler',
    branchId: AC_ID,
    partyId: null,
    partyName: null,
    accountId: account.id,
    accountName: account.name,
    voucherType: null,
    vatRateBp: null,
    amountCents: 50_000_000,
    frequency: 'monthly',
    dueDay: 25,
    nextDueDate: '2026-11-25',
    remindDaysBefore: 5,
    treasuryAccountId: caja.id,
    treasuryName: caja.name,
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
    updatedAt: '2026-11-01T10:00:00Z',
    monthStatus: 'pending',
    daysToDue: 2,
  } as RecurringExpenseRow
  return { f, data, row, caja, mp, banco }
}

beforeEach(() => {
  ui.calls = []
})

describe('la tira de pago de un gasto fijo', () => {
  it('paga en la sucursal del gasto fijo y con una caja de ahí o de todo el bar', () => {
    const { data, row, caja, mp, banco } = fixture()
    renderToStaticMarkup(
      <PayStrip
        row={row}
        month="2026-11"
        amountCents={50_000_000}
        onAmountRead={null}
        data={data}
        message={null}
        onRetry={() => {}}
        onCancel={() => {}}
        onPaid={() => {}}
      />,
    )
    const last = ui.calls.at(-1)
    expect(last).toMatchObject({ branchId: AC_ID, recurringExpenseId: ROW_ID })
    // La caja del Cerro (la de siempre de este gasto) no se ofrece pagando en Alta Córdoba.
    expect(last?.treasuryAccountId).not.toBe(caja.id)
    expect([mp.id, banco.id]).toContain(last?.treasuryAccountId)
  })

  it('un gasto fijo del Cerro paga en el Cerro, con su caja', () => {
    const { data, row, caja } = fixture()
    const cerroRow = { ...row, branchId: CERRO_ID }
    const cerroData = {
      ...data,
      recurring: data.recurring.map((r) => ({ ...r, branchId: CERRO_ID })),
    }
    renderToStaticMarkup(
      <PayStrip
        row={cerroRow}
        month="2026-11"
        amountCents={50_000_000}
        onAmountRead={null}
        data={cerroData}
        message={null}
        onRetry={() => {}}
        onCancel={() => {}}
        onPaid={() => {}}
      />,
    )
    expect(ui.calls.at(-1)).toMatchObject({ branchId: CERRO_ID, treasuryAccountId: caja.id })
  })
})

describe('«Todas»: la parte de cada sucursal en el totalizador', () => {
  it('suma lo de cada una con la misma cuenta del total (gastos fijos y sueldos)', () => {
    const { row } = fixture()
    const rows = [
      { ...row, id: 'a', branchId: AC_ID, amountCents: 30_000_000 },
      { ...row, id: 'c', branchId: CERRO_ID, amountCents: 20_000_000 },
    ]
    const employee = (id: string, branchId: string, salaryCents: number): PayrollEmployee => ({
      id,
      name: id,
      branchId,
      payFrequency: 'monthly',
      active: true,
      notes: null,
      salaryCents,
      advancesCents: 0,
      paidCents: 0,
      movements: [],
    })
    const employees = [employee('e1', AC_ID, 10_000_000), employee('e2', CERRO_ID, 5_000_000)]
    const split = sheetTotalsByBranch({
      branchIds: [AC_ID, CERRO_ID],
      rows,
      payments: new Map(),
      employees,
      month: '2026-11',
      today: TODAY,
    })
    expect(split.totalCents).toEqual({ [AC_ID]: 40_000_000, [CERRO_ID]: 25_000_000 })
    // Las partes suman el total de «Todas».
    const sheet = buildSheet(rows, new Map(), { month: '2026-11', today: TODAY })
    const total = sheetTotals(sheet, {
      count: 2,
      salaryCents: 15_000_000,
      advancesCents: 0,
      paidCents: 0,
      owedCents: 15_000_000,
    }).totalCents
    expect((split.totalCents[AC_ID] ?? 0) + (split.totalCents[CERRO_ID] ?? 0)).toBe(total)
  })
})
