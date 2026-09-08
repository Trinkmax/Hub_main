/**
 * Cómo y desde dónde se sirve el HTML que sube el bar.
 *
 * HAY DOS MODOS, y cuál corre depende de una sola variable de entorno:
 *
 *  A) HOST DEDICADO (`NEXT_PUBLIC_LANDINGS_HOST`) — el bueno.
 *     Las landings se sirven desde otro host (ej. `hubbar-paginas.vercel.app`,
 *     o mañana `paginas.hubbar.com.ar`) donde NO vive nada del panel. Ahí el
 *     HTML del bar corre como cualquier página de internet: sin sandbox, con su
 *     origen real. Videos de YouTube, Analytics, localStorage: todo funciona.
 *     La sesión del panel no corre riesgo porque las cookies de `@supabase/ssr`
 *     son host-only (no llevan atributo Domain), así que otro host NO puede
 *     leerlas — y el proxy además impide que el panel se sirva en ese host, de
 *     modo que ahí nunca puede existir una sesión.
 *
 *     `vercel.app` está en la Public Suffix List: dos subdominios `.vercel.app`
 *     son cross-SITE entre sí, no sólo cross-origin. Por eso alcanza con pedir
 *     otro `*.vercel.app` en Vercel — sin comprar dominio ni tocar DNS.
 *
 *  B) DOMINIO COMPARTIDO (la variable vacía) — el modo prudente.
 *     Si no hay host dedicado, la landing se sirve en `/p/[slug]` del mismo
 *     dominio que el panel y ahí SÍ va con `Content-Security-Policy: sandbox`
 *     sin `allow-same-origin`. Sin eso, un `<script>` copiado de un tutorial
 *     dentro de una landing podría hacer `document.cookie` y llevarse la sesión
 *     de cualquiera que la abra — el dueño de otro bar, un superadmin, vos.
 *
 *     El precio del sandbox está medido, no supuesto: el documento queda en un
 *     "origen opaco" y **los iframes anidados heredan esos flags**, así que el
 *     reproductor de YouTube queda con `origin: "null"` y sin storage, y no
 *     arranca. Comprobado en Chrome: `localStorage → SecurityError` adentro del
 *     iframe hijo. Por eso el modo A existe.
 *
 * NUNCA agregar `allow-same-origin` al modo B para "arreglar" los videos: es
 * exactamente el permiso que le devuelve a la landing el acceso a la sesión.
 * La salida es el host dedicado, no aflojar el sandbox.
 */

/**
 * Host que sirve las landings, sin protocolo (ej. `hubbar-paginas.vercel.app`).
 * Vacío = modo B. Es `NEXT_PUBLIC_` porque el editor también necesita saberlo
 * para no mentir en la vista previa ni en los avisos.
 */
export const LANDINGS_HOST = (process.env.NEXT_PUBLIC_LANDINGS_HOST ?? '')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '')
  .toLowerCase()

/** ¿Hay un host dedicado configurado? */
export const HAS_LANDINGS_HOST = LANDINGS_HOST.length > 0

/** El `Host:` que llega puede traer puerto; comparamos por hostname. */
export function isLandingsHost(host: string | null | undefined): boolean {
  if (!HAS_LANDINGS_HOST || !host) return false
  const clean = host.toLowerCase()
  return clean === LANDINGS_HOST || clean.split(':')[0] === LANDINGS_HOST.split(':')[0]
}

/** Origen absoluto del host dedicado, o null si no hay. */
export function landingsOrigin(): string | null {
  if (!HAS_LANDINGS_HOST) return null
  const protocol =
    LANDINGS_HOST.startsWith('localhost') || LANDINGS_HOST.startsWith('127.') ? 'http' : 'https'
  return `${protocol}://${LANDINGS_HOST}`
}

export const LANDING_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads; frame-ancestors 'none'"

/**
 * Headers del modo B (`/p/*` en el dominio del panel). En `next.config.ts` van
 * DESPUÉS del bloque general (`/:path*`) porque ante la misma key gana la
 * última definición, y con `missing: host` para que NO se apliquen en el host
 * dedicado — ahí el sandbox es justamente lo que no queremos.
 *
 * - `Referrer-Policy: no-referrer` — desde un origen opaco el navegador no manda
 *   Referer igual; lo declaramos explícito para no filtrar el dominio del panel.
 * - `Cross-Origin-Resource-Policy: same-origin` — que otro sitio no pueda
 *   cargar la landing como subrecurso.
 */
export const LANDING_SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: LANDING_CSP },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

/**
 * Modo A: en el host dedicado no hay sandbox ni CSP propio. Sólo dejamos el
 * `Referrer-Policy` heredado del bloque general
 * (`strict-origin-when-cross-origin`), que le manda a YouTube el origen que
 * necesita para autorizar el reproductor, sin filtrar la ruta completa.
 */
export const LANDING_HOST_HEADERS = [{ key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }]

/**
 * El `sandbox` del <iframe> de la vista previa del panel.
 *
 * OJO: acá NO se agrega `allow-same-origin` NUNCA, ni siquiera en el modo A.
 * La previa usa `srcdoc`, así que con ese flag el HTML del bar heredaría el
 * origen DEL PANEL — justo donde está la sesión del dueño. Consecuencia
 * asumida: los videos no se reproducen en la previa aunque sí lo hagan en la
 * página publicada; el editor lo dice con todas las letras.
 */
export const LANDING_PREVIEW_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals'
