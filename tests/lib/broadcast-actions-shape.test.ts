/**
 * Tests for broadcast actions shape.
 *
 * NOTE: Importing lib/broadcasts/actions.ts directly in vitest is impractical
 * because it transitively pulls in next/cache, @/lib/supabase/server,
 * @/lib/meta/whatsapp (server-only), and other modules that require a full
 * Next.js runtime or extensive mocking. The meaningful logic (variable
 * resolution, throttle) is already covered in broadcast-variables.test.ts and
 * broadcast-throttle.test.ts. Here we validate the schemas consumed by the
 * new actions and assert the action exports exist via dynamic import with
 * vi.mock stubs.
 */
import { describe, expect, it, vi } from 'vitest'
import { broadcastTestSchema } from '@/lib/broadcasts/schemas'

// ---------------------------------------------------------------------------
// Schema validation — broadcastTestSchema used by sendBroadcastTest
// ---------------------------------------------------------------------------
describe('broadcastTestSchema', () => {
  it('rejects empty to_phone', () => {
    const result = broadcastTestSchema.safeParse({
      channel_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      template_id: 'b3d8e7c6-5a4f-4b3e-8c2d-1f9a7b3e5d2c',
      to_phone: '',
      variable_mapping: {},
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing to_phone', () => {
    const result = broadcastTestSchema.safeParse({
      channel_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      template_id: 'b3d8e7c6-5a4f-4b3e-8c2d-1f9a7b3e5d2c',
      variable_mapping: {},
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid uuid for channel_id', () => {
    const result = broadcastTestSchema.safeParse({
      channel_id: 'not-a-uuid',
      template_id: 'b3d8e7c6-5a4f-4b3e-8c2d-1f9a7b3e5d2c',
      to_phone: '+5493513001234',
      variable_mapping: {},
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid input and defaults variable_mapping to {}', () => {
    const result = broadcastTestSchema.safeParse({
      channel_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      template_id: 'b3d8e7c6-5a4f-4b3e-8c2d-1f9a7b3e5d2c',
      to_phone: '+5493513001234',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variable_mapping).toEqual({})
    }
  })

  it('accepts variable_mapping with valid entries', () => {
    const result = broadcastTestSchema.safeParse({
      channel_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      template_id: 'b3d8e7c6-5a4f-4b3e-8c2d-1f9a7b3e5d2c',
      to_phone: '3513001234',
      variable_mapping: {
        '1': { source: 'first_name', fallback: 'amigo' },
        '2': { source: 'custom', value: 'HUB' },
      },
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Export presence — assert actions module exports the expected functions.
// We vi.mock all server-side deps so the module can be imported in vitest.
// ---------------------------------------------------------------------------
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/tenant', () => ({
  requireTenantAccess: vi.fn(),
  requireRole: vi.fn(),
  RoleRequiredError: class RoleRequiredError extends Error {},
  TenantNotFoundError: class TenantNotFoundError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}))
vi.mock('@/lib/jobs/queue', () => ({ enqueueJob: vi.fn() }))
vi.mock('@/lib/meta/whatsapp', () => ({ sendTemplate: vi.fn() }))
vi.mock('@/lib/phone', () => ({ tryNormalizePhone: vi.fn() }))

describe('broadcast actions exports', () => {
  it('exports scheduleBroadcast, cancelBroadcast, sendBroadcastNow, resendFailedRecipients, sendBroadcastTest', async () => {
    const mod = await import('@/lib/broadcasts/actions')
    expect(typeof mod.scheduleBroadcast).toBe('function')
    expect(typeof mod.cancelBroadcast).toBe('function')
    expect(typeof mod.sendBroadcastNow).toBe('function')
    expect(typeof mod.resendFailedRecipients).toBe('function')
    expect(typeof mod.sendBroadcastTest).toBe('function')
  })
})
