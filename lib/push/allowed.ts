/**
 * A qué direcciones se les puede mandar una notificación push — PURO y testeado
 * (`tests/lib/push-allowed.test.ts`).
 *
 * El `endpoint` de una suscripción lo trae el navegador, o sea que lo puede escribir cualquiera que
 * tenga una sesión. Como después es el servidor el que le hace un POST, sin este control alcanzaría
 * con anotar una dirección interna para usar a la app de puente (SSRF). Acá solo pasan los servicios
 * de push de verdad, por https, en el puerto de siempre y sin usuario ni contraseña en la dirección.
 */

/** Servicios que atienden en un único nombre. */
const HOSTS: readonly string[] = [
  // Chrome y los navegadores armados sobre Chromium que usan el servicio de Google.
  'fcm.googleapis.com',
  // El mismo servicio para los Chrome que no son la versión estable (Beta, Dev, Canary): según el
  // código de Chromium (`push_messaging_utils.cc`), esos entregan sus endpoints en este otro nombre.
  'jmt17.google.com',
]

/** Servicios que reparten entre varios nombres: vale cualquier subdominio, no el dominio pelado. */
const SUFFIXES: readonly string[] = [
  // Safari y las apps instaladas en iPhone y iPad (`web.push.apple.com`).
  '.push.apple.com',
  // Firefox (`updates.push.services.mozilla.com`).
  '.push.services.mozilla.com',
  // Edge (`….notify.windows.com`).
  '.notify.windows.com',
]

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

export function isAllowedPushEndpoint(url: string): boolean {
  if (typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false
  // `URL` deja el puerto vacío cuando es el del protocolo (443): cualquier otro es sospechoso.
  if (parsed.port !== '') return false

  // `URL` ya lo deja en minúsculas, y a una IP escrita en hexadecimal o como un solo número la pasa a
  // la forma de cuatro números. Ninguna IP está en la lista, pero se corta acá por si la lista crece.
  const host = parsed.hostname
  if (host.startsWith('[') || IPV4.test(host)) return false
  // Un nombre con una parte vacía (`.push.apple.com`, `a..notify.windows.com`) no es de nadie.
  if (host.startsWith('.') || host.includes('..')) return false

  return HOSTS.includes(host) || SUFFIXES.some((suffix) => host.endsWith(suffix))
}
