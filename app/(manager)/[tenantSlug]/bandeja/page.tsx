import { ArrowLeft, Inbox, MessageSquareDashed } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { listApprovedTemplates, listConversations } from '@/lib/bandeja/queries'
import { listConversationTags } from '@/lib/conversation-tags/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { cn } from '@/lib/utils'
import { ConversationList } from './_components/conversation-list'
import { ConversationView } from './_components/conversation-view'
import { TagFilterBar } from './_components/tag-filter-bar'

export const metadata = { title: 'Bandeja' }
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

  const [conversationsResult, templates, allTags] = await Promise.all([
    listConversations(access.tenant.id, { tagId, limit }),
    listApprovedTemplates(access.tenant.id),
    listConversationTags(access.tenant.id),
  ])
  const { rows: conversations, hasMore } = conversationsResult

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Hoy"
        title="Bandeja"
        description="Mensajes 1-a-1 con tus clientes en WhatsApp e Instagram, en un solo lugar."
        className="pb-0"
      />

      <div className="card-hairline flex flex-1 overflow-hidden rounded-xl border bg-card">
        <aside
          className={cn(
            'w-full flex-col border-r border-border/60 bg-surface/40 md:flex md:w-[320px] md:max-w-[320px] md:shrink-0',
            selectedId ? 'hidden' : 'flex',
          )}
        >
          <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <Inbox className="size-4 text-primary" />
              <h2 className="font-display text-sm font-semibold tracking-tight">Conversaciones</h2>
            </div>
            <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
              {conversations.length}
            </span>
          </header>
          <TagFilterBar tags={allTags} tenantSlug={tenantSlug} activeTagId={tagId ?? null} />
          <ConversationList
            conversations={conversations}
            tenantSlug={tenantSlug}
            tenantId={access.tenant.id}
            selectedId={selectedId ?? null}
            hasMore={hasMore}
            currentN={limit}
            selectedTag={tagId ?? null}
          />
        </aside>
        <section
          className={cn('flex-1 flex-col overflow-hidden md:flex', selectedId ? 'flex' : 'hidden')}
        >
          {selectedId ? (
            <>
              <div className="border-b border-border/60 px-3 py-2 md:hidden">
                <Link
                  href={`/${tenantSlug}/bandeja`}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                  Volver
                </Link>
              </div>
              <ConversationView
                tenantSlug={tenantSlug}
                tenantId={access.tenant.id}
                conversationId={selectedId}
                templates={templates}
              />
            </>
          ) : (
            <div className="flex w-full flex-1 items-center justify-center p-6">
              <EmptyState
                icon={MessageSquareDashed}
                title="Elegí una conversación"
                description={
                  conversations.length === 0
                    ? 'Cuando un cliente te escriba por WhatsApp o Instagram, va a aparecer en esta lista.'
                    : 'Tocá una conversación de la izquierda para ver el hilo y responder.'
                }
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
