import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getSessionForWaiter } from '@/lib/sessions-waiter/queries'
import { requireTenantAccess } from '@/lib/tenant'
import {
  getKitchenFlowEnabled,
  listTicketItemsForTickets,
  listTicketsForSession,
} from '@/lib/tickets/queries'
import { SessionDetail } from './_components/session-detail'

export const metadata = { title: 'Sesión' }
export const dynamic = 'force-dynamic'

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; sessionId: string }>
}) {
  const { tenantSlug, sessionId } = await params

  let role: string
  let tenantId: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    role = access.role
    tenantId = access.tenant.id
  } catch {
    notFound()
  }

  if (!['waiter', 'owner', 'cashier'].includes(role)) notFound()

  const session = await getSessionForWaiter(sessionId)
  if (!session) notFound()

  const [tickets, kitchenFlowEnabled] = await Promise.all([
    listTicketsForSession(sessionId),
    getKitchenFlowEnabled(tenantId),
  ])
  const items = await listTicketItemsForTickets(tickets.map((t) => t.id))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salón · Mesa"
        title={session.table_label ?? 'Mesa'}
        description={`Total acumulado: $${(session.total_cents / 100).toFixed(2)}`}
      />
      <SessionDetail
        tenantSlug={tenantSlug}
        session={session}
        initialTickets={tickets}
        initialItems={items}
        kitchenFlowEnabled={kitchenFlowEnabled}
      />
    </div>
  )
}
