import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { AwardScreen } from './_components/award-screen'

export const metadata = { title: 'Acreditar puntos' }

export default async function AcreditarPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  try {
    const { role } = await requireTenantAccess(tenantSlug)
    requireRole(role, ['owner', 'cashier', 'waiter'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Cajero"
        title="Acreditar puntos"
        description="Escaneá el QR del cliente y cargá el monto pagado. Sin items, sin mesa."
      />
      <AwardScreen tenantSlug={tenantSlug} />
    </div>
  )
}
