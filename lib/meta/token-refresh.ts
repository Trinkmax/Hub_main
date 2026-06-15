import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptToken, encryptToken } from './crypto'
import { getMetaConfig } from './env'
import { metaFetch } from './http'

// ────────────────────────────────────────────────────────────────
// Pure helper — no side effects, easy to unit-test
// ────────────────────────────────────────────────────────────────

/**
 * Returns true when `expiresAt` is within `withinDays` days from `now`
 * (or already past). Returns false when expiresAt is null (no expiry tracked).
 */
export function isTokenExpiringSoon(expiresAt: string | null, now: Date, withinDays = 7): boolean {
  if (!expiresAt) return false
  const expiresDate = new Date(expiresAt)
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000)
  return expiresDate <= cutoff
}

// ────────────────────────────────────────────────────────────────
// Token refresh API calls
// ────────────────────────────────────────────────────────────────

type TokenRefreshResult = { access_token: string; expires_in: number }

/**
 * WhatsApp / Facebook: exchange the current long-lived user token for a new one.
 * Re-exchanging a valid long-lived token extends it ~60 days.
 * GET https://graph.facebook.com/v{ver}/oauth/access_token
 *   ?grant_type=fb_exchange_token
 *   &client_id={app_id}
 *   &client_secret={app_secret}
 *   &fb_exchange_token={current_token}
 */
async function refreshWhatsAppToken(currentToken: string): Promise<TokenRefreshResult> {
  const { appId, appSecret, graphVersion } = getMetaConfig()
  const url =
    `https://graph.facebook.com/${graphVersion}/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(currentToken)}`
  return metaFetch<TokenRefreshResult>(url, { method: 'GET' })
}

/**
 * Instagram: refresh a long-lived token (must be called before it expires; valid
 * tokens can be refreshed at any time).
 * GET https://graph.instagram.com/refresh_access_token
 *   ?grant_type=ig_refresh_token
 *   &access_token={current_token}
 * → { access_token, token_type, expires_in }
 */
async function refreshInstagramToken(currentToken: string): Promise<TokenRefreshResult> {
  const url =
    `https://graph.instagram.com/refresh_access_token` +
    `?grant_type=ig_refresh_token` +
    `&access_token=${encodeURIComponent(currentToken)}`
  return metaFetch<TokenRefreshResult>(url, { method: 'GET' })
}

// ────────────────────────────────────────────────────────────────
// Main service function
// ────────────────────────────────────────────────────────────────

export interface RefreshResult {
  refreshed: number
  failed: number
}

/**
 * Finds all connected channels whose tokens expire within `withinDays` days and
 * attempts to refresh them via the appropriate Meta API. On success the new token
 * is re-encrypted and stored; on failure `last_error` is set and `status` is set
 * to `'error'` so the UI can prompt the owner to reconnect.
 */
export async function refreshExpiringMetaTokens(
  opts: { withinDays?: number } = {},
): Promise<RefreshResult> {
  const withinDays = opts.withinDays ?? 7
  const service = createServiceClient()

  // Build the cutoff timestamp as an ISO string Postgres can compare against.
  const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: channels, error } = await service
    .from('channels')
    .select('id, type, encrypted_access_token, token_expires_at')
    .eq('status', 'connected')
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', cutoff)

  if (error) {
    console.error('[token-refresh] query failed:', error.message)
    return { refreshed: 0, failed: 0 }
  }

  let refreshed = 0
  let failed = 0

  for (const channel of channels ?? []) {
    if (!channel.encrypted_access_token) {
      failed++
      continue
    }

    try {
      const currentToken = await decryptToken(channel.encrypted_access_token)

      let result: TokenRefreshResult
      if (channel.type === 'whatsapp') {
        result = await refreshWhatsAppToken(currentToken)
      } else if (channel.type === 'instagram') {
        result = await refreshInstagramToken(currentToken)
      } else {
        // Unknown channel type — skip silently
        continue
      }

      const newEncrypted = await encryptToken(result.access_token)
      const newExpiresAt = new Date(Date.now() + result.expires_in * 1000).toISOString()

      const { error: updateError } = await service
        .from('channels')
        .update({
          encrypted_access_token: newEncrypted,
          token_expires_at: newExpiresAt,
          last_error: null,
        })
        .eq('id', channel.id)

      if (updateError) {
        throw new Error(updateError.message)
      }

      refreshed++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[token-refresh] channel ${channel.id} (${channel.type}) failed: ${msg}`)

      await service
        .from('channels')
        .update({
          status: 'error',
          last_error: `Renovación automática de token fallida: ${msg}`,
        })
        .eq('id', channel.id)

      failed++
    }
  }

  return { refreshed, failed }
}
