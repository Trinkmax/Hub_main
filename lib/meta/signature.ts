import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

export function computeSignature(rawBody: string, appSecret: string): string {
  const hmac = createHmac('sha256', appSecret)
  hmac.update(rawBody, 'utf8')
  return `sha256=${hmac.digest('hex')}`
}

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false
  const expected = computeSignature(rawBody, appSecret)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signatureHeader, 'utf8')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
