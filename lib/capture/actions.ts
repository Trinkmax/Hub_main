'use server'

import { cookies } from 'next/headers'
import { getRequestIp, getRequestUserAgent } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { walletCookieName } from './cookie'
import { captureSubmitSchema } from './schemas'

export type CaptureActionState =
  | {
      ok: true
      was_new: boolean
      welcome_bonus_points?: number
      welcome_reward_name?: string | null
    }
  | { ok: false; message: string }

type SubmitCaptureResult = {
  customer_id: string | null
  tenant_id: string | null
  qr_token: string | null
  was_new: boolean
  welcome_reward_name: string | null
  welcome_bonus_points: number | null
}

/**
 * Acción pública sin autenticación: la consume el formulario del club embebido
 * en la carta (`/carta/[slug]`). Usa `createClient` (anon) en server context — es
 * seguro porque la única vía de escritura es la RPC `submit_capture`
 * (SECURITY DEFINER) y la lectura del link valida `active = true` por RLS.
 *
 * Al sumarse, se setea una cookie httpOnly con el `qr_token` del cliente para que
 * la carta pueda abrir su wallet (/c/[token]) sin login.
 */
export async function submitCapture(formData: FormData): Promise<CaptureActionState> {
  const ip = await getRequestIp()
  const userAgent = await getRequestUserAgent()

  try {
    rateLimit({ key: `capture:${ip}`, limit: 10, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Esperá un minuto antes de reintentar.' }
    }
    throw e
  }

  const parsed = captureSubmitSchema.safeParse({
    link_slug: formData.get('link_slug'),
    phone: formData.get('phone'),
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    opt_in_marketing: formData.get('opt_in_marketing') === 'on',
    website: formData.get('website') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('submit_capture', {
    p_link_slug: parsed.data.link_slug,
    p_phone: parsed.data.phone,
    p_first_name: parsed.data.first_name,
    p_last_name: parsed.data.last_name,
    p_opt_in: parsed.data.opt_in_marketing,
    p_ip: ip,
    p_user_agent: userAgent ?? '',
  })

  if (error) {
    console.error('[capture] submit_capture failed', error.message)
    return { ok: false, message: 'No pudimos guardar tus datos. Probá de nuevo.' }
  }

  const result = data as SubmitCaptureResult | null

  // Identidad por cookie: la carta lee este token para mostrar la wallet sin login.
  if (result?.qr_token && result.tenant_id) {
    const store = await cookies()
    store.set(walletCookieName(result.tenant_id), result.qr_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 180, // 180 días
    })
  }

  return {
    ok: true,
    was_new: Boolean(result?.was_new),
    welcome_bonus_points: result?.welcome_bonus_points ?? 0,
    welcome_reward_name: result?.welcome_reward_name ?? null,
  }
}
