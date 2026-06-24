import 'server-only'
import { handleSendBroadcastMessage } from '@/lib/broadcasts/engine'
import type { JobHandler } from '@/lib/jobs/runner'
import { type DownloadAndStoreOpts, downloadAndStoreMedia } from '@/lib/meta/media'
import { createServiceClient } from '@/lib/supabase/service'

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

// Handler único de jobs de mensajería. Usado por el dispatcher (/api/cron/dispatch)
// y por la ruta legacy /api/cron/process-jobs, para que ambos drenen job_queue con
// la misma lógica. Mantener en sync con los `kind` que se encolan en job_queue.
export const messagingJobHandler: JobHandler = async (job) => {
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
  // Kinds desconocidos se marcan failed no-recoverable (no se reintentan).
  throw Object.assign(new Error(`unknown job kind: ${job.kind}`), { fatal: true })
}
