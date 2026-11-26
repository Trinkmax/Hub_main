'use server'

import { redirect } from 'next/navigation'
import { mustChangePassword } from '@/lib/auth/first-password'
import { getRequestIp, getRequestUserAgent } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isPinShape, parsePinVerify, pinFailureMessage, pinProblem, safeNext } from './pin'
import { newDevice, readDevice, rememberDevice, secretHash } from './pin-server'

/**
 * El PIN de ingreso por equipo (`./pin.ts`).
 *
 * Elegirlo y quitarlo lo hace la persona con su sesión (la base decide de quién es cada PIN). Entrar
 * con PIN es la única parte que usa la clave de servicio: no hay sesión todavía, así que la app
 * comprueba el PIN contra la base (que solo le cree si viene con el secreto de ese equipo, y cuenta
 * los errores) y recién entonces le abre la sesión a esa persona.
 */

export type PinState = { ok: true } | { ok: false; message: string; locked?: boolean }

const TRY_AGAIN = 'No pudimos guardar el PIN. Probá de nuevo.'

/** Elegir (o cambiar) el PIN propio en este equipo. */
export async function setPinAction(pin: string): Promise<PinState> {
  if (typeof pin !== 'string') return { ok: false, message: TRY_AGAIN }
  const problem = pinProblem(pin)
  if (problem) return { ok: false, message: problem }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Se cerró tu sesión. Volvé a entrar.' }
  if (mustChangePassword(user.app_metadata)) {
    return { ok: false, message: 'Primero elegí tu contraseña.' }
  }

  const userAgent = await getRequestUserAgent()
  // Si este equipo ya tiene su secreto (alguien más eligió su PIN acá), se suma al mismo equipo.
  let device = (await readDevice()) ?? newDevice()
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.rpc('device_pin_set', {
      p_device_id: device.id,
      p_secret_hash: secretHash(device.secret),
      p_pin: pin,
      p_user_agent: userAgent,
    })
    if (!error) {
      await rememberDevice(device)
      return { ok: true }
    }
    const reason = error.message ?? ''
    if (reason.includes('weak_pin') || reason.includes('invalid_pin')) {
      return { ok: false, message: pinProblem(pin) ?? 'Ese PIN no sirve. Elegí otro.' }
    }
    if (reason.includes('must_change_password')) {
      return { ok: false, message: 'Primero elegí tu contraseña.' }
    }
    if (reason.includes('too_many_pins')) {
      return { ok: false, message: 'Ya tenés PIN en demasiados equipos. Quitá alguno primero.' }
    }
    if (reason.includes('invalid_device') && attempt === 0) {
      // La cookie de este equipo no coincide con lo guardado (se borró algo): arranca como equipo nuevo.
      device = newDevice()
      continue
    }
    console.error('[auth.pin] set', error.code)
    return { ok: false, message: TRY_AGAIN }
  }
  return { ok: false, message: TRY_AGAIN }
}

/** ¿Tengo PIN en este equipo? */
export async function pinStatusAction(): Promise<{ exists: boolean; locked: boolean }> {
  const none = { exists: false, locked: false }
  const device = await readDevice()
  if (!device) return none
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('device_pin_status', { p_device_id: device.id })
  if (error || typeof data !== 'object' || data === null) return none
  const row = data as { exists?: unknown; locked?: unknown }
  return { exists: row.exists === true, locked: row.locked === true }
}

/** Quitar el PIN propio de este equipo. */
export async function removePinAction(): Promise<PinState> {
  const device = await readDevice()
  if (!device) return { ok: true }
  const supabase = await createClient()
  const { error } = await supabase.rpc('device_pin_remove', { p_device_id: device.id })
  if (error) {
    console.error('[auth.pin] remove', error.code)
    return { ok: false, message: 'No pudimos quitar el PIN. Probá de nuevo.' }
  }
  return { ok: true }
}

/**
 * Entrar con PIN. Si sale bien no devuelve nada: redirige ya con la sesión abierta.
 */
export async function signInWithPinAction(
  pinId: string,
  pin: string,
  next?: string,
): Promise<PinState> {
  try {
    rateLimit({ key: `pin:${await getRequestIp()}`, limit: 30, windowMs: 60_000 })
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { ok: false, message: 'Demasiados intentos. Esperá un minuto.' }
    }
    throw error
  }
  const device = await readDevice()
  if (!device || typeof pinId !== 'string' || !isPinShape(pin)) {
    return { ok: false, message: 'Entrá con tu contraseña.' }
  }

  const service = createServiceClient()
  const { data, error } = await service.rpc('device_pin_verify', {
    p_device_id: device.id,
    p_secret: device.secret,
    p_pin_id: pinId,
    p_pin: pin,
  })
  if (error) {
    console.error('[auth.pin] verify', error.code)
    return { ok: false, message: 'No pudimos comprobar el PIN. Probá de nuevo.' }
  }
  const verified = parsePinVerify(data)
  if (!verified.ok) {
    return {
      ok: false,
      message: pinFailureMessage(verified),
      locked: verified.reason !== 'wrong',
    }
  }

  // El PIN es de esa persona y de este equipo: se le abre la sesión. No hay contraseña de por medio,
  // así que se usa un enlace de un solo uso que nunca sale del servidor.
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email: verified.email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) {
    console.error('[auth.pin] link', linkError?.code ?? linkError?.status)
    return { ok: false, message: 'No pudimos abrir tu sesión. Entrá con tu contraseña.' }
  }
  const supabase = await createClient()
  const { error: otpError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  })
  if (otpError) {
    const status = (otpError as { status?: number }).status
    console.error('[auth.pin] session', otpError.code ?? status)
    return {
      ok: false,
      message:
        status === 429
          ? 'Hay muchos entrando a la vez. Probá en un minuto, o entrá con tu contraseña.'
          : 'No pudimos abrir tu sesión. Entrá con tu contraseña.',
    }
  }
  // Para que el JWT salga con el bar activo, como en el ingreso con contraseña.
  await supabase.auth.refreshSession()
  redirect(safeNext(next))
}
