import 'server-only'
import { materializeAudience } from '@/lib/audiences/engine'
import { enqueueJob } from '@/lib/jobs/queue'
import { MetaApiError, mapMetaErrorToStatus } from '@/lib/meta/errors'
import { sendTemplate, type WhatsAppChannelLike } from '@/lib/meta/whatsapp'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json } from '@/types/database'

type BroadcastRow = Database['public']['Tables']['broadcasts']['Row']

const BROADCAST_JOB_KIND = 'send_broadcast_message'
// Distribuimos el envío para no exceder rate limits del WABA
// (WhatsApp tier 1: 80 msg/s; con 5s de jitter para 1000 dest dura ~5s).
const JITTER_WINDOW_SECONDS = 5

// Toma broadcasts scheduled cuyo scheduled_at ya pasó: materializa los
// recipients y encola un job por cada uno.
export async function processScheduledBroadcasts(): Promise<{
  promoted: number
  recipients: number
}> {
  const service = createServiceClient()
  const nowIso = new Date().toISOString()
  const { data: candidates, error } = await service
    .from('broadcasts')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .limit(50)
  if (error) throw new Error(`processScheduledBroadcasts: ${error.message}`)

  let promoted = 0
  let recipients = 0
  for (const row of candidates ?? []) {
    const { data: claimed } = await service
      .from('broadcasts')
      .update({ status: 'sending', started_at: nowIso })
      .eq('id', row.id)
      .eq('status', 'scheduled') // doble-check para evitar races
      .select('*')
      .maybeSingle()
    if (!claimed) continue

    try {
      const inserted = await materializeBroadcast(claimed)
      promoted += 1
      recipients += inserted
    } catch (e) {
      await service
        .from('broadcasts')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', row.id)
      console.error('[broadcasts.materialize]', (e as Error).message)
    }
  }
  return { promoted, recipients }
}

async function materializeBroadcast(broadcast: BroadcastRow): Promise<number> {
  const service = createServiceClient()
  const customerIds = await materializeAudience(broadcast.audience_id)
  if (customerIds.length === 0) {
    await service
      .from('broadcasts')
      .update({
        status: 'sent',
        completed_at: new Date().toISOString(),
        stats: { total: 0, sent: 0, failed: 0 } as unknown as Json,
      })
      .eq('id', broadcast.id)
    return 0
  }

  // Insert recipients en lote (idempotente vía unique).
  const rows = customerIds.map((cid) => ({
    broadcast_id: broadcast.id,
    customer_id: cid,
    status: 'pending' as const,
  }))
  const { error } = await service.from('broadcast_recipients').upsert(rows, {
    onConflict: 'broadcast_id,customer_id',
    ignoreDuplicates: true,
  })
  if (error) throw new Error(`recipients insert: ${error.message}`)

  // Cargar ids generados (en bulk) para enqueue.
  const { data: created } = await service
    .from('broadcast_recipients')
    .select('id')
    .eq('broadcast_id', broadcast.id)
    .eq('status', 'pending')
  const recipientIds = (created ?? []).map((r) => r.id)

  const baseTime = Date.now()
  for (const recipientId of recipientIds) {
    const jitterMs = Math.floor(Math.random() * JITTER_WINDOW_SECONDS * 1000)
    await enqueueJob({
      tenantId: broadcast.tenant_id,
      kind: BROADCAST_JOB_KIND,
      payload: { recipient_id: recipientId, broadcast_id: broadcast.id } as Json,
      runAt: new Date(baseTime + jitterMs),
    })
  }

  await service
    .from('broadcast_recipients')
    .update({ queued_at: new Date().toISOString() })
    .eq('broadcast_id', broadcast.id)
    .eq('status', 'pending')

  await service
    .from('broadcasts')
    .update({
      stats: { total: recipientIds.length, sent: 0, failed: 0 } as unknown as Json,
    })
    .eq('id', broadcast.id)

  return recipientIds.length
}

type SendJobPayload = { recipient_id: string; broadcast_id: string }

