import { NextResponse } from 'next/server'
import { messagingJobHandler } from '@/lib/jobs/handlers'
import { runWorker } from '@/lib/jobs/runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const JOB_LIMIT = Number(process.env.JOB_QUEUE_LIMIT ?? 100)

// Ruta legacy: drena job_queue una vez. El scheduling productivo pasa por el
// dispatcher (/api/cron/dispatch); esta ruta queda para invocación manual.
export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await runWorker({ limit: JOB_LIMIT, handler: messagingJobHandler })
    return NextResponse.json({ ...result, ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
