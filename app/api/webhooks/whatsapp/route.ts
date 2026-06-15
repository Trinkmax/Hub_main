import { NextResponse } from 'next/server'
import { getMetaConfig } from '@/lib/meta/env'
import { ingestInboundMessage } from '@/lib/meta/inbound'
import { verifyMetaSignature } from '@/lib/meta/signature'
import { parseWhatsAppPayload } from '@/lib/meta/webhook-parser'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const { appSecret } = getMetaConfig()

  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    console.error('[webhook.whatsapp] invalid signature')
    return new NextResponse('forbidden', { status: 403 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new NextResponse('bad request', { status: 400 })
  }

  const parsed = parseWhatsAppPayload(payload)
  if (parsed.messages.length === 0 && parsed.statuses.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 })
  }

  const service = createServiceClient()

  // Cargar canales involucrados en una sola query.
  const phoneIds = Array.from(
    new Set([
      ...parsed.messages.map((m) => m.phoneNumberId),
      ...parsed.statuses.map((s) => s.phoneNumberId),
    ]),
  )
  const { data: channels, error: channelsErr } = await service
    .from('channels')
    .select('*')
    .eq('type', 'whatsapp')
    .in('external_phone_number_id', phoneIds)
  if (channelsErr) {
    console.error('[webhook.whatsapp] channels query', channelsErr.message)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
  const channelByPhone = new Map(
    (channels ?? [])
      .filter((c) => c.external_phone_number_id)
      .map((c) => [c.external_phone_number_id as string, c]),
  )

  let processed = 0

  for (const msg of parsed.messages) {
    const channel = channelByPhone.get(msg.phoneNumberId)
    if (!channel) {
      console.warn('[webhook.whatsapp] no channel for phone_number_id', msg.phoneNumberId)
      continue
    }
    try {
      const ingest = await ingestInboundMessage({
        channel,
        externalUserId: msg.from,
        metaMessageId: msg.metaMessageId,
        content: msg.text,
        media: (msg.media ?? null) as Json | null,
        sentAt: msg.timestamp,
        matchPhone: msg.from,
      })
      await service.rpc('mark_broadcast_replied', {
        p_conversation_id: ingest.conversation_id,
      })
      processed += 1
    } catch (e) {
      console.error('[webhook.whatsapp] ingest', (e as Error).message)
    }
  }

  for (const st of parsed.statuses) {
    try {
      const { data: msgId } = await service.rpc('update_message_status', {
        p_meta_message_id: st.metaMessageId,
        p_status: st.status,
        p_error: st.errorMessage,
        p_timestamp: st.timestamp,
      })
      if (msgId) {
        await service.rpc('sync_broadcast_recipient_status', {
          p_message_id: msgId,
          p_status: st.status,
          p_timestamp: st.timestamp,
        })
      }
      processed += 1
    } catch (e) {
      console.error('[webhook.whatsapp] status', (e as Error).message)
    }
  }

  return NextResponse.json({ ok: true, processed })
}
