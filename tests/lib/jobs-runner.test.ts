import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRecoverable } from '@/lib/jobs/runner'
import { MetaApiError } from '@/lib/meta/errors'

// Mocks de la queue: los hooks del runner consultan estas funciones, las
// suplantamos para no tocar Postgres. El mock es estático (factory) para que
// sea estable entre imports.
const mocks = vi.hoisted(() => ({
  claimJobs: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  requeueStuckJobs: vi.fn(),
}))

vi.mock('@/lib/jobs/queue', () => mocks)

describe('isRecoverable', () => {
  it('errores genéricos son recuperables', () => {
    expect(isRecoverable(new Error('network blip'))).toBe(true)
  })

  it('Meta 5xx es recuperable', () => {
    const err = new MetaApiError(502, { message: 'bad gateway' })
    expect(isRecoverable(err)).toBe(true)
  })

  it('Meta 131056 (rate limit) es recuperable', () => {
    const err = new MetaApiError(429, { message: 'rate', code: 131056 })
    expect(isRecoverable(err)).toBe(true)
  })

  it('Meta 190 (token expirado) NO es recuperable', () => {
    const err = new MetaApiError(401, { message: 'expired', code: 190 })
    expect(isRecoverable(err)).toBe(false)
  })

  it('Meta 132xxx (template) NO son recuperables', () => {
    const err = new MetaApiError(400, { message: 'bad template', code: 132000 })
    expect(isRecoverable(err)).toBe(false)
  })

  it('Meta 4xx desconocido NO es recuperable (evita bucle)', () => {
    const err = new MetaApiError(403, { message: 'forbidden', code: 999999 })
    expect(isRecoverable(err)).toBe(false)
  })
})

describe('runWorker (mocked queue)', () => {
  beforeEach(() => {
    mocks.claimJobs.mockReset()
    mocks.completeJob.mockReset().mockResolvedValue(undefined)
    mocks.failJob.mockReset().mockResolvedValue(undefined)
    mocks.requeueStuckJobs.mockReset().mockResolvedValue(0)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reclama jobs, completa los exitosos y falla los recuperables con backoff', async () => {
    mocks.claimJobs.mockResolvedValue([
      { id: 'job-1', kind: 'send_broadcast_message', payload: {} },
      { id: 'job-2', kind: 'send_broadcast_message', payload: {} },
    ])
    const { runWorker } = await import('@/lib/jobs/runner')
    const handler = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network blip'))
    const res = await runWorker({ handler })
    expect(res).toEqual({ reaped: 0, claimed: 2, ok: 1, failed: 1 })
    expect(mocks.completeJob).toHaveBeenCalledWith('job-1')
    expect(mocks.failJob).toHaveBeenCalledWith('job-2', 'network blip', true)
  })

  it('marca como no recuperable cuando MetaApiError es fatal', async () => {
    mocks.claimJobs.mockResolvedValue([{ id: 'job-3', kind: 'k', payload: {} }])
    const { runWorker } = await import('@/lib/jobs/runner')
    await runWorker({
      handler: async () => {
        throw new MetaApiError(401, { message: 'expired', code: 190 })
      },
    })
    expect(mocks.failJob).toHaveBeenCalledWith('job-3', 'expired', false)
  })
})
