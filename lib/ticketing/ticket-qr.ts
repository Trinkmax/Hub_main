import QRCode from 'qrcode'
import { QR_EYE, type TicketQr } from './ticket-art'

/**
 * El dibujo del QR de la entrada, listo para pintar en SVG y en canvas con los
 * mismos trazos. Solo del server: `qrcode` no baja al navegador.
 *
 * - Los datos van como columnas de píldoras redondeadas: la pista de sonido al
 *   costado de una película. El centro de cada módulo sigue siendo oscuro o
 *   claro como manda el estándar, que es lo único que mira un lector.
 * - Los tres ojos los dibuja quien pinta (anillo + centro, como un rollo de
 *   película): acá solo quedan afuera del trazo. El centro del ojo va LLENO: con
 *   agujeritos adentro ZXing (el lector de nuestro escáner en iPhone) dejaba de
 *   leerlo, aunque el motor de la cámara del iPhone lo leyera perfecto.
 * - El centro queda libre para la ✦. Corrección de errores Q (25 %): alcanza y
 *   sobra para ese hueco, un reflejo o un vidrio rayado.
 */

/** Un trazo de largo cero no se pinta en canvas: el punto suelto lleva un largo mínimo. */
const DOT = '.001'

export function buildTicketQr(url: string): TicketQr {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'Q' })
  const size = modules.size
  const dark = (x: number, y: number) => modules.data[y * size + x] === 1

  // Impar, para que quede centrado sobre un módulo.
  const hole = Math.max(5, Math.round(size * 0.135) | 1)
  const holeFrom = (size - hole) / 2
  const inHole = (x: number, y: number) =>
    x >= holeFrom && x < holeFrom + hole && y >= holeFrom && y < holeFrom + hole
  const inEye = (x: number, y: number) =>
    (x < QR_EYE && y < QR_EYE) ||
    (x >= size - QR_EYE && y < QR_EYE) ||
    (x < QR_EYE && y >= size - QR_EYE)
  const paints = (x: number, y: number) => dark(x, y) && !inEye(x, y) && !inHole(x, y)

  const parts: string[] = []
  for (let x = 0; x < size; x++) {
    let y = 0
    while (y < size) {
      if (!paints(x, y)) {
        y++
        continue
      }
      let end = y
      while (end + 1 < size && paints(x, end + 1)) end++
      parts.push(`M${x + 0.5} ${y + 0.5}${end === y ? `v${DOT}` : `V${end + 0.5}`}`)
      y = end + 1
    }
  }
  return { url, size, path: parts.join(''), hole }
}
