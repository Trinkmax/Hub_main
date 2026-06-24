import { NextResponse } from 'next/server'
import { encryptToken } from '@/lib/meta/crypto'
import { getMetaConfig } from '@/lib/meta/env'
import { exchangeFacebookCode, findWabaIdsFromToken } from '@/lib/meta/oauth'
import { signState as _signState, verifyState } from '@/lib/meta/state'
import { listWabaPhoneNumbers, subscribeAppToWaba } from '@/lib/meta/whatsapp'
import { createServiceClient } from '@/lib/supabase/service'

void _signState // mantener export tree-shaken

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function redirectToConfigError(appUrl: string, slug: string | null, msg: string) {
  const target = new URL(`${appUrl}/${slug ?? ''}/configuracion/canales`)
  target.searchParams.set('meta_error', msg)
  return NextResponse.redirect(target)
}

export async function GET(request: Request) {
  const { appUrl } = await getMetaConfig()
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')

  if (error) {
    console.error('[meta.whatsapp.callback] meta returned error', error)
    return redirectToConfigError(appUrl, null, error)
  }
  if (!code || !state) {
    return redirectToConfigError(appUrl, null, 'missing_code_or_state')
  }
  const verified = await verifyState(state)
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
    const redirectUri = `${appUrl}/api/meta/whatsapp/callback`
    const tokenRes = await exchangeFacebookCode({ code, redirectUri })
    const accessToken = tokenRes.access_token
    const expiresAt = tokenRes.expires_in
      ? new Date(Date.now() + tokenRes.expires_in * 1000).toISOString()
      : null

    const wabaIds = await findWabaIdsFromToken(accessToken)
    const wabaId = wabaIds[0]
    if (!wabaId) {
      throw new Error('no WABA in granted scopes')
    }

    const phones = await listWabaPhoneNumbers(wabaId, accessToken)
    const phone = phones[0]
    if (!phone) throw new Error('no phone numbers in WABA')

    await subscribeAppToWaba(wabaId, accessToken)

    const encrypted = await encryptToken(accessToken)

    const { error: upsertErr } = await service.from('channels').upsert(
      {
        tenant_id: tenant.id,
        type: 'whatsapp',
        status: 'connected',
        external_account_id: wabaId,
        external_phone_number_id: phone.id,
        display_name: phone.verified_name || phone.display_phone_number,
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
      payload: { type: 'whatsapp', waba_id: wabaId, phone_id: phone.id },
    })

    return NextResponse.redirect(`${appUrl}/${tenant.slug}/configuracion/canales?meta_ok=whatsapp`)
  } catch (e) {
    const msg = (e as Error).message
    console.error('[meta.whatsapp.callback]', msg)
    await service
      .from('channels')
      .update({ status: 'error', last_error: msg })
      .eq('tenant_id', tenant.id)
      .eq('type', 'whatsapp')
    return redirectToConfigError(appUrl, tenant.slug, msg)
  }
}
