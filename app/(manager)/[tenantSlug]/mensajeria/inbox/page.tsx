import { notFound } from 'next/navigation'
import {
  hasConnectedChannel,
  listApprovedTemplates,
  listConversations,
} from '@/lib/bandeja/queries'
import { buildListHref } from '@/lib/bandeja/utils'
import { listConversationTags } from '@/lib/conversation-tags/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'
import { ChatListPanel } from './_components/chat-list-panel'
import { ChatView } from './_components/chat-view'
import { EmptyChatPane } from './_components/empty-chat-pane'

export const metadata = { title: 'Chats' }
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

export default async function BandejaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ c?: string; tag?: string; n?: string }>
}) {
  const { tenantSlug } = await params
  const { c: selectedId, tag: tagId, n: nParam } = await searchParams
  const limit = Math.max(PAGE_SIZE, Math.min(Number(nParam) || PAGE_SIZE, 300))

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'cashier', 'waiter'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [conversationsResult, templates, allTags, channelConnected] = await Promise.all([
    listConversations(access.tenant.id, { tagId, limit }),
    listApprovedTemplates(access.tenant.id),
    listConversationTags(access.tenant.id),
    hasConnectedChannel(access.tenant.id),
  ])
  const { rows: conversations, hasMore } = conversationsResult
  // Volver desde un chat en mobile conserva el filtro de etiqueta y la paginación
  const backHref = buildListHref(tenantSlug, { n: limit, tag: tagId ?? null })

  return (
    <div className="flex h-full min-h-0">
      {/* Panel de lista, estilo WhatsApp Web (~30% con topes) */}
      <aside
        className={cn(
          'w-full min-w-0 border-r border-(--wa-border) md:block md:w-[340px] md:shrink-0 lg:w-[380px] xl:w-[420px]',
          selectedId ? 'hidden' : 'block',
        )}
      >
        <ChatListPanel
          conversations={conversations}
          tenantSlug={tenantSlug}
          tenantId={access.tenant.id}
          selectedId={selectedId ?? null}
          hasMore={hasMore}
          currentN={limit}
          selectedTag={tagId ?? null}
          allTags={allTags}
          templates={templates}
        />
      </aside>

      {/* Conversación */}
      <section className={cn('min-w-0 flex-1', selectedId ? 'block' : 'hidden md:block')}>
        {selectedId ? (
          <ChatView
            // key: al cambiar de chat se desmonta todo el estado cliente
            // (borrador del composer, picker de etiquetas, panel de ficha)
            key={selectedId}
            tenantSlug={tenantSlug}
            tenantId={access.tenant.id}
            conversationId={selectedId}
            templates={templates}
            canViewProfile={access.role === 'owner'}
            backHref={backHref}
          />
        ) : (
          <EmptyChatPane
            hasConversations={conversations.length > 0}
            channelConnected={channelConnected}
          />
        )}
      </section>
    </div>
  )
}