// Handler invocado por el job runner.
export async function handleSendBroadcastMessage(payload: unknown): Promise<void> {
  const data = payload as SendJobPayload
  if (!data?.recipient_id || !data?.broadcast_id) {
    throw new Error('payload missing recipient_id/broadcast_id')
  }
  const service = createServiceClient()

  // 1. Cargar recipient + broadcast + template + channel + customer.
  const { data: recipient, error: recErr } = await service
    .from('broadcast_recipients')
    .select(
      'id, broadcast_id, customer_id, status, broadcast:broadcasts(id, tenant_id, channel_id, template_id), customer:customers(phone, first_name, last_name)',
    )
    .eq('id', data.recipient_id)
    .maybeSingle()
  if (recErr || !recipient) throw new Error(`recipient: ${recErr?.message ?? 'not found'}`)
  if (recipient.status !== 'pending') return // idempotencia: ya procesado

  type Joined = typeof recipient & {
    broadcast:
      | { id: string; tenant_id: string; channel_id: string; template_id: string }
      | { id: string; tenant_id: string; channel_id: string; template_id: string }[]
      | null
    customer:
      | { phone: string; first_name: string; last_name: string }
      | { phone: string; first_name: string; last_name: string }[]
      | null
  }
  const r = recipient as Joined
  const broadcast = Array.isArray(r.broadcast) ? r.broadcast[0] : r.broadcast
  const customer = Array.isArray(r.customer) ? r.customer[0] : r.customer
  if (!broadcast || !customer) throw new Error('broadcast/customer missing')

  const { data: channel } = await service
    .from('channels')
    .select('*')
    .eq('id', broadcast.channel_id)
    .maybeSingle()
  if (!channel) throw new Error('channel not found')

  const { data: template } = await service
    .from('message_templates')
    .select('id, name, language')
    .eq('id', broadcast.template_id)
    .maybeSingle()
  if (!template) throw new Error('template not found')

  // Variables: {{1}} = first_name (default v1; broadcast variable_mapping
  // se agrega cuando ampliemos UI).
  const variables = [customer.first_name]

  try {
    const { meta_message_id } = await sendTemplate(
      channel as WhatsAppChannelLike,
      customer.phone,
      template.name,
      template.language,
      variables,
    )

    // Insertar message como outbound + asociar recipient.
    const { data: msg } = await service
      .from('messages')
      .insert({
        tenant_id: broadcast.tenant_id,
        conversation_id: await ensureConversationId(
          broadcast.tenant_id,
          channel.id,
          customer.phone,
          recipient.customer_id,
        ),
        direction: 'outbound',
        content: `[template:${template.name}] ${variables.join(' | ')}`,
        meta_message_id,
        status: 'sent',
        sent_at: new Date().toISOString(),
        broadcast_id: broadcast.id,
      })
      .select('id')
      .single()

    await service
      .from('broadcast_recipients')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        message_id: msg?.id ?? null,
        error: null,
      })
      .eq('id', recipient.id)

    await bumpBroadcastStats(broadcast.id, 'sent')
    await maybeFinalizeBroadcast(broadcast.id)
  } catch (err) {
    if (err instanceof MetaApiError) {
      const mapped = mapMetaErrorToStatus(err)
      await service
        .from('broadcast_recipients')
        .update({ status: 'failed', error: mapped.reason })
        .eq('id', recipient.id)
      await bumpBroadcastStats(broadcast.id, 'failed')
      await maybeFinalizeBroadcast(broadcast.id)
    }
    throw err
  }
}

async function ensureConversationId(
  tenantId: string,
  channelId: string,
  phone: string,
  customerId: string,
): Promise<string> {
  const service = createServiceClient()
  const { data: existing } = await service
    .from('conversations')
    .select('id')
    .eq('channel_id', channelId)
    .eq('external_user_id', phone)
    .maybeSingle()
  if (existing) return existing.id
  const { data: created, error } = await service
    .from('conversations')
    .insert({
      tenant_id: tenantId,
      channel_id: channelId,
      external_user_id: phone,
      customer_id: customerId,
      last_message_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error || !created) throw new Error(`conversation create: ${error?.message}`)
  return created.id
}

async function bumpBroadcastStats(broadcastId: string, key: 'sent' | 'failed'): Promise<void> {
  const service = createServiceClient()
  const { data } = await service
    .from('broadcasts')
    .select('stats')
    .eq('id', broadcastId)
    .maybeSingle()
  const stats = (data?.stats ?? {}) as Record<string, number>
  stats[key] = (stats[key] ?? 0) + 1
  await service
    .from('broadcasts')
    .update({ stats: stats as unknown as Json })
    .eq('id', broadcastId)
}

async function maybeFinalizeBroadcast(broadcastId: string): Promise<void> {
  const service = createServiceClient()
  const { count: pending } = await service
    .from('broadcast_recipients')
    .select('id', { head: true, count: 'exact' })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending')
  if ((pending ?? 0) > 0) return
  await service
    .from('broadcasts')
    .update({ status: 'sent', completed_at: new Date().toISOString() })
    .eq('id', broadcastId)
    .eq('status', 'sending')
}
