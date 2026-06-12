import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { requireFeature } from '@/lib/platform/guards'
import { requireTenantAccess } from '@/lib/tenant'
import { listKitchenQueue, listTicketItemsForTickets } from '@/lib/tickets/queries'
import { KdsScreen } from './_components/kds-screen'

export const metadata = { title: 'Salón · Cocina' }
export const dynamic = 'force-dynamic'

export default async function SalonCocinaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch {
    notFound()
  }

  const tenantId = access.tenant.id
  const role = access.role
  if (!['kitchen', 'owner', 'cashier'].includes(role)) notFound()
  await requireFeature(access.tenant, 'kitchen')

  const tickets = await listKitchenQueue(tenantId)
  const items = await listTicketItemsForTickets(tickets.map((t) => t.id))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salón"
        title="Cocina"
        description="Tickets activos en orden de antigüedad."
      />
      <KdsScreen
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        initialTickets={tickets}
        initialItems={items}
      />
    </div>
  )
}
