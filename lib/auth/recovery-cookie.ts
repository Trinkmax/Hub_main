import 'server-only'
import { cookies } from 'next/headers'

export const RECOVERY_COOKIE = 'hub_recovery_flow'
const RECOVERY_TTL_SECONDS = 15 * 60 // 15 minutos

/**
 * Marca la sesión como "viene de un magic link de password recovery".
 * Permite a `updatePasswordAction` saltar la reauth con la contraseña
 * actual (que el usuario justamente olvidó).
 */
export async function setRecoveryFlowCookie(): Promise<void> {
  const store = await cookies()
  store.set(RECOVERY_COOKIE, '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: RECOVERY_TTL_SECONDS,
  })
}

/**
 * Lee la flag de recovery sin consumirla. Útil en `/auth/update-password`
 * para decidir si mostrar el campo "Contraseña actual".
 */
export async function isInRecoveryFlow(): Promise<boolean> {
  const store = await cookies()
  return store.get(RECOVERY_COOKIE)?.value === '1'
}

/**
 * Limpia la flag — se llama justo después de cambiar la contraseña con
 * éxito para que la próxima visita a /auth/update-password requiera reauth.
 */
export async function clearRecoveryFlowCookie(): Promise<void> {
  const store = await cookies()
  store.delete(RECOVERY_COOKIE)
}
