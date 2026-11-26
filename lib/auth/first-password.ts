/**
 * La primera contraseña — PURO y testeado (`tests/lib/auth-first-password.test.ts`).
 *
 * Cuando alguien le pone una contraseña a OTRA persona (el dueño desde Equipo, o el script de alta del
 * equipo), esa contraseña es para arrancar: la cuenta queda marcada y, apenas entra, la persona tiene
 * que elegir la suya. Hasta que lo haga, el proxy no la deja pasar a ninguna otra pantalla.
 *
 * La marca vive en `app_metadata` de la cuenta (`must_change_password`), que solo se escribe con la
 * clave de servicio: nadie se la puede sacar desde el navegador. Viaja en el JWT, así que el proxy la
 * lee sin ir a la base.
 */

export const MUST_CHANGE_KEY = 'must_change_password'
/** Cuándo se puso la contraseña de arranque (segundos desde 1970). */
export const MUST_CHANGE_SINCE_KEY = 'must_change_since'

/** Dónde se elige la contraseña propia. */
export const FIRST_PASSWORD_PATH = '/auth/update-password'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** ¿Esta cuenta todavía tiene que elegir su contraseña? */
export function mustChangePassword(appMetadata: unknown): boolean {
  return record(appMetadata)?.[MUST_CHANGE_KEY] === true
}

/**
 * Las direcciones que una cuenta marcada puede seguir usando: la pantalla donde elige su contraseña (y
 * las acciones que salen de ella, que se mandan a esa misma dirección), el intercambio de sesión y lo que
 * es público para cualquiera.
 */
function allowedWhileMarked(pathname: string): boolean {
  return pathname === FIRST_PASSWORD_PATH || pathname.startsWith('/auth/')
}

/**
 * A dónde mandar a una cuenta marcada que pide `pathname`; `null` si puede seguir. `isPublic` es lo que
 * el proxy ya considera público (la carta, los íconos…): eso no se toca. `/login` es la excepción: una
 * cuenta marcada que ya tiene sesión no tiene nada que hacer ahí.
 */
export function firstPasswordRedirect(
  appMetadata: unknown,
  pathname: string,
  isPublic: boolean,
): string | null {
  if (!mustChangePassword(appMetadata)) return null
  if (allowedWhileMarked(pathname)) return null
  if (isPublic && pathname !== '/login') return null
  return FIRST_PASSWORD_PATH
}

/** Cuándo entró con contraseña esta sesión (segundos), según el `amr` del JWT. */
export function passwordLoginAt(claims: unknown): number | null {
  const amr = record(claims)?.amr
  if (!Array.isArray(amr)) return null
  let latest: number | null = null
  for (const entry of amr) {
    const item = record(entry)
    if (item?.method !== 'password') continue
    const at = typeof item.timestamp === 'number' ? item.timestamp : Number(item.timestamp)
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at
  }
  return latest
}

/**
 * ¿Se le puede dejar elegir la contraseña sin volver a pedirle la que tiene? Solo si la cuenta está
 * marcada y esta sesión entró CON CONTRASEÑA después de que se la pusieran: es decir, la acaba de
 * tipear. Una sesión que no entró con contraseña (un enlace, un PIN) la tiene que escribir.
 */
export function canSkipCurrentPassword(appMetadata: unknown, claims: unknown): boolean {
  if (!mustChangePassword(appMetadata)) return false
  const since = Number(record(appMetadata)?.[MUST_CHANGE_SINCE_KEY] ?? 0)
  const at = passwordLoginAt(claims)
  return at !== null && at >= (Number.isFinite(since) ? since : 0)
}

/** Lo que se escribe en la cuenta al ponerle una contraseña de arranque. */
export function mustChangeMark(nowMs: number): Record<string, unknown> {
  return { [MUST_CHANGE_KEY]: true, [MUST_CHANGE_SINCE_KEY]: Math.floor(nowMs / 1000) }
}

/** Lo que se escribe cuando ya eligió la suya (las claves en `null` se borran). */
export const MUST_CHANGE_CLEARED: Record<string, null> = {
  [MUST_CHANGE_KEY]: null,
  [MUST_CHANGE_SINCE_KEY]: null,
}

/**
 * Los roles a los que una contraseña puesta por otro los obliga a cambiarla. La cocina no: es la cuenta
 * de una pantalla, no de una persona, y la contraseña que le pone el dueño es la que queda.
 */
export function roleMustChoosePassword(role: string | null | undefined): boolean {
  return typeof role === 'string' && role !== 'kitchen'
}
