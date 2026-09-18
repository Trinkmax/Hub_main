import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { resolveCommissionPeriod } from '@/lib/commissions/period'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { listCommissionSummary } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CommissionsDashboard } from './_components/commissions-dashboard'

export const metadata = { title: 'Comisiones · Liquidación' }
export const dynamic = 'force-dynamic'

export default async function ComisionesStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  // Rango libre: la liquidación de la gestora es "del 15 al 15" pero se corre.
  // `resolveCommissionPeriod` es el único lugar donde se decide el rango — acá,
  // en el detalle del gestor y en "Mis números" — y traduce solo los links
  // viejos `?month=YYYY-MM` que ya andan dando vuelta en favoritos.
  const period = resolveCommissionPeriod(
    {
      from: typeof sp.from === 'string' ? sp.from : undefined,
      to: typeof sp.to === 'string' ? sp.to : undefined,
      month: typeof sp.month === 'string' ? sp.month : undefined,
    },
    todayInCordoba(),
  )
  const summary = await listCommissionSummary({
    tenantId: access.tenant.id,
    from: period.from,
    to: period.to,
  })

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/estadisticas`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Estadísticas
          </Link>
        }
        title="Comisiones"
        description={`Liquidación de ${period.label}`}
      />
      <CommissionsDashboard
        tenantSlug={tenantSlug}
        period={period}
        summary={summary.rows}
        truncated={summary.truncated}
      />
    </div>
  )
}
