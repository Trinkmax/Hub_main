import { NextResponse } from 'next/server'
import { getMetaConfig, isMetaConfigured } from '@/lib/meta/env'
import { buildWhatsAppEmbeddedSignupUrl } from '@/lib/meta/oauth'
import { signState } from '@/lib/meta/state'
import { requireRole, requireTenantAccess } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('tenant')
  if (!slug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 })

  // Nunca devolvemos JSON crudo: volvemos a Canales con un motivo legible.
  const back = (err: string) =>
    NextResponse.redirect(new URL(`/${slug}/mensajeria/canales?meta_error=${err}`, url.origin))

  let tenantId: string
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    tenantId = tenant.id
  } catch {
    return back('forbidden')
  }

  // Falta la app de Meta a nivel plataforma (META_APP_ID/SECRET): UX clara, sin crash.
  if (!(await isMetaConfigured())) return back('not_configured')

  try {
    const { appUrl } = await getMetaConfig()
    const redirectUri = `${appUrl}/api/meta/whatsapp/callback`
    const state = await signState(tenantId)
    const target = await buildWhatsAppEmbeddedSignupUrl({ redirectUri, state })
    return NextResponse.redirect(target)
  } catch (e) {
    console.error('[meta.whatsapp.connect]', (e as Error).message)
    return back('connect_failed')
  }
}
