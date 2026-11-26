import 'server-only'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'
import { MUST_CHANGE_CLEARED, mustChangeMark } from './first-password'

/**
 * Marcar y desmarcar «tiene que elegir su contraseña» (`./first-password.ts`). La marca vive en
 * `app_metadata`, que solo se escribe con la clave de servicio: por eso esto corre únicamente en el
 * servidor, siempre sobre UNA cuenta y siempre después de comprobar quién lo pide (el dueño del bar
 * para marcar; la propia persona, recién cambiada su contraseña, para desmarcar).
 */

/** La cuenta queda obligada a elegir su contraseña la próxima vez que entre. */
export async function markMustChangePassword(userId: string): Promise<boolean> {
  const service = createServiceClient()
  const { error } = await service.auth.admin.updateUserById(userId, {
    app_metadata: mustChangeMark(Date.now()),
  })
  if (error) console.error('[auth.firstPassword] mark', error.code ?? error.status)
  return !error
}

/** Ya eligió la suya: se le saca la marca. Reintenta, porque de esto depende que pueda seguir. */
export async function clearMustChangePassword(userId: string): Promise<boolean> {
  const service = createServiceClient()
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await service.auth.admin.updateUserById(userId, {
      app_metadata: MUST_CHANGE_CLEARED,
    })
    if (!error) return true
    console.error('[auth.firstPassword] clear', error.code ?? error.status)
  }
  return false
}

/**
 * «Ya eligió su contraseña, falta sacarle la marca». Si sacar la marca falla justo después de guardar la
 * contraseña nueva, la persona quedaría dando vueltas: no puede volver a «elegir» la misma. Con esta
 * cookie la próxima visita termina el trámite sola, sin pedirle nada.
 */
const DONE_COOKIE = 'hub_first_password_done'

export async function rememberPasswordChosen(userId: string): Promise<void> {
  const store = await cookies()
  store.set(DONE_COOKIE, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth',
    maxAge: 15 * 60,
  })
}

export async function passwordAlreadyChosen(userId: string): Promise<boolean> {
  const store = await cookies()
  return store.get(DONE_COOKIE)?.value === userId
}

export async function forgetPasswordChosen(): Promise<void> {
  const store = await cookies()
  store.delete({ name: DONE_COOKIE, path: '/auth' })
}
