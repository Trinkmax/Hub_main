import { NextResponse } from 'next/server'
import { handleSendBroadcastMessage } from '@/lib/broadcasts/engine'
import { runWorker } from '@/lib/jobs/runner'
import { type DownloadAndStoreOpts, downloadAndStoreMedia } from '@/lib/meta/media'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const JOB_LIMIT = Number(process.env.JOB_QUEUE_LIMIT ?? 100)

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await runWorker({
      limit: JOB_LIMIT,
      handler: async (job) => {
        if (job.kind === 'send_broadcast_message') {
          await handleSendBroadcastMessage(job.payload)
          return
        }
        if (job.kind === 'start_flow') {
          await handleStartFlow(job.payload)
          return
        }
        if (job.kind === 'download_media') {
          await downloadAndStoreMedia(job.payload as DownloadAndStoreOpts)
          return
        }
        // Kinds desconocidos se marcan failed no-recoverable.
        throw Object.assign(new Error(`unknown job kind: ${job.kind}`), { fatal: true })
      },
    })
    return NextResponse.json({ ...result, ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

type StartFlowPayload = { flow_id: string; customer_id: string; context?: unknown }

async function handleStartFlow(payload: unknown): Promise<void> {
  const data = payload as StartFlowPayload
  if (!data?.flow_id || !data?.customer_id) {
    throw new Error('start_flow: missing flow_id/customer_id')
  }
  const service = createServiceClient()
  const { error } = await service.rpc('start_flow_for_customer', {
    p_flow_id: data.flow_id,
    p_customer_id: data.customer_id,
    p_context: (data.context ?? {}) as never,
  })
  if (error) throw new Error(error.message)
}
