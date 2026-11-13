import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageShell } from '@/components/ui/page-shell'
import { canUseFloorPlan, canUseTableQr } from '@/lib/floor-plan/access'
import type { PlanBranch } from '@/lib/floor-plan/branches'
import { listTables } from '@/lib/floor-plan/model'
import { getFloorPlan } from '@/lib/floor-plan/queries'
import { isFeatureEnabled } from '@/lib/platform/features'
import { getActiveBranch } from '@/lib/pos/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { FloorPlanEditor } from './_components/floor-plan-editor'
import { FloorPlanErrorBoundary } from './_components/floor-plan-error-boundary'
import { PAPEL } from './_components/papel'
import { TablesListFallback } from './_components/tables-list-fallback'

export const metadata: Metadata = { title: 'Plano del salón' }

/**
 * El editor del plano: dónde está cada mesa, la barra y las paredes de cada
 * sector, por sucursal. Lo que se dibuja acá es lo que el salón ve en su mapa.
 *
 * `?sucursal=<slug>` elige la sucursal (la elección queda en la URL); sin eso,
 * la que usa este dispositivo o la principal. Con una sola sucursal no hay
 * nada que elegir.
 */
export default async function MesasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ sucursal?: string | string[] }>
}) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams])
  const wantedBranch = typeof query.sucursal === 'string' ? query.sucursal : null

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch {
    notFound()
  }

  if (access.role !== 'owner') notFound()

  // Se abre con el interruptor del plano O con el del punto de venta (el mapa en
  // vivo del salón se dibuja acá). Los superadmins pasan siempre, igual que en
  // `requireFeature`: la regla está en `canUseFloorPlan` porque también la
  // aplican las acciones del editor.
  const tenant = access.tenant
  if (!canUseFloorPlan(tenant, access.isPlatformAdmin)) notFound()

  const { branches, active } = await getActiveBranch(tenant.id, wantedBranch)
  const data = await getFloorPlan(tenant.id, active?.id ?? null)

  const toBranch = (b: (typeof branches)[number]): PlanBranch => ({
    id: b.id,
    name: b.name,
    short_name: b.short_name,
    slug: b.slug,
    color: b.color,
    is_default: b.is_default,
  })
  const qrEnabled = canUseTableQr(tenant, access.isPlatformAdmin)

  return (
    <PageShell width="full" className="px-3 py-3 sm:px-3 sm:py-3 lg:px-3">
      {/* `pos` trae los tokens de papel y la letra; el editor es el mismo objeto en tema claro y oscuro. */}
      <div className={PAPEL}>
        <FloorPlanErrorBoundary
          fallback={
            <TablesListFallback slug={tenantSlug} tables={listTables(data)} qrEnabled={qrEnabled} />
          }
        >
          <FloorPlanEditor
            // Otra sucursal es otro plano: el editor arranca de cero (selección, deshacer, sector).
            key={active?.id ?? 'sin-sucursal'}
            slug={tenantSlug}
            tenantId={tenant.id}
            branch={active ? toBranch(active) : null}
            branches={branches.map(toBranch)}
            initial={data}
            posEnabled={isFeatureEnabled(tenant, 'pos')}
            qrEnabled={qrEnabled}
            timeZone={tenant.timezone || 'America/Argentina/Cordoba'}
          />
        </FloorPlanErrorBoundary>
      </div>
    </PageShell>
  )
}
