import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data, error } = await service.rpc('finish_past_events')
  if (error) {
    console.error('[cron.finish_past_events]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const result = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    ok: true,
    finished_events: result?.finished_events ?? 0,
    no_show_reservations: result?.no_show_reservations ?? 0,
  })
}
