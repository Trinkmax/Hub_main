import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { resolveEarnRate } from '@/lib/points/earn-rate'
import { listRules } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import { AwardScreen } from './_components/award-screen'

export const metadata = { title: 'Acreditar puntos' }

export default async function AcreditarPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  try {
    const { tenant, role } = await requireTenantAccess(tenantSlug)
    requireRole(role, REDEMPTION_STAFF_ROLES)
    tenantId = tenant.id
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  // Misma tasa que ve el mozo en el salón: el preview de puntos sale de la
  // config real del tenant, no de un número escrito a mano.
  const earnRate = resolveEarnRate(await listRules({ tenantId }))

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Cajero"
        title="Acreditar puntos"
        description="Un escáner para todo: QR del socio para acreditar y sellar, QR de canje para entregarlo."
      />
      <AwardScreen tenantSlug={tenantSlug} earnRate={earnRate} />
    </div>
  )
}
