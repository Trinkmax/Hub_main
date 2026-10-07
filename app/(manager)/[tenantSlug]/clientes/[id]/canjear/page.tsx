import { notFound } from 'next/navigation'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Section } from '@/components/ui/section'
import { getCustomerById } from '@/lib/customers/queries'
import { formatNumber } from '@/lib/format/number-kind'
import { listActiveRewards } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { RedeemForm } from './redeem-form'

export const metadata = { title: 'Canjear puntos' }

export default async function CanjearPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'cashier'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [customer, rewards] = await Promise.all([
    getCustomerById({ tenantId: access.tenant.id, id }),
    listActiveRewards({ tenantId: access.tenant.id }),
  ])
  if (!customer) notFound()

  const c = customer as unknown as {
    id: string
    first_name: string
    last_name: string
    points_balance: number
  }
  const fullName = `${c.first_name} ${c.last_name}`.trim() || 'Cliente sin nombre'

  return (
    <PageShell width="compact">
      <PageHeader
        back={{ href: `/${tenantSlug}/clientes/${id}`, label: fullName }}
        title="Canjear puntos"
        description="Tocá la recompensa que eligió y confirmá el descuento."
      />

      <KPIGroup columns={2}>
        <KPI label="Cliente" value={fullName} />
        <KPI
          label="Puntos disponibles"
          value={formatNumber(c.points_balance)}
          unit={c.points_balance === 1 ? 'punto' : 'puntos'}
        />
      </KPIGroup>

      <Section title="Recompensas">
        <RedeemForm
          tenantSlug={tenantSlug}
          customerId={c.id}
          customerName={fullName}
          balance={c.points_balance}
          rewards={rewards}
        />
      </Section>
    </PageShell>
  )
}
