import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
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
    <main className="space-y-6 py-6">
      <PageHeader
        title="Documentación"
        description="Guía completa del sistema. Consultala cuando tengas dudas."
      />
      <DocsContent tenantSlug={tenantSlug} role={role} />
    </main>
  )
}
