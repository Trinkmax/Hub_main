import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import type { LiveFloorData } from '@/lib/floor-plan/queries'
import { getLiveFloor, listFloorAreas } from '@/lib/floor-plan/queries'
import { getSalonOccupancy, listSalonTables } from '@/lib/sessions-waiter/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { SalonView } from './_components/salon-view'

export const metadata = { title: 'Salón · Mesas' }
export const dynamic = 'force-dynamic'

export default async function SalonMesasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenantId = access.tenant.id
    role = access.role
  } catch {
    notFound()
  }

  if (!['waiter', 'owner', 'cashier'].includes(role)) notFound()

  const [tables, occupancy, liveAreas] = await Promise.all([
    listSalonTables(tenantId),
    getSalonOccupancy(tenantId),
    listFloorAreas(tenantId),
  ])

  // Live data del área default para la pestaña Plano (null si el salón no tiene áreas).
  const defaultAreaId = liveAreas[0]?.id ?? null
  let initialLive: LiveFloorData | null = null
  if (defaultAreaId) {
    initialLive = await getLiveFloor(tenantId, defaultAreaId)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salón"
        title="Mesas"
        description="Escaneá el QR al sentar a un grupo, o tocá una mesa libre para activarla."
      />
      <SalonView
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        initialTables={tables}
        initialOccupancy={occupancy}
        liveAreas={liveAreas}
        initialLive={initialLive}
      />
    </div>
  )
}
