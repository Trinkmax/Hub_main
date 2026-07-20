import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClientEnv } from '@/lib/env'

let client: SupabaseClient | undefined
let authReady: Promise<void> | undefined

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
    ready = supabase.auth
      .getSession()
      .then(({ data }) => {
        const token = data.session?.access_token
        if (token) supabase.realtime.setAuth(token)
      })
      .catch(() => {
        // Sin sesión: el socket queda como anon (páginas públicas)
      })
    authReady = ready
  }
  return ready
}
