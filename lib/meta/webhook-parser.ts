import type { MessageStatus } from '@/types/database'

export type WhatsAppParsedMessage = {
  phoneNumberId: string
  from: string
  metaMessageId: string
  timestamp: string
  type: string
  text: string | null
  media: Record<string, unknown> | null
  contactName: string | null
}

export type WhatsAppParsedStatus = {
  phoneNumberId: string
  metaMessageId: string
  status: MessageStatus
  timestamp: string
  errorMessage: string | null
}

type WhatsAppEntry = {
  changes?: Array<{
    field?: string
    value?: {
      messaging_product?: string
      metadata?: { phone_number_id?: string }
      contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
      messages?: Array<{
        from?: string
        id?: string
        timestamp?: string
        type?: string
        text?: { body?: string }
        image?: Record<string, unknown>
        video?: Record<string, unknown>
        audio?: Record<string, unknown>
        document?: Record<string, unknown>
        sticker?: Record<string, unknown>
        location?: Record<string, unknown>
      }>
      statuses?: Array<{
        id?: string
        status?: string
        timestamp?: string
        errors?: Array<{ message?: string; title?: string; code?: number }>
      }>
    }
  }>
}

type WhatsAppPayload = {
  object?: string
  entry?: WhatsAppEntry[]
}

const STATUS_MAP: Record<string, MessageStatus | undefined> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
}

export function parseWhatsAppPayload(payload: unknown): {
  messages: WhatsAppParsedMessage[]
  statuses: WhatsAppParsedStatus[]
} {
  const out: { messages: WhatsAppParsedMessage[]; statuses: WhatsAppParsedStatus[] } = {
    messages: [],
    statuses: [],
  }
  const root = payload as WhatsAppPayload | null
  if (!root || root.object !== 'whatsapp_business_account') return out

  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      if (!value) continue
      const phoneNumberId = value.metadata?.phone_number_id
      if (!phoneNumberId) continue
      const contactName = value.contacts?.[0]?.profile?.name ?? null

      for (const msg of value.messages ?? []) {
        if (!msg.id || !msg.from || !msg.timestamp) continue
        const type = msg.type ?? 'unknown'
        let text: string | null = null
        let media: Record<string, unknown> | null = null
        if (type === 'text') {
          text = msg.text?.body ?? null
        } else if (
          type === 'image' ||
          type === 'video' ||
          type === 'audio' ||
          type === 'document' ||
          type === 'sticker'
        ) {
          const candidate = msg[type] as Record<string, unknown> | undefined
          media = candidate ? { type, ...candidate } : null
        } else if (type === 'location' && msg.location) {
          media = { type: 'location', ...msg.location }
        }
        out.messages.push({
          phoneNumberId,
          from: msg.from,
          metaMessageId: msg.id,
          timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
          type,
          text,
          media,
          contactName,
        })
      }

      for (const st of value.statuses ?? []) {
        if (!st.id || !st.status || !st.timestamp) continue
        const mapped = STATUS_MAP[st.status]
        if (!mapped) continue
        out.statuses.push({
          phoneNumberId,
          metaMessageId: st.id,
          status: mapped,
          timestamp: new Date(Number(st.timestamp) * 1000).toISOString(),
          errorMessage: st.errors?.[0]?.message ?? st.errors?.[0]?.title ?? null,
        })
      }
    }
  }
  return out
}

export type InstagramParsedMessage = {
  igUserId: string // dueño del inbox (entry.id)
  senderId: string
  recipientId: string
  metaMessageId: string
  timestamp: string
  text: string | null
  media: Record<string, unknown> | null
  isEcho: boolean
}

type InstagramPayload = {
  object?: string
  entry?: Array<{
    id?: string
    time?: number
    messaging?: Array<{
      sender?: { id?: string }
      recipient?: { id?: string }
      timestamp?: number
      message?: {
        mid?: string
        text?: string
        attachments?: Array<{ type?: string; payload?: { url?: string } }>
        is_echo?: boolean
        is_deleted?: boolean
      }
    }>
  }>
}

export function parseInstagramPayload(payload: unknown): InstagramParsedMessage[] {
  const out: InstagramParsedMessage[] = []
  const root = payload as InstagramPayload | null
  if (!root || root.object !== 'instagram') return out

  for (const entry of root.entry ?? []) {
    const igUserId = entry.id
    if (!igUserId) continue
    for (const ev of entry.messaging ?? []) {
      const msg = ev.message
      if (!msg?.mid || msg.is_deleted) continue
      const senderId = ev.sender?.id
      const recipientId = ev.recipient?.id
      const ts = ev.timestamp
      if (!senderId || !recipientId || !ts) continue
      const media =
        msg.attachments && msg.attachments.length > 0 ? { attachments: msg.attachments } : null
      out.push({
        igUserId,
        senderId,
        recipientId,
        metaMessageId: msg.mid,
        timestamp: new Date(ts).toISOString(),
        text: msg.text ?? null,
        media,
        isEcho: msg.is_echo === true,
      })
    }
  }
  return out
}
