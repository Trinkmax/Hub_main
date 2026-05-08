import 'server-only'
import { headers } from 'next/headers'

/**
 * Extrae la IP cliente del request actual.
 * Confiamos en `x-forwarded-for` cuando estamos detrás de Vercel/proxy
 * y caemos a `x-real-ip`. En ausencia de ambos devolvemos `unknown` para
 * que el rate-limiter use la cadena literal como key — es estricto pero
 * seguro para entornos de dev sin proxy real.
 */
export async function getRequestIp(): Promise<string> {
  const h = await headers()
  const xff = h.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = h.get('x-real-ip')?.trim()
  if (real) return real
  return 'unknown'
}

export async function getRequestUserAgent(): Promise<string | null> {
  const h = await headers()
  return h.get('user-agent') ?? null
}
