import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { listActiveMenu } from '@/lib/menu/queries'
import { listRules } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CloseTableWizard } from './_components/wizard'

export const metadata = { title: 'Cerrar mesa' }

export default async function NuevaVisitaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'cashier'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [menu, rules] = await Promise.all([
    listActiveMenu({ tenantId: access.tenant.id }),
    listRules({ tenantId: access.tenant.id }),
  ])

  return (
    <PageShell width="comfortable">
      <PageHeader
        back={{ href: `/${tenantSlug}`, label: 'Resumen' }}
        title="Cerrar mesa"
        description="Identificá al cliente, cargá lo que consumió y dale los puntos en pocos toques."
      />
      <CloseTableWizard
        tenantSlug={tenantSlug}
        categories={menu.categories}
        items={menu.items}
        rules={rules}
      />
    </PageShell>
  )
}
