import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import type { LiveFloorData } from '@/lib/floor-plan/queries'
import { getLiveFloor, listFloorAreas } from '@/lib/floor-plan/queries'
import { requireFeature } from '@/lib/platform/guards'
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

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch {
    notFound()
  }

  const tenantId = access.tenant.id
  const role = access.role
  if (!['waiter', 'owner', 'cashier'].includes(role)) notFound()
  await requireFeature(access.tenant, 'table_service')

  // Live data del área default para la pestaña Plano (null si el salón no tiene áreas).
  // El live solo depende de las áreas: se encadena a listFloorAreas y corre en
  // paralelo con mesas/ocupación en vez de esperar a todo el Promise.all.
  // Se pasa la fila del área para que getLiveFloor no la vuelva a leer.
  const livePromise = listFloorAreas(tenantId).then(
    async (areas): Promise<{ areas: typeof areas; live: LiveFloorData | null }> => {
      const defaultArea = areas[0]
      const live = defaultArea ? await getLiveFloor(tenantId, defaultArea.id, defaultArea) : null
      return { areas, live }
    },
  )

  const [tables, occupancy, { areas: liveAreas, live: initialLive }] = await Promise.all([
    listSalonTables(tenantId),
    getSalonOccupancy(tenantId),
    livePromise,
  ])

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
