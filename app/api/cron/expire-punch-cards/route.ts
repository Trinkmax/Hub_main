import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return new NextResponse('cron_secret_not_configured', { status: 500 })

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const service = createServiceClient()
  const { data, error } = await service.rpc('expire_punch_cards')
  if (error) {
    console.error('[cron.expirePunchCards]', error.message)
    return new NextResponse(error.message, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...((data as Record<string, unknown>) ?? {}) })
}
