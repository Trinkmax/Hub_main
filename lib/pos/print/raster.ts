/**
 * Un logo en colores, pasado a puntos negros para la cabeza térmica — PURO y testeado
 * (`tests/lib/pos-print-escpos.test.ts`).
 *
 * Una térmica imprime negro o nada: no hay grises. Para un logo eso conviene (sale nítido), siempre
 * que lo de color no desaparezca. Por eso cuenta como tinta todo lo que NO es blanco ni transparente:
 * el signo dorado del logo de HUB sale negro, no blanco.
 */
import type { Raster } from './escpos'

/** Una imagen en RGBA de 8 bits (como la devuelve `png.ts`). */
export type Rgba = { width: number; height: number; data: Uint8Array }

/** Cuánta tinta lleva un punto: 0 = papel, 1 = negro. Lo transparente es papel. */
function inkOf(data: Uint8Array, index: number): number {
  const r = data[index] ?? 255
  const g = data[index + 1] ?? 255
  const b = data[index + 2] ?? 255
  const a = (data[index + 3] ?? 255) / 255
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return (1 - luminance) * a
}

/** Desde qué cantidad de tinta un punto del original cuenta como dibujo (para recortar los bordes). */
const INK = 0.18
/**
 * Desde qué promedio de tinta un punto achicado se imprime. Bajo, para que un color claro (el dorado)
 * y los trazos finos no se pierdan al achicar.
 */
const CUT = 0.32

/** El rectángulo donde está el dibujo (sin el margen vacío alrededor). */
function inkBox(image: Rgba): { left: number; top: number; right: number; bottom: number } | null {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (inkOf(image.data, (y * image.width + x) * 4) < INK) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { left, top, right, bottom }
}

/**
 * La imagen, recortada a lo que tiene dibujo y achicada a `maxWidth` puntos (sin pasar `maxHeight`),
 * en blanco y negro. `null` si no tiene nada que imprimir.
 */
export function toRaster(image: Rgba, maxWidth: number, maxHeight = maxWidth): Raster | null {
  const box = inkBox(image)
  if (!box) return null
  const sourceWidth = box.right - box.left + 1
  const sourceHeight = box.bottom - box.top + 1
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  const width = Math.max(8, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const bytesPerRow = Math.ceil(width / 8)
  const data = new Uint8Array(bytesPerRow * height)

  for (let y = 0; y < height; y++) {
    // Cada punto nuevo es el promedio de los puntos del original que cubre (achicar sin perder trazos finos).
    const y0 = box.top + Math.floor(y / scale)
    const y1 = Math.max(y0 + 1, Math.min(box.bottom + 1, box.top + Math.floor((y + 1) / scale)))
    for (let x = 0; x < width; x++) {
      const x0 = box.left + Math.floor(x / scale)
      const x1 = Math.max(x0 + 1, Math.min(box.right + 1, box.left + Math.floor((x + 1) / scale)))
      let sum = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          sum += inkOf(image.data, (sy * image.width + sx) * 4)
          count++
        }
      }
      if (count > 0 && sum / count >= CUT) {
        const at = y * bytesPerRow + (x >> 3)
        data[at] = (data[at] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }
  return { width: bytesPerRow * 8, height, data }
}
