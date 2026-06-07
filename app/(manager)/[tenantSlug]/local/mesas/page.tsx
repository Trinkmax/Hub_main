import { LayoutGrid } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import type { LiveFloorData } from '@/lib/floor-plan/queries'
import { getFloorPlan, getLiveFloor, listFloorAreas } from '@/lib/floor-plan/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { FloorPlanEditor } from './_components/floor-plan-editor'
import { FloorPlanErrorBoundary } from './_components/floor-plan-error-boundary'
import { TablesListFallback } from './_components/tables-list-fallback'
import { ZeroAreaCta } from './_components/zero-area-cta'

export const metadata = { title: 'Plano de mesas' }

export default async function MesasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let tenant: { id: string; name: string }
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenant = access.tenant
    role = access.role
  } catch {
    notFound()
  }

  if (role !== 'owner') notFound()

  const data = await getFloorPlan(tenant.id)

  // Áreas para el selector de la vista En vivo (mismo orden canónico que el editor).
  const liveAreas = await listFloorAreas(tenant.id)
  // Live data del área default (la primera). Si no hay áreas, no hay vista en vivo.
  const defaultAreaId = liveAreas[0]?.id ?? null
  let initialLive: LiveFloorData | null = null
  if (defaultAreaId) {
    initialLive = await getLiveFloor(tenant.id, defaultAreaId)
  }

  // Para el fallback accesible (datos planos serializables): mesas ubicadas
  // (elementos kind='table') + mesas no ubicadas (bandeja).
  const fallbackTables = [
    ...data.elements
      .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
      .map((el) => ({
        id: el.physical_table_id as string,
        label: el.table?.label ?? el.label ?? '',
        capacity: el.table?.capacity ?? null,
        qr_token: el.table?.qr_token ?? '',
        active: el.table?.active ?? true,
      })),
    ...data.unplacedTables.map((t) => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      qr_token: t.qr_token,
      active: true,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'es'))

  return (
    <main className="space-y-6 py-6">
      <PageHeader
        title="Plano de mesas"
        description="Dibujá la distribución real del local: arrastrá elementos desde la paleta al lienzo, reubicalos y gestioná cada QR. Cambiá a En vivo para ver el estado de cada mesa."
      />

      {data.areas.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Todavía no hay áreas"
          description="Creá la primera área (un piso o salón) para empezar a ubicar mesas en el plano."
          action={<ZeroAreaCta slug={tenantSlug} />}
        />
      ) : (
        <FloorPlanErrorBoundary
          fallback={<TablesListFallback slug={tenantSlug} tables={fallbackTables} />}
        >
          <FloorPlanEditor
            slug={tenantSlug}
            tenantId={tenant.id}
            initial={data}
            liveAreas={liveAreas}
            initialLive={initialLive}
          />
        </FloorPlanErrorBoundary>
      )}
    </main>
  )
}
