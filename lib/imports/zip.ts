/**
 * Lector de ZIP mínimo (diseño §4.0): el ZIP de «Mis Comprobantes» y los
 * `.xlsx`, que también son ZIP.
 *
 * - Lee el **directorio central** (no los encabezados locales): ARCA arma el ZIP
 *   en streaming (bit 3: tamaños y CRC recién después de los datos), así que el
 *   encabezado local trae ceros. Soporta ZIP64.
 * - Métodos 0 (guardado) y 8 (deflate). Un ZIP con contraseña o con otro método
 *   tira `ZipError` con un código para el mensaje.
 * - El que descomprime se inyecta (`InflateRaw`). Por defecto,
 *   `DecompressionStream('deflate-raw')` si el runtime lo tiene, y si no
 *   `inflateRawSync`: un inflate de RFC 1951 escrito acá (Safari anterior a 16.4
 *   no tiene `deflate-raw`). Los dos se prueban contra `node:zlib`.
 * - Contra «bombas»: el tamaño declarado se controla ANTES de descomprimir, la
 *   salida no puede pasar de ese tamaño y al final se verifica el CRC-32.
 */

import { decodeWindows1252 } from './bytes'
import type { InflateRaw } from './types'

export type ZipErrorCode =
  | 'zip_corrupt'
  | 'zip_encrypted'
  | 'zip_unsupported'
  | 'zip_too_big'
  | 'zip_not_found'

export class ZipError extends Error {
  readonly code: ZipErrorCode
  constructor(code: ZipErrorCode, message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

export type ZipEntry = {
  readonly name: string
  /** 0 = guardado, 8 = deflate. */
  readonly method: number
  readonly compressedSize: number
  /** Tamaño descomprimido declarado. */
  readonly size: number
  readonly crc32: number
  readonly localHeaderOffset: number
  readonly encrypted: boolean
  readonly isDirectory: boolean
  /** Basura que agrega macOS al comprimir (`__MACOSX/`, `._archivo`). */
  readonly isJunk: boolean
}

/** Tope por archivo descomprimido (un CSV de 365 días de Emitidos no llega ni cerca). */
export const ZIP_MAX_ENTRY_SIZE = 100 * 1024 * 1024
const MAX_ENTRIES = 5000

// ─── CRC-32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 (el de ZIP y PNG). */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// ─── Directorio central ──────────────────────────────────────────────────────

const SIG_EOCD = 0x06054b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

function u16(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8)
}

function u32(b: Uint8Array, o: number): number {
  return (
    ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0
  )
}

function u64(b: Uint8Array, o: number): number {
  const lo = u32(b, o)
  const hi = u32(b, o + 4)
  const value = hi * 0x1_0000_0000 + lo
  if (!Number.isSafeInteger(value)) throw new ZipError('zip_too_big', 'ZIP64 con valores enormes')
  return value
}

function corrupt(what: string): ZipError {
  return new ZipError('zip_corrupt', `ZIP dañado: ${what}`)
}

function decodeName(raw: Uint8Array, utf8Flag: boolean): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    // Sin la marca UTF-8 los nombres van en la página de códigos del sistema; para
    // lo que usamos el nombre (mostrarlo y ver si dice «recibidos») alcanza.
    return utf8Flag ? new TextDecoder('utf-8').decode(raw) : decodeWindows1252(raw)
  }
}

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === SIG_EOCD && i + 22 + u16(bytes, i + 20) <= bytes.length) return i
  }
  throw corrupt('no se encontró el final del directorio')
}

