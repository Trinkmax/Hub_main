import { notFound } from 'next/navigation'
import { HoldReload } from '@/components/shell/hold-reload'
import { getAppUrl } from '@/lib/app-url'
import { getCanonicalCaptureLink } from '@/lib/capture/canonical'
import { renderQrSvg } from '@/lib/qr'
import { requireRole, requireTenantAccess } from '@/lib/tenant'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import { ClubQrStage } from './_components/club-qr-stage'

export const metadata = { title: 'Salón · QR del club' }
export const dynamic = 'force-dynamic'

/**
 * El QR del club, en el bolsillo del mozo.
 *
 * Es exactamente el mismo que el dueño baja desde el Club («QR del club»):
 * `/carta/<slug>?club=1`, la carta pública con el formulario del club abierto.
 * El mozo lo necesita en su celular porque el momento en que se pide es al
 * cerrar la cuenta, y al panel del dueño no entra.
 *
 * Usa la variante read-only del link canónico: crear el link escribe con
 * `service_role`, y esto es un GET disparado desde el celular de un mozo.
 */
export default async function QrClubPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let tenant: { id: string; name: string }
  try {
    const access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, REDEMPTION_STAFF_ROLES)
    tenant = { id: access.tenant.id, name: access.tenant.name }
  } catch {
    notFound()
  }

  const [appUrl, captureLink] = await Promise.all([getAppUrl(), getCanonicalCaptureLink(tenant.id)])
  const clubUrl = `${appUrl}/carta/${tenantSlug}?club=1`
  const qrSvg = await renderQrSvg(clubUrl)

  return (
    <div className="space-y-4">
      {/* El cliente está apuntando su cámara a esta pantalla: no se recarga sola (lib/app-version). */}
      <HoldReload />
      <ClubQrStage qrSvg={qrSvg} tenantName={tenant.name} clubUrl={clubUrl} />

      {captureLink === null ? (
        <p className="rounded-xl border border-dashed border-warning/50 bg-warning/10 p-3 text-center text-xs text-muted-foreground text-balance">
          El QR funciona igual, pero el dueño todavía no activó el club (se activa solo cuando abre
          «QR del club» en su panel). Avisale.
        </p>
      ) : null}
    </div>
  )
}
