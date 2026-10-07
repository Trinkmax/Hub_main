import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getAppUrl } from '@/lib/app-url'
import { getOrCreateCanonicalCaptureLink } from '@/lib/capture/canonical'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { QrCard } from './_components/qr-card'

export const metadata = { title: 'QR de la carta y del club' }

export default async function CapturaConfigPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  // Garantiza que exista el link de captura canónico que usa el formulario del club.
  await getOrCreateCanonicalCaptureLink({
    tenantId: access.tenant.id,
    tenantSlug,
  })

  const appUrl = await getAppUrl()
  const cartaUrl = `${appUrl}/carta/${tenantSlug}`
  const clubUrl = `${cartaUrl}?club=1`

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Tu local"
        title="QR de la carta y del club"
        description="Dos QRs, nada más. La carta para las mesas, y el del club que el mozo muestra al cerrar la cuenta para invitar a sumarse."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <QrCard
          title="Carta"
          description="Pegalo en las mesas. Tus clientes ven la carta completa, sin descargar nada ni loguearse."
          url={cartaUrl}
          downloadName={`qr-carta-${tenantSlug}.png`}
          printHref={`/print/carta/${tenantSlug}`}
        />
        <QrCard
          title="Club de beneficios"
          description="El mozo lo muestra al cerrar la cuenta. Abre la carta con el formulario del club listo para sumar al cliente."
          url={clubUrl}
          downloadName={`qr-club-${tenantSlug}.png`}
        />
      </div>
    </div>
  )
}
