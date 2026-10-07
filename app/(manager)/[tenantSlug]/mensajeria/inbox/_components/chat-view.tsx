import { getConversation, listMessages } from '@/lib/bandeja/queries'
import type { TemplateLite } from '@/lib/bandeja/template-view'
import { getTagsForConversationIds, listConversationTags } from '@/lib/conversation-tags/queries'
import { getCustomerById } from '@/lib/customers/queries'
import { formatPhoneForDisplay } from '@/lib/phone'
import { listTiers } from '@/lib/points/queries'
import { progressToNext, type TierProgress } from '@/lib/points/tiers'
import { listQuickMessages } from '@/lib/quick-messages/queries'
import { getCustomerInsights } from '@/lib/stats/queries'
import { ChatShell } from './chat-shell'
import { Composer } from './composer'
import { ContactPanel, type PanelCustomer, type PanelInsights } from './contact-panel'
import { ConversationTagPicker } from './conversation-tag-picker'
import { MessageThread } from './message-thread'

/**
 * Vista de una conversación: junta hilo + composer + ficha del cliente.
 * Server Component — todas las queries en paralelo.
 */
export async function ChatView({
  tenantSlug,
  tenantId,
  conversationId,
  templates,
  canViewProfile,
  backHref,
}: {
  tenantSlug: string
  tenantId: string
  conversationId: string
  templates: TemplateLite[]
  canViewProfile: boolean
  /** Volver a la lista (mobile) conservando filtros de la URL. */
  backHref: string
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
      <div className="flex h-full items-center justify-center bg-(--wa-panel-soft) p-4 text-sm text-(--wa-muted)">
        No encontramos esta conversación.
      </div>
    )
  }

  // Datos de fidelización del cliente vinculado (si existe)
  let customer: PanelCustomer | null = null
  let tier: TierProgress | null = null
  let insights: PanelInsights | null = null
  if (convo.customer_id) {
    const [customerRow, tiers, rawInsights] = await Promise.all([
      getCustomerById({ tenantId, id: convo.customer_id }),
      listTiers({ tenantId }),
      getCustomerInsights(tenantId, convo.customer_id),
    ])
    if (customerRow) {
      customer = customerRow as unknown as PanelCustomer
      tier = progressToNext(customer.category_points, tiers)
    }
    if (rawInsights) {
      const avg = rawInsights.avg_ticket_cents
      insights = {
        avgTicketCents: avg == null ? null : Number(avg),
        favoriteItem: rawInsights.favorite_item_name ?? null,
      }
    }
  }

  const lastInboundMs = convo.last_inbound_at ? new Date(convo.last_inbound_at).getTime() : 0
  const insideWindow = lastInboundMs > 0 && Date.now() - lastInboundMs < 24 * 3600 * 1000
  const isWhatsApp = convo.channel_type === 'whatsapp'
  const phoneDisplay = isWhatsApp ? formatPhoneForDisplay(convo.external_user_id) : null
  const display = convo.customer_name ?? phoneDisplay ?? 'Cliente de Instagram'
  // "las 14:30" si vence hoy, "mañana a las 14:30" si cruza medianoche
  let replyUntil: string | null = null
  if (insideWindow && lastInboundMs > 0) {
    const expiry = new Date(lastInboundMs + 24 * 3600 * 1000)
    const hora = expiry.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    const sameDay = expiry.toDateString() === new Date().toDateString()
    replyUntil = sameDay ? `las ${hora}` : `mañana a las ${hora}`
  }
  const assignedTags = tagsMap.get(conversationId) ?? []
  const avatarSeed = convo.customer_name ?? convo.external_user_id
  const subtitle = customer
    ? `${phoneDisplay ?? 'Instagram'} · tocá para ver la ficha`
    : (phoneDisplay ?? 'Instagram')

  return (
    <ChatShell
      display={display}
      subtitle={subtitle}
      avatarSeed={avatarSeed}
      backHref={backHref}
      isWhatsApp={isWhatsApp}
      insideWindow={insideWindow}
      replyUntil={replyUntil}
      loyalty={
        customer
          ? {
              points: customer.points_balance,
              tierName: tier?.current?.name ?? null,
              tierColor: tier?.current?.color ?? null,
            }
          : null
      }
      tagPicker={
        <ConversationTagPicker
          tenantSlug={tenantSlug}
          conversationId={conversationId}
          allTags={allTags}
          assignedTagIds={assignedTags.map((t) => t.id)}
        />
      }
      contactPanel={
        <ContactPanel
          tenantSlug={tenantSlug}
          display={display}
          avatarSeed={avatarSeed}
          phoneDisplay={phoneDisplay}
          channelType={convo.channel_type}
          customer={customer}
          tier={tier}
          insights={insights}
          assignedTags={assignedTags}
          canViewProfile={canViewProfile}
        />
      }
      thread={
        <MessageThread
          tenantSlug={tenantSlug}
          conversationId={convo.id}
          initialMessages={messages}
          templates={templates}
        />
      }
      composer={
        <Composer
          tenantSlug={tenantSlug}
          conversationId={convo.id}
          channelType={convo.channel_type}
          insideWindow={insideWindow}
          templates={templates}
          quickMessages={quickMessages}
        />
      }
    />
  )
}
