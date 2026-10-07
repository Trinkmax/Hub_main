import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { FormTemplate } from '@/components/ui/page-templates'
import { getTenantConfig } from '@/lib/admin/tenant-config'
import { requireFeature } from '@/lib/platform/guards'
import { requireTenantAccess } from '@/lib/tenant'
import { AutoAcceptForm } from './_components/auto-accept-form'
import { AUTO_ACCEPT_DESCRIPTION, AUTO_ACCEPT_TITLE } from './_components/page-copy'

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
    <FormTemplate
      header={<PageHeader title={AUTO_ACCEPT_TITLE} description={AUTO_ACCEPT_DESCRIPTION} />}
    >
      <AutoAcceptForm tenantSlug={tenantSlug} initialConfig={config} />
    </FormTemplate>
  )
}