/** Lista los archivos del ZIP leyendo su directorio central. */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const eocd = findEocd(bytes)
  let total = u16(bytes, eocd + 10)
  let cdSize = u32(bytes, eocd + 12)
  let cdOffset = u32(bytes, eocd + 16)

  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20
    if (loc < 0 || u32(bytes, loc) !== SIG_ZIP64_LOCATOR)
      throw corrupt('falta el localizador ZIP64')
    const z64 = u64(bytes, loc + 8)
    if (z64 + 56 > bytes.length || u32(bytes, z64) !== SIG_ZIP64_EOCD)
      throw corrupt('ZIP64 inválido')
    total = u64(bytes, z64 + 32)
    cdSize = u64(bytes, z64 + 40)
    cdOffset = u64(bytes, z64 + 48)
  }
  if (total > MAX_ENTRIES) throw new ZipError('zip_too_big', 'El ZIP tiene demasiados archivos')
  if (cdOffset + cdSize > bytes.length) throw corrupt('el directorio se sale del archivo')

  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== SIG_CENTRAL)
      throw corrupt('entrada del directorio')
    const flags = u16(bytes, p + 8)
    const method = u16(bytes, p + 10)
    const crc = u32(bytes, p + 16)
    let compressedSize = u32(bytes, p + 20)
    let size = u32(bytes, p + 24)
    const nameLen = u16(bytes, p + 28)
    const extraLen = u16(bytes, p + 30)
    const commentLen = u16(bytes, p + 32)
    let localHeaderOffset = u32(bytes, p + 42)
    const nameStart = p + 46
    const extraStart = nameStart + nameLen
    const next = extraStart + extraLen + commentLen
    if (next > bytes.length) throw corrupt('entrada del directorio cortada')

    // Campo extra ZIP64 (0x0001): trae, en orden, solo los valores que vinieron en 0xFFFFFFFF.
    let q = extraStart
    while (q + 4 <= extraStart + extraLen) {
      const id = u16(bytes, q)
      const len = u16(bytes, q + 2)
      if (id === 0x0001) {
        let r = q + 4
        if (size === 0xffffffff) {
          size = u64(bytes, r)
          r += 8
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(bytes, r)
          r += 8
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(bytes, r)
      }
      q += 4 + len
    }

    const name = decodeName(bytes.subarray(nameStart, extraStart), (flags & 0x0800) !== 0)
    const base = name.split('/').pop() ?? name
    entries.push({
      name,
      method,
      compressedSize,
      size,
      crc32: crc,
      localHeaderOffset,
      encrypted: (flags & 0x0001) !== 0,
      isDirectory: name.endsWith('/'),
      isJunk: name.startsWith('__MACOSX/') || base.startsWith('._') || base === '.DS_Store',
    })
    p = next
  }
  return entries
}

// ─── Lectura de un archivo ───────────────────────────────────────────────────

function dataOf(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const o = entry.localHeaderOffset
  if (o + 30 > bytes.length || u32(bytes, o) !== SIG_LOCAL) throw corrupt('encabezado local')
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28)
  const end = start + entry.compressedSize
  if (end > bytes.length) throw corrupt('datos cortados')
  return bytes.subarray(start, end)
}

/**
 * Descomprime un archivo del ZIP (por nombre exacto o la entrada de `listZip`).
 * Verifica tamaño y CRC-32.
 */
export async function readZipEntry(
  bytes: Uint8Array,
  entryOrName: ZipEntry | string,
  inflateRaw: InflateRaw = defaultInflateRaw,
  maxSize = ZIP_MAX_ENTRY_SIZE,
): Promise<Uint8Array> {
  const entry =
    typeof entryOrName === 'string'
      ? listZip(bytes).find((e) => e.name === entryOrName)
      : entryOrName
  if (!entry) throw new ZipError('zip_not_found', 'El archivo no está en el ZIP')
  if (entry.encrypted) throw new ZipError('zip_encrypted', 'El ZIP tiene contraseña')
  if (entry.size > maxSize)
    throw new ZipError('zip_too_big', 'El archivo del ZIP es demasiado grande')
  const data = dataOf(bytes, entry)
  let out: Uint8Array
  if (entry.method === 0) {
    out = data.slice()
  } else if (entry.method === 8) {
    try {
      // El tope es lo que declara el directorio central: si sale más, el ZIP miente (una
      // bomba) y el descompresor corta ahí, antes de llenar la memoria.
      out = await inflateRaw(data, entry.size)
    } catch (e) {
      if (e instanceof ZipError && e.code === 'zip_too_big') throw corrupt('el tamaño no coincide')
      if (e instanceof ZipError) throw e
      throw corrupt('no se pudo descomprimir')
    }
  } else {
    throw new ZipError('zip_unsupported', `Método de compresión ${entry.method} no soportado`)
  }
  if (out.length !== entry.size) throw corrupt('el tamaño no coincide')
  if (crc32(out) !== entry.crc32) throw corrupt('el CRC no coincide')
  return out
}

// ─── Descompresores ──────────────────────────────────────────────────────────

