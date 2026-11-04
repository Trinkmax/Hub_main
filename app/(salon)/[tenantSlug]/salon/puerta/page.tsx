import { notFound } from 'next/navigation'
import { DoorScreen } from '@/components/door/door-screen'
import { requireRole, requireTenantAccess } from '@/lib/tenant'
import { TICKET_DOOR_ROLES } from '@/lib/tenant/roles'
import { getDoorToday } from '@/lib/ticketing/door-queries'

export const metadata = { title: 'Salón · Puerta' }
export const dynamic = 'force-dynamic'

/**
 * Validar las entradas compradas online. Acepta `?code=` porque el QR apunta a
 * /e/<código> y esa página rebota acá si quien lo abre es del equipo (escaneó con
 * la cámara del teléfono en vez de esta pantalla).
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

  const today = await getDoorToday(tenantId)
  return <DoorScreen tenantSlug={tenantSlug} initialCode={code ?? null} today={today} />
}
