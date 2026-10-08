/**
 * Bytes → texto, y qué clase de archivo es (diseño §4.0, `arca-mis-comprobantes.md`
 * §9.1, `banco.md` §3.2).
 *
 * - UTF-8 estricto primero (sacando el BOM); si no es UTF-8 válido, Windows-1252,
 *   que es como vienen los CSV viejos de ARCA y muchos TXT de bancos. El
 *   decodificador de Windows-1252 está escrito acá (256 entradas) para no
 *   depender de que el runtime traiga esa tabla.
 * - UTF-16 (con BOM, o sin BOM si la mitad de los bytes son ceros): lo que deja
 *   Excel con «Texto Unicode».
 * - Mojibake: un archivo que alguien abrió como Windows-1252 y volvió a guardar
 *   en UTF-8 trae «EmisiÃ³n». Se detecta y, si la vuelta es limpia, se arregla.
 */

import type { TextEncodingName } from './types'

// ─── Windows-1252 ────────────────────────────────────────────────────────────

/**
 * Los 32 bytes 0x80–0x9F, que es donde Windows-1252 difiere de Latin-1. Los cinco
 * sin asignar (0x81, 0x8D, 0x8F, 0x90, 0x9D) quedan como el control C1 del mismo
 * número, igual que hace `TextDecoder('windows-1252')`.
 */
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
]

/** Code point → byte de Windows-1252 (para deshacer el mojibake). */
const CP1252_REVERSE: ReadonlyMap<number, number> = (() => {
  const m = new Map<number, number>()
  for (let b = 0; b < 256; b++) {
    const cp = b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b - 0x80] ?? b) : b
    m.set(cp, b)
  }
  return m
})()

/** Windows-1252 → texto. Cada byte es un carácter, así que nunca falla. */
export function decodeWindows1252(bytes: Uint8Array): string {
  let out = ''
  const CHUNK = 8192
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK)
    const codes: number[] = new Array(end - start)
    for (let i = start; i < end; i++) {
      const b = bytes[i] ?? 0
      codes[i - start] = b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b - 0x80] ?? b) : b
    }
    out += String.fromCharCode(...codes)
  }
  return out
}

/** Texto → bytes de Windows-1252, o `null` si algún carácter no existe en esa tabla. */
function encodeWindows1252(text: string): Uint8Array | null {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const b = CP1252_REVERSE.get(text.charCodeAt(i))
    if (b === undefined) return null
    out[i] = b
  }
  return out
}

// ─── Mojibake ────────────────────────────────────────────────────────────────

/**
 * «Ã» o «Â» seguidos de lo que deja un byte de continuación de UTF-8 leído como
 * Windows-1252 («Ã³» = ó, «Ã‘» = Ñ, «Â°» = °). En castellano real esa pareja no
 * aparece.
 */
const MOJIBAKE_RE = /[ÃÂ][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/

/** ¿Tiene pinta de UTF-8 leído como Windows-1252 y vuelto a guardar? Mira los primeros 64 KB. */
export function looksLikeMojibake(text: string): boolean {
  return MOJIBAKE_RE.test(text.length > 65536 ? text.slice(0, 65536) : text)
}

/**
 * Deshace el mojibake: vuelve a los bytes de Windows-1252 y los lee como UTF-8.
 * Devuelve `null` si la vuelta no es limpia (hay caracteres que no son de esa
 * tabla o los bytes no son UTF-8 válido): en ese caso no se toca nada.
 */
export function fixMojibake(text: string): string | null {
  const bytes = encodeWindows1252(text)
  if (!bytes) return null
  try {
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return looksLikeMojibake(fixed) ? null : fixed
  } catch {
    return null
  }
}

// ─── Decodificación ──────────────────────────────────────────────────────────

export type DecodedText = {
  /** El texto, sin BOM. */
  readonly text: string
  readonly encoding: TextEncodingName
  /** ¿Venía con BOM? */
  readonly bom: boolean
  /** Quedó mojibake sin arreglar (avisar «las tildes vienen rotas»). */
  readonly mojibake: boolean
  /** Había mojibake y se arregló. */
  readonly repaired: boolean
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((b, i) => bytes[i] === b)
}

/** UTF-16 sin BOM: en texto «latino» la mitad de los bytes (los altos) son 0. */
function guessUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length - (bytes.length % 2), 1024)
  if (n < 8) return null
  let zeroOdd = 0
  let zeroEven = 0
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) zeroEven++
    if (bytes[i + 1] === 0) zeroOdd++
  }
  const pairs = n / 2
  if (zeroOdd > pairs * 0.4 && zeroEven < pairs * 0.05) return 'utf-16le'
  if (zeroEven > pairs * 0.4 && zeroOdd < pairs * 0.05) return 'utf-16be'
  return null
}

