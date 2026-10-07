import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getAudienceBuilderOptions } from '@/lib/audiences/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { AudienceForm } from '../_components/audience-form'

export const metadata = { title: 'Nueva audiencia' }

export default async function NewAudiencePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const options = await getAudienceBuilderOptions(access.tenant.id)
  const listHref = `/${tenantSlug}/mensajeria/audiencias`

  return (
    <PageShell width="compact">
      <PageHeader
        back={{ href: listHref, label: 'Audiencias' }}
        title="Nueva audiencia"
        description="Elegí un grupo listo o armalo a tu medida. La cantidad de clientes se calcula sola mientras lo armás."
      />
      <AudienceForm tenantSlug={tenantSlug} options={options} cancelHref={listHref} />
    </PageShell>
  )
}
