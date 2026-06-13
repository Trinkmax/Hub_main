import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getReviewSettings } from '@/lib/reviews/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ReviewSettingsForm } from './_components/review-settings-form'

export const metadata = { title: 'Reseñas' }

export default async function ResenasSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  // Owner-only: 404 si no tiene permiso (no exponemos la ruta).
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const settings = await getReviewSettings(access.tenant.id)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuración"
        title="Reseñas"
        description="Definí adónde van las reseñas de tus clientes y cuántos puntos otorgás por dejar una opinión."
      />
      <ReviewSettingsForm tenantSlug={tenantSlug} settings={settings} />
    </div>
  )
}
