/**
 * El PIN de ingreso por equipo — PURO y testeado (`tests/lib/auth-pin.test.ts`).
 *
 * Pedido de Nacho (26/11/2026): «estaría bueno que tengan un PIN para entrar luego más fácil».
 *
 * La primera vez en un equipo se entra con mail y contraseña y ahí se elige un PIN de 4 números. Desde
 * entonces, en ESE equipo se entra tocando el nombre y el PIN. El PIN solo no abre nada: cada equipo
 * guarda un secreto largo (en una cookie que las páginas no pueden leer) y la base solo le cree al PIN
 * si viene con ese secreto. A los 5 errores seguidos se bloquea y hay que entrar con la contraseña.
 * Lo guarda y lo comprueba la base (`device_pins`, migración `ingreso_pin_por_equipo`).
 */

export const PIN_LENGTH = 4
/** La cookie con el equipo y su secreto: `<id>.<secreto>`. Solo la lee el servidor. */
export const DEVICE_COOKIE = 'hub_device'
/** Lo más que un navegador guarda una cookie. */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SECRET = /^[A-Za-z0-9_-]{32,128}$/

export function isPinShape(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4}$/.test(pin)
}

/** Lo que cualquiera prueba primero: cuatro iguales o una escalera (la base rechaza lo mismo). */
export function isWeakPin(pin: string): boolean {
  return /^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)
}

/** Por qué ese PIN no sirve, dicho para la persona; `null` si sirve. */
export function pinProblem(pin: string): string | null {
  if (!isPinShape(pin)) return `El PIN son ${PIN_LENGTH} números.`
  if (isWeakPin(pin))
    return 'Ese es muy fácil de adivinar. Elegí otro: ni cuatro iguales ni seguidos.'
  return null
}

export type DeviceRef = { id: string; secret: string }

export function encodeDevice(device: DeviceRef): string {
  return `${device.id}.${device.secret}`
}

/** Lee la cookie del equipo; algo con otra forma es como no tener cookie. */
export function parseDevice(value: string | null | undefined): DeviceRef | null {
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  const id = value.slice(0, dot)
  const secret = value.slice(dot + 1)
  return UUID.test(id) && SECRET.test(secret) ? { id: id.toLowerCase(), secret } : null
}

/** Quién puede entrar con PIN en este equipo. Sin mail: solo el nombre con el que se lo conoce. */
export type PinAccount = { id: string; name: string; locked: boolean }

export function parsePinAccounts(raw: unknown): PinAccount[] {
  if (!Array.isArray(raw)) return []
  const accounts: PinAccount[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !UUID.test(row.id)) continue
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Sin nombre'
    accounts.push({ id: row.id, name, locked: row.locked === true })
  }
  return accounts
}

export type PinVerify =
  | { ok: true; userId: string; email: string }
  /** `wrong` trae cuántos intentos quedan; `locked` = hay que entrar con la contraseña;
   *  `password` = tiene pendiente elegir su contraseña; `gone` = ese PIN ya no existe en este equipo. */
  | { ok: false; reason: 'wrong'; left: number }
  | { ok: false; reason: 'locked' | 'password' | 'gone' }

export function parsePinVerify(raw: unknown): PinVerify {
  const gone: PinVerify = { ok: false, reason: 'gone' }
  if (typeof raw !== 'object' || raw === null) return gone
  const row = raw as Record<string, unknown>
  if (row.ok === true) {
    return typeof row.user_id === 'string' &&
      typeof row.email === 'string' &&
      row.email.includes('@')
      ? { ok: true, userId: row.user_id, email: row.email }
      : gone
  }
  if (row.reason === 'wrong') {
    const left = typeof row.left === 'number' && row.left > 0 ? Math.floor(row.left) : 0
    return left > 0 ? { ok: false, reason: 'wrong', left } : { ok: false, reason: 'locked' }
  }
  if (row.reason === 'locked' || row.reason === 'password') return { ok: false, reason: row.reason }
  return gone
}

/** Qué se le dice a quien no pudo entrar con el PIN. */
export function pinFailureMessage(result: Exclude<PinVerify, { ok: true }>): string {
  switch (result.reason) {
    case 'wrong':
      return result.left === 1
        ? 'Ese no es. Te queda 1 intento.'
        : `Ese no es. Te quedan ${result.left} intentos.`
    case 'locked':
      return 'El PIN quedó bloqueado. Entrá con tu contraseña y elegí uno nuevo.'
    case 'password':
      return 'Primero entrá con tu contraseña.'
    default:
      return 'Ese PIN ya no está en este equipo. Entrá con tu contraseña.'
  }
}

/** A dónde se puede volver después de entrar: solo direcciones de esta misma app. */
export function safeNext(value: string | null | undefined): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}
