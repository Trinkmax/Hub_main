import type { BranchCookie, BranchSurface } from './types'

/**
 * La cookie del dispositivo: en qué sucursal trabaja y cuál mira el panel. Es la misma que usaba el punto de venta
 * desde el 13/11 (`hub_branch_<bar>` = el id de la sucursal), así que ningún equipo que ya eligió vuelve a preguntar.
 * Ahora también puede decir «Todas»: `all` o `all.<id>` (ver `BranchCookie`).
 *
 * La cookie no da permisos: solo dice qué se quiere mirar. Lo que la persona puede ver lo decide la base
 * (`my_branches`) y `resolveBranchScope` recorta.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const BRANCH_COOKIE_PREFIX = 'hub_branch_'

/** Un año: el dispositivo se acuerda; se cambia desde el selector. */
export const BRANCH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function branchCookieName(tenantId: string): string {
  return `${BRANCH_COOKIE_PREFIX}${tenantId}`
}

export function isBranchId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function parseBranchCookie(raw: string | null | undefined): BranchCookie | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (UUID.test(value)) return { kind: 'branch', id: value.toLowerCase() }
  if (value === 'all') return { kind: 'all', device: null }
  if (value.startsWith('all.')) {
    const device = value.slice(4)
    return UUID.test(device)
      ? { kind: 'all', device: device.toLowerCase() }
      : { kind: 'all', device: null }
  }
  return null
}

export function serializeBranchCookie(cookie: BranchCookie): string {
  if (cookie.kind === 'branch') return cookie.id
  return cookie.device ? `all.${cookie.device}` : 'all'
}

/** La sucursal concreta que recuerda la cookie (la del dispositivo), si hay. */
export function cookieDeviceId(cookie: BranchCookie | null): string | null {
  if (!cookie) return null
  return cookie.kind === 'branch' ? cookie.id : cookie.device
}

/**
 * Qué guardar después de elegir.
 * - En el panel: elegir una sucursal la deja como la del dispositivo también (estás mirando el Cerro → el salón de
 *   este equipo es el Cerro); elegir «Todas» no mueve el dispositivo.
 * - En el salón: elegir una sucursal mueve el dispositivo; si el panel estaba en «Todas», sigue en «Todas».
 */
export function nextBranchCookie(
  previous: BranchCookie | null,
  choice: string,
  surface: BranchSurface,
): BranchCookie {
  if (choice === 'all') {
    if (surface === 'device') throw new Error('branch_cookie_device_all')
    return { kind: 'all', device: cookieDeviceId(previous) }
  }
  if (!isBranchId(choice)) throw new Error('branch_cookie_invalid_choice')
  const id = choice.toLowerCase()
  if (surface === 'device' && previous?.kind === 'all') return { kind: 'all', device: id }
  return { kind: 'branch', id }
}
