/**
 * DER mínimo para ARCA: lo justo para armar el pedido de certificado (PKCS#10),
 * el CMS que firma el ticket del WSAA y leer certificados X.509.
 *
 * Port de `research/ref/der.mjs`, que se validó contra OpenSSL (`openssl req
 * -verify`, `openssl cms -verify`) y contra el WSAA de homologación. Los
 * encoders hacen lo mismo que la referencia; el lector suma chequeos de límites,
 * porque lo que lee puede venir de un archivo que subió una persona.
 *
 * Puro (Node, `Buffer`): no toca claves ni red. Diseño: §2.4.1.
 */
import { Buffer } from 'node:buffer'

// ─── Errores ────────────────────────────────────────────────────────────────

export type ArcaCryptoErrorCode =
  /** El DER está cortado, mal armado o usa algo que este lector no soporta. */
  | 'invalid_der'
  /** Un dato de entrada que no tiene la forma esperada (fecha, texto, TRA vacío…). */
  | 'invalid_input'
  /** La CUIT no tiene 11 dígitos, prefijo o dígito verificador válidos. */
  | 'invalid_cuit'
  /** La organización o el nombre (CN) del pedido no sirven. */
  | 'invalid_subject'
  /** La clave privada no se puede leer, no es RSA o es más chica que 2048 bits. */
  | 'invalid_key'
  /** Lo que llegó no es un certificado X.509 legible. */
  | 'not_a_certificate'
  /** El certificado no corresponde a la clave privada. */
  | 'key_mismatch'
  /** El servicio del TRA no cumple el patrón del XSD del WSAA. */
  | 'invalid_service'

/**
 * Error de la cripto de ARCA. `code` es estable (sirve para elegir el texto que
 * ve la persona); `message` es solo para logs y nunca lleva CUIT, claves ni PEM.
 */
export class ArcaCryptoError extends Error {
  readonly code: ArcaCryptoErrorCode

  constructor(code: ArcaCryptoErrorCode, message: string) {
    super(message)
    this.name = 'ArcaCryptoError'
    this.code = code
  }
}

const derError = (message: string) => new ArcaCryptoError('invalid_der', message)

// ─── Etiquetas y OID ────────────────────────────────────────────────────────

/** Etiquetas universales (un byte) que usan X.509, PKCS#10 y CMS. */
export const TAG = {
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  TELETEX_STRING: 0x14,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  VISIBLE_STRING: 0x1a,
  UNIVERSAL_STRING: 0x1c,
  BMP_STRING: 0x1e,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const

/** `[n]` construido (contexto): `0xa0 + n`. */
export const contextTag = (n: number): number => 0xa0 + n

export const OID = {
  // Atributos del nombre (X.520)
  countryName: '2.5.4.6',
  organizationName: '2.5.4.10',
  organizationalUnitName: '2.5.4.11',
  commonName: '2.5.4.3',
  serialNumber: '2.5.4.5',
  localityName: '2.5.4.7',
  stateOrProvinceName: '2.5.4.8',
  emailAddress: '1.2.840.113549.1.9.1',
  // Algoritmos
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRSAEncryption: '1.2.840.113549.1.1.11',
  sha256: '2.16.840.1.101.3.4.2.1',
  // CMS (RFC 5652) y atributos PKCS#9
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
} as const

/** Mira los mismos bytes como `Buffer` (sin copiar). */
export function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

// ─── Encoders ───────────────────────────────────────────────────────────────

function encLen(n: number): Buffer {
  if (!Number.isSafeInteger(n) || n < 0) throw derError('Largo DER inválido')
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  let rest = n
  while (rest > 0) {
    bytes.unshift(rest % 256)
    rest = Math.floor(rest / 256)
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

/** Etiqueta + largo + contenido (las partes se concatenan en orden). */
export function tlv(tag: number, ...parts: Uint8Array[]): Buffer {
  if (!Number.isInteger(tag) || tag < 0 || tag > 0xff || (tag & 0x1f) === 0x1f) {
    throw derError('Etiqueta DER inválida')
  }
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag]), encLen(body.length), body])
}

export const seq = (...parts: Uint8Array[]): Buffer => tlv(TAG.SEQUENCE, ...parts)

/** `SET` con los elementos en el orden en que llegan (para un solo elemento). */
export const set = (...parts: Uint8Array[]): Buffer => tlv(TAG.SET, ...parts)

