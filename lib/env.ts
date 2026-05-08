/**
 * Helper para vars de runtime con error claro si faltan. Solo válido
 * server-side: en server, `process.env[name]` se resuelve a runtime.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

/**
 * Vars del cliente Supabase. Acceso ESTÁTICO (`process.env.NEXT_PUBLIC_X`)
 * obligatorio para que Next.js las inyecte en el bundle del cliente al
 * build time. Si usás `process.env[name]` dinámico, Next no puede
 * analizarlo y queda undefined en el browser.
 */
export function getSupabaseClientEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL. Definila en .env / .env.local y reiniciá el dev server.',
    )
  }
  if (!anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY. Definila en .env / .env.local y reiniciá el dev server.',
    )
  }
  return { url, anonKey }
}
