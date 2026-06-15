import { Inbox } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { listConversations } from '@/lib/bandeja/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { ConversationListMobile } from './_components/conversation-list-mobile'

export const metadata = { title: 'Salón · Bandeja' }
export const dynamic = 'force-dynamic'

export default async function SalonBandejaPage({
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

  const { rows: conversations } = await listConversations(access.tenant.id)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salón"
        title="Bandeja"
        description="Mensajes 1-a-1 con tus clientes en WhatsApp e Instagram."
      />

      {conversations.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Sin mensajes todavía"
          description="Cuando un cliente te escriba por WhatsApp o Instagram, va a aparecer en esta lista."
        />
      ) : (
        <ConversationListMobile conversations={conversations} tenantSlug={tenantSlug} />
      )}
    </div>
  )
}
