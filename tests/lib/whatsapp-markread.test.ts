import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/meta/crypto', () => ({
  decryptToken: vi.fn(async (_s: string) => 'TEST_ACCESS_TOKEN'),
}))

vi.mock('@/lib/meta/env', () => ({
  getMetaConfig: async () => ({
    appId: 'APP',
    appSecret: 'SECRET',
    webhookVerifyToken: 'VERIFY',
    graphVersion: 'v23.0',
    tokenKey: 'KEY',
    appUrl: 'https://app.test',
  }),
  graphUrl: (path: string) => `https://graph.facebook.com/v23.0/${path.replace(/^\//, '')}`,
}))

import { markRead } from '@/lib/meta/whatsapp'

type FetchArgs = { url: string; init: RequestInit }

function mockFetchOnce(handler: (args: FetchArgs) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const res = handler({ url, init })
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

const WA_CHANNEL = {
  id: 'ch1',
  external_phone_number_id: 'PHONE_ID_123',
  external_account_id: 'WABA_ID',
  encrypted_access_token: 'enc_token',
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('whatsapp.markRead', () => {
  it('POSTea status:read con el message_id correcto al endpoint de mensajes', async () => {
    let captured: FetchArgs | null = null
    mockFetchOnce((args) => {
      captured = args
      return { status: 200, body: { success: true } }
    })

    await markRead(WA_CHANNEL, 'wamid.INBOUND_MSG_ID')

    if (!captured) throw new Error('fetch was not called')
    const args = captured as FetchArgs

    expect(args.url).toBe('https://graph.facebook.com/v23.0/PHONE_ID_123/messages')
    expect(args.init.method).toBe('POST')

    const body = JSON.parse(String(args.init.body))
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.INBOUND_MSG_ID',
    })

    const headers = args.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer TEST_ACCESS_TOKEN')
  })

  it('propaga el error de Meta si la respuesta no es 2xx', async () => {
    mockFetchOnce(() => ({
      status: 400,
      body: { error: { message: 'Invalid message id', type: 'OAuthException', code: 100 } },
    }))

    await expect(markRead(WA_CHANNEL, 'bad_id')).rejects.toThrow()
  })

  it('lanza error si el canal no tiene phone_number_id', async () => {
    const noPhoneChannel = { ...WA_CHANNEL, external_phone_number_id: null }
    await expect(markRead(noPhoneChannel, 'wamid.123')).rejects.toThrow(
      'WhatsApp channel missing phone_number_id',
    )
  })
})
