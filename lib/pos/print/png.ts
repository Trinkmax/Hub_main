/**
 * Leer un PNG sin librerías — PURO y testeado (`tests/lib/pos-print-escpos.test.ts`).
 *
 * Lo necesita «HUB Impresoras» para imprimir el logo del bar en la comandera. El programa corre en una
 * compu del bar con solo Node instalado, así que no puede depender de una librería de imágenes: esto lee
 * los PNG comunes (los que exportan Canva, Photoshop o Figma: color, gris o paleta, con o sin
 * transparencia, de 8 bits o menos y sin entrelazar). Descomprimir lo hace quien llama (`inflate`):
 * en Node, `zlib.inflateSync`.
 */
import type { Rgba } from './raster'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function u32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) * 0x1000000 +
      ((bytes[at + 1] ?? 0) << 16) +
      ((bytes[at + 2] ?? 0) << 8) +
      (bytes[at + 3] ?? 0)) >>>
    0
  )
}

function chunkType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0,
  )
}

/** Cuántas muestras tiene cada punto según el tipo de color del PNG. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function decodePng(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): Rgba {
  if (SIGNATURE.some((value, index) => bytes[index] !== value)) throw new Error('no es un PNG')

  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  const parts: Uint8Array[] = []

  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = u32(bytes, at)
    const type = chunkType(bytes, at + 4)
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = u32(body, 0)
      height = u32(body, 4)
      depth = body[8] ?? 0
      colorType = body[9] ?? 0
      if ((body[12] ?? 0) !== 0) throw new Error('PNG entrelazado')
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') transparency = body
    else if (type === 'IDAT') parts.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }

  const channels = CHANNELS[colorType]
  if (!width || !height || channels === undefined) throw new Error('PNG sin forma conocida')
  if (depth === 16 || (depth < 8 && colorType !== 0 && colorType !== 3)) {
    throw new Error('PNG de una profundidad que no se lee')
  }
  if (width * height > 25_000_000) throw new Error('PNG demasiado grande')

  const compressed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    compressed.set(part, offset)
    offset += part.length
  }
  const raw = inflate(compressed)

  const bitsPerPixel = depth * channels
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const step = Math.max(1, bitsPerPixel >> 3)
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    const source = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x] ?? 0
      const left = x >= step ? (pixels[row + x - step] ?? 0) : 0
      const up = y > 0 ? (pixels[row - stride + x] ?? 0) : 0
      const upLeft = y > 0 && x >= step ? (pixels[row - stride + x - step] ?? 0) : 0
      let out = value
      if (filter === 1) out = value + left
      else if (filter === 2) out = value + up
      else if (filter === 3) out = value + ((left + up) >> 1)
      else if (filter === 4) out = value + paeth(left, up, upLeft)
      pixels[row + x] = out & 0xff
    }
  }

  const rgba = new Uint8Array(width * height * 4)
  const sample = (y: number, index: number): number => {
    if (depth === 8) return pixels[y * stride + index] ?? 0
    const bit = index * depth
    const byte = pixels[y * stride + (bit >> 3)] ?? 0
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
  }
  const scale = depth < 8 && colorType === 0 ? 255 / ((1 << depth) - 1) : 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4
      const base = x * channels
      if (colorType === 3) {
        const index = sample(y, x)
        rgba[out] = palette?.[index * 3] ?? 0
        rgba[out + 1] = palette?.[index * 3 + 1] ?? 0
        rgba[out + 2] = palette?.[index * 3 + 2] ?? 0
        rgba[out + 3] = transparency?.[index] ?? 255
      } else if (colorType === 0 || colorType === 4) {
        const gray = Math.round(sample(y, base) * scale)
        rgba[out] = gray
        rgba[out + 1] = gray
        rgba[out + 2] = gray
        rgba[out + 3] = colorType === 4 ? sample(y, base + 1) : 255
      } else {
        rgba[out] = sample(y, base)
        rgba[out + 1] = sample(y, base + 1)
        rgba[out + 2] = sample(y, base + 2)
        rgba[out + 3] = colorType === 6 ? sample(y, base + 3) : 255
      }
    }
  }
  return { width, height, data: rgba }
}
