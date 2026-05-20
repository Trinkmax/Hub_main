import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
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
  const from = typeof sp.from === 'string' ? sp.from : `${new Date().toISOString().slice(0, 7)}-01`
  const to = typeof sp.to === 'string' ? sp.to : new Date().toISOString().slice(0, 10)

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const [entries, managers] = await Promise.all([
    listCommissionBreakdown({
      tenantId: access.tenant.id,
      managerId,
      from,
      to,
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
            href={`/${tenantSlug}/estadisticas/comisiones`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Liquidación
          </Link>
        }
        title={manager.display_name}
        description={`Detalle de comisiones del período ${from} → ${to}`}
      />
      <ManagerCommissionsBreakdown tenantSlug={tenantSlug} entries={entries} />
    </div>
  )
}
