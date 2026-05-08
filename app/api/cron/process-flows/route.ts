import { NextResponse } from 'next/server'
import { markFailed, tickFlowExecution } from '@/lib/flows/runtime'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TICK_LIMIT = Number(process.env.FLOW_TICK_LIMIT ?? 100)

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const service = createServiceClient()
  const { data: executions } = await service
    .from('flow_executions')
    .select('id')
    .eq('status', 'running')
    .lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true })
    .limit(TICK_LIMIT)

  let ok = 0
  let failed = 0
  for (const exec of executions ?? []) {
    try {
      await tickFlowExecution(exec.id)
      ok += 1
    } catch (e) {
      const msg = (e as Error).message ?? 'unknown'
      const recoverable = (e as { recoverable?: boolean }).recoverable !== false
      if (!recoverable) {
        await markFailed(exec.id, msg)
        failed += 1
        continue
      }
      // recoverable: lo dejamos en running pero corremos el next_run_at +30s
      await service
        .from('flow_executions')
        .update({
          next_run_at: new Date(Date.now() + 30_000).toISOString(),
          error: msg,
        })
        .eq('id', exec.id)
      failed += 1
    }
  }
  return NextResponse.json({ ok: true, processed: ok, failed })
}
