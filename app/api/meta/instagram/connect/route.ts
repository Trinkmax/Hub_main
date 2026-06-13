import { NextResponse } from 'next/server'
import { getMetaConfig, isMetaConfigured } from '@/lib/meta/env'
import { buildInstagramLoginUrl } from '@/lib/meta/oauth'
import { signState } from '@/lib/meta/state'
import { requireRole, requireTenantAccess } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('tenant')
  if (!slug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 })

  const back = (err: string) =>
    NextResponse.redirect(new URL(`/${slug}/configuracion/canales?meta_error=${err}`, url.origin))

  let tenantId: string
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    tenantId = tenant.id
  } catch {
    return back('forbidden')
  }

  if (!isMetaConfigured()) return back('not_configured')

  try {
    const { appUrl } = getMetaConfig()
    const redirectUri = `${appUrl}/api/meta/instagram/callback`
    const state = signState(tenantId)
    const target = buildInstagramLoginUrl({ redirectUri, state })
    return NextResponse.redirect(target)
  } catch (e) {
    console.error('[meta.instagram.connect]', (e as Error).message)
    return back('connect_failed')
  }
}
