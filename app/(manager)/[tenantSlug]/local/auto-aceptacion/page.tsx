import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getTenantConfig } from '@/lib/admin/tenant-config'
import { requireFeature } from '@/lib/platform/guards'
import { requireTenantAccess } from '@/lib/tenant'
import { AutoAcceptForm } from './_components/auto-accept-form'

export const metadata = { title: 'Auto-aceptación' }

export default async function AutoAcceptPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch {
    notFound()
  }
  if (access.role !== 'owner') notFound()
  await requireFeature(access.tenant, 'auto_accept')

  const config = await getTenantConfig(tenantSlug)
  if (!config) notFound()

  return (
    <PageShell width="compact">
      <PageHeader
        eyebrow="Salón"
        title="Auto-aceptación de comandas"
        description="Configurá si las comandas del comensal van directo a cocina o esperan al mozo."
      />
      <AutoAcceptForm tenantSlug={tenantSlug} initialConfig={config} />
    </PageShell>
  )
}
