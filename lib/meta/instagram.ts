import 'server-only'
import { decryptToken } from './crypto'
import { instagramGraphUrl } from './env'
import { metaFetch } from './http'

export type InstagramChannelLike = {
  id: string
  external_account_id: string // IG user id
  encrypted_access_token: string | null
}

export type InstagramSendResult = {
  meta_message_id: string
}

type SendResponse = {
  recipient_id?: string
  message_id?: string
}

async function getAccessToken(channel: InstagramChannelLike): Promise<string> {
  if (!channel.encrypted_access_token) {
    throw new Error('Instagram channel has no access token configured')
  }
  return decryptToken(channel.encrypted_access_token)
}

// Endpoint del flujo "Instagram API with Instagram Login": graph.instagram.com.
// scopes requeridos: instagram_business_basic + instagram_business_manage_messages.
export async function sendDM(
  channel: InstagramChannelLike,
  to: string,
  text: string,
): Promise<InstagramSendResult> {
  const accessToken = await getAccessToken(channel)
  const url = instagramGraphUrl(`${channel.external_account_id}/messages`)
  const res = await metaFetch<SendResponse>(url, {
    accessToken,
    body: {
      recipient: { id: to },
      message: { text },
    },
  })
  if (!res.message_id) throw new Error('Instagram send: missing message_id in response')
  return { meta_message_id: res.message_id }
}
