'use server'

import { redirect } from 'next/navigation'
import { clearRecoveryFlowCookie, isInRecoveryFlow } from '@/lib/auth/recovery-cookie'
import { createClient } from '@/lib/supabase/server'
import { requestResetSchema, signInSchema, updatePasswordSchema } from './schemas'

export type AuthState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  /** Para repintar el campo que falló sin perder el resto. */
  fieldErrors?: Partial<Record<'email' | 'password' | 'confirm' | 'currentPassword', string>>
}

const initialError = (message: string, fieldErrors?: AuthState['fieldErrors']): AuthState => ({
  status: 'error',
  message,
  fieldErrors,
})

// ──────────────────────────────────────────────────────────
// 1. Sign in con email + password
// ──────────────────────────────────────────────────────────
export async function signInWithPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: formData.get('redirectTo') ?? undefined,
  })
  if (!parsed.success) {
    const issues = parsed.error.issues
    const fieldErrors: AuthState['fieldErrors'] = {}
    for (const i of issues) {
      const key = i.path[0] as 'email' | 'password' | undefined
      if (key && !fieldErrors[key]) fieldErrors[key] = i.message
    }
    return initialError(issues[0]?.message ?? 'Datos inválidos', fieldErrors)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    const code = (error as { code?: string }).code
    const status = (error as { status?: number }).status
    if (code === 'invalid_credentials' || status === 400) {
      return initialError('Email o contraseña incorrectos.')
    }
    if (code === 'email_not_confirmed') {
      return initialError('Tu cuenta todavía no está confirmada. Contactá al owner del bar.')
    }
    if (status === 429) {
      return initialError('Demasiados intentos. Esperá un minuto.')
    }
    console.error('[auth.signIn]', { code, status, message: error.message })
    return initialError('No pudimos iniciar sesión. Probá de nuevo.')
  }

  // Refresh para que el custom_access_token_hook inyecte active_tenant_id.
  await supabase.auth.refreshSession()

  const next = parsed.data.redirectTo?.startsWith('/') ? parsed.data.redirectTo : '/'
  redirect(next)
}

// ──────────────────────────────────────────────────────────
// 2. Solicitar email de recuperación
// ──────────────────────────────────────────────────────────
export async function requestPasswordResetAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = requestResetSchema.safeParse({
    email: formData.get('email'),
  })
  if (!parsed.success) {
    return initialError(parsed.error.issues[0]?.message ?? 'Email inválido', {
      email: parsed.error.issues[0]?.message,
    })
  }

  const supabase = await createClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const callback = new URL('/auth/callback', appUrl)
  callback.searchParams.set('next', '/auth/update-password')

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callback.toString(),
  })

  if (error) {
    const status = (error as { status?: number }).status
    const code = (error as { code?: string }).code
    if (status === 429 || code === 'over_email_send_rate_limit') {
      return initialError(
        'Alcanzaste el límite de envíos. Esperá unos minutos antes de pedir otro email.',
      )
    }
    console.error('[auth.requestReset]', { code, status, message: error.message })
    // No revelamos si el email existe — devolvemos success igual.
  }

  // Mensaje genérico aunque falle: previene enumeración de cuentas.
  return {
    status: 'success',
    message: 'Si el email está registrado, te llegará un link para crear una nueva contraseña.',
  }
}

// ──────────────────────────────────────────────────────────
// 3. Actualizar contraseña (post-recovery o cambio voluntario)
// ──────────────────────────────────────────────────────────
export async function updatePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const rawCurrent = formData.get('currentPassword')
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    currentPassword:
      typeof rawCurrent === 'string' && rawCurrent.length > 0 ? rawCurrent : undefined,
  })
  if (!parsed.success) {
    const issues = parsed.error.issues
    const fieldErrors: AuthState['fieldErrors'] = {}
    for (const i of issues) {
      const key = i.path[0] as 'password' | 'confirm' | 'currentPassword' | undefined
      if (key && !fieldErrors[key]) fieldErrors[key] = i.message
    }
    return initialError(issues[0]?.message ?? 'Datos inválidos', fieldErrors)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return initialError('Tu sesión expiró. Pedí otro link de recuperación.')
  }

  const fromRecovery = await isInRecoveryFlow()

  // Si NO viene del flow de recovery, exigimos reauth con la contraseña actual.
  // Defensa contra: alguien con sesión activa intentando cambiar la pass sin
  // saber la actual (cookie hijack, dispositivo robado, sesión olvidada en
  // un tablet del bar).
  if (!fromRecovery) {
    if (!parsed.data.currentPassword) {
      return initialError('Confirmá tu contraseña actual para cambiarla.', {
        currentPassword: 'Requerida',
      })
    }
    if (!user.email) {
      return initialError('No pudimos validar tu cuenta. Cerrá sesión y volvé a entrar.')
    }
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.currentPassword,
    })
    if (reauthError) {
      const status = (reauthError as { status?: number }).status
      if (status === 429) {
        return initialError('Demasiados intentos. Esperá un minuto.')
      }
      return initialError('La contraseña actual no es correcta.', {
        currentPassword: 'No coincide con tu contraseña actual',
      })
    }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    const code = (error as { code?: string }).code
    if (code === 'same_password') {
      return initialError('Esa es tu contraseña actual. Elegí una distinta.', {
        password: 'Elegí una contraseña distinta',
      })
    }
    console.error('[auth.updatePassword]', { code, message: error.message })
    return initialError('No pudimos cambiar la contraseña. Probá de nuevo.')
  }

  // Limpiar la flag para que el próximo acceso a /auth/update-password
  // requiera reauth aunque la sesión siga activa.
  if (fromRecovery) {
    await clearRecoveryFlowCookie()
  }

  return { status: 'success', message: 'Contraseña actualizada.' }
}
