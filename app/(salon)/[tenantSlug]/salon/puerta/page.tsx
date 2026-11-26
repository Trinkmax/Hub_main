import { notFound } from 'next/navigation'
import { DoorScreen } from '@/components/door/door-screen'
import { HoldReload } from '@/components/shell/hold-reload'
import { getBranchScope } from '@/lib/branches/scope'
import { requireRole, requireTenantAccess } from '@/lib/tenant'
import { TICKET_DOOR_ROLES } from '@/lib/tenant/roles'
import { getDoorToday } from '@/lib/ticketing/door-queries'

export const metadata = { title: 'Salón · Puerta' }
export const dynamic = 'force-dynamic'

/**
 * Validar las entradas compradas online. Acepta `?code=` porque el QR apunta a
 * /e/<código> y esa página rebota acá si quien lo abre es del equipo (escaneó con
 * la cámara del teléfono en vez de esta pantalla).
 *
 * La puerta es un lugar: la sucursal de este equipo (`getBranchScope(…, 'device')`). El cartel
 * cuenta las funciones de hoy de esa sucursal, y una entrada de otra no pasa: dice dónde es.
 */
export default async function PuertaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ code?: string }>
}) {
  const { tenantSlug } = await params
  const { code } = await searchParams

  let tenantId: string
  try {
    const { tenant, role } = await requireTenantAccess(tenantSlug)
    requireRole(role, TICKET_DOOR_ROLES)
    tenantId = tenant.id
  } catch {
    notFound()
  }

  const scope = await getBranchScope(tenantSlug, 'device')
  const branch = scope.current
  const today = await getDoorToday(tenantId, branch?.id ?? null)
  return (
    <>
      {/* La cámara prendida o una entrada en pantalla: no se recarga sola (lib/app-version). */}
      <HoldReload />
      <DoorScreen
        tenantSlug={tenantSlug}
        initialCode={code ?? null}
        today={today}
        branchId={branch?.id ?? null}
        // Con una sola sucursal no hace falta decir cuál es.
        branchName={scope.multi && branch ? branch.name : null}
      />
    </>
  )
}
