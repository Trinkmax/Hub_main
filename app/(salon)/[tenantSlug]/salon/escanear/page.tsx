import { notFound } from 'next/navigation'
import { resolveEarnRate } from '@/lib/points/earn-rate'
import { listRules } from '@/lib/points/queries'
import { requireRole, requireTenantAccess } from '@/lib/tenant'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import { ScanScreen } from './_components/scan-screen'

export const metadata = { title: 'Salón · Sumar puntos' }
export const dynamic = 'force-dynamic'

/**
 * La pantalla central del turno: escanear y acreditar.
 *
 * Acepta `?code=` porque el QR de un canje apunta a /v/<token> y esa página
 * rebota acá con el token ya cargado (staff que escanea con la cámara nativa
 * del teléfono, por ejemplo).
 *
 * La tasa de puntos se resuelve en el server y baja al cliente para poder
 * mostrar "suma N puntos" mientras el mozo tipea el monto, sin un round-trip
 * por tecla.
 */
export default async function EscanearPage({
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
    requireRole(role, REDEMPTION_STAFF_ROLES)
    tenantId = tenant.id
  } catch {
    notFound()
  }

  const earnRate = resolveEarnRate(await listRules({ tenantId }))

  return <ScanScreen tenantSlug={tenantSlug} initialCode={code ?? null} earnRate={earnRate} />
}
