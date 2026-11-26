import 'server-only'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  type DeviceRef,
  encodeDevice,
  type PinAccount,
  parseDevice,
  parsePinAccounts,
} from './pin'

/**
 * El equipo y su secreto (`./pin.ts`). El secreto vive en una cookie `httpOnly`: ninguna página lo
 * puede leer, solo viaja al servidor. En la base queda su huella (sha256), nunca el secreto.
 */

export function secretHash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export async function readDevice(): Promise<DeviceRef | null> {
  const store = await cookies()
  return parseDevice(store.get(DEVICE_COOKIE)?.value)
}

/** Un equipo nuevo: un id y 32 bytes al azar. Todavía no se guarda en ningún lado. */
export function newDevice(): DeviceRef {
  return { id: randomUUID(), secret: randomBytes(32).toString('base64url') }
}

export async function rememberDevice(device: DeviceRef): Promise<void> {
  const store = await cookies()
  store.set(DEVICE_COOKIE, encodeDevice(device), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE,
  })
}

/**
 * Quiénes pueden entrar con PIN en este equipo. Lo pide la pantalla de ingreso, sin sesión: por eso va
 * con la clave de servicio, y la base no contesta nada si el secreto no es el de ese equipo.
 */
export async function deviceAccounts(device: DeviceRef | null): Promise<PinAccount[]> {
  if (!device) return []
  try {
    const { data, error } = await createServiceClient().rpc('device_pin_accounts', {
      p_device_id: device.id,
      p_secret: device.secret,
    })
    if (error) {
      console.error('[auth.pin] accounts', error.code)
      return []
    }
    return parsePinAccounts(data)
  } catch {
    // Sin la clave de servicio (un entorno a medio configurar) no hay PIN: se entra con contraseña.
    return []
  }
}

/** Le cambiaron la contraseña: sus PIN dejan de valer en todos los equipos. */
export async function forgetPinsOf(userId: string): Promise<void> {
  const { error } = await createServiceClient().from('device_pins').delete().eq('user_id', userId)
  if (error) console.error('[auth.pin] forget', error.code)
}
