import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getZoneCapacityDefaults, listZoneOverrides } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ZoneCapacityEditor } from './_components/zone-capacity-editor'

export const metadata = { title: 'Capacidad del salón' }
export const dynamic = 'force-dynamic'

export default async function SalonConfigPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const [defaults, overrides] = await Promise.all([
    getZoneCapacityDefaults({ tenantId: access.tenant.id }),
    listZoneOverrides({ tenantId: access.tenant.id }),
  ])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/configuracion`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Configuración
          </Link>
        }
        title="Capacidad del salón"
        description="Cupo por zona (Planta Alta, Plata Baja) + overrides puntuales por fecha. El panel operativo lo usa para mostrar las barras de capacidad."
      />
      <ZoneCapacityEditor
        tenantSlug={tenantSlug}
        defaults={defaults}
        initialOverrides={overrides}
      />
    </div>
  )
}
