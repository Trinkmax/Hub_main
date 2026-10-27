import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getAppUrl } from '@/lib/app-url'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import {
  getAdminOverview,
  getTicketingSettings,
  listActiveManagers,
  listRecentOrders,
} from '@/lib/ticketing/queries'
import { CarteleraCard } from './_components/cartelera-card'
import { ExperiencesSection } from './_components/experiences-section'
import { MercadoPagoCard } from './_components/mercado-pago-card'
import { type OrdersResult, OrdersSection } from './_components/orders-section'
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
  const [overview, settings, managers, appUrl, orders] = await Promise.all([
    getAdminOverview(tenantId),
    getTicketingSettings(tenantId),
    listActiveManagers(tenantId),
    getAppUrl(),
    // Las ventas son una tarjeta más: si fallan, el resto de la pestaña igual sirve.
    listRecentOrders(tenantId).then(
      (rows): OrdersResult => ({ ok: true, orders: rows }),
      (): OrdersResult => ({ ok: false }),
    ),
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

      <OrdersSection tenantSlug={tenantSlug} result={orders} now={new Date()} />

      <SettingsSection tenantSlug={tenantSlug} settings={settings} managers={managers} />
    </PageShell>
  )
}
