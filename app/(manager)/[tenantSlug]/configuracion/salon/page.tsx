import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getBranchScope } from '@/lib/branches/scope'
import { branchHasFloors, singleBranchSegmentScope } from '@/lib/salon/branch-scope'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { getZoneCapacityDefaults } from '@/lib/salon/queries'
import { getSegmentEditorData } from '@/lib/salon/segment-queries'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { BranchSeatsEditor } from './_components/branch-seats-editor'
import { CapacityBranchPicker } from './_components/capacity-branch-picker'
import { SegmentCapacityEditor } from './_components/segment-capacity-editor'
import { SegmentOverridesEditor } from './_components/segment-overrides-editor'
import { TotalSeatsField } from './_components/total-seats-field'
import { ZoneCapacityEditor } from './_components/zone-capacity-editor'

export const metadata = { title: 'Capacidad del salón' }
export const dynamic = 'force-dynamic'

/**
 * Configuración → Capacidad (solo owner).
 *
 * El orden de las tarjetas es el orden de importancia desde el cupo por
 * servicio: primero lo que usan el calendario, el alta de reservas y el salón
 * (cupo por servicio y especiales por fecha), después el cupo total del bar
 * (ocupación EN VIVO de las sesiones, no de reservas) y al final el cupo por
 * planta, que quedó como respaldo de los servicios sin configurar.
 *
 * Sucursales (docs/features/sucursales.md): el cupo es de un lugar, así que la
 * pantalla trabaja sobre UNA sucursal (la que se mira; en «Todas», la principal,
 * con un selector arriba). La principal tiene plantas y su respaldo es PA + PB;
 * una sucursal sin plantas tiene su «Cupo general de la sucursal» (sus sillas).
 */
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

  const tenantId = access.tenant.id
  // «Hoy» del bar, no del server: la lista de especiales arranca acá y el
  // alta no deja cargar fechas anteriores.
  const today = todayInCordoba()

  // La sucursal del cupo: la que se mira; mirando «Todas», la principal.
  const branchScope = await getBranchScope(tenantSlug)
  const branch =
    branchScope.current ??
    branchScope.branches.find((b) => b.isDefault) ??
    branchScope.branches[0] ??
    null
  // Sin sucursales (un bar que todavía no las tiene) vale como siempre: con plantas.
  const hasFloors = branch ? branchHasFloors(branch) : true

  const supabase = await createClient()
  // Lecturas independientes: un solo hop. total_seats se agrega en la migración
  // 20260527 — cast hasta regenerar types.
  const [{ data: tenantRow }, defaults, segmentData] = await Promise.all([
    supabase.from('tenants').select('total_seats').eq('id', tenantId).maybeSingle(),
    getZoneCapacityDefaults({ tenantId }),
    getSegmentEditorData({
      tenantId,
      today,
      scope: branch ? singleBranchSegmentScope(branch) : undefined,
    }),
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
        description="Cuántas personas entran en cada servicio, día por día. El calendario, el alta de reservas y el salón usan estos números."
      />
      {branch && branchScope.multi ? <CapacityBranchPicker branchId={branch.id} /> : null}
      {/* `key`: otra sucursal es otra grilla (el estado de los editores no se arrastra). */}
      <SegmentCapacityEditor
        key={`grilla-${branch?.id ?? 'bar'}`}
        tenantSlug={tenantSlug}
        branchId={branch?.id ?? null}
        weekly={segmentData.weekly}
        settings={segmentData.settings}
        fallbackTotal={segmentData.fallbackTotal}
      />
      <SegmentOverridesEditor
        key={`especiales-${branch?.id ?? 'bar'}`}
        tenantSlug={tenantSlug}
        branchId={branch?.id ?? null}
        today={today}
        initialOverrides={segmentData.overrides}
        weekly={segmentData.weekly}
        fallbackTotal={segmentData.fallbackTotal}
      />
      <TotalSeatsField tenantSlug={tenantSlug} initialTotalSeats={totalSeats} />
      {hasFloors ? (
        <ZoneCapacityEditor tenantSlug={tenantSlug} defaults={defaults} />
      ) : branch ? (
        <BranchSeatsEditor
          key={`sillas-${branch.id}`}
          tenantSlug={tenantSlug}
          branchId={branch.id}
          branchName={branch.name}
          initialSeats={branch.seatCapacity}
        />
      ) : null}
    </div>
  )
}
