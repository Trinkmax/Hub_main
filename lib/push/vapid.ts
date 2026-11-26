import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  generateVapidKeys,
  type VapidDetails,
  type VapidKeys,
  vapidAuthorization,
} from './web-push'

/**
 * El par de claves con el que la app firma las notificaciones push (VAPID). Es uno solo para toda la
 * plataforma y vive cifrado en la base; lo leen únicamente las funciones `push_vapid_keys` y
 * `push_vapid_init`, que solo responden a la clave de servicio. Por eso esto se llama desde
 * `/api/cron/*` y nunca desde una pantalla.
 *
 * La mitad pública es la que usa el navegador para anotarse (`push_public_key()`): si el par cambiara,
 * las suscripciones hechas con el anterior dejarían de servir. Por eso se genera una sola vez y, si
 * dos procesos llegan juntos, gana el primero que guarda y los dos terminan usando ese.
 *
 * Las claves no se loguean nunca.
 */

const keysSchema = z.object({
  public: z.string().min(1).nullable(),
  private: z.string().min(1).nullable(),
})

const EMAIL = /^[^\s<>@,;:"']+@[^\s<>@,;:"']+\.[^\s<>@,;:"']+$/

function httpsOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== 'localhost' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * A quién le avisa el servicio de push si los envíos de la app dan problemas. Va firmado en cada
 * pedido y tiene que ser un `mailto:` o una dirección `https://`. Escrito con nombre, espacios o `<>`
 * («HUB <hola@…>») hay servicios que rechazan la firma entera (pasa con Apple), así que de
 * `EMAIL_FROM` se usa solo la dirección.
 *
 * Si no hay mail configurado, vale la dirección pública de la app (`NEXT_PUBLIC_APP_URL` o, en Vercel,
 * la del proyecto). `null` cuando no hay ninguna (una máquina de desarrollo sin configurar): sin
 * contacto no se manda nada.
 */
export function vapidSubject(env: Record<string, string | undefined> = process.env): string | null {
  const from = env.EMAIL_FROM?.trim() ?? ''
  const address = (/<([^<>]*)>\s*$/.exec(from)?.[1] ?? from).trim()
  if (EMAIL.test(address)) return `mailto:${address}`

  const production = env.VERCEL_PROJECT_PRODUCTION_URL
  return (
    httpsOrigin(env.NEXT_PUBLIC_APP_URL) ??
    httpsOrigin(production ? `https://${production}` : undefined)
  )
}

async function readKeys(service: SupabaseClient): Promise<VapidKeys | null> {
  const { data, error } = await service.rpc('push_vapid_keys')
  if (error) throw new Error(`push_vapid_keys: ${error.message}`)
  const parsed = keysSchema.safeParse(data)
  if (!parsed.success) throw new Error('push_vapid_keys: respuesta inesperada')
  const { public: publicKey, private: privateKey } = parsed.data
  if (publicKey === null && privateKey === null) return null
  if (publicKey === null || privateKey === null) {
    throw new Error('push: el par de claves VAPID guardado está incompleto')
  }
  return { publicKey, privateKey }
}

let cached: VapidDetails | null = null

/**
 * Las claves y el contacto para firmar los envíos. La primera vez las lee de la base (y, si todavía no
 * existen, las genera y las guarda); después las recuerda mientras viva el proceso.
 */
export async function getVapid(service: SupabaseClient): Promise<VapidDetails> {
  if (cached) return cached

  const subject = vapidSubject()
  if (!subject) {
    throw new Error(
      'push: falta EMAIL_FROM o una NEXT_PUBLIC_APP_URL con https para firmar las notificaciones',
    )
  }

  let keys = await readKeys(service)
  if (!keys) {
    const fresh = generateVapidKeys()
    const { error } = await service.rpc('push_vapid_init', {
      p_public: fresh.publicKey,
      p_private: fresh.privateKey,
    })
    if (error) throw new Error(`push_vapid_init: ${error.message}`)
    // Se vuelve a leer en vez de usar el par recién hecho: si otro proceso guardó el suyo un instante
    // antes, el que vale es ese.
    keys = await readKeys(service)
    if (!keys) throw new Error('push: el par de claves VAPID no quedó guardado')
  }

  const vapid: VapidDetails = { ...keys, subject }
  // Firma de prueba: si lo guardado no es un par P-256 sano, se sabe ahora y no en cada envío.
  vapidAuthorization('https://fcm.googleapis.com', vapid)
  cached = vapid
  return vapid
}
