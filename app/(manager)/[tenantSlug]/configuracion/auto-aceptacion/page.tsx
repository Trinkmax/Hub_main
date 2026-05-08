import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { getTenantConfig } from '@/lib/admin/tenant-config'
import { requireTenantAccess } from '@/lib/tenant'
import { AutoAcceptForm } from './_components/auto-accept-form'

export const metadata = { title: 'Auto-aceptación' }

export default async function AutoAcceptPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    role = access.role
  } catch {
    notFound()
  }
  if (role !== 'owner') notFound()

  const config = await getTenantConfig(tenantSlug)
  if (!config) notFound()

  return (
    <main className="space-y-6 py-6">
      <PageHeader
        title="Auto-aceptación de comandas"
        description="Configurá si las comandas del comensal van directo a cocina o esperan al mozo."
      />
      <Section>
        <AutoAcceptForm tenantSlug={tenantSlug} initialConfig={config} />
      </Section>
    </main>
  )
}
