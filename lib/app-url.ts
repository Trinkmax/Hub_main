import { headers } from 'next/headers'

/**
 * Devuelve la base URL canónica de la app, sin trailing slash.
 *
 * Prioridad de resolución (de más confiable a menos):
 *   1. Host de la request actual (siempre correcto en server components)
 *   2. NEXT_PUBLIC_APP_URL si está seteado y no es localhost
 *   3. VERCEL_PROJECT_PRODUCTION_URL (auto-inyectado por Vercel)
 *   4. VERCEL_URL (auto-inyectado por Vercel, dominio del deployment actual)
 *   5. NEXT_PUBLIC_APP_URL aunque sea localhost (último recurso para dev local)
 *
 * Esto hace que los QRs impresos, links del panel cliente, etc. siempre
 * apunten al dominio real desde donde se accedió, sin depender de la env
 * var manual.
 */
export async function getAppUrl(): Promise<string> {
  try {
    const h = await headers()
    const host = h.get('host')
    if (host && !host.startsWith('localhost') && !host.startsWith('127.')) {
      const proto = h.get('x-forwarded-proto') ?? 'https'
      return `${proto}://${host}`
    }
  } catch {
    // headers() no disponible (build time, edge non-request context, etc.)
  }

  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit && !explicit.includes('localhost') && !explicit.includes('127.')) {
    return explicit.replace(/\/$/, '')
  }

  const vercelProd =
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercelProd) return `https://${vercelProd}`

  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL
  if (vercelUrl) return `https://${vercelUrl}`

  return explicit ?? 'http://localhost:3000'
}
