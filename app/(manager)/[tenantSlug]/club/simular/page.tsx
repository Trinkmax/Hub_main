import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { getSimulatorConfig } from '@/lib/wallet/simulator'
import { WalletSimulator } from './_components/wallet-simulator'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Simular wallet' }

export default async function SimularPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}): Promise<React.JSX.Element> {
  const { tenantSlug } = await params

  // Owner-only: 404 si no es owner para no revelar la ruta.
  try {
    const access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const config = await getSimulatorConfig(tenantSlug)
  if (!config) notFound()

  return (
    <PageShell width="comfortable">
      <PageHeader
        back={{ href: `/${tenantSlug}/club`, label: 'Club de beneficios' }}
        title="Simular wallet"
        description="Probá la tarjeta del socio en todos sus estados (puntos, niveles, vencimientos y canjes) sin tocar datos reales. Usa la configuración real de niveles, beneficios y catálogo de tu club."
      />
      <WalletSimulator config={config} />
    </PageShell>
  )
}
