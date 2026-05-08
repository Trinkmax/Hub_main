import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { ChannelType, MessageDirection, MessageStatus } from '@/types/database'

export type ConversationListRow = {
  id: string
  channel_id: string
  channel_type: ChannelType
  customer_id: string | null
  customer_name: string | null
  external_user_id: string
  last_message_at: string | null
  unread_count: number
  preview: string | null
}

export type MessageRow = {
  id: string
  direction: MessageDirection
  content: string | null
  status: MessageStatus | null
  error: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  created_at: string
}

export async function listConversations(
  tenantId: string,
  limit = 50,
): Promise<ConversationListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conversations')
    .select(
      `
      id,
      channel_id,
      external_user_id,
      customer_id,
      last_message_at,
      unread_count,
      channel:channels!inner(type),
      customer:customers(first_name, last_name),
      preview:messages(content, created_at)
    `,
    )
    .eq('tenant_id', tenantId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) {
    console.error('[bandeja.listConversations]', error.message)
    return []
  }
  type Joined = {
    id: string
    channel_id: string
    external_user_id: string
    customer_id: string | null
    last_message_at: string | null
    unread_count: number
    channel: { type: ChannelType } | { type: ChannelType }[] | null
    customer:
      | { first_name: string; last_name: string }
      | { first_name: string; last_name: string }[]
      | null
    preview: Array<{ content: string | null; created_at: string }> | null
  }
  return (data as unknown as Joined[]).map((row) => {
    const channel = Array.isArray(row.channel) ? row.channel[0] : row.channel
    const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer
    const last = (row.preview ?? [])
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
    return {
      id: row.id,
      channel_id: row.channel_id,
      channel_type: channel?.type ?? 'whatsapp',
      customer_id: row.customer_id,
      customer_name: customer ? `${customer.first_name} ${customer.last_name}`.trim() : null,
      external_user_id: row.external_user_id,
      last_message_at: row.last_message_at,
      unread_count: row.unread_count,
      preview: last?.content ?? null,
    }
  })
}

export type ConversationDetail = {
  id: string
  channel_id: string
  channel_type: ChannelType
  external_user_id: string
  customer_name: string | null
  last_inbound_at: string | null
}

export async function getConversation(
  tenantId: string,
  conversationId: string,
): Promise<ConversationDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conversations')
    .select(
      `
      id,
      channel_id,
      external_user_id,
      customer:customers(first_name, last_name),
      channel:channels!inner(type)
    `,
    )
    .eq('id', conversationId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error || !data) return null

  const { data: lastIn } = await supabase
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)

  type Joined = {
    id: string
    channel_id: string
    external_user_id: string
    customer:
      | { first_name: string; last_name: string }
      | { first_name: string; last_name: string }[]
      | null
    channel: { type: ChannelType } | { type: ChannelType }[] | null
  }
  const row = data as unknown as Joined
  const channel = Array.isArray(row.channel) ? row.channel[0] : row.channel
  const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer

  return {
    id: row.id,
    channel_id: row.channel_id,
    channel_type: channel?.type ?? 'whatsapp',
    external_user_id: row.external_user_id,
    customer_name: customer ? `${customer.first_name} ${customer.last_name}`.trim() : null,
    last_inbound_at: lastIn?.[0]?.created_at ?? null,
  }
}

export async function listMessages(
  tenantId: string,
  conversationId: string,
  limit = 100,
): Promise<MessageRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('messages')
    .select('id, direction, content, status, error, sent_at, delivered_at, read_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) {
    console.error('[bandeja.listMessages]', error.message)
    return []
  }
  return (data ?? []) as MessageRow[]
}

export async function listApprovedTemplates(tenantId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('message_templates')
    .select('id, name, language, category, components')
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')
    .order('name')
  return data ?? []
}