/** `SET OF` en DER: los elementos ordenados por su codificación (X.690 §11.6). */
export const setOf = (...parts: Uint8Array[]): Buffer =>
  tlv(TAG.SET, ...[...parts].sort(Buffer.compare))

export const nul = (): Buffer => Buffer.from([TAG.NULL, 0x00])

export const octet = (bytes: Uint8Array): Buffer => tlv(TAG.OCTET_STRING, bytes)

export const utf8 = (text: string): Buffer => tlv(TAG.UTF8_STRING, Buffer.from(text, 'utf8'))

const PRINTABLE_RE = /^[A-Za-z0-9 '()+,\-./:=?]*$/

/** PrintableString (X.680 §41.4): letras, números, espacio y `'()+,-./:=?`. */
export function printable(text: string): Buffer {
  if (!PRINTABLE_RE.test(text)) {
    throw new ArcaCryptoError(
      'invalid_input',
      'El texto tiene caracteres que no van en un PrintableString',
    )
  }
  return tlv(TAG.PRINTABLE_STRING, Buffer.from(text, 'ascii'))
}

/** BIT STRING sin bits sobrantes (firmas, claves). */
export const bitString = (bytes: Uint8Array): Buffer =>
  tlv(TAG.BIT_STRING, Buffer.from([0x00]), bytes)

/**
 * INTEGER no negativo. `value` es un número chico, un `bigint` o la magnitud sin
 * signo en big-endian (`Uint8Array`, p. ej. un número de serie crudo).
 */
export function int(value: number | bigint | Uint8Array): Buffer {
  let bytes: Buffer
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new ArcaCryptoError('invalid_input', 'INTEGER: el número no es un entero seguro')
    }
    const big = BigInt(value)
    if (big < 0n) throw new ArcaCryptoError('invalid_input', 'INTEGER: solo valores no negativos')
    const hex = big.toString(16)
    bytes = Buffer.from(hex.length % 2 === 1 ? `0${hex}` : hex, 'hex')
  } else {
    bytes = value.length === 0 ? Buffer.from([0x00]) : Buffer.from(value)
  }
  // Mínimo: sin ceros de más a la izquierda…
  let start = 0
  while (
    start < bytes.length - 1 &&
    bytes[start] === 0x00 &&
    ((bytes[start + 1] ?? 0) & 0x80) === 0
  ) {
    start++
  }
  let body = bytes.subarray(start)
  // …y con un 0x00 adelante si el bit alto quedaría prendido (se leería negativo).
  if (((body[0] ?? 0) & 0x80) !== 0) body = Buffer.concat([Buffer.from([0x00]), body])
  return tlv(TAG.INTEGER, body)
}

function base128(n: number): number[] {
  const bytes = [n % 128]
  let rest = Math.floor(n / 128)
  while (rest > 0) {
    bytes.unshift(0x80 | (rest % 128))
    rest = Math.floor(rest / 128)
  }
  return bytes
}

const OID_RE = /^[0-2](\.(0|[1-9]\d*))+$/

/** OBJECT IDENTIFIER desde la forma con puntos (`'1.2.840.113549.1.7.2'`). */
export function oid(dotted: string): Buffer {
  if (!OID_RE.test(dotted)) throw new ArcaCryptoError('invalid_input', 'OID inválido')
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number)
  if (first < 2 && second >= 40) throw new ArcaCryptoError('invalid_input', 'OID inválido')
  const head = first * 40 + second
  const arcs = [head, ...rest]
  if (!arcs.every(Number.isSafeInteger)) {
    throw new ArcaCryptoError('invalid_input', 'OID demasiado grande')
  }
  return tlv(TAG.OID, Buffer.from(arcs.flatMap(base128)))
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function assertDate(d: Date): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new ArcaCryptoError('invalid_input', 'Fecha inválida')
  }
}

