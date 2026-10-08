/**
 * Huellas de los importadores (diseño §4.0, «Idempotencia, en cuatro capas»).
 *
 * - `sha256Hex`: el SHA-256 del archivo (capa 1, «ya importaste este archivo»).
 *   Usa Web Crypto cuando está y, si no, el SHA-256 puro de
 *   `lib/accounting/preview.ts`: abriendo el panel por la IP de la red local
 *   (`http://192.168.x.x`) `crypto.subtle` no existe.
 * - `sha256HexSync`: siempre el puro, síncrono. Lo usan los parsers para las
 *   claves naturales de las filas (Mercado Pago y banco), que tienen que dar lo
 *   mismo en el navegador y en el cron.
 * - `uuidV8FromSha256`: el `client_ref` determinístico de cada propuesta. Son los
 *   primeros 16 bytes del SHA-256 con versión 8 y variante RFC 9562 (`z.uuid()`
 *   de zod 4 la acepta). El mismo texto da siempre el mismo UUID, así un
 *   reintento cae en la idempotencia de `acc_post_bundle`.
 */

import { sha256Hex as pureSha256Hex } from '@/lib/accounting/preview'

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function webSubtle(): SubtleCrypto | null {
  const c: Crypto | undefined =
    typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto
  return c?.subtle ?? null
}

/** SHA-256 en hex minúscula (64 caracteres), síncrono y puro. `string` se firma como UTF-8. */
export function sha256HexSync(input: string | Uint8Array): string {
  return pureSha256Hex(input)
}

/**
 * SHA-256 en hex minúscula con Web Crypto si existe (más rápido con archivos de
 * varios MB) y con la versión pura si no. Las dos dan exactamente lo mismo.
 */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const subtle = webSubtle()
  if (!subtle) return pureSha256Hex(input)
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  // Copia a un ArrayBuffer propio: un `subarray` de un buffer más grande o uno
  // compartido no siempre se acepta tal cual.
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const digest = await subtle.digest('SHA-256', copy.buffer)
  return toHex(new Uint8Array(digest))
}

/** Forma de un SHA-256 en hex (la que exigen los CHECK de la base). */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/**
 * UUID versión 8 (RFC 9562) con los primeros 16 bytes del SHA-256 del texto:
 * `client_ref = uuidV8FromSha256('acc-import:' + tenantId + ':' + key + ':' + attempt)`.
 */
export function uuidV8FromSha256(text: string): string {
  const hex = pureSha256Hex(text).slice(0, 32)
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80 // versión 8
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // variante 10xx (RFC 9562)
  const h = toHex(bytes)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** El `client_ref` de una propuesta importada (diseño §4.0, capa 3). */
export function importClientRef(tenantId: string, proposalKey: string, attempt: number): string {
  return uuidV8FromSha256(`acc-import:${tenantId}:${proposalKey}:${attempt}`)
}
