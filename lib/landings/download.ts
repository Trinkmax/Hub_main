import { format } from 'date-fns'

/**
 * Bajar el código de una página como archivo `.html`.
 *
 * Existe por el ida y vuelta con ChatGPT: marketing arma la landing allá, la
 * retoca a mano en el panel y, para la vuelta siguiente, tiene que pasarle
 * EXACTAMENTE lo que quedó acá. Seleccionar y copiar un textarea de 200 KB es
 * donde se pierde un pedazo del archivo, o se le pasa la versión vieja que
 * quedó en la compu y ChatGPT pisa los retoques.
 */

/**
 * `halloween_2026-09-21_14.38.html`.
 *
 * La hora va en el nombre porque el archivo se baja muchas veces: sin ella el
 * navegador numera (`halloween (3).html`) y adivinar cuál es el último es justo
 * el error que el botón viene a evitar. `14.38` como las capturas de macOS: los
 * `:` no son válidos en un nombre de archivo de Windows.
 */
export function landingFileName(slug: string, at: Date): string {
  return `${slug}_${format(at, 'yyyy-MM-dd_HH.mm')}.html`
}

/**
 * Dispara la descarga en el navegador. Baja el texto tal cual lo recibe, sin
 * BOM ni retoques: es el mismo archivo que después vuelve por "Subir .html".
 */
export function downloadLandingHtml(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Safari cancela la descarga si la URL se revoca en el mismo tick del click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
