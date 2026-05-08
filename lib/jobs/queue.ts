import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json } from '@/types/database'

export type JobRow = Database['public']['Tables']['job_queue']['Row']

export type EnqueueOpts = {
  tenantId: string
  kind: string
  payload: Json
  runAt?: Date
  maxAttempts?: number
}

export async function enqueueJob(opts: EnqueueOpts): Promise<string> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('enqueue_job', {
    p_tenant_id: opts.tenantId,
    p_kind: opts.kind,
    p_payload: opts.payload,
    p_run_at: (opts.runAt ?? new Date()).toISOString(),
    p_max_attempts: opts.maxAttempts ?? 5,
  })
  if (error || !data) throw new Error(`enqueueJob: ${error?.message ?? 'no id'}`)
  return data
}

export async function claimJobs(opts: { kind?: string; limit?: number }): Promise<JobRow[]> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('claim_jobs', {
    p_kind: opts.kind ?? null,
    p_limit: opts.limit ?? 25,
  })
  if (error) throw new Error(`claimJobs: ${error.message}`)
  return (data ?? []) as JobRow[]
}

export async function completeJob(id: string): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.rpc('complete_job', { p_id: id })
  if (error) throw new Error(`completeJob: ${error.message}`)
}

export async function failJob(id: string, err: string, recoverable = true): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.rpc('fail_job', {
    p_id: id,
    p_error: err,
    p_recoverable: recoverable,
  })
  if (error) throw new Error(`failJob: ${error.message}`)
}

export async function requeueStuckJobs(thresholdSeconds = 300): Promise<number> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('requeue_stuck_jobs', {
    p_threshold_seconds: thresholdSeconds,
  })
  if (error) throw new Error(`requeueStuckJobs: ${error.message}`)
  return data ?? 0
}
