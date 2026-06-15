import { ArrowLeft, Clock, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Composer } from '@/app/(manager)/[tenantSlug]/bandeja/_components/composer'
import { MessageThread } from '@/app/(manager)/[tenantSlug]/bandeja/_components/message-thread'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { getConversation, listApprovedTemplates, listMessages } from '@/lib/bandeja/queries'
import { requireTenantAccess } from '@/lib/tenant'

export const metadata = { title: 'Salón · Conversación' }
export const dynamic = 'force-dynamic'

export default async function SalonConversationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; conversationId: string }>
}) {
  const { tenantSlug, conversationId } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch {
    notFound()
  }

  const [convo, messages, templates] = await Promise.all([
    getConversation(access.tenant.id, conversationId),
    listMessages(access.tenant.id, conversationId),
    listApprovedTemplates(access.tenant.id),
  ])

  if (!convo) notFound()

  const lastInboundMs = convo.last_inbound_at ? new Date(convo.last_inbound_at).getTime() : 0
  const insideWindow = lastInboundMs > 0 && Date.now() - lastInboundMs < 24 * 3600 * 1000
  const display = convo.customer_name ?? convo.external_user_id
  const initials = (display || '?').charAt(0).toUpperCase()

  // Tomamos altura ajustada al viewport mobile menos topbar (56px) y bottom-tab
  // (estimado 76px con safe-area). El thread scrollea adentro.
  return (
    <div className="-mx-4 sm:-mx-6">
      <div className="card-hairline flex h-[calc(100dvh-56px-76px)] flex-col rounded-none border-x-0 border-y border-border/60 bg-card sm:mx-0 sm:rounded-xl sm:border-x">
        <header className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5">
          <Link
            href={`/${tenantSlug}/salon/bandeja`}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[--cream-tint] hover:text-foreground"
            aria-label="Volver a bandeja"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="bg-secondary text-sm font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-base font-semibold leading-tight">{display}</p>
            <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <MessageSquare className="size-3" aria-hidden />
                {convo.channel_type === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
              </span>
              <span aria-hidden>·</span>
              <Badge
                variant="outline"
                className={
                  insideWindow
                    ? 'gap-1 border-success/40 bg-success/10 text-success'
                    : 'gap-1 border-warning/40 bg-warning/10 text-warning'
                }
              >
                <Clock className="size-2.5" aria-hidden />
                {insideWindow ? '24h activa' : 'Fuera de ventana'}
              </Badge>
            </p>
          </div>
        </header>

        <MessageThread
          tenantSlug={tenantSlug}
          conversationId={convo.id}
          initialMessages={messages}
        />

        <Composer
          tenantSlug={tenantSlug}
          conversationId={convo.id}
          channelType={convo.channel_type}
          insideWindow={insideWindow}
          templates={templates}
        />
      </div>
    </div>
  )
}