/** `DecompressionStream('deflate-raw')` (navegadores modernos y Node ≥ 21), cortando en `maxSize`. */
export async function inflateRawWithStreams(
  data: Uint8Array,
  maxSize = ZIP_MAX_ENTRY_SIZE,
): Promise<Uint8Array> {
  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxSize) {
      await reader.cancel()
      throw new ZipError('zip_too_big', 'El archivo descomprimido es demasiado grande')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

function hasDeflateRawStream(): boolean {
  if (typeof DecompressionStream !== 'function') return false
  try {
    new DecompressionStream('deflate-raw')
    return true
  } catch {
    return false
  }
}

/** El descompresor por defecto: el nativo si existe, si no `inflateRawSync`. Los dos cortan en `maxSize`. */
export const defaultInflateRaw: InflateRaw = (data, maxSize) =>
  hasDeflateRawStream() ? inflateRawWithStreams(data, maxSize) : inflateRawSync(data, maxSize)

// ─── Inflate (RFC 1951) ──────────────────────────────────────────────────────

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
] as const
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
] as const
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
] as const
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
] as const
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15] as const

/**
 * Tabla de decodificación «directa»: el índice son los próximos `bits` bits del
 * flujo (en el orden en que se leen) y cada entrada es `(símbolo << 4) | largo`.
 * Las entradas en 0 son códigos que no existen.
 */
type Huffman = { table: Int32Array; bits: number }

function buildHuffman(lengths: ArrayLike<number>, count: number): Huffman {
  const blCount = new Uint16Array(16)
  let maxLen = 0
  for (let s = 0; s < count; s++) {
    const len = lengths[s] ?? 0
    if (len > 15) throw corrupt('código de más de 15 bits')
    blCount[len] = (blCount[len] ?? 0) + 1
    if (len > maxLen) maxLen = len
  }
  blCount[0] = 0
  // Más códigos de los que entran en el árbol: el flujo está roto.
  let left = 1
  for (let len = 1; len <= 15; len++) {
    left = left * 2 - (blCount[len] ?? 0)
    if (left < 0) throw corrupt('árbol de Huffman inválido')
  }
  const bits = Math.max(1, maxLen)
  const table = new Int32Array(1 << bits)
  const nextCode = new Uint16Array(16)
  let code = 0
  for (let len = 1; len <= 15; len++) {
    code = (code + (blCount[len - 1] ?? 0)) << 1
    nextCode[len] = code
  }
  for (let s = 0; s < count; s++) {
    const len = lengths[s] ?? 0
    if (len === 0) continue
    const c = nextCode[len] ?? 0
    nextCode[len] = c + 1
    // Los códigos se escriben del bit más alto al más bajo pero el flujo se lee
    // al revés: se indexa por el código invertido.
    let rev = 0
    for (let i = 0; i < len; i++) rev |= ((c >> i) & 1) << (len - 1 - i)
    const entry = (s << 4) | len
    for (let i = rev; i < 1 << bits; i += 1 << len) table[i] = entry
  }
  return { table, bits }
}

let fixedTables: { lit: Huffman; dist: Huffman } | null = null

