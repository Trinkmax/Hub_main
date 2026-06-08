import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { DocsContent } from './_components/docs-content'

export const metadata = { title: 'Documentación' }

export default async function DocsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    role = access.role
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  return (
    <PageShell width="default">
      <PageHeader
        title="Documentación"
        description="Guía completa del sistema. Consultala cuando tengas dudas."
      />
      <DocsContent tenantSlug={tenantSlug} role={role} />
    </PageShell>
  )
}
