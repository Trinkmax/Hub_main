import 'server-only'
import { conversationKey, tryNormalizePhone } from '@/lib/phone'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json } from '@/types/database'

type ChannelRow = Database['public']['Tables']['channels']['Row']

type IngestArgs = {
  channel: ChannelRow
  externalUserId: string
  metaMessageId: string
  content: string | null
  media: Json | null
  sentAt: string
  // Para WA es el `wa_id` (teléfono); para IG es null por ahora
  matchPhone?: string | null
}

export type IngestResult = {
  message_id: string | null
  conversation_id: string
  was_new: boolean
}

// Resuelve el customer (si existe) y delega en la RPC idempotente.
export async function ingestInboundMessage(args: IngestArgs): Promise<IngestResult> {
  const service = createServiceClient()
  let customerId: string | null = null

  if (args.matchPhone) {
    const e164 = tryNormalizePhone(args.matchPhone) ?? `+${args.matchPhone}`
    const { data } = await service
      .from('customers')
      .select('id')
      .eq('tenant_id', args.channel.tenant_id)
      .eq('phone', e164)
      .is('deleted_at', null)
      .maybeSingle()
    customerId = data?.id ?? null
  }

  const { data, error } = await service.rpc('ingest_inbound_message', {
    p_tenant_id: args.channel.tenant_id,
    p_channel_id: args.channel.id,
    p_external_user_id: conversationKey(args.externalUserId),
    p_meta_message_id: args.metaMessageId,
    p_content: args.content,
    p_media: args.media,
    p_sent_at: args.sentAt,
    p_customer_id: customerId,
  })
  if (error) throw new Error(`ingest_inbound_message: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('ingest_inbound_message returned no rows')
  return {
    message_id: row.message_id ?? null,
    conversation_id: row.conversation_id,
    was_new: row.was_new,
  }
}
