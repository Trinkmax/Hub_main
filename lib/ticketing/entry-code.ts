/**
 * El código que lleva el QR de una entrada: el id del pedido escrito más corto
 * (22 caracteres en vez de 36). Menos caracteres son menos puntos en el QR, y
 * un QR con puntos más grandes se lee mejor en la puerta, con poca luz y de
 * celular a celular.
 *
 * No es una llave nueva: el id del pedido ya es la llave de la entrada (uuid al
 * azar, ver getPublicOrder). Solo del server: usa Buffer.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE_RE = /^[A-Za-z0-9_-]{22}$/

export function entryCodeFromOrderId(orderId: string): string {
  if (!UUID_RE.test(orderId)) throw new Error('entry-code: el id del pedido no es un uuid')
  return Buffer.from(orderId.replace(/-/g, ''), 'hex').toString('base64url')
}

/** El id del pedido, o `null` si el código no salió de `entryCodeFromOrderId`. */
export function orderIdFromEntryCode(code: string): string | null {
  if (!CODE_RE.test(code)) return null
  const hex = Buffer.from(code, 'base64url').toString('hex')
  if (hex.length !== 32) return null
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  // Un mismo uuid admite varias escrituras con el último caracter distinto: vale una sola.
  return entryCodeFromOrderId(id) === code ? id : null
}

/** «a1b2c3d4-…» → «A1B2C3D4»: el número que se lee en la entrada y se puede dictar. */
export function shortCodeFromOrderId(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase()
}
