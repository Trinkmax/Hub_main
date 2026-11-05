// @vitest-environment node
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountsTable } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_components/accounts-table'
import { fetchAccountMovements } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/account-movements-action'
import {
  type CajaAccountMeta,
  cajaView,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/wallet-view'
import { toastUndo } from '@/components/administracion/quick-actions'
import { authorizeAccounting } from '@/lib/accounting/access'
import { saveTreasuryAccount } from '@/lib/accounting/actions/master'
import { setTreasuryBankTax } from '@/lib/accounting/actions/taxes'
import { getSubledger } from '@/lib/accounting/queries/books'
import { AccQueryError } from '@/lib/accounting/queries/shared'
import type { TreasuryBalanceRow } from '@/lib/accounting/queries/treasury'
import { addDays, todayInCordoba } from '@/lib/dates'

/**
 * Lo de Caja que no se ve sin tocar: el «⋯» de cada cuenta, el panel en la URL y la lectura de los
 * movimientos. El menú se dibuja abierto (`DropdownMenu` del panel solo abre en el navegador) y sus
 * opciones se aprietan a mano, para fijar qué le manda cada una a la base.
 */

const CAJA = '11111111-1111-4111-8111-111111111111'
const BANCO = '22222222-2222-4222-8222-222222222222'
const STAMP = '2026-10-12T15:00:00.000+00:00'
const NEW_STAMP = '2026-10-13T15:00:00.000+00:00'

type MenuItem = {
  label: string
  role?: string
  checked?: boolean
  onSelect?: (event: { preventDefault: () => void }) => void
}

const ui = vi.hoisted(() => ({
  search: '',
  readOnly: false,
  openAction: vi.fn(),
  items: [] as MenuItem[],
  pending: [] as Array<Promise<unknown>>,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/cajas',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(ui.search),
}))
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => ({
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: false },
    readOnly: ui.readOnly,
    openAction: ui.openAction,
    closeAction: () => {},
  }),
  useAccountingOptional: () => ({ readOnly: ui.readOnly }),
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => children,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({
    children,
    role,
    onSelect,
    'aria-checked': checked,
  }: {
    children: ReactNode
    role?: string
    onSelect?: MenuItem['onSelect']
    'aria-checked'?: boolean
  }) => {
    const label = (Array.isArray(children) ? children[0] : children) as string
    ui.items.push({ label, role, checked, onSelect })
    return <div role={role ?? 'menuitem'}>{label}</div>
  },
}))
// El panel lateral se dibuja en un portal: acá alcanza con ver qué cuenta recibe.
vi.mock('@/app/(manager)/[tenantSlug]/administracion/cajas/_components/account-sheet', () => ({
  AccountSheet: ({ open, account }: { open: boolean; account: { id: string } | null }) => (
    <div data-panel={open ? (account?.id ?? 'sin cuenta') : 'cerrado'} />
  ),
}))
// Sin React de por medio: corre la acción y le pasa el resultado a quien la pidió.
vi.mock(
  '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/use-master-action',
  () => ({
    useMasterAction: () => ({
      pending: false,
      run: (
        call: () => Promise<{ ok: boolean; data?: unknown; message: string }>,
        opts: {
          onSuccess?: (data: unknown, message: string) => void
          onFailure?: (state: unknown) => void
        } = {},
      ) => {
        ui.pending.push(
          call().then((result) => {
            if (result.ok) opts.onSuccess?.(result.data, result.message)
            else opts.onFailure?.(result)
          }),
        )
      },
    }),
  }),
)
vi.mock('@/components/administracion/quick-actions', () => ({ toastUndo: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/accounting/actions/master', () => ({ saveTreasuryAccount: vi.fn() }))
vi.mock('@/lib/accounting/actions/taxes', () => ({ setTreasuryBankTax: vi.fn() }))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/accounting/queries/books', () => ({ getSubledger: vi.fn() }))

beforeEach(() => {
  ui.search = ''
  ui.readOnly = false
  ui.items = []
  ui.pending = []
  ui.openAction.mockClear()
  vi.mocked(saveTreasuryAccount).mockReset()
  vi.mocked(setTreasuryBankTax).mockReset()
  vi.mocked(toastUndo).mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

function row(over: Partial<TreasuryBalanceRow>): TreasuryBalanceRow {
  return {
    treasuryId: BANCO,
    accountId: null,
    name: 'BBVA',
    kind: 'bank',
    accountCode: '1.1.01',
    alias: null,
    bankName: null,
    allowNegative: false,
    active: true,
    balanceCents: 100_000,
    pendingWalletCents: 0,
    lastMovementDate: '2026-10-12',
    lastCheckedOn: null,
    ...over,
  }
}

function render(
  rows: TreasuryBalanceRow[],
  meta: ReadonlyMap<string, CajaAccountMeta> = new Map(
    rows.map((r) => [r.treasuryId, { updatedAt: STAMP, chargesBankTax: null }] as const),
  ),
) {
  ui.items = []
  return renderToStaticMarkup(
    <AccountsTable
      tenantSlug="hub"
      base="/hub/administracion"
      view={cajaView(
        rows,
        meta,
        { openingStatus: 'posted', booksStartDate: '2026-09-01' },
        {
          today: '2026-10-13',
          base: '/hub/administracion',
        },
      )}
      exportHref="/x"
      exportFileName="x.csv"
    />,
  )
}

const press = (label: string) => {
  const item = ui.items.find((i) => i.label === label)
  if (!item?.onSelect) throw new Error(`falta «${label}»`)
  const event = { preventDefault: vi.fn() }
  item.onSelect(event)
  return event
}
const settled = async () => {
  await Promise.all(ui.pending)
}
const labels = () => ui.items.map((i) => i.label)

describe('el «⋯» de una cuenta', () => {
  it('cambiar el nombre, transferir, el impuesto al cheque y desactivar', () => {
    render([row({})])
    expect(labels()).toEqual([
      'Cambiar el nombre',
      'Transferir a otra cuenta',
      'Cobra impuesto al cheque',
      'Desactivar',
    ])
  })

  it('al efectivo y a la tarjeta de la empresa no se les pregunta por el impuesto', () => {
    render([row({ treasuryId: CAJA, name: 'Caja', kind: 'cash' })])
    expect(labels()).not.toContain('Cobra impuesto al cheque')
    render([row({ name: 'Visa', kind: 'credit_card', balanceCents: -100 })])
    expect(labels()).not.toContain('Cobra impuesto al cheque')
  })

  it('una cuenta desactivada se vuelve a usar: no se le transfiere', () => {
    render([row({ active: false })])
    expect(labels()).toEqual(['Cambiar el nombre', 'Cobra impuesto al cheque', 'Volver a usar'])
  })

  it('sin el catálogo no se puede guardar nada, y transferir sigue andando', () => {
    render([row({})], new Map())
    expect(labels()).toEqual(['Transferir a otra cuenta'])
  })

  it('«Mover plata» no está en ningún lado', () => {
    expect(render([row({})])).not.toContain('Mover plata')
  })

  it('transferir abre la hoja de siempre con esa cuenta puesta', () => {
    render([row({})])
    press('Transferir a otra cuenta')
    expect(ui.openAction).toHaveBeenCalledWith('mover', { caja: BANCO })
  })

  it('el interruptor del impuesto: marca lo que hay, cambia en la base y el menú queda abierto', async () => {
    vi.mocked(setTreasuryBankTax).mockResolvedValue({
      ok: true,
      data: { treasuryId: BANCO, value: false },
      message: 'ok',
    })
    render([row({})])
    const item = ui.items.find((i) => i.label === 'Cobra impuesto al cheque')
    expect(item).toMatchObject({ role: 'menuitemcheckbox', checked: true })
    const event = press('Cobra impuesto al cheque')
    expect(event.preventDefault).toHaveBeenCalled()
    await settled()
    expect(setTreasuryBankTax).toHaveBeenCalledWith('hub', { treasuryId: BANCO, value: false })
  })

  it('lo que tiene marcado le gana al tipo', async () => {
    vi.mocked(setTreasuryBankTax).mockResolvedValue({
      ok: true,
      data: { treasuryId: BANCO, value: true },
      message: 'ok',
    })
    render([row({})], new Map([[BANCO, { updatedAt: STAMP, chargesBankTax: false }]]))
    expect(ui.items.find((i) => i.label === 'Cobra impuesto al cheque')?.checked).toBe(false)
    press('Cobra impuesto al cheque')
    await settled()
    expect(setTreasuryBankTax).toHaveBeenCalledWith('hub', { treasuryId: BANCO, value: true })
  })

  it('desactivar manda solo `active`, con su token, y se puede deshacer con el token nuevo', async () => {
    vi.mocked(saveTreasuryAccount).mockResolvedValue({
      ok: true,
      data: { id: BANCO, updatedAt: NEW_STAMP } as never,
      message: '«BBVA» quedó desactivada.',
    })
    render([row({})])
    press('Desactivar')
    await settled()
    expect(saveTreasuryAccount).toHaveBeenCalledWith('hub', {
      id: BANCO,
      expectedUpdatedAt: STAMP,
      name: 'BBVA',
      kind: 'bank',
      active: false,
    })
    expect(toastUndo).toHaveBeenCalledTimes(1)
    const [message, opts] = vi.mocked(toastUndo).mock.calls[0] ?? []
    expect(message).toBe('«BBVA» quedó desactivada.')
    await opts?.onUndo()
    await settled()
    expect(saveTreasuryAccount).toHaveBeenLastCalledWith('hub', {
      id: BANCO,
      expectedUpdatedAt: NEW_STAMP,
      name: 'BBVA',
      kind: 'bank',
      active: true,
    })
  })

  it('volver a usar no ofrece deshacer', async () => {
    vi.mocked(saveTreasuryAccount).mockResolvedValue({
      ok: true,
      data: { id: BANCO, updatedAt: NEW_STAMP } as never,
      message: 'Datos guardados.',
    })
    render([row({ active: false })])
    press('Volver a usar')
    await settled()
    expect(saveTreasuryAccount).toHaveBeenCalledWith(
      'hub',
      expect.objectContaining({ active: true }),
    )
    expect(toastUndo).not.toHaveBeenCalled()
  })
})

describe('el panel lateral, en la URL', () => {
  it('sin nada en la URL, cerrado', () => {
    expect(render([row({})])).toContain('data-panel="cerrado"')
  })

  it('`?cuenta=` lo abre con esa cuenta', () => {
    ui.search = `cuenta=${BANCO}`
    expect(render([row({})])).toContain(`data-panel="${BANCO}"`)
  })

  it('una cuenta que no es de esta lista no abre nada', () => {
    ui.search = `cuenta=${CAJA}`
    expect(render([row({})])).toContain('data-panel="cerrado"')
  })

  it('la contadora también lo abre', () => {
    ui.readOnly = true
    ui.search = `cuenta=${BANCO}`
    expect(render([row({})])).toContain(`data-panel="${BANCO}"`)
  })
})

describe('los movimientos del panel', () => {
  const allow = () =>
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: true,
      tenantId: 'tenant',
      userId: 'user',
      slug: 'hub',
      access: {} as never,
    })
  const page = (over: Partial<Awaited<ReturnType<typeof getSubledger>>> = {}) => ({
    rows: [],
    nextCursor: null,
    totalRows: 0,
    kind: 'treasury' as const,
    from: '2026-10-01',
    to: '2026-10-13',
    ...over,
  })

  it('pide los últimos 30 días de esa cuenta, y los da con lo más nuevo arriba', async () => {
    allow()
    vi.mocked(getSubledger).mockResolvedValue(
      page({
        rows: [
          {
            rowKind: 'line',
            documentId: 'd1',
            entryId: 'e1',
            date: '2026-10-12',
            values: {
              document_kind: 'expense',
              description: 'Gasto · Hielo',
              outflow_cents: 1_200_000,
            },
          },
          {
            rowKind: 'line',
            documentId: 'd2',
            entryId: 'e2',
            date: '2026-10-13',
            values: {
              document_kind: 'expense',
              description: 'Gasto · Flete',
              outflow_cents: 500_000,
            },
          },
        ],
      }),
    )
    const result = await fetchAccountMovements('hub', { treasuryId: BANCO, kind: 'bank' })
    const today = todayInCordoba()
    expect(getSubledger).toHaveBeenCalledWith('tenant', {
      kind: 'treasury',
      treasuryId: BANCO,
      from: addDays(today, -29),
      to: today,
      limit: 500,
    })
    expect(result.ok && result.data.movements.map((m) => m.title)).toEqual(['Flete', 'Hielo'])
    expect(result.ok && result.data.tooMany).toBe(false)
  })

  it('si hay más de lo que entra en una lectura, no muestra una lista que no es la más nueva', async () => {
    allow()
    vi.mocked(getSubledger).mockResolvedValue(page({ nextCursor: 'seguir' }))
    const result = await fetchAccountMovements('hub', { treasuryId: BANCO, kind: 'bank' })
    expect(result).toEqual({ ok: true, data: { movements: [], tooMany: true } })
  })

  it('sin acceso no lee, y devuelve el motivo', async () => {
    vi.mocked(getSubledger).mockClear()
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: false,
      state: { ok: false, code: 'forbidden', message: 'No tenés acceso.' },
    })
    const result = await fetchAccountMovements('hub', { treasuryId: BANCO, kind: 'bank' })
    expect(result).toEqual({ ok: false, code: 'forbidden', message: 'No tenés acceso.' })
    expect(getSubledger).not.toHaveBeenCalled()
  })

  it('lo que no es una cuenta no llega a la base', async () => {
    vi.mocked(getSubledger).mockClear()
    allow()
    const result = await fetchAccountMovements('hub', { treasuryId: 'cualquiera', kind: 'bank' })
    expect(result.ok).toBe(false)
    const other = await fetchAccountMovements('hub', { treasuryId: BANCO, kind: 'no existe' })
    expect(other.ok).toBe(false)
    expect(getSubledger).not.toHaveBeenCalled()
  })

  it('si la lectura falla, nunca tira: devuelve el mensaje para reintentar', async () => {
    allow()
    vi.mocked(getSubledger).mockRejectedValue(
      new AccQueryError('acc_report_subledger', 'error', 'Sin conexión.'),
    )
    const result = await fetchAccountMovements('hub', { treasuryId: BANCO, kind: 'bank' })
    expect(result).toEqual({ ok: false, code: 'error', message: 'Sin conexión.' })
  })
})
