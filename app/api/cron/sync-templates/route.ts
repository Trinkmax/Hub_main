import { NextResponse } from 'next/server'
import { syncTemplates } from '@/lib/meta/templates'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data: channels, error } = await service
    .from('channels')
    .select('*')
    .eq('type', 'whatsapp')
    .eq('status', 'connected')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let totalSynced = 0
  const results: Array<{ channel_id: string; synced: number; error?: string }> = []
  for (const channel of channels ?? []) {
    try {
      const { synced } = await syncTemplates(channel)
      totalSynced += synced
      results.push({ channel_id: channel.id, synced })
    } catch (e) {
      results.push({ channel_id: channel.id, synced: 0, error: (e as Error).message })
    }
  }
  return NextResponse.json({ ok: true, totalSynced, results })
}
