import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getZoneCapacityDefaults, listZoneOverrides } from '@/lib/salon/queries'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { TotalSeatsField } from './_components/total-seats-field'
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

  const supabase = await createClient()
  // total_seats se agrega en la migración 20260527 — cast hasta regenerar types.
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('total_seats')
    .eq('id', access.tenant.id)
    .maybeSingle()

  const [defaults, overrides] = await Promise.all([
    getZoneCapacityDefaults({ tenantId: access.tenant.id }),
    listZoneOverrides({ tenantId: access.tenant.id }),
  ])

  const totalSeats = (tenantRow as { total_seats?: number | null } | null)?.total_seats ?? null

  return (
    <div className="space-y-6">
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
        description="Cupo total del bar (para ocupación en tiempo real) + cupo por zona y overrides puntuales (para reservas anticipadas)."
      />
      <TotalSeatsField tenantSlug={tenantSlug} initialTotalSeats={totalSeats} />
      <ZoneCapacityEditor
        tenantSlug={tenantSlug}
        defaults={defaults}
        initialOverrides={overrides}
      />
    </div>
  )
}
