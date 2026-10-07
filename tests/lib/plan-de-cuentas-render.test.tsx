// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ChartAccount } from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/tree'
import { chartLevel, chartParentCode, STANDARD_CHART } from '@/lib/accounting/chart'

/**
 * Primer paint (SSR) del plan de cuentas configurable: el árbol con el plan estándar de 5 niveles,
 * «Cuentas del sistema» e «Importar plan», para el dueño y para la contadora. La interacción
 * (hoja, mover, desactivar, importar) queda para el smoke manual.
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

const BASE = '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas'

function standardPlan(): ChartAccount[] {
  const ids = new Map(
    STANDARD_CHART.map((a, i) => [
      a.code,
      `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    ]),
  )
  return STANDARD_CHART.map((a) => {
    const parentCode = chartParentCode(a.code)
    return {
      id: ids.get(a.code) ?? '',
      code: a.code,
      name: a.name,
      type: a.type,
      normalSide: a.normalSide,
      parentId: parentCode ? (ids.get(parentCode) ?? null) : null,
      level: chartLevel(a.code),
      postable: a.postable,
      active: true,
      systemKey: a.systemKey,
      requiresParty: a.requiresParty,
      isTreasury: false,
      purchaseSelectable: a.purchaseSelectable,
      manualSelectable: true,
      description: a.description,
      balanceCents: null,
      hasChildren: false,
      updatedAt: '2026-10-07T12:00:00.000+00:00',
    }
  })
}

async function renderWorkspace(child: 'tree' | 'system', readOnly: boolean): Promise<string> {
  const { ChartWorkspace } = await import(`${BASE}/_components/chart-workspace`)
  const { ChartTree } = await import(`${BASE}/_components/chart-tree`)
  const { SystemAccounts } = await import(`${BASE}/_components/system-accounts`)
  const { NewAccountButton } = await import(`${BASE}/_components/new-account-button`)
  return renderToString(
    createElement(
      ChartWorkspace,
      {
        tenantSlug: 'hub',
        accounts: standardPlan(),
        readOnly,
        canAdmin: !readOnly,
        balancesAvailable: false,
        initialAccountId: null,
      },
      createElement(NewAccountButton),
      createElement(child === 'tree' ? ChartTree : SystemAccounts),
    ),
  )
}

describe('plan de cuentas (SSR)', () => {
  it('el árbol: principales abiertas, insignias del sistema y los niveles 1 a 5', async () => {
    const html = await renderWorkspace('tree', false)
    expect(html).toContain('1.0.00.00.000')
    expect(html).toContain('RESULTADO DEL EJERCICIO')
    expect(html).toContain('Activo corriente')
    expect(html).toContain('Ver hasta el nivel')
    expect(html).toContain('Ver hasta el nivel 5')
    expect(html).toContain('Nueva cuenta')
    // Las de nivel 3 todavía no se ven (están cerradas).
    expect(html).not.toContain('1.1.03.04.028')
  })

  it('la contadora: el mismo árbol, sin «Nueva cuenta»', async () => {
    const html = await renderWorkspace('tree', true)
    expect(html).toContain('1.0.00.00.000')
    expect(html).not.toContain('Nueva cuenta')
  })

  it('«Cuentas del sistema»: cada uso con su cuenta y «Usar otra cuenta»', async () => {
    const html = await renderWorkspace('system', false)
    expect(html).toContain('IVA crédito fiscal')
    expect(html).toContain('1.1.03.04.028')
    expect(html).toContain('Usar otra cuenta')
    const readOnly = await renderWorkspace('system', true)
    expect(readOnly).not.toContain('Usar otra cuenta')
  })

  it('«Importar plan»: la tarjeta para pegar', async () => {
    const { ImportForm } = await import(`${BASE}/importar/_components/import-form`)
    const html = renderToString(
      createElement(ImportForm, {
        tenantSlug: 'hub',
        plan: [{ code: '1.0.00.00.000', name: 'ACTIVO' }],
      }),
    )
    expect(html).toContain('Pegá el plan')
    expect(html).toContain('Revisar')
  })
})
