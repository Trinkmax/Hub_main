'use server'

import { z } from 'zod'
import { passwordSchema } from '@/lib/auth/schemas'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const tokenSchema = z.string().uuid()

export type AcceptResult =
  | { ok: true; redirectTo: string }
  | {
      ok: false
      code:
        | 'unauthenticated'
        | 'email_mismatch'
        | 'expired'
        | 'invalid_password'
        | 'invalid_token'
        | 'unknown'
      message: string
    }

// Acepta una invitación cuando ya hay sesión iniciada con el email correcto.
export async function acceptInvitation(token: string): Promise<AcceptResult> {
  const parsed = tokenSchema.safeParse(token)
  if (!parsed.success) {
    return { ok: false, code: 'invalid_token', message: 'Token inválido.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, code: 'unauthenticated', message: 'Necesitás iniciar sesión.' }
  }

  const { data, error } = await supabase.rpc('accept_invitation', { p_token: parsed.data })
  if (error) {
    if (error.message.includes('email_mismatch')) {
      return {
        ok: false,
        code: 'email_mismatch',
        message: 'El email de tu cuenta no coincide con el de la invitación.',
      }
    }
    if (error.message.includes('invalid_or_expired_token')) {
      return { ok: false, code: 'expired', message: 'La invitación expiró o ya fue usada.' }
    }
    return { ok: false, code: 'unknown', message: 'No pudimos aceptar la invitación.' }
  }

  await supabase.auth.refreshSession()

  const tenantId = (data as { tenant_id?: string } | null)?.tenant_id
  let slug = ''
  if (tenantId) {
    const { data: t } = await supabase
      .from('tenants')
      .select('slug')
      .eq('id', tenantId)
      .maybeSingle()
    slug = t?.slug ?? ''
  }

  return { ok: true, redirectTo: slug ? `/${slug}` : '/' }
}

// Acepta una invitación creando/iniciando sesión con password en un solo paso.
//   - Si el email del invite ya tiene cuenta: hace login con la pass.
//   - Si no existe: crea cuenta confirmada con esa pass y entra.
const acceptWithPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
})

export async function acceptInvitationWithPassword(input: {
  token: string
  password: string
}): Promise<AcceptResult> {
  const parsed = acceptWithPasswordSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_password',
      message: parsed.error.issues[0]?.message ?? 'Contraseña inválida.',
    }
  }

  const supabase = await createClient()

  // 1. Cargo preview de la invitación (público vía RPC).
  const { data: previewArr, error: previewErr } = await supabase.rpc('get_invitation_preview', {
    p_token: parsed.data.token,
  })
  const preview = (
    previewArr as Array<{
      email: string
      role: string
      tenant_name: string
      expired: boolean
    }> | null
  )?.[0]
  if (previewErr || !preview) {
    return { ok: false, code: 'invalid_token', message: 'Invitación no encontrada.' }
  }
  if (preview.expired) {
    return { ok: false, code: 'expired', message: 'La invitación expiró o ya fue usada.' }
  }

  // 2. ¿El email ya tiene cuenta?
  const service = createServiceClient()
  const { data: existingId, error: findErr } = await service.rpc('find_user_id_by_email', {
    p_email: preview.email,
  })
  if (findErr) {
    console.error('[accept.findUser]', findErr)
    return { ok: false, code: 'unknown', message: 'No pudimos validar tu email.' }
  }

  if (!existingId) {
    // 2a. Usuario nuevo → crear con la contraseña indicada.
    const { error: createErr } = await service.auth.admin.createUser({
      email: preview.email,
      password: parsed.data.password,
      email_confirm: true,
    })
    if (createErr) {
      console.error('[accept.createUser]', createErr)
      return { ok: false, code: 'unknown', message: 'No pudimos crear la cuenta.' }
    }
  }

  // 3. Login con la pass — si la cuenta ya existía, valida; si la creamos, entra.
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: preview.email,
    password: parsed.data.password,
  })
  if (signInErr) {
    const code = (signInErr as { code?: string }).code
    if (code === 'invalid_credentials') {
      return {
        ok: false,
        code: 'invalid_password',
        message: 'La contraseña no coincide con la cuenta existente.',
      }
    }
    console.error('[accept.signIn]', signInErr)
    return { ok: false, code: 'unknown', message: 'No pudimos iniciar sesión.' }
  }

  // 4. Aceptar la invitación con la sesión nueva.
  const result = await acceptInvitation(parsed.data.token)
  return result
}
