/**
 * Los headers con los que se sirve el HTML que sube el bar (/p/[slug]).
 *
 * ESTO ES LO QUE HACE QUE LA FEATURE SEA SEGURA, así que vive en un archivo
 * propio y se aplica DOS VECES a propósito: en `next.config.ts` (que gana
 * siempre: Next descarta el header del Response si la config ya seteó esa key)
 * y en el Route Handler. Si alguien borra uno de los dos, el otro sigue de pie.
 *
 * POR QUÉ `sandbox`
 * -----------------
 * El HTML lo escribe una persona, no nosotros, y se sirve desde el MISMO
 * dominio que el panel. Las cookies de sesión de `@supabase/ssr` son
 * `httpOnly: false` por diseño (el cliente del browser las lee), o sea que un
 * `<script>` copiado de cualquier lado dentro de una landing podría hacer
 * `document.cookie` y llevarse la sesión de quien la abra — incluido el dueño
 * de OTRO bar. Con `Content-Security-Policy: sandbox` y SIN `allow-same-origin`
 * el documento queda en un "origen opaco": `document.cookie`, `localStorage`,
 * `indexedDB` y `fetch` con credenciales tiran SecurityError, y las cookies
 * SameSite=Lax ni siquiera viajan. Es la recomendación explícita de Google para
 * hostear contenido de usuarios (web.dev/articles/securely-hosting-user-data) y
 * lo que hace hoy `raw.githubusercontent.com`.
 *
 * Los flags que SÍ damos son los que necesita una landing de verdad: correr su
 * JS de animaciones, abrir WhatsApp en otra pestaña (y que esa pestaña NO
 * herede el sandbox), mandar un formulario y descargar un PDF.
 * `allow-same-origin` no se agrega NUNCA. Los `allow-top-navigation*` no se
 * ponen porque en un documento top-level no hacen nada.
 *
 * Lo que NO tapa: `history.pushState` puede reescribir la barra de direcciones
 * a otra ruta del mismo dominio. Por eso la sección es sólo del dueño y cada
 * publicación queda en `audit_log`.
 */

export const LANDING_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads; frame-ancestors 'none'"

/**
 * Headers fijos de `/p/*`. Van en `next.config.ts` DESPUÉS del bloque general
 * (`/:path*`): en Next, ante la misma key gana la última definición.
 *
 * - `Referrer-Policy: no-referrer` — desde un origen opaco el navegador no
 *   manda Referer igual; lo declaramos para que sea explícito y no dependa del
 *   header general (`strict-origin-when-cross-origin`), que filtraría el
 *   dominio del panel.
 * - `Cross-Origin-Resource-Policy: same-origin` — que otro sitio no pueda
 *   cargar la landing como subrecurso.
 */
export const LANDING_SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: LANDING_CSP },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

/**
 * Los mismos flags, para el `sandbox` del <iframe> de la vista previa del
 * panel. Tienen que coincidir con `LANDING_CSP` o la previa mentiría: algo
 * andaría en el editor y no en la página publicada.
 *
 * (`allow-downloads` no va: en la previa no queremos que un script arranque
 * una descarga mientras el dueño escribe.)
 */
export const LANDING_PREVIEW_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals'
