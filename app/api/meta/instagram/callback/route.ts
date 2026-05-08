import { NextResponse } from 'next/server'
import { encryptToken } from '@/lib/meta/crypto'
import { getMetaConfig, instagramGraphUrl } from '@/lib/meta/env'
import { metaFetch } from '@/lib/meta/http'
import { exchangeForLongLivedInstagramToken, exchangeInstagramCode } from '@/lib/meta/oauth'
import { verifyState } from '@/lib/meta/state'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function redirectToConfigError(appUrl: string, slug: string | null, msg: string) {
  const target = new URL(`${appUrl}/${slug ?? ''}/configuracion/canales`)
  target.searchParams.set('meta_error', msg)
  return NextResponse.redirect(target)
}

type IgUserResp = { id?: string; username?: string }

export async function GET(request: Request) {
  const { appUrl } = getMetaConfig()
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')

  if (error) {
    return redirectToConfigError(appUrl, null, error)
  }
  if (!code || !state) {
    return redirectToConfigError(appUrl, null, 'missing_code_or_state')
  }
  const verified = verifyState(state)
  if (!verified) {
    return redirectToConfigError(appUrl, null, 'invalid_state')
  }

  const service = createServiceClient()
  const { data: tenant, error: tenantErr } = await service
    .from('tenants')
    .select('id, slug')
    .eq('id', verified.tenantId)
    .maybeSingle()
  if (tenantErr || !tenant) {
    return redirectToConfigError(appUrl, null, 'tenant_not_found')
  }

  try {
    const redirectUri = `${appUrl}/api/meta/instagram/callback`
    const shortLived = await exchangeInstagramCode({ code, redirectUri })
    const longLived = await exchangeForLongLivedInstagramToken(shortLived.access_token)
    const accessToken = longLived.access_token
    const expiresAt = longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
      : null

    const userInfo = await metaFetch<IgUserResp>(
      instagramGraphUrl(`${shortLived.user_id}?fields=id,username`),
      { accessToken },
    )

    const encrypted = await encryptToken(accessToken)

    const { error: upsertErr } = await service.from('channels').upsert(
      {
        tenant_id: tenant.id,
        type: 'instagram',
        status: 'connected',
        external_account_id: shortLived.user_id,
        display_name: userInfo.username ?? null,
        encrypted_access_token: encrypted,
        token_expires_at: expiresAt,
        last_error: null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,type' },
    )
    if (upsertErr) throw new Error(`channel upsert: ${upsertErr.message}`)

    await service.from('audit_log').insert({
      tenant_id: tenant.id,
      action: 'channel_connected',
      entity: 'channels',
      payload: { type: 'instagram', ig_user_id: shortLived.user_id },
    })

    return NextResponse.redirect(`${appUrl}/${tenant.slug}/configuracion/canales?meta_ok=instagram`)
  } catch (e) {
    const msg = (e as Error).message
    console.error('[meta.instagram.callback]', msg)
    await service
      .from('channels')
      .update({ status: 'error', last_error: msg })
      .eq('tenant_id', tenant.id)
      .eq('type', 'instagram')
    return redirectToConfigError(appUrl, tenant.slug, msg)
  }
}
