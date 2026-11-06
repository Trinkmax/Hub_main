import { ReceiveList } from '@/components/purchasing/kitchen/receive-list'
import { todayInCordoba } from '@/lib/dates'
import { requirePurchasingPage } from '@/lib/purchasing/access'
import { getCatalog, getOrders } from '@/lib/purchasing/queries'
import { PURCHASING_KITCHEN_ROLES } from '@/lib/tenant/roles'

export const metadata = { title: 'Salón · ¿Qué llegó?' }
export const dynamic = 'force-dynamic'

export default async function ReceiveListPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { tenant } = await requirePurchasingPage(tenantSlug, PURCHASING_KITCHEN_ROLES)
  const [orders, catalog] = await Promise.all([
    getOrders(tenant.id, ['sent', 'confirmed']),
    getCatalog(tenant.id),
  ])
  return (
    <ReceiveList
      slug={tenantSlug}
      today={todayInCordoba()}
      orders={orders}
      suppliers={catalog.suppliers}
      reviewerName={catalog.settings.reviewerName}
    />
  )
}
