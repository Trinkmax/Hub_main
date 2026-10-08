// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ChartAccount } from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/tree'

/**
 * Lo que se corrigió en la pasada visual del 07/10 (plan de cuentas, puesta en marcha): el saldo en
 * cero alineado con los que llevan «D»/«A», el saldo de los grupos en el celular, los pasos del
 * asistente sin cortarse y la puesta en marcha ya hecha mandando a Ajustes.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hub/administracion/plan-de-cuentas',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/accounting/actions/master', () => ({
  saveAccount: vi.fn(),
  importAccounts: vi.fn(),
  remapSystemAccount: vi.fn(),
}))

const PLAN = '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas'
const CONFIGURAR = '@/app/(manager)/[tenantSlug]/administracion/configurar'

function account(over: Partial<ChartAccount> & Pick<ChartAccount, 'id' | 'code' | 'name'>) {
  return {
    type: 'asset',
    normalSide: 'debit',
    parentId: null,
    level: 1,
    postable: false,
    active: true,
    systemKey: null,
    requiresParty: false,
    isTreasury: false,
    purchaseSelectable: false,
    manualSelectable: true,
    description: null,
    balanceCents: 0,
    hasChildren: false,
    updatedAt: '2026-10-07T12:00:00.000+00:00',
    ...over,
  } satisfies ChartAccount
}

async function renderTree(accounts: ChartAccount[]): Promise<string> {
  const { ChartWorkspace } = await import(`${PLAN}/_components/chart-workspace`)
  const { ChartTree } = await import(`${PLAN}/_components/chart-tree`)
  return renderToString(
    createElement(
      ChartWorkspace,
      {
        tenantSlug: 'hub',
        accounts,
        readOnly: false,
        canAdmin: true,
        balancesAvailable: true,
        initialAccountId: null,
      },
      createElement(ChartTree),
    ),
  )
}

describe('plan de cuentas: saldos', () => {
  it('el cero deja el lugar de la letra (los centavos alineados) y los grupos muestran saldo en el celular', async () => {
    const html = await renderTree([
      account({
        id: '00000000-0000-4000-8000-000000000001',
        code: '1.0.00.00.000',
        name: 'ACTIVO',
        balanceCents: 1_000_000,
        hasChildren: true,
      }),
      account({
        id: '00000000-0000-4000-8000-000000000002',
        code: '2.0.00.00.000',
        name: 'PASIVO',
        type: 'liability',
        normalSide: 'credit',
        balanceCents: 0,
      }),
    ])
    // Cero: «0,00» + la «D» invisible (solo ocupa su lugar; los lectores no la leen).
    expect(html).toMatch(/0,00<span aria-hidden="true" class="invisible ml-1">D<\/span>/)
    // Los dos son grupos y los dos dicen su saldo en la línea del celular.
    expect(html.match(/Saldo /g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('puesta en marcha', () => {
  it('los pasos van en una palabra y abajo, en el celular, el nombre entero', async () => {
    const { WizardProgress } = await import(`${CONFIGURAR}/_components/wizard-progress`)
    const html = renderToString(createElement(WizardProgress, { current: 0 }))
    for (const label of ['Datos', 'Cajas', 'Saldos', 'Listo']) expect(html).toContain(label)
    expect(html).not.toContain('Saldos iniciales</p>')
    expect(html).toContain('Datos de la SAS')
  })

  it('ya configurada: lo dice y manda a Ajustes', async () => {
    const { SetupDone } = await import(`${CONFIGURAR}/_components/setup-done`)
    const html = renderToString(createElement(SetupDone, { tenantSlug: 'hub' }))
    expect(html).toContain('Administración ya está configurada.')
    expect(html).toContain('href="/hub/administracion/ajustes"')
    expect(html).toContain('Ir a Ajustes')
    expect(html).toContain('Ir al Resumen')
  })
})
