import { describe, expect, it } from 'vitest'
import { savePlatformMetaConfigSchema } from '@/lib/platform/meta-config-schema'

describe('savePlatformMetaConfigSchema', () => {
  it('acepta appSecret vacío (= conservar)', () => {
    const r = savePlatformMetaConfigSchema.safeParse({
      appId: '123',
      appSecret: '',
      webhookVerifyToken: 'tok',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza appId vacío', () => {
    const r = savePlatformMetaConfigSchema.safeParse({ appId: '', webhookVerifyToken: 'tok' })
    expect(r.success).toBe(false)
  })

  it('rechaza webhookVerifyToken vacío', () => {
    const r = savePlatformMetaConfigSchema.safeParse({ appId: '123', webhookVerifyToken: '' })
    expect(r.success).toBe(false)
  })
})
