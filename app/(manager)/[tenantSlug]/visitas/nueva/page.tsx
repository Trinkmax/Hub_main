import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
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
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/${tenantSlug}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver al resumen
      </Link>
      <PageHeader
        eyebrow="Operación"
        title="Cerrar mesa"
        description="Identificá al cliente, cargá el consumo y otorgá los puntos en pocos toques."
      />
      <CloseTableWizard
        tenantSlug={tenantSlug}
        categories={menu.categories}
        items={menu.items}
        rules={rules}
      />
    </div>
  )
}
