import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ReceiveScreen } from '@/components/purchasing/kitchen/receive-screen'
import { todayInCordoba } from '@/lib/dates'
import { requirePurchasingPage, viewerFirstName } from '@/lib/purchasing/access'
import { getCatalog, getOrder } from '@/lib/purchasing/queries'
import { PURCHASING_KITCHEN_ROLES } from '@/lib/tenant/roles'

export const metadata = { title: 'Salón · Recibir' }
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ReceivePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; orderId: string }>
}) {
  const { tenantSlug, orderId } = await params
  if (!UUID.test(orderId)) notFound()
  const { tenant } = await requirePurchasingPage(tenantSlug, PURCHASING_KITCHEN_ROLES)
  const [order, catalog, firstName] = await Promise.all([
    getOrder(tenant.id, orderId),
    getCatalog(tenant.id),
    viewerFirstName(),
  ])
  if (!order) notFound()
  const supplierName = order.supplierId
    ? (catalog.suppliers.find((s) => s.id === order.supplierId)?.name ?? 'Proveedor')
    : 'Sin proveedor'

  if (order.status !== 'sent' && order.status !== 'confirmed') {
    return (
      <div className="mx-auto w-full max-w-xl pt-10 text-center">
        <h1 className="font-serif text-2xl font-semibold">
          {order.status === 'draft'
            ? 'Este pedido volvió a revisión'
            : `${supplierName} ya se recibió`}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {order.status === 'draft'
            ? 'Todavía no se mandó al proveedor.'
            : order.receivedByName
              ? `Lo recibió ${order.receivedByName}.`
              : 'No hay nada más para marcar.'}
        </p>
        <Link
          href={`/${tenantSlug}/salon/stock/recibir`}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-6 font-semibold text-primary-foreground"
        >
          Ver los pedidos en camino
        </Link>
      </div>
    )
  }

  return (
    <ReceiveScreen
      slug={tenantSlug}
      today={todayInCordoba()}
      order={order}
      supplierName={supplierName}
      reviewerName={catalog.settings.reviewerName}
      defaultName={firstName}
    />
  )
}
