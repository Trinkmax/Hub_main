import { describe, expect, it } from 'vitest'
import { resolveMetaCredentials } from '@/lib/meta/platform-config'

const env = { appId: 'ENV_ID', appSecret: 'ENV_SECRET', webhookVerifyToken: 'ENV_TOKEN' }

describe('resolveMetaCredentials', () => {
  it('usa el valor de DB cuando está presente', () => {
    const out = resolveMetaCredentials(
      { appId: 'DB_ID', appSecret: 'DB_SECRET', webhookVerifyToken: 'DB_TOKEN' },
      env,
    )
    expect(out).toEqual({ appId: 'DB_ID', appSecret: 'DB_SECRET', webhookVerifyToken: 'DB_TOKEN' })
  })

  it('cae al env cuando el campo de DB es null/empty', () => {
    const out = resolveMetaCredentials(
      { appId: 'DB_ID', appSecret: null, webhookVerifyToken: '' },
      env,
    )
    expect(out).toEqual({
      appId: 'DB_ID',
      appSecret: 'ENV_SECRET',
      webhookVerifyToken: 'ENV_TOKEN',
    })
  })

  it('tira error claro si un campo falta en DB y env', () => {
    expect(() =>
      resolveMetaCredentials(
        { appId: null, appSecret: null, webhookVerifyToken: null },
        { appId: null, appSecret: null, webhookVerifyToken: null },
      ),
    ).toThrow(/META_APP_ID/)
  })
})
