import 'server-only'
import { type ConversationTag, getTagsForConversationIds } from '@/lib/conversation-tags/queries'
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
  tags: ConversationTag[]
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

export type ConversationListResult = {
  rows: ConversationListRow[]
  hasMore: boolean
}

export async function listConversations(
  tenantId: string,
  opts: { tagId?: string; limit?: number } = {},
): Promise<ConversationListResult> {
  const { tagId, limit = 30 } = opts
  // Fetch one extra to detect if there are more pages
  const fetchLimit = limit + 1
  const supabase = await createClient()

  let query = supabase
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
    .limit(fetchLimit)

  // Filtro por etiqueta: solo conversaciones que tienen esa tag asignada
  if (tagId) {
    // conversation_tag_assignments tiene conversation_id → filtrar con subquery vía RPC
    // La forma más directa con supabase-js es filtrar en dos pasos:
    // 1. Obtener los conversation_ids que tienen ese tag
    const { data: assignments } = await supabase
      .from('conversation_tag_assignments')
      .select('conversation_id')
      .eq('tag_id', tagId)

    const ids = (assignments ?? []).map((a) => a.conversation_id)
    if (ids.length === 0) {
      // Sin conversaciones con esa etiqueta
      return { rows: [], hasMore: false }
    }
    query = query.in('id', ids)
  }

  const { data, error } = await query
  if (error) {
    console.error('[bandeja.listConversations]', error.message)
    return { rows: [], hasMore: false }
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

  const raw = data as unknown as Joined[]
  const hasMore = raw.length > limit
  // Trim the extra sentinel row
  const slice = hasMore ? raw.slice(0, limit) : raw

  const rows = slice.map((row) => {
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
      tags: [] as ConversationTag[],
    }
  })

  // Batch-fetch de tags para todas las conversaciones (una sola query, sin N+1)
  if (rows.length > 0) {
    const tagsMap = await getTagsForConversationIds(
      tenantId,
      rows.map((r) => r.id),
    )
    for (const row of rows) {
      row.tags = tagsMap.get(row.id) ?? []
    }
  }

  return { rows, hasMore }
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
      last_inbound_at,
      customer:customers(first_name, last_name),
      channel:channels!inner(type)
    `,
    )
    .eq('id', conversationId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error || !data) return null

  type Joined = {
    id: string
    channel_id: string
    external_user_id: string
    last_inbound_at: string | null
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
    last_inbound_at: row.last_inbound_at,
  }
}

export type ListMessagesOpts = {
  /** Only return messages with created_at strictly before this ISO timestamp (for loading older messages). */
  before?: string
  limit?: number
}

export async function listMessages(
  tenantId: string,
  conversationId: string,
  opts: ListMessagesOpts | number = {},
): Promise<MessageRow[]> {
  // Accept legacy numeric `limit` arg for backward compat
  const { before, limit = 50 } = typeof opts === 'number' ? { limit: opts } : opts
  const supabase = await createClient()
  let query = supabase
    .from('messages')
    .select('id, direction, content, status, error, sent_at, delivered_at, read_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) {
    query = query.lt('created_at', before)
  }

  const { data, error } = await query
  if (error) {
    console.error('[bandeja.listMessages]', error.message)
    return []
  }
  // Return ascending so UI renders oldest → newest
  return ((data ?? []) as MessageRow[]).reverse()
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
