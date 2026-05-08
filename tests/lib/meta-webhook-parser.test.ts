import { describe, expect, it } from 'vitest'
import { parseInstagramPayload, parseWhatsAppPayload } from '@/lib/meta/webhook-parser'

const WA_INBOUND_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '215589313241560883',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15551797781',
              phone_number_id: '7794189252778687',
            },
            contacts: [{ profile: { name: 'Jessica' }, wa_id: '13557825698' }],
            messages: [
              {
                from: '17863559966',
                id: 'wamid.HBgL1',
                timestamp: '1758254144',
                type: 'text',
                text: { body: 'Hi!' },
              },
            ],
          },
        },
      ],
    },
  ],
}

const WA_STATUS_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'x',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '7794189252778687' },
            statuses: [
              {
                id: 'wamid.OUTBOUND1',
                status: 'delivered',
                timestamp: '1758254200',
              },
              {
                id: 'wamid.OUTBOUND2',
                status: 'failed',
                timestamp: '1758254300',
                errors: [{ code: 131026, message: 'Out of 24h window' }],
              },
            ],
          },
        },
      ],
    },
  ],
}

const IG_PAYLOAD = {
  object: 'instagram',
  entry: [
    {
      id: 'IG_USER_ID_1',
      time: 1234567890,
      messaging: [
        {
          sender: { id: 'SENDER1' },
          recipient: { id: 'IG_USER_ID_1' },
          timestamp: 1234567890000,
          message: { mid: 'mid.IG.1', text: 'hola' },
        },
        {
          sender: { id: 'IG_USER_ID_1' },
          recipient: { id: 'SENDER1' },
          timestamp: 1234567890001,
          message: { mid: 'mid.IG.echo', text: 'soy yo', is_echo: true },
        },
      ],
    },
  ],
}

describe('parseWhatsAppPayload', () => {
  it('parsea un mensaje inbound con texto', () => {
    const out = parseWhatsAppPayload(WA_INBOUND_PAYLOAD)
    expect(out.messages).toHaveLength(1)
    const m = out.messages[0]
    if (!m) throw new Error('expected message')
    expect(m.metaMessageId).toBe('wamid.HBgL1')
    expect(m.phoneNumberId).toBe('7794189252778687')
    expect(m.from).toBe('17863559966')
    expect(m.text).toBe('Hi!')
    expect(m.contactName).toBe('Jessica')
  })

  it('idempotencia: mismo payload genera el mismo metaMessageId', () => {
    const a = parseWhatsAppPayload(WA_INBOUND_PAYLOAD)
    const b = parseWhatsAppPayload(WA_INBOUND_PAYLOAD)
    expect(a.messages.map((m) => m.metaMessageId)).toEqual(b.messages.map((m) => m.metaMessageId))
  })

  it('parsea statuses incluyendo failed con error', () => {
    const out = parseWhatsAppPayload(WA_STATUS_PAYLOAD)
    expect(out.statuses).toHaveLength(2)
    expect(out.statuses[0]?.status).toBe('delivered')
    expect(out.statuses[1]?.status).toBe('failed')
    expect(out.statuses[1]?.errorMessage).toBe('Out of 24h window')
  })

  it('ignora payloads que no son del object whatsapp_business_account', () => {
    const out = parseWhatsAppPayload({ object: 'page', entry: [] })
    expect(out.messages).toHaveLength(0)
    expect(out.statuses).toHaveLength(0)
  })

  it('ignora mensajes sin id', () => {
    const out = parseWhatsAppPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'x' },
                messages: [{ from: '1', timestamp: '1' }],
              },
            },
          ],
        },
      ],
    })
    expect(out.messages).toHaveLength(0)
  })
})

describe('parseInstagramPayload', () => {
  it('parsea un DM inbound y rutea por entry.id (igUserId)', () => {
    const out = parseInstagramPayload(IG_PAYLOAD)
    expect(out).toHaveLength(2)
    const inbound = out.find((m) => !m.isEcho)
    expect(inbound?.metaMessageId).toBe('mid.IG.1')
    expect(inbound?.igUserId).toBe('IG_USER_ID_1')
    expect(inbound?.senderId).toBe('SENDER1')
    expect(inbound?.text).toBe('hola')
  })

  it('marca echo correctamente para mensajes outbound espejados', () => {
    const out = parseInstagramPayload(IG_PAYLOAD)
    const echo = out.find((m) => m.isEcho)
    expect(echo).toBeDefined()
    expect(echo?.metaMessageId).toBe('mid.IG.echo')
  })

  it('ignora payloads que no son del object instagram', () => {
    expect(parseInstagramPayload({ object: 'page', entry: [] })).toEqual([])
  })
})