function timeDigits(d: Date): string {
  return `${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

/** UTCTime `YYMMDDHHMMSSZ` (sin milisegundos). Solo cubre 1950–2049. */
export function utcTime(d: Date): Buffer {
  assertDate(d)
  const year = d.getUTCFullYear()
  if (year < 1950 || year > 2049) {
    throw new ArcaCryptoError('invalid_input', 'UTCTime solo cubre de 1950 a 2049')
  }
  return tlv(TAG.UTC_TIME, Buffer.from(`${pad(year % 100)}${timeDigits(d)}Z`, 'ascii'))
}

/** GeneralizedTime `YYYYMMDDHHMMSSZ` (sin fracciones, como pide RFC 5280). */
export function generalizedTime(d: Date): Buffer {
  assertDate(d)
  const year = d.getUTCFullYear()
  if (year < 1000 || year > 9999) throw new ArcaCryptoError('invalid_input', 'Año fuera de rango')
  return tlv(TAG.GENERALIZED_TIME, Buffer.from(`${pad(year, 4)}${timeDigits(d)}Z`, 'ascii'))
}

/** La que corresponde según RFC 5280 §4.1.2.5 y RFC 5652 §11.3: UTCTime hasta 2049. */
export function derTime(d: Date): Buffer {
  assertDate(d)
  const year = d.getUTCFullYear()
  return year >= 1950 && year <= 2049 ? utcTime(d) : generalizedTime(d)
}

function assertContextNumber(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > 30) {
    throw derError('Número de etiqueta de contexto inválido')
  }
}

/** `[n] EXPLICIT`: envuelve las partes en un TLV construido `0xa0 + n`. */
export function explicit(n: number, ...parts: Uint8Array[]): Buffer {
  assertContextNumber(n)
  return tlv(contextTag(n), ...parts)
}

/** `[n] IMPLICIT` de un TLV construido: copia y cambia solo la etiqueta (`0x30`/`0x31` → `0xa0 + n`). */
export function implicitConstructed(n: number, derOfConstructed: Uint8Array): Buffer {
  assertContextNumber(n)
  const first = derOfConstructed[0]
  if (first === undefined || (first & 0x20) === 0) {
    throw derError('Solo se puede re-etiquetar un TLV construido')
  }
  const out = Buffer.from(derOfConstructed)
  out[0] = contextTag(n)
  return out
}

// ─── Lector ─────────────────────────────────────────────────────────────────

/**
 * Un TLV leído. `start` y `end` son relativos al buffer que se leyó (para los
 * hijos, el contenido del padre); `body` y `raw` son vistas sin copia.
 */
export interface Tlv {
  /** Etiqueta de un byte (alcanza para X.509, PKCS#10 y CMS). */
  tag: number
  start: number
  hdrLen: number
  len: number
  end: number
  /** Solo el contenido. */
  body: Buffer
  /** Etiqueta + largo + contenido, tal como está en el buffer. */
  raw: Buffer
}

/** Lee el TLV que empieza en `off`. Tira `invalid_der` si está cortado o no es DER. */
export function readTLV(input: Uint8Array, off = 0): Tlv {
  const buf = toBuffer(input)
  const tag = buf[off]
  const first = buf[off + 1]
  if (tag === undefined || first === undefined) throw derError('El DER está cortado')
  if ((tag & 0x1f) === 0x1f) throw derError('Etiqueta DER de varios bytes (no soportada)')
  let len = first
  let hdrLen = 2
  if ((first & 0x80) !== 0) {
    const n = first & 0x7f
    if (n === 0) throw derError('Largo indefinido: es BER, no DER')
    if (n > 4) throw derError('Largo DER demasiado grande')
    len = 0
    for (let i = 0; i < n; i++) {
      const byte = buf[off + 2 + i]
      if (byte === undefined) throw derError('El DER está cortado')
      len = len * 256 + byte
    }
    hdrLen += n
  }
  const end = off + hdrLen + len
  if (end > buf.length) throw derError('El DER está cortado')
  return {
    tag,
    start: off,
    hdrLen,
    len,
    end,
    body: buf.subarray(off + hdrLen, end),
    raw: buf.subarray(off, end),
  }
}

/** Los TLV que hay dentro del contenido de `node`, en orden. */
export function children(node: Tlv): Tlv[] {
  const out: Tlv[] = []
  let off = 0
  while (off < node.body.length) {
    const child = readTLV(node.body, off)
    out.push(child)
    off = child.end
  }
  return out
}

/** Lee un buffer que tiene que ser exactamente un TLV (sin bytes de más al final). */
export function parseDer(input: Uint8Array): Tlv {
  const node = readTLV(input, 0)
  if (node.end !== input.length) throw derError('Sobran bytes después del DER')
  return node
}

/** OBJECT IDENTIFIER → forma con puntos. */
export function readOid(node: Tlv): string {
  if (node.tag !== TAG.OID || node.len === 0) throw derError('Se esperaba un OID')
  const values: number[] = []
  let value = 0
  let pending = false
  for (const byte of node.body) {
    value = value * 128 + (byte & 0x7f)
    if (!Number.isSafeInteger(value)) throw derError('OID demasiado grande')
    pending = (byte & 0x80) !== 0
    if (!pending) {
      values.push(value)
      value = 0
    }
  }
  if (pending) throw derError('OID cortado')
  const [head = 0, ...rest] = values
  const first = head < 40 ? 0 : head < 80 ? 1 : 2
  return [first, head - first * 40, ...rest].join('.')
}

/** INTEGER (complemento a dos) → `bigint`. */
export function readInteger(node: Tlv): bigint {
  if (node.tag !== TAG.INTEGER || node.len === 0) throw derError('Se esperaba un INTEGER')
  let value = 0n
  for (const byte of node.body) value = (value << 8n) | BigInt(byte)
  if (((node.body[0] ?? 0) & 0x80) !== 0) value -= 1n << BigInt(node.body.length * 8)
  return value
}

function decodeUtf16be(body: Buffer): string {
  if (body.length % 2 !== 0) throw derError('BMPString con largo impar')
  return Buffer.from(body).swap16().toString('utf16le')
}

function decodeUtf32be(body: Buffer): string {
  if (body.length % 4 !== 0) throw derError('UniversalString con largo inválido')
  let out = ''
  for (let i = 0; i < body.length; i += 4) out += String.fromCodePoint(body.readUInt32BE(i))
  return out
}

/** Los tipos de texto de los nombres X.500 → `string`. */
export function readString(node: Tlv): string {
  switch (node.tag) {
    case TAG.UTF8_STRING:
      return node.body.toString('utf8')
    case TAG.PRINTABLE_STRING:
    case TAG.IA5_STRING:
    case TAG.VISIBLE_STRING:
    case TAG.TELETEX_STRING:
      return node.body.toString('latin1')
    case TAG.BMP_STRING:
      return decodeUtf16be(node.body)
    case TAG.UNIVERSAL_STRING:
      return decodeUtf32be(node.body)
    default:
      throw derError('Se esperaba un texto')
  }
}

const UTC_TIME_RE = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})$/
const GENERALIZED_TIME_RE =
  /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?(?:[.,](\d{1,9}))?(Z|[+-]\d{4})$/

/** UTCTime o GeneralizedTime → `Date`. Exige zona (`Z` u offset), como RFC 5280. */
export function readTime(node: Tlv): Date {
  const text = node.body.toString('latin1')
  let parts: { y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number }
  let zone: string
  if (node.tag === TAG.UTC_TIME) {
    const m = UTC_TIME_RE.exec(text)
    if (!m) throw derError('UTCTime inválido')
    const yy = Number(m[1])
    parts = {
      y: yy >= 50 ? 1900 + yy : 2000 + yy,
      mo: Number(m[2]),
      d: Number(m[3]),
      h: Number(m[4]),
      mi: Number(m[5]),
      s: Number(m[6] ?? 0),
      ms: 0,
    }
    zone = m[7] ?? 'Z'
  } else if (node.tag === TAG.GENERALIZED_TIME) {
    const m = GENERALIZED_TIME_RE.exec(text)
    if (!m) throw derError('GeneralizedTime inválido')
    parts = {
      y: Number(m[1]),
      mo: Number(m[2]),
      d: Number(m[3]),
      h: Number(m[4]),
      mi: Number(m[5] ?? 0),
      s: Number(m[6] ?? 0),
      ms: m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0,
    }
    zone = m[8] ?? 'Z'
  } else {
    throw derError('Se esperaba una fecha')
  }
  const { y, mo, d, h, mi, s, ms } = parts
  if (y < 1000 || h > 23 || mi > 59 || s > 59) throw derError('Fecha DER fuera de rango')
  let time = Date.UTC(y, mo - 1, d, h, mi, s, ms)
  const check = new Date(time)
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw derError('Fecha DER inexistente')
  }
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1
    const offsetMinutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5))
    time -= sign * offsetMinutes * 60_000
  }
  return new Date(time)
}
