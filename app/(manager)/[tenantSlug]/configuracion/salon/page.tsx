import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
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
  const supabase = await createClient()
  // Lecturas independientes: un solo hop. total_seats se agrega en la migración
  // 20260527 — cast hasta regenerar types.
  const [{ data: tenantRow }, defaults, segmentData] = await Promise.all([
    supabase.from('tenants').select('total_seats').eq('id', tenantId).maybeSingle(),
    getZoneCapacityDefaults({ tenantId }),
    getSegmentEditorData({ tenantId, today }),
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
      <SegmentCapacityEditor
        tenantSlug={tenantSlug}
        weekly={segmentData.weekly}
        settings={segmentData.settings}
        fallbackTotal={segmentData.fallbackTotal}
      />
      <SegmentOverridesEditor
        tenantSlug={tenantSlug}
        today={today}
        initialOverrides={segmentData.overrides}
        weekly={segmentData.weekly}
        fallbackTotal={segmentData.fallbackTotal}
      />
      <TotalSeatsField tenantSlug={tenantSlug} initialTotalSeats={totalSeats} />
      <ZoneCapacityEditor tenantSlug={tenantSlug} defaults={defaults} />
    </div>
  )
}
