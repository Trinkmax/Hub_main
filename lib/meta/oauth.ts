import 'server-only'
import { getMetaConfig, graphUrl } from './env'
import { metaFetch } from './http'

// ───────────── WhatsApp / Facebook OAuth (Embedded Signup) ─────────────

export function buildWhatsAppEmbeddedSignupUrl(opts: { redirectUri: string; state: string }) {
  const { appId, graphVersion } = getMetaConfig()
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    state: opts.state,
    scope: 'whatsapp_business_management,whatsapp_business_messaging,business_management',
    extras: JSON.stringify({
      feature: 'whatsapp_embedded_signup',
      version: 3,
    }),
  })
  return `https://www.facebook.com/${graphVersion}/dialog/oauth?${params.toString()}`
}

export async function exchangeFacebookCode(opts: {
  code: string
  redirectUri: string
}): Promise<{ access_token: string; expires_in?: number; token_type?: string }> {
  const { appId, appSecret } = getMetaConfig()
  const url = graphUrl(
    `oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(
      appSecret,
    )}&code=${encodeURIComponent(opts.code)}&redirect_uri=${encodeURIComponent(opts.redirectUri)}`,
  )
  return metaFetch(url, { method: 'GET' })
}

export type DebugTokenResponse = {
  data?: {
    granular_scopes?: Array<{
      scope?: string
      target_ids?: string[]
    }>
    expires_at?: number
    is_valid?: boolean
  }
}

// Encuentra el WABA al que el usuario dio acceso al instalar la app.
export async function findWabaIdsFromToken(accessToken: string): Promise<string[]> {
  const { appId, appSecret } = getMetaConfig()
  const appAccessToken = `${appId}|${appSecret}`
  const res = await metaFetch<DebugTokenResponse>(
    graphUrl(`debug_token?input_token=${encodeURIComponent(accessToken)}`),
    { accessToken: appAccessToken },
  )
  const scopes = res.data?.granular_scopes ?? []
  const wabaScope = scopes.find((s) => s.scope === 'whatsapp_business_management')
  return wabaScope?.target_ids ?? []
}

// ───────────── Instagram Login ─────────────

export function buildInstagramLoginUrl(opts: { redirectUri: string; state: string }) {
  const { appId } = getMetaConfig()
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    state: opts.state,
    scope:
      'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
  })
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`
}

export async function exchangeInstagramCode(opts: {
  code: string
  redirectUri: string
}): Promise<{ access_token: string; user_id: string }> {
  const { appId, appSecret } = getMetaConfig()
  const form = new URLSearchParams()
  form.set('client_id', appId)
  form.set('client_secret', appSecret)
  form.set('grant_type', 'authorization_code')
  form.set('redirect_uri', opts.redirectUri)
  form.set('code', opts.code)

  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Instagram code exchange failed (${res.status}): ${text}`)
  }
  const parsed = JSON.parse(text) as
    | { access_token?: string; user_id?: string | number }
    | { data?: Array<{ access_token?: string; user_id?: string | number }> }
  const obj =
    'data' in parsed && Array.isArray(parsed.data)
      ? (parsed.data[0] ?? {})
      : (parsed as Record<string, unknown>)
  const token = obj.access_token as string | undefined
  const userId = obj.user_id
  if (!token || !userId) {
    throw new Error('Instagram code exchange: missing access_token or user_id')
  }
  return { access_token: token, user_id: String(userId) }
}

// Intercambia un short-lived token de IG por uno long-lived (~60 días).
export async function exchangeForLongLivedInstagramToken(
  shortLivedToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const { appSecret } = getMetaConfig()
  const url = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
    appSecret,
  )}&access_token=${encodeURIComponent(shortLivedToken)}`
  return metaFetch(url, { method: 'GET' })
}
