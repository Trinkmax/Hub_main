/**
 * Deja creado el par de claves VAPID con el que la app firma las notificaciones push.
 *
 *   npx tsx scripts/push-vapid-init.ts
 *
 * Es lo mismo que hace sola la app la primera vez que manda una notificación
 * (lib/push/vapid.ts#getVapid), pero a mano y ANTES de que alguien quiera activar los avisos: el
 * navegador se anota con la clave pública (`push_public_key()`), y mientras no exista no hay a qué
 * anotarse.
 *
 * Se puede correr las veces que haga falta: si el par ya existe, no lo toca (cambiarlo dejaría sin
 * servir todas las suscripciones hechas) y solo controla que esté sano. Imprime `ok` y el largo de la
 * clave pública; las claves no se muestran nunca.
 *
 * Script admin: usa SUPABASE_SERVICE_ROLE_KEY de .env/.env.local. El par es uno solo para toda la
 * plataforma, así que no toca datos de ningún bar (CLAUDE.md §4).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { generateVapidKeys, type VapidKeys, vapidAuthorization } from '../lib/push/web-push'

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const file of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        out[key] = value
      }
    } catch {
      // archivo opcional
    }
  }
  return { ...out, ...(process.env as Record<string, string>) }
}

/** El par guardado, o `null` si todavía no hay ninguno. */
async function storedKeys(supabase: SupabaseClient): Promise<VapidKeys | null> {
  const { data, error } = await supabase.rpc('push_vapid_keys')
  if (error) throw new Error(`push_vapid_keys: ${error.message}`)
  const keys = (data ?? {}) as { public?: unknown; private?: unknown }
  const publicKey = typeof keys.public === 'string' && keys.public.length > 0 ? keys.public : null
  const privateKey =
    typeof keys.private === 'string' && keys.private.length > 0 ? keys.private : null
  if (publicKey === null && privateKey === null) return null
  if (publicKey === null || privateKey === null) {
    throw new Error('el par de claves guardado está incompleto')
  }
  return { publicKey, privateKey }
}

async function main() {
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  // Las funciones `push_vapid_*` todavía no están en types/database.ts: cliente sin tipar.
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  let keys = await storedKeys(supabase)
  const existed = keys !== null
  if (!keys) {
    const fresh = generateVapidKeys()
    const { error } = await supabase.rpc('push_vapid_init', {
      p_public: fresh.publicKey,
      p_private: fresh.privateKey,
    })
    if (error) throw new Error(`push_vapid_init: ${error.message}`)
    // Se vuelve a leer: si otro proceso guardó el suyo un instante antes, el que vale es ese.
    keys = await storedKeys(supabase)
    if (!keys) throw new Error('el par de claves no quedó guardado')
  }

  // Firma de prueba (no sale de acá): confirma que lo guardado es un par P-256 sano.
  vapidAuthorization('https://fcm.googleapis.com', { ...keys, subject: 'mailto:push@example.com' })

  console.log(
    `ok — ${existed ? 'el par ya existía' : 'par de claves creado'} (clave pública de ${keys.publicKey.length} caracteres)`,
  )
}

main().catch((e) => {
  // Solo el mensaje: ningún error de acá nombra una clave, pero el objeto entero puede traer de más.
  console.error(e instanceof Error ? e.message : 'falló')
  process.exit(1)
})
