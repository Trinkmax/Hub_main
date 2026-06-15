import { NextResponse } from 'next/server'
import { refreshExpiringMetaTokens } from '@/lib/meta/token-refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await refreshExpiringMetaTokens()
  return NextResponse.json({ ok: true, ...result })
}
