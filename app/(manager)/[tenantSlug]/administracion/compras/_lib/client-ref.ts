/**
 * El `clientRef` de un formulario contable (G.6): un UUID v4 que hace
 * idempotente el envío (un reintento devuelve lo ya guardado).
 *
 * `crypto.randomUUID` solo existe en contextos seguros (HTTPS o `localhost`):
 * abriendo el panel por la IP de la red desde el celular no está. Ahí se arma
 * con `crypto.getRandomValues`, que existe en cualquier contexto.
 */
export function newClientRef(): string {
  const c = typeof globalThis === 'undefined' ? undefined : globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      // Contexto no seguro: sigue abajo.
    }
  }
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  // Versión 4 y variante RFC 4122 (lo que valida `z.uuid()`).
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
