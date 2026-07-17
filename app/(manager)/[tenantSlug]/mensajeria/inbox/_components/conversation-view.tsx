import { Clock, MessageSquare } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { getConversation, listMessages } from '@/lib/bandeja/queries'
import { getTagsForConversationIds, listConversationTags } from '@/lib/conversation-tags/queries'
import { formatPhoneForDisplay } from '@/lib/phone'
import { listQuickMessages } from '@/lib/quick-messages/queries'
import { Composer } from './composer'
import { ConversationTagPicker } from './conversation-tag-picker'
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
  const [convo, messages, allTags, tagsMap, quickMessages] = await Promise.all([
    getConversation(tenantId, conversationId),
    listMessages(tenantId, conversationId),
    listConversationTags(tenantId),
    getTagsForConversationIds(tenantId, [conversationId]),
    listQuickMessages(tenantId),
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
  const display =
    convo.customer_name ??
    (convo.channel_type === 'whatsapp'
      ? formatPhoneForDisplay(convo.external_user_id)
      : 'Cliente de Instagram')
  const replyUntil =
    insideWindow && lastInboundMs > 0
      ? new Date(lastInboundMs + 24 * 3600 * 1000).toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null
  const initials = (display || '?').charAt(0).toUpperCase()
  const assignedTags = tagsMap.get(conversationId) ?? []
  const assignedTagIds = assignedTags.map((t) => t.id)

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
            {convo.channel_type === 'whatsapp' ? (
              <>
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
                  {insideWindow
                    ? replyUntil
                      ? `Respondés hasta las ${replyUntil}`
                      : 'Podés responder'
                    : 'Pasaron 24 h · solo por plantilla'}
                </Badge>
              </>
            ) : null}
          </p>
        </div>
        <ConversationTagPicker
          tenantSlug={tenantSlug}
          conversationId={conversationId}
          allTags={allTags}
          assignedTagIds={assignedTagIds}
        />
      </header>
      <MessageThread tenantSlug={tenantSlug} conversationId={convo.id} initialMessages={messages} />
      <Composer
        tenantSlug={tenantSlug}
        conversationId={convo.id}
        channelType={convo.channel_type}
        insideWindow={insideWindow}
        templates={templates}
        quickMessages={quickMessages}
      />
    </div>
  )
}
