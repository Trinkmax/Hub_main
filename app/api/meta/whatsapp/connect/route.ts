import { NextResponse } from 'next/server'
import { getMetaConfig } from '@/lib/meta/env'
import { buildWhatsAppEmbeddedSignupUrl } from '@/lib/meta/oauth'
import { signState } from '@/lib/meta/state'
import { requireRole, requireTenantAccess } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('tenant')
  if (!slug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 })

  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    const { appUrl } = getMetaConfig()
    const redirectUri = `${appUrl}/api/meta/whatsapp/callback`
    const state = signState(tenant.id)
    const target = buildWhatsAppEmbeddedSignupUrl({ redirectUri, state })
    return NextResponse.redirect(target)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
}
