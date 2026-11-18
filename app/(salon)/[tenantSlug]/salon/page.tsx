import { notFound, redirect } from 'next/navigation'
import { isFeatureEnabled } from '@/lib/platform/features'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { POS_FLOOR_ROLES, REDEMPTION_STAFF_ROLES, SALON_READ_ROLES } from '@/lib/tenant/roles'

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

  // Con el punto de venta prendido, el inicio del salón es el mapa en vivo; la cocina entra a su pantalla.
  if (isFeatureEnabled(access.tenant, 'pos')) {
    if (access.role === 'kitchen') redirect(`/${tenantSlug}/salon/tele`)
    if (POS_FLOOR_ROLES.includes(access.role)) redirect(`/${tenantSlug}/salon/mapa`)
  }
  // Sin punto de venta: lo que más hace el staff en el turno es escanear el
  // QR del socio para acreditarle el consumo. Ese es el home.
  if (REDEMPTION_STAFF_ROLES.includes(access.role)) {
    redirect(`/${tenantSlug}/salon/escanear`)
  }
  // La cocina no ve las reservas: sin punto de venta, lo suyo es el stock (Compras).
  if (access.role === 'kitchen' && isFeatureEnabled(access.tenant, 'purchasing')) {
    redirect(`/${tenantSlug}/salon/stock`)
  }
  if (!SALON_READ_ROLES.includes(access.role)) notFound()
  redirect(`/${tenantSlug}/salon/reservas-operativo`)
}
