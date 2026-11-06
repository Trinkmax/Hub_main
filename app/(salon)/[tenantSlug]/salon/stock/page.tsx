import { KitchenHome } from '@/components/purchasing/kitchen/kitchen-home'
import { requirePurchasingPage, viewerFirstName } from '@/lib/purchasing/access'
import { getKitchenHome } from '@/lib/purchasing/queries'
import { PURCHASING_KITCHEN_ROLES } from '@/lib/tenant/roles'

export const metadata = { title: 'Salón · Stock' }
export const dynamic = 'force-dynamic'

/** Compras en el celular de la cocina: recibir lo que llega, contar el stock y los eventos de la semana. */
export default async function StockPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params
  const { tenant } = await requirePurchasingPage(tenantSlug, PURCHASING_KITCHEN_ROLES)
  const [data, firstName] = await Promise.all([getKitchenHome(tenant.id), viewerFirstName()])
  return <KitchenHome slug={tenantSlug} data={data} firstName={firstName} />
}
