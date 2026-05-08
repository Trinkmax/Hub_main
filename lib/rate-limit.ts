/**
 * Rate limiting in-memory (MVP).
 *
 * Limitación conocida: en serverless cada instancia/cold-start tiene su
 * propio mapa, así que el límite efectivo puede exceder el configurado.
 * Aceptable para MVP/desarrollo. Path de upgrade: swap interno por
 * `@upstash/ratelimit` o `@vercel/kv` manteniendo la misma interfaz.
 */

export class RateLimitedError extends Error {
  readonly code = 'rate_limited'
  readonly retryAfterMs: number
  constructor(retryAfterMs: number, message = 'Demasiados intentos. Probá en un minuto.') {
    super(message)
    this.name = 'RateLimitedError'
    this.retryAfterMs = retryAfterMs
  }
}

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export type RateLimitOpts = {
  key: string
  limit: number
  windowMs: number
  /** Permite inyectar un clock para tests. */
  now?: () => number
}

export function rateLimit({ key, limit, windowMs, now = Date.now }: RateLimitOpts): void {
  const t = now()
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= t) {
    buckets.set(key, { count: 1, resetAt: t + windowMs })
    return
  }

  if (existing.count >= limit) {
    throw new RateLimitedError(existing.resetAt - t)
  }

  existing.count += 1
}

/** Solo para tests. Limpia el estado global. */
export function _resetRateLimit(): void {
  buckets.clear()
}
