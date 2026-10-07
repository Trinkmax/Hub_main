import { notFound } from 'next/navigation'
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
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Club de beneficios
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Simular wallet</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Probá la tarjeta del socio en todos sus estados —puntos, niveles, vencimientos y canjes—
          sin tocar datos reales. Usa la configuración real de niveles, beneficios y catálogo de tu
          club.
        </p>
      </div>
      <WalletSimulator config={config} />
    </div>
  )
}
