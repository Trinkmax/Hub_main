import { NextResponse } from 'next/server'
import { setRecoveryFlowCookie } from '@/lib/auth/recovery-cookie'
import { createClient } from '@/lib/supabase/server'

const SAFE_NEXT = (value: string | null): string => {
  if (!value) return '/'
  // Solo aceptamos rutas internas — evitamos open-redirect.
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')
  const errorDescription = searchParams.get('error_description')

  // Caso recovery: forzamos a la pantalla de cambio de contraseña.
  const next = type === 'recovery' ? '/auth/update-password' : SAFE_NEXT(searchParams.get('next'))

  if (errorDescription) {
    console.warn('[auth.callback]', errorDescription)
    const loginUrl = new URL('/login', origin)
    loginUrl.searchParams.set('error', 'callback')
    return NextResponse.redirect(loginUrl)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Cuando el callback viene del email de recovery, marcamos una cookie
      // efímera que `updatePasswordAction` lee para saltar la reauth (el
      // usuario justamente olvidó su contraseña actual).
      if (type === 'recovery') {
        await setRecoveryFlowCookie()
      }
      // Forzamos refresh para que el custom_access_token_hook
      // inyecte el active_tenant_id en el JWT antes de la 1ra página.
      await supabase.auth.refreshSession()
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[auth.callback] exchange failed:', error.message)
  }

  return NextResponse.redirect(`${origin}/login?error=callback`)
}
