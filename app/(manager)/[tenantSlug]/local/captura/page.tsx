import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
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
    // Dos tarjetas de QR lado a lado: 4xl, entre el ancho compacto y el cómodo.
    <PageShell width="compact" className="max-w-4xl">
      <PageHeader
        title="QR de la carta y del club"
        description="Son dos y no cambian nunca. El de la carta va en las mesas; el del club lo muestra el mozo al cerrar la cuenta para invitar a sumarse."
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <QrCard
          title="Carta"
          description="Pegalo en las mesas. Tus clientes ven la carta completa, sin descargar nada ni registrarse."
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
    </PageShell>
  )
}
