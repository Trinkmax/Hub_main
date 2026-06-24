import { NextResponse } from 'next/server'
import { runDispatch } from '@/lib/cron/dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// pg_cron pega acá cada minuto (POST con `Authorization: Bearer ${CRON_SECRET}`).
// Corre todo el trabajo de fondo de mensajería vencido. GET se acepta para
// invocación manual (smoke) con el mismo secreto.
async function handle(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await runDispatch()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron.dispatch]', (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const POST = handle
export const GET = handle
