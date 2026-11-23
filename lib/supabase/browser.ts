import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClientEnv } from '@/lib/env'

let client: SupabaseClient | undefined
let authReady: Promise<void> | undefined
let keeping = false

/**
 * Cliente Supabase del browser (singleton: un solo websocket para toda la app).
 */
export function createClient() {
  if (client) return client
  const { url, anonKey } = getSupabaseClientEnv()
  client = createBrowserClient(url, anonKey)
  if (typeof window !== 'undefined') {
    void realtimeAuthReady()
  }
  return client
}

/**
 * Le pasa al socket de Realtime la sesión de AHORA, pidiéndosela al cliente (sin escribirle un token a mano).
 *
 * Por qué así (23/11/2026, «hay que actualizar todo el tiempo para ver los cambios de colores»): un token
 * escrito a mano con `setAuth(token)` queda fijo. La librería deja de renovarlo en cada latido («manual
 * token») y el token dura una hora: pasada la hora, Realtime cierra los canales privados y cada reintento
 * vuelve a entrar con el token vencido (`InvalidJWTExpiration`). El salón quedaba «sin conexión» hasta
 * recargar la página. Además, acá la sesión muchas veces la renueva el SERVIDOR (el proxy, en cada pedido),
 * no el navegador: el navegador nunca se entera por un evento, pero sí la ve si la vuelve a leer.
 *
 * `setAuth()` sin argumentos lee la sesión vigente (de las cookies), se la manda a los canales si cambió y
 * deja a la librería renovándola sola.
 */
export async function syncRealtimeAuth(): Promise<void> {
  const supabase = createClient()
  try {
    await supabase.realtime.setAuth()
  } catch {
    // Sin sesión legible: el socket queda como anónimo (páginas públicas) o con el último token bueno.
  }
}

/**
 * Mantiene el token del socket al día mientras haya conexión: en cada latido (cada ~25 s) se vuelve a
 * leer la sesión. Hace falta aunque `syncRealtimeAuth` ya la haya puesto bien: cuando el navegador renueva
 * la sesión, supabase-js le escribe el token nuevo A MANO al socket y la renovación automática se apaga de
 * nuevo. Leer en cada latido la vuelve a prender, la renueve quien la renueve.
 */
function keepRealtimeAuthFresh(supabase: SupabaseClient): void {
  if (keeping) return
  keeping = true
  supabase.realtime.onHeartbeat((status) => {
    if (status === 'sent') void syncRealtimeAuth()
  })
}

/**
 * Resuelve cuando el socket de Realtime ya tiene el JWT del usuario.
 *
 * IMPORTANTE: los claims de una suscripción postgres_changes se fijan al
 * momento del JOIN y el servidor NO los re-evalúa después. Si el canal se une
 * antes de que supabase-js cargue la sesión, queda como `anon`, RLS filtra
 * todo y no llega ningún evento (bug que dejaba el inbox sin realtime).
 * Esperá esta promise ANTES de llamar `.subscribe()`.
 */
export function realtimeAuthReady(): Promise<void> {
  const supabase = createClient()
  let ready = authReady
  if (!ready) {
    keepRealtimeAuthFresh(supabase)
    ready = syncRealtimeAuth()
    authReady = ready
  }
  return ready
}
