import { Ticket } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getAppUrl } from '@/lib/app-url'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { getAdminOverview, getTicketingSettings, listActiveManagers } from '@/lib/ticketing/queries'
import { CarteleraCard } from './_components/cartelera-card'
import { ExperiencesSection } from './_components/experiences-section'
import { MercadoPagoCard } from './_components/mercado-pago-card'
import { SettingsSection } from './_components/settings-section'
import { carteleraSummary, latestPrices } from './_lib/overview'

export const metadata = { title: 'Entradas online' }

// Lugares, ventas y la cuenta de Mercado Pago: todo cambia solo, nada que prerenderizar.
export const dynamic = 'force-dynamic'

export default async function EntradasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    // Es la vidriera pública del bar y es plata: solo el dueño (la RLS dice lo mismo).
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const tenantId = access.tenant.id
  const [overview, settings, managers, appUrl] = await Promise.all([
    getAdminOverview(tenantId),
    getTicketingSettings(tenantId),
    listActiveManagers(tenantId),
    getAppUrl(),
  ])

  const publicUrl = `${appUrl}/entradas/${tenantSlug}`
  const webhookUrl = `${appUrl}/api/webhooks/mercadopago?t=${tenantId}`
  const canSell = Boolean(settings.mp_connected_at)

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Marketing"
        title="Entradas online"
        description="Vendé las funciones con pago por Mercado Pago: cuando alguien paga, la reserva se carga sola."
        actions={
          // Las ventas tienen su propia sección (06/11/2026): ahí también entra la anfitriona.
          <Button asChild variant="outline" className="h-11 sm:h-9">
            <Link href={`/${tenantSlug}/ventas-online`}>
              <Ticket className="size-4" aria-hidden />
              Ver ventas online
            </Link>
          </Button>
        }
      />

      <CarteleraCard
        publicUrl={publicUrl}
        summary={carteleraSummary(overview.experiences)}
        canSell={canSell}
      />

      <MercadoPagoCard
        tenantSlug={tenantSlug}
        account={{
          mp_user_id: settings.mp_user_id,
          mp_nickname: settings.mp_nickname,
          mp_live: settings.mp_live,
          mp_connected_at: settings.mp_connected_at,
        }}
        webhookUrl={webhookUrl}
      />

      <ExperiencesSection
        tenantSlug={tenantSlug}
        experiences={overview.experiences}
        availableTemplates={overview.availableTemplates}
        defaults={latestPrices(overview.experiences)}
      />

      <SettingsSection tenantSlug={tenantSlug} settings={settings} managers={managers} />
    </PageShell>
  )
}
