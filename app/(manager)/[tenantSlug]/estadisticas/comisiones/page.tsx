import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
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

function monthRange(monthStr?: string): { from: string; to: string; label: string } {
  const now = new Date()
  let y = now.getFullYear()
  let m = now.getMonth() + 1
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    const [yy, mm] = monthStr.split('-').map(Number)
    if (yy) y = yy
    if (mm) m = mm
  }
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const label = new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
  return { from, to, label }
}

export default async function ComisionesStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const monthStr = typeof sp.month === 'string' ? sp.month : undefined

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const { from, to, label } = monthRange(monthStr)
  const summary = await listCommissionSummary({ tenantId: access.tenant.id, from, to })

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
        description={`Liquidación de ${label}`}
      />
      <CommissionsDashboard
        tenantSlug={tenantSlug}
        currentYM={monthStr ?? new Date().toISOString().slice(0, 7)}
        from={from}
        to={to}
        summary={summary}
      />
    </div>
  )
}