function fixedHuffman(): { lit: Huffman; dist: Huffman } {
  if (fixedTables) return fixedTables
  const lit = new Uint8Array(288)
  for (let i = 0; i < 288; i++) lit[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8
  const dist = new Uint8Array(30).fill(5)
  fixedTables = { lit: buildHuffman(lit, 288), dist: buildHuffman(dist, 30) }
  return fixedTables
}

/**
 * Descomprime un flujo deflate crudo (sin encabezado zlib), como los de ZIP.
 * `maxSize` corta la salida (contra bombas); tira `ZipError` si el flujo está roto.
 */
export function inflateRawSync(data: Uint8Array, maxSize = ZIP_MAX_ENTRY_SIZE): Uint8Array {
  let pos = 0
  let bitBuf = 0
  let bitCnt = 0
  /** Bits «leídos» más allá del final (ceros de relleno para mirar adelante). */
  let overrun = 0

  const need = (n: number) => {
    while (bitCnt < n) {
      if (pos < data.length) {
        bitBuf |= (data[pos] ?? 0) << bitCnt
        pos++
      } else {
        overrun += 8
      }
      bitCnt += 8
    }
  }
  const take = (n: number): number => {
    if (n === 0) return 0
    need(n)
    const v = bitBuf & ((1 << n) - 1)
    bitBuf >>>= n
    bitCnt -= n
    // Los bits de relleno quedan arriba en el buffer: si ya se consumió alguno, el flujo se cortó.
    if (overrun > bitCnt) throw corrupt('el flujo deflate termina antes de tiempo')
    return v
  }
  const decode = (h: Huffman): number => {
    need(h.bits)
    const entry = h.table[bitBuf & ((1 << h.bits) - 1)] ?? 0
    const len = entry & 15
    if (len === 0) throw corrupt('código de Huffman inexistente')
    bitBuf >>>= len
    bitCnt -= len
    if (overrun > bitCnt) throw corrupt('el flujo deflate termina antes de tiempo')
    return entry >> 4
  }

  let out = new Uint8Array(Math.min(Math.max(1024, data.length * 4), maxSize))
  let outLen = 0
  const ensure = (extra: number) => {
    const wanted = outLen + extra
    if (wanted > maxSize)
      throw new ZipError('zip_too_big', 'El archivo descomprimido es demasiado grande')
    if (wanted <= out.length) return
    let size = out.length * 2
    while (size < wanted) size *= 2
    const bigger = new Uint8Array(Math.min(size, maxSize))
    bigger.set(out.subarray(0, outLen))
    out = bigger
  }

  let final = 0
  while (!final) {
    final = take(1)
    const type = take(2)
    if (type === 0) {
      // Bloque guardado: se descartan los bits que quedan del byte en curso y se
      // devuelven los bytes enteros que ya se habían cargado (los de relleno no
      // avanzaron `pos`, así que no se devuelven).
      pos -= (bitCnt >> 3) - (overrun >> 3)
      bitBuf = 0
      bitCnt = 0
      overrun = 0
      if (pos + 4 > data.length) throw corrupt('bloque guardado cortado')
      const len = u16(data, pos)
      const nlen = u16(data, pos + 2)
      if ((len ^ 0xffff) !== nlen) throw corrupt('largo de bloque guardado')
      pos += 4
      if (pos + len > data.length) throw corrupt('bloque guardado cortado')
      ensure(len)
      out.set(data.subarray(pos, pos + len), outLen)
      outLen += len
      pos += len
      continue
    }
    let lit: Huffman
    let dist: Huffman
    if (type === 1) {
      ;({ lit, dist } = fixedHuffman())
    } else if (type === 2) {
      const hlit = take(5) + 257
      const hdist = take(5) + 1
      const hclen = take(4) + 4
      if (hlit > 286 || hdist > 30) throw corrupt('cantidad de códigos')
      const clLengths = new Uint8Array(19)
      for (let i = 0; i < hclen; i++) clLengths[CL_ORDER[i] ?? 0] = take(3)
      const cl = buildHuffman(clLengths, 19)
      const lengths = new Uint8Array(hlit + hdist)
      let i = 0
      while (i < hlit + hdist) {
        const sym = decode(cl)
        if (sym < 16) {
          lengths[i++] = sym
          continue
        }
        let repeat: number
        let value = 0
        if (sym === 16) {
          if (i === 0) throw corrupt('repetición sin valor previo')
          value = lengths[i - 1] ?? 0
          repeat = 3 + take(2)
        } else if (sym === 17) {
          repeat = 3 + take(3)
        } else {
          repeat = 11 + take(7)
        }
        if (i + repeat > hlit + hdist) throw corrupt('demasiados largos de código')
        lengths.fill(value, i, i + repeat)
        i += repeat
      }
      if ((lengths[256] ?? 0) === 0) throw corrupt('falta el código de fin de bloque')
      lit = buildHuffman(lengths.subarray(0, hlit), hlit)
      dist = buildHuffman(lengths.subarray(hlit), hdist)
    } else {
      throw corrupt('tipo de bloque inválido')
    }

    for (;;) {
      const sym = decode(lit)
      if (sym < 256) {
        if (outLen >= out.length) ensure(1)
        out[outLen++] = sym
      } else if (sym === 256) {
        break
      } else {
        const li = sym - 257
        if (li >= 29) throw corrupt('código de largo inválido')
        const len = (LEN_BASE[li] ?? 0) + take(LEN_EXTRA[li] ?? 0)
        const di = decode(dist)
        if (di >= 30) throw corrupt('código de distancia inválido')
        const d = (DIST_BASE[di] ?? 0) + take(DIST_EXTRA[di] ?? 0)
        if (d > outLen) throw corrupt('distancia hacia atrás del inicio')
        ensure(len)
        let from = outLen - d
        for (let k = 0; k < len; k++) out[outLen++] = out[from++] ?? 0
      }
    }
  }
  return out.slice(0, outLen)
}
