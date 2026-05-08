import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
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

  let tenantId: string
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenantId = access.tenant.id
    role = access.role
  } catch {
    notFound()
  }

  if (!['kitchen', 'owner', 'cashier'].includes(role)) notFound()

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
