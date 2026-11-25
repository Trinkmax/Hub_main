import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClientEnv } from '@/lib/env'
import { probeConnection } from '@/lib/realtime/probe'

let client: SupabaseClient | undefined
let authReady: Promise<void> | undefined
let keeping = false
let watching = false

/**
 * Cuánto tiene que haber estado oculta la pantalla (celular bloqueado, otra app adelante) para desconfiar de la
 * conexión en vivo al volver. Una ojeada rápida a otra pestaña no hace falta revisarla.
 */
const WAKE_AFTER_HIDDEN_MS = 4_000

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
    keepRealtimeAlive()
    ready = syncRealtimeAuth()
    authReady = ready
  }
  return ready
}

/**
 * ¿Sigue viva la conexión en vivo? Si no, que la librería la levante de nuevo y vuelva a unir los canales.
 *
 * Por qué (25/11/2026, «en el sistema de los mozos no se actualizan las cosas en tiempo real»): al bloquear el
 * celular el navegador congela la página y el servidor corta la conexión, pero la página no se entera. Al
 * desbloquear, el socket sigue figurando abierto y la librería recién lo da por muerto cuando un latido queda sin
 * respuesta: hasta ~50 segundos sin avisos (medido en producción: 57 s en el Operativo y, en el tablero del salón,
 * nunca más). Apenas vuelve la pantalla (o la red) se manda un latido y, si no contesta, se reconecta
 * (`lib/realtime/probe.ts`). Cada pantalla, al ver su canal de nuevo en vivo, relee lo que se perdió en el medio.
 */
export function probeRealtime(): void {
  probeConnection(createClient().realtime)
}

/**
 * Revisa la conexión en vivo cada vez que la pantalla vuelve a estar a la vista después de un rato, cuando
 * vuelve la red y cuando el navegador restaura la página de su caché (atrás/adelante).
 */
function keepRealtimeAlive(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  let hiddenAt: number | null = document.hidden ? Date.now() : null
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now()
      return
    }
    const since = hiddenAt
    hiddenAt = null
    if (since !== null && Date.now() - since >= WAKE_AFTER_HIDDEN_MS) probeRealtime()
  })
  window.addEventListener('online', () => probeRealtime())
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) probeRealtime()
  })
}
