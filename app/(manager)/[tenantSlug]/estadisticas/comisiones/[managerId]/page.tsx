import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { resolveCommissionPeriod } from '@/lib/commissions/period'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { listCommissionBreakdown, listManagers } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ManagerCommissionsBreakdown } from './_components/manager-breakdown'

export const metadata = { title: 'Comisiones del gestor' }
export const dynamic = 'force-dynamic'

export default async function ManagerCommissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; managerId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, managerId } = await params
  const sp = await searchParams
  // El calendario del bar, resuelto una sola vez y compartido con el breakdown:
  // es el mismo "hoy" con el que el server topea qué se puede liquidar, así que
  // la pantalla no puede quedar contando un día distinto.
  const today = todayInCordoba()
  // Mismo resolvedor que la liquidación: el detalle tiene que abarcar
  // exactamente el rango del que se viene, porque desde acá se marca el pago.
  const period = resolveCommissionPeriod(
    {
      from: typeof sp.from === 'string' ? sp.from : undefined,
      to: typeof sp.to === 'string' ? sp.to : undefined,
      month: typeof sp.month === 'string' ? sp.month : undefined,
    },
    today,
  )

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const [breakdown, managers] = await Promise.all([
    listCommissionBreakdown({
      tenantId: access.tenant.id,
      managerId,
      from: period.from,
      to: period.to,
    }),
    listManagers({ tenantId: access.tenant.id, onlyActive: false }),
  ])
  const manager = managers.find((m) => m.id === managerId)
  if (!manager) notFound()

  return (
    <PageShell width="comfortable">
      <PageHeader
        // Vuelve a la liquidación con el MISMO rango: si volviera al mes
        // calendario, el dueño perdería el período que estaba revisando.
        back={{
          href: `/${tenantSlug}/estadisticas/comisiones?from=${period.from}&to=${period.to}`,
          label: 'Liquidación',
        }}
        title={manager.display_name}
        description={`Comisiones de ${period.label}`}
      />
      <ManagerCommissionsBreakdown
        tenantSlug={tenantSlug}
        managerId={managerId}
        period={period}
        entries={breakdown.entries}
        truncated={breakdown.truncated}
        today={today}
      />
    </PageShell>
  )
}