function decodeUtf16(bytes: Uint8Array, encoding: 'utf-16le' | 'utf-16be'): string {
  return new TextDecoder(encoding).decode(bytes)
}

function finish(text: string, encoding: TextEncodingName, bom: boolean): DecodedText {
  if (!looksLikeMojibake(text)) {
    return { text, encoding, bom, mojibake: false, repaired: false }
  }
  const fixed = fixMojibake(text)
  if (fixed !== null) return { text: fixed, encoding, bom, mojibake: false, repaired: true }
  return { text, encoding, bom, mojibake: true, repaired: false }
}

/**
 * Bytes → texto. Orden: BOM de UTF-8 o UTF-16 → UTF-16 sin BOM → UTF-8 estricto →
 * Windows-1252. Los finales de línea quedan como vinieron (el CSV acepta los tres).
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    const body = bytes.subarray(3)
    try {
      return finish(new TextDecoder('utf-8', { fatal: true }).decode(body), 'utf-8', true)
    } catch {
      return finish(decodeWindows1252(body), 'windows-1252', true)
    }
  }
  if (startsWith(bytes, [0xff, 0xfe]))
    return finish(decodeUtf16(bytes.subarray(2), 'utf-16le'), 'utf-16le', true)
  if (startsWith(bytes, [0xfe, 0xff]))
    return finish(decodeUtf16(bytes.subarray(2), 'utf-16be'), 'utf-16be', true)
  const utf16 = guessUtf16(bytes)
  if (utf16) return finish(decodeUtf16(bytes, utf16), utf16, false)
  try {
    return finish(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'utf-8', false)
  } catch {
    return finish(decodeWindows1252(bytes), 'windows-1252', false)
  }
}

// ─── Qué clase de archivo es ─────────────────────────────────────────────────

/**
 * - `zip`: ZIP (el de Mis Comprobantes o un `.xlsx`, que también es ZIP).
 * - `ole`: un `.xls` viejo de Excel (BIFF, `D0 CF 11 E0`): no lo leemos.
 * - `pdf`, `gzip`: no son tablas.
 * - `html`: un «.xls» que en realidad es una página HTML (exportes de bancos).
 * - `spreadsheetml`: un «.xls» que es XML de Excel 2003.
 * - `text`: CSV o TXT.
 * - `binary`: otra cosa.
 */
export type ContainerKind =
  | 'empty'
  | 'zip'
  | 'ole'
  | 'pdf'
  | 'gzip'
  | 'html'
  | 'spreadsheetml'
  | 'text'
  | 'binary'

/** Los primeros 2 KB como texto, sin BOM ni espacios al principio (para mirar si es HTML o XML). */
function headText(bytes: Uint8Array): string {
  return decodeText(bytes.subarray(0, 2048)).text.trimStart()
}

/** ¿Hay bytes de control que no aparecen en un texto (NUL y compañía)? */
function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096)
  let control = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i] ?? 0
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) control++
  }
  return control > n * 0.01
}

/** Mira los primeros bytes y dice qué clase de archivo es (no lo abre). */
export function sniffContainer(bytes: Uint8Array): ContainerKind {
  if (bytes.length === 0) return 'empty'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return 'zip'
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'
  if (startsWith(bytes, [0x1f, 0x8b])) return 'gzip'
  const utf16 =
    startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff]) || guessUtf16(bytes) !== null
  if (!utf16 && looksBinary(bytes)) return 'binary'
  const head = headText(bytes).slice(0, 1024).toLowerCase()
  if (head.startsWith('<')) {
    if (head.includes('urn:schemas-microsoft-com:office:spreadsheet')) return 'spreadsheetml'
    if (/<(!doctype html|html|table|head|body|meta|tr)[\s>]/.test(head)) return 'html'
  }
  return 'text'
}
