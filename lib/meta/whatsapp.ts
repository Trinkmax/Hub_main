import 'server-only'
import { decryptToken } from './crypto'
import { graphUrl } from './env'
import { metaFetch } from './http'

export type WhatsAppChannelLike = {
  id: string
  external_phone_number_id: string | null
  external_account_id: string
  encrypted_access_token: string | null
}

export type WhatsAppSendResult = {
  meta_message_id: string
}

type SendResponse = { messages?: Array<{ id: string }> }

async function getAccessToken(channel: WhatsAppChannelLike): Promise<string> {
  if (!channel.encrypted_access_token) {
    throw new Error('Channel has no access token configured')
  }
  return decryptToken(channel.encrypted_access_token)
}

function requirePhoneId(channel: WhatsAppChannelLike): string {
  if (!channel.external_phone_number_id) {
    throw new Error('WhatsApp channel missing phone_number_id')
  }
  return channel.external_phone_number_id
}

export async function sendText(
  channel: WhatsAppChannelLike,
  to: string,
  text: string,
): Promise<WhatsAppSendResult> {
  const accessToken = await getAccessToken(channel)
  const url = graphUrl(`${requirePhoneId(channel)}/messages`)
  const res = await metaFetch<SendResponse>(url, {
    accessToken,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: true },
    },
  })
  const id = res.messages?.[0]?.id
  if (!id) throw new Error('WhatsApp send: missing message id in response')
  return { meta_message_id: id }
}

export type TemplateVariable = string

export async function sendTemplate(
  channel: WhatsAppChannelLike,
  to: string,
  templateName: string,
  language: string,
  variables: TemplateVariable[] = [],
): Promise<WhatsAppSendResult> {
  const accessToken = await getAccessToken(channel)
  const url = graphUrl(`${requirePhoneId(channel)}/messages`)
  const components =
    variables.length > 0
      ? [
          {
            type: 'body',
            parameters: variables.map((v) => ({ type: 'text', text: v })),
          },
        ]
      : undefined
  const res = await metaFetch<SendResponse>(url, {
    accessToken,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        ...(components ? { components } : {}),
      },
    },
  })
  const id = res.messages?.[0]?.id
  if (!id) throw new Error('WhatsApp send: missing message id in response')
  return { meta_message_id: id }
}

export type WhatsAppMediaType = 'image' | 'video' | 'document' | 'audio'

export async function sendMedia(
  channel: WhatsAppChannelLike,
  to: string,
  mediaUrl: string,
  type: WhatsAppMediaType,
  caption?: string,
): Promise<WhatsAppSendResult> {
  const accessToken = await getAccessToken(channel)
  const url = graphUrl(`${requirePhoneId(channel)}/messages`)
  const mediaPayload: Record<string, unknown> = { link: mediaUrl }
  if (caption && (type === 'image' || type === 'video' || type === 'document')) {
    mediaPayload.caption = caption
  }
  const res = await metaFetch<SendResponse>(url, {
    accessToken,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type,
      [type]: mediaPayload,
    },
  })
  const id = res.messages?.[0]?.id
  if (!id) throw new Error('WhatsApp send: missing message id in response')
  return { meta_message_id: id }
}

export async function markRead(channel: WhatsAppChannelLike, metaMessageId: string): Promise<void> {
  const accessToken = await getAccessToken(channel)
  const url = graphUrl(`${requirePhoneId(channel)}/messages`)
  await metaFetch(url, {
    accessToken,
    body: {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: metaMessageId,
    },
  })
}

// Suscribir nuestra app a los webhooks del WABA (después de Embedded Signup).
export async function subscribeAppToWaba(wabaId: string, accessToken: string): Promise<void> {
  await metaFetch(graphUrl(`${wabaId}/subscribed_apps`), {
    method: 'POST',
    accessToken,
  })
}

export type WabaPhoneNumber = {
  id: string
  display_phone_number: string
  verified_name: string
}

export async function listWabaPhoneNumbers(
  wabaId: string,
  accessToken: string,
): Promise<WabaPhoneNumber[]> {
  const res = await metaFetch<{ data?: WabaPhoneNumber[] }>(
    graphUrl(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`),
    { accessToken },
  )
  return res.data ?? []
}
