import { LayoutGrid } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import type { LiveFloorData } from '@/lib/floor-plan/queries'
import { getFloorPlan, getLiveFloor } from '@/lib/floor-plan/queries'
import { requireFeature } from '@/lib/platform/guards'
import { requireTenantAccess } from '@/lib/tenant'
import { FloorPlanEditor } from './_components/floor-plan-editor'
import { FloorPlanErrorBoundary } from './_components/floor-plan-error-boundary'
import { TablesListFallback } from './_components/tables-list-fallback'
import { ZeroAreaCta } from './_components/zero-area-cta'

export const metadata = { title: 'Plano de mesas' }

export default async function MesasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch {
    notFound()
  }

  if (access.role !== 'owner') notFound()
  await requireFeature(access.tenant, 'floor_plan')

  const tenant = access.tenant
  const data = await getFloorPlan(tenant.id)

  // Áreas para el selector de la vista En vivo (mismo orden canónico que el editor).
  // getFloorPlan ya trae exactamente esta lista (misma query, mismo orden):
  // reusarla evita el hop de listFloorAreas.
  const liveAreas = data.areas
  // Live data del área default (la primera). Si no hay áreas, no hay vista en vivo.
  // Se pasa la fila del área para que getLiveFloor no la vuelva a leer.
  const defaultArea = liveAreas[0]
  let initialLive: LiveFloorData | null = null
  if (defaultArea) {
    initialLive = await getLiveFloor(tenant.id, defaultArea.id, defaultArea)
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
    <PageShell width="wide">
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
    </PageShell>
  )
}
