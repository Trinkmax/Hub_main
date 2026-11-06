import { OrdersPanel } from '@/components/purchasing/panel/orders-panel'
import { requirePurchasingPage } from '@/lib/purchasing/access'
import { getPanelData } from '@/lib/purchasing/queries'
import { PURCHASING_MANAGE_ROLES } from '@/lib/tenant/roles'

export const metadata = { title: 'Compras · Pedidos' }
// Lo mueven varios a la vez (la cocina manda, un socio aprueba): nunca una versión cacheada.
export const dynamic = 'force-dynamic'

export default async function ComprasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params
  const { tenant } = await requirePurchasingPage(tenantSlug, PURCHASING_MANAGE_ROLES)
  const data = await getPanelData(tenant.id)
  return <OrdersPanel slug={tenantSlug} tenantName={tenant.name} data={data} />
}
