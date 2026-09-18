import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
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
  // Mismo resolvedor que la liquidación: el detalle tiene que abarcar
  // exactamente el rango del que se viene, porque desde acá se marca el pago.
  const period = resolveCommissionPeriod(
    {
      from: typeof sp.from === 'string' ? sp.from : undefined,
      to: typeof sp.to === 'string' ? sp.to : undefined,
      month: typeof sp.month === 'string' ? sp.month : undefined,
    },
    todayInCordoba(),
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
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/estadisticas/comisiones?from=${period.from}&to=${period.to}`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Liquidación
          </Link>
        }
        title={manager.display_name}
        description={`Comisiones de ${period.label}`}
      />
      <ManagerCommissionsBreakdown
        tenantSlug={tenantSlug}
        managerId={managerId}
        period={period}
        entries={breakdown.entries}
        truncated={breakdown.truncated}
      />
    </div>
  )
}
