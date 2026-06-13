import { notFound, redirect } from 'next/navigation'
import { isFeatureEnabled } from '@/lib/platform/features'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'

export default async function SalonRootPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenant: Awaited<ReturnType<typeof requireTenantAccess>>['tenant']
  try {
    tenant = (await requireTenantAccess(tenantSlug)).tenant
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  // Con servicio de mesa ON → grilla de mesas. Si está OFF (producto loyalty-first),
  // el staff aterriza en el operativo de reservas.
  if (isFeatureEnabled(tenant, 'table_service')) {
    redirect(`/${tenantSlug}/salon/mesas`)
  }
  redirect(`/${tenantSlug}/salon/reservas-operativo`)
}
