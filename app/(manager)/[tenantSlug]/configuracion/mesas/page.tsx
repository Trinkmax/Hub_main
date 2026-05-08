import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { listPhysicalTables } from '@/lib/tables/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { NewTableDialog } from './_components/new-table-dialog'
import { TablesList } from './_components/tables-list'

export const metadata = { title: 'Mesas' }

export default async function MesasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let tenant: { id: string; name: string }
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenant = access.tenant
    role = access.role
  } catch {
    notFound()
  }

  if (role !== 'owner') notFound()

  const tables = await listPhysicalTables(tenant.id)

  return (
    <main className="space-y-6 py-6">
      <PageHeader
        title="Mesas"
        description="Gestioná las mesas físicas del bar y sus QRs."
        actions={<NewTableDialog tenantSlug={tenantSlug} />}
      />
      <Section>
        <TablesList tenantSlug={tenantSlug} tables={tables} />
      </Section>
    </main>
  )
}
