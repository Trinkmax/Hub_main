import { QR_TOKEN_REGEX } from './schemas'

/**
 * Acepta dos formas de input del scanner:
 *   1. El token crudo (16 chars alfanuméricos), por si el QR fue impreso solo con el token.
 *   2. Una URL completa con `/m/<token>` al final.
 *
 * Devuelve el token validado o null si no se puede extraer.
 */
export function parseQrInput(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (raw.length === 0) return null

  if (QR_TOKEN_REGEX.test(raw)) return raw

  try {
    const url = new URL(raw)
    const match = url.pathname.match(/\/m\/([A-Za-z0-9]{16})\/?$/)
    if (match?.[1]) return match[1]
  } catch {
    // No era URL válida; cae al fallback regex de path.
  }

  const pathMatch = raw.match(/\/m\/([A-Za-z0-9]{16})\/?$/)
  return pathMatch?.[1] ?? null
}
