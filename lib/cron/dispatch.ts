import 'server-only'
import { processScheduledBroadcasts } from '@/lib/broadcasts/engine'
import { markFailed, tickFlowExecution } from '@/lib/flows/runtime'
import { evaluateTimeTriggers } from '@/lib/flows/triggers'
import { messagingJobHandler } from '@/lib/jobs/handlers'
import { runWorker } from '@/lib/jobs/runner'
import { syncTemplates } from '@/lib/meta/templates'
import { refreshExpiringMetaTokens } from '@/lib/meta/token-refresh'
import { createServiceClient } from '@/lib/supabase/service'
import { type GatedTask, gatedTasksDue } from './schedule'

const JOB_LIMIT = Number(process.env.JOB_QUEUE_LIMIT ?? 100)
const FLOW_TICK_LIMIT = Number(process.env.FLOW_TICK_LIMIT ?? 100)

type ServiceClient = ReturnType<typeof createServiceClient>

export type DispatchResult = {
  broadcasts: { promoted: number; recipients: number }
  jobs: { reaped: number; claimed: number; ok: number; failed: number }
  flows: { ok: number; failed: number }
  gated: GatedTask[]
}

// Corre TODO el trabajo de fondo de mensajería vencido. Idempotente y tolerante a
// ticks perdidos (cada sub-tarea filtra por due<=now). Lo invoca pg_cron cada minuto
// vía /api/cron/dispatch. Reemplaza el scheduling individual de los crons de
// mensajería (process-broadcasts/process-jobs/process-flows/evaluate-time-flows/
// sync-templates), que quedan como endpoints manuales.
export async function runDispatch(now: Date = new Date()): Promise<DispatchResult> {
  const service = createServiceClient()

  // 1) Alta frecuencia: corren en cada tick.
  //    - promover difusiones programadas → encolar envíos
  //    - drenar job_queue (envíos de difusión, start_flow, descarga de media)
  //    - avanzar ejecuciones de flow vencidas
  const broadcasts = await processScheduledBroadcasts()
  const jobs = await runWorker({ limit: JOB_LIMIT, handler: messagingJobHandler })
  const flows = await tickDueFlows(service, FLOW_TICK_LIMIT)

  // 2) Gated por cadencia (minuto/hora UTC). Cada una aislada: si una falla,
  //    se loguea (sin PII) y el tick continúa.
  const gated = gatedTasksDue(now)
  for (const task of gated) {
    try {
      if (task === 'evaluate_time_triggers') {
        await evaluateTimeTriggers()
      } else if (task === 'sync_templates') {
        await syncAllConnectedTemplates(service)
      } else if (task === 'refresh_meta_tokens') {
        await refreshExpiringMetaTokens()
      }
    } catch (e) {
      console.error(`[dispatch.${task}]`, (e as Error).message)
    }
  }

  return { broadcasts, jobs, flows, gated }
}

// Replica de /api/cron/process-flows: tickea ejecuciones running vencidas, con
// backoff recuperable (+30s) y markFailed para errores no-recuperables.
async function tickDueFlows(
  service: ServiceClient,
  limit: number,
): Promise<{ ok: number; failed: number }> {
  const { data: executions } = await service
    .from('flow_executions')
    .select('id')
    .eq('status', 'running')
    .lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true })
    .limit(limit)

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
      } else {
        await service
          .from('flow_executions')
          .update({ next_run_at: new Date(Date.now() + 30_000).toISOString(), error: msg })
          .eq('id', exec.id)
      }
      failed += 1
    }
  }
  return { ok, failed }
}

// Sync de templates de cada canal WhatsApp conectado (igual que /api/cron/sync-templates).
async function syncAllConnectedTemplates(service: ServiceClient): Promise<void> {
  const { data: channels } = await service
    .from('channels')
    .select('*')
    .eq('type', 'whatsapp')
    .eq('status', 'connected')
  for (const channel of channels ?? []) {
    try {
      await syncTemplates(channel)
    } catch (e) {
      console.error('[dispatch.sync_templates]', channel.id, (e as Error).message)
    }
  }
}
