import { notFound, redirect } from 'next/navigation'
import { isFeatureEnabled } from '@/lib/platform/features'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'

export default async function SalonRootPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  // Con servicio de mesa ON → grilla de mesas (bares que operan comandas).
  if (isFeatureEnabled(access.tenant, 'table_service')) {
    redirect(`/${tenantSlug}/salon/mesas`)
  }
  // Producto loyalty-first: lo que más hace el staff en el turno es escanear el
  // QR del socio para acreditarle el consumo. Ese es el home.
  if (REDEMPTION_STAFF_ROLES.includes(access.role)) {
    redirect(`/${tenantSlug}/salon/escanear`)
  }
  redirect(`/${tenantSlug}/salon/reservas-operativo`)
}
