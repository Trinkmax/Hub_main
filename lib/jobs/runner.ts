import 'server-only'
import { MetaApiError } from '@/lib/meta/errors'
import { claimJobs, completeJob, failJob, type JobRow, requeueStuckJobs } from './queue'

// Errores Meta no recuperables (token revocado, template inválido).
const FATAL_META_CODES = new Set<number>([190, 102, 463, 132000, 132001, 132005, 132007])

export type JobHandler = (job: JobRow) => Promise<void>

export type RunWorkerResult = {
  reaped: number
  claimed: number
  ok: number
  failed: number
}

export async function runWorker(opts: {
  kind?: string
  limit?: number
  handler: JobHandler
}): Promise<RunWorkerResult> {
  const reaped = await requeueStuckJobs()
  const jobs = await claimJobs({ kind: opts.kind, limit: opts.limit ?? 25 })
  let ok = 0
  let failed = 0
  for (const job of jobs) {
    try {
      await opts.handler(job)
      await completeJob(job.id)
      ok += 1
    } catch (err) {
      const recoverable = isRecoverable(err)
      const message = (err as Error).message ?? 'unknown error'
      await failJob(job.id, message, recoverable)
      failed += 1
    }
  }
  return { reaped, claimed: jobs.length, ok, failed }
}

export function isRecoverable(err: unknown): boolean {
  if (err instanceof MetaApiError) {
    if (err.code != null && FATAL_META_CODES.has(err.code)) return false
    // 5xx + rate limits + network → recoverable
    if (err.status >= 500) return true
    if (err.code === 131056 || err.code === 80007) return true
    // 4xx con código desconocido → asumimos no recuperable para no spammear
    if (err.status >= 400 && err.status < 500) return false
    return true
  }
  // Errores genéricos (network, timeout) → recoverable
  return true
}
