import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mockeamos crypto.decryptToken antes de importar los senders.
vi.mock('@/lib/meta/crypto', () => ({
  encryptToken: vi.fn(async (s: string) => `enc(${s})`),
  decryptToken: vi.fn(async (_s: string) => 'TEST_ACCESS_TOKEN'),
}))

vi.mock('@/lib/meta/env', async () => {
  return {
    getMetaConfig: async () => ({
      appId: 'APP',
      appSecret: 'SECRET',
      webhookVerifyToken: 'VERIFY',
      graphVersion: 'v23.0',
      tokenKey: 'KEY',
      appUrl: 'https://app.test',
    }),
    graphUrl: (path: string) => `https://graph.facebook.com/v23.0/${path.replace(/^\//, '')}`,
    instagramGraphUrl: (path: string) =>
      `https://graph.instagram.com/v23.0/${path.replace(/^\//, '')}`,
  }
})

import { MetaApiError, mapMetaErrorToStatus } from '@/lib/meta/errors'
import { sendDM } from '@/lib/meta/instagram'
import { sendTemplate, sendText } from '@/lib/meta/whatsapp'

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
  external_phone_number_id: 'PHONE_ID',
  external_account_id: 'WABA_ID',
  encrypted_access_token: 'enc_token',
}

const IG_CHANNEL = {
  id: 'ch2',
  external_account_id: 'IG_USER_ID',
  encrypted_access_token: 'enc_token',
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('whatsapp.sendText', () => {
  it('manda payload de texto al endpoint correcto y devuelve message id', async () => {
    let captured: FetchArgs | null = null
    mockFetchOnce((args) => {
      captured = args
      return { status: 200, body: { messages: [{ id: 'wamid.OUT1' }] } }
    })

    const res = await sendText(WA_CHANNEL, '5491145551234', 'Hola!')
    expect(res.meta_message_id).toBe('wamid.OUT1')
    if (!captured) throw new Error('fetch was not called')
    const args = captured as FetchArgs
    expect(args.url).toBe('https://graph.facebook.com/v23.0/PHONE_ID/messages')
    expect(args.init.method).toBe('POST')
    const body = JSON.parse(String(args.init.body))
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5491145551234',
      type: 'text',
      text: { body: 'Hola!' },
    })
    const headers = args.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer TEST_ACCESS_TOKEN')
  })

  it('mapea error 131026 (fuera de ventana 24h) a failed con razón legible', async () => {
    mockFetchOnce(() => ({
      status: 400,
      body: {
        error: {
          message: 'Re-engagement message',
          type: 'OAuthException',
          code: 131026,
        },
      },
    }))

    await expect(sendText(WA_CHANNEL, '54900', 'Hola')).rejects.toBeInstanceOf(MetaApiError)
    try {
      await sendText(WA_CHANNEL, '54900', 'Hola')
    } catch (e) {
      const mapped = mapMetaErrorToStatus(e as MetaApiError)
      expect(mapped.status).toBe('failed')
      expect(mapped.reason).toMatch(/ventana de 24/i)
    }
  })
})

describe('whatsapp.sendTemplate', () => {
  it('arma componente body con variables', async () => {
    let captured: FetchArgs | null = null
    mockFetchOnce((args) => {
      captured = args
      return { status: 200, body: { messages: [{ id: 'wamid.T1' }] } }
    })

    await sendTemplate(WA_CHANNEL, '5491100', 'welcome', 'es_AR', ['Juan', '500'])
    if (!captured) throw new Error('fetch not called')
    const body = JSON.parse(String((captured as FetchArgs).init.body))
    expect(body.template).toMatchObject({
      name: 'welcome',
      language: { code: 'es_AR' },
    })
    expect(body.template.components[0]).toMatchObject({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Juan' },
        { type: 'text', text: '500' },
      ],
    })
  })

  it('omite componentes cuando no hay variables', async () => {
    let captured: FetchArgs | null = null
    mockFetchOnce((args) => {
      captured = args
      return { status: 200, body: { messages: [{ id: 'wamid.T2' }] } }
    })

    await sendTemplate(WA_CHANNEL, '5491100', 'noop', 'es_AR', [])
    if (!captured) throw new Error('fetch not called')
    const body = JSON.parse(String((captured as FetchArgs).init.body))
    expect(body.template.components).toBeUndefined()
  })
})

describe('instagram.sendDM', () => {
  it('manda DM contra graph.instagram.com con la forma correcta', async () => {
    let captured: FetchArgs | null = null
    mockFetchOnce((args) => {
      captured = args
      return { status: 200, body: { recipient_id: 'X', message_id: 'mid.OUT1' } }
    })

    const res = await sendDM(IG_CHANNEL, 'IGSID_123', 'hola')
    expect(res.meta_message_id).toBe('mid.OUT1')
    if (!captured) throw new Error('fetch not called')
    const args = captured as FetchArgs
    expect(args.url).toBe('https://graph.instagram.com/v23.0/IG_USER_ID/messages')
    const body = JSON.parse(String(args.init.body))
    expect(body).toEqual({
      recipient: { id: 'IGSID_123' },
      message: { text: 'hola' },
    })
  })
})
