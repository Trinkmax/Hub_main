import { NextResponse } from 'next/server'
import { getMetaConfig } from '@/lib/meta/env'
import { ingestInboundMessage } from '@/lib/meta/inbound'
import { verifyMetaSignature } from '@/lib/meta/signature'
import { parseInstagramPayload } from '@/lib/meta/webhook-parser'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const { appSecret } = getMetaConfig()

  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    console.error('[webhook.instagram] invalid signature')
    return new NextResponse('forbidden', { status: 403 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new NextResponse('bad request', { status: 400 })
  }

  const events = parseInstagramPayload(payload).filter((e) => !e.isEcho)
  if (events.length === 0) return NextResponse.json({ ok: true, processed: 0 })

  const service = createServiceClient()

  const igIds = Array.from(new Set(events.map((e) => e.igUserId)))
  const { data: channels, error: channelsErr } = await service
    .from('channels')
    .select('*')
    .eq('type', 'instagram')
    .in('external_account_id', igIds)
  if (channelsErr) {
    console.error('[webhook.instagram] channels query', channelsErr.message)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
  const channelByIg = new Map((channels ?? []).map((c) => [c.external_account_id, c]))

  let processed = 0
  for (const ev of events) {
    const channel = channelByIg.get(ev.igUserId)
    if (!channel) {
      console.warn('[webhook.instagram] no channel for ig user', ev.igUserId)
      continue
    }
    try {
      await ingestInboundMessage({
        channel,
        externalUserId: ev.senderId,
        metaMessageId: ev.metaMessageId,
        content: ev.text,
        media: (ev.media ?? null) as Json | null,
        sentAt: ev.timestamp,
      })
      processed += 1
    } catch (e) {
      console.error('[webhook.instagram] ingest', (e as Error).message)
    }
  }

  return NextResponse.json({ ok: true, processed })
}
