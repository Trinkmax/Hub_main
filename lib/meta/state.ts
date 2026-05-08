import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getMetaConfig } from './env'

// State firmado para OAuth callbacks. Formato: <tenantId>.<nonce>.<sig>
// Firmado con META_APP_SECRET para evitar CSRF.
export function signState(tenantId: string): string {
  const { appSecret } = getMetaConfig()
  const nonce = randomBytes(12).toString('hex')
  const data = `${tenantId}.${nonce}`
  const sig = createHmac('sha256', appSecret).update(data).digest('hex').slice(0, 32)
  return `${data}.${sig}`
}

export function verifyState(state: string): { tenantId: string } | null {
  const { appSecret } = getMetaConfig()
  const parts = state.split('.')
  if (parts.length !== 3) return null
  const [tenantId, nonce, sig] = parts
  if (!tenantId || !nonce || !sig) return null
  const expected = createHmac('sha256', appSecret)
    .update(`${tenantId}.${nonce}`)
    .digest('hex')
    .slice(0, 32)
  const a = Buffer.from(sig, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return null
  try {
    if (!timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  return { tenantId }
}
