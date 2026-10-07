import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getAudience, getAudienceBuilderOptions } from '@/lib/audiences/queries'
import type { AudienceFilter } from '@/lib/audiences/schemas'
import { formatNumber } from '@/lib/format/number-kind'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { AudienceForm } from '../_components/audience-form'

export const metadata = { title: 'Editar audiencia' }
export const dynamic = 'force-dynamic'

export default async function EditAudiencePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [audience, options] = await Promise.all([
    getAudience(access.tenant.id, id),
    getAudienceBuilderOptions(access.tenant.id),
  ])
  if (!audience) notFound()

  const listHref = `/${tenantSlug}/mensajeria/audiencias`
  const count = audience.customer_count_cached

  return (
    <PageShell width="compact">
      <PageHeader
        back={{ href: listHref, label: 'Audiencias' }}
        title="Editar audiencia"
        description={`${formatNumber(count)} ${
          count === 1 ? 'cliente' : 'clientes'
        } en el último conteo. Si cambiás las condiciones, el número se actualiza solo.`}
      />
      <AudienceForm
        tenantSlug={tenantSlug}
        options={options}
        audienceId={audience.id}
        initialName={audience.name}
        initialFilters={audience.filters as unknown as AudienceFilter}
        cancelHref={listHref}
      />
    </PageShell>
  )
}
