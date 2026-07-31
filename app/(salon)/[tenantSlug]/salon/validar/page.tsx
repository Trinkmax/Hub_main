import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { requireRole, requireTenantAccess } from '@/lib/tenant'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import { ValidateScreen } from './_components/validate-screen'

export const metadata = { title: 'Salón · Validar' }
export const dynamic = 'force-dynamic'

/**
 * La pantalla del mozo: escanea y entrega. Acepta `?code=` porque el QR del
 * canje apunta a /v/<token> y esa página rebota acá con el token ya cargado
 * (staff que escanea con la cámara nativa del teléfono, por ejemplo).
 */
export default async function ValidarPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ code?: string }>
}) {
  const { tenantSlug } = await params
  const { code } = await searchParams

  try {
    const { role } = await requireTenantAccess(tenantSlug)
    requireRole(role, REDEMPTION_STAFF_ROLES)
  } catch {
    notFound()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salón"
        title="Validar"
        description="Escaneá el QR del socio: si es un canje lo entregás, si es su QR personal le sellás las tarjetas."
      />
      <ValidateScreen tenantSlug={tenantSlug} initialCode={code ?? null} />
    </div>
  )
}
