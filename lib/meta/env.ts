import 'server-only'
import { requireEnv } from '@/lib/env'
import { loadMetaCredentials } from './platform-config'

const DEFAULT_GRAPH_VERSION = 'v23.0'

// tokenKey y graphVersion SIEMPRE de env (no de la DB), para mantener graphUrl/crypto
// síncronos y romper el ciclo de imports con platform-config (que descifra el secret).
export function getTokenKey(): string {
  return requireEnv('META_TOKEN_KEY')
}

export function getGraphVersion(): string {
  return process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
}

/**
 * ¿Está configurada la app de Meta a nivel plataforma? (sin throw — para decidir
 * la UX antes de intentar el OAuth). Sin META_APP_ID/SECRET no se puede conectar.
 */
export async function isMetaConfigured(): Promise<boolean> {
  try {
    await loadMetaCredentials()
    return true
  } catch (e) {
    // Sólo silenciamos "config incompleta" (caso normal pre-conexión). Otros errores
    // (Supabase caído, META_TOKEN_KEY incorrecta/rotada → falla el descifrado) se loguean.
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes('Meta config incompleta')) {
      console.error('[isMetaConfigured] error inesperado:', msg)
    }
    return false
  }
}

export async function getMetaConfig() {
  const creds = await loadMetaCredentials()
  return {
    appId: creds.appId,
    appSecret: creds.appSecret,
    webhookVerifyToken: creds.webhookVerifyToken,
    graphVersion: getGraphVersion(),
    tokenKey: getTokenKey(),
    appUrl: requireEnv('NEXT_PUBLIC_APP_URL'),
  }
}

export function graphUrl(path: string) {
  const clean = path.startsWith('/') ? path.slice(1) : path
  return `https://graph.facebook.com/${getGraphVersion()}/${clean}`
}

export function instagramGraphUrl(path: string) {
  const clean = path.startsWith('/') ? path.slice(1) : path
  return `https://graph.instagram.com/${getGraphVersion()}/${clean}`
}
