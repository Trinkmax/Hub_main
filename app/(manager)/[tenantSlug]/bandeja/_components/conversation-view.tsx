import { Clock, MessageSquare } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { getConversation, listMessages } from '@/lib/bandeja/queries'
import { Composer } from './composer'
import { MessageThread } from './message-thread'

type Template = {
  id: string
  name: string
  language: string
  category: string
  components: unknown
}

export async function ConversationView({
  tenantSlug,
  tenantId,
  conversationId,
  templates,
}: {
  tenantSlug: string
  tenantId: string
  conversationId: string
  templates: Template[]
}) {
  const [convo, messages] = await Promise.all([
    getConversation(tenantId, conversationId),
    listMessages(tenantId, conversationId),
  ])
  if (!convo) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        Conversación no encontrada.
      </div>
    )
  }

  const lastInboundMs = convo.last_inbound_at ? new Date(convo.last_inbound_at).getTime() : 0
  const insideWindow = lastInboundMs > 0 && Date.now() - lastInboundMs < 24 * 3600 * 1000
  const display = convo.customer_name ?? convo.external_user_id
  const initials = (display || '?').charAt(0).toUpperCase()

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
        <Avatar className="size-10">
          <AvatarFallback className="bg-secondary font-semibold">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold leading-tight">{display}</p>
          <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3" />
              {convo.channel_type === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
            </span>
            <span aria-hidden>·</span>
            <Badge
              variant="outline"
              className={
                insideWindow
                  ? 'gap-1 border-success/30 bg-success/10 text-success'
                  : 'gap-1 border-warning/30 bg-warning/10 text-warning'
              }
            >
              <Clock className="size-2.5" />
              {insideWindow ? 'Dentro de ventana 24h' : 'Fuera de ventana'}
            </Badge>
          </p>
        </div>
      </header>
      <MessageThread conversationId={convo.id} initialMessages={messages} />
      <Composer
        tenantSlug={tenantSlug}
        conversationId={convo.id}
        channelType={convo.channel_type}
        insideWindow={insideWindow}
        templates={templates}
      />
    </div>
  )
}
