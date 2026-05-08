import { NextResponse } from 'next/server'
import { evaluateTimeTriggers } from '@/lib/flows/triggers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // Permite limitar a un subset desde la URL: ?type=customer_inactive,birthday
  const url = new URL(request.url)
  const typeParam = url.searchParams.get('type')
  const types = typeParam
    ? (typeParam.split(',') as Parameters<typeof evaluateTimeTriggers>[0])
    : undefined
  try {
    const result = await evaluateTimeTriggers(types)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
