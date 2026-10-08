/**
 * PEM ↔ DER y «¿qué archivo subió la persona?» (diseño §2.4.1 y §2.4.2).
 *
 * ARCA entrega el certificado como `.crt`: en homologación (WSASS) es PEM; en
 * producción puede venir en PEM o en DER (P-T2), así que se aceptan los dos, y
 * también el base64 «pelado» de quien copió el texto sin las líneas BEGIN/END.
 *
 * Puro (Node, `Buffer`): reconoce claves privadas para avisar, pero nunca las
 * usa ni las devuelve.
 */
import { Buffer } from 'node:buffer'
import {
  ArcaCryptoError,
  children,
  contextTag,
  parseDer,
  readInteger,
  readOid,
  TAG,
  type Tlv,
  toBuffer,
} from './der'

export type PemLabel = 'CERTIFICATE' | 'CERTIFICATE REQUEST'

/** Lo que puede ser el archivo subido. Cada caso tiene su texto en la UI (§2.4.2). */
export type UploadKind = 'certificate' | 'csr' | 'private_key' | 'pkcs12' | 'unknown'

/**
 * Tope del archivo del certificado (§2.3, `uploadArcaCertificate`). Un `.crt` de
 * ARCA pesa 1–2 KB; lo que pase de esto se trata como ilegible.
 */
export const CERT_UPLOAD_MAX_BYTES = 16 * 1024

/** DER → PEM con líneas de 64 caracteres y salto final (lo que guarda la base). */
export function toPem(der: Uint8Array, label: PemLabel): string {
  if (der.length === 0) throw new ArcaCryptoError('invalid_input', 'No hay nada para pasar a PEM')
  const lines =
    toBuffer(der)
      .toString('base64')
      .match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

export interface PemBlock {
  label: string
  der: Buffer
}

const PEM_BLOCK_RE = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g
const PEM_LABEL_RE = /-----BEGIN ([A-Z0-9 ]+)-----/g
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function decodeBase64Strict(text: string): Buffer | null {
  const compact = text.replace(/\s+/g, '')
  if (compact.length === 0 || !BASE64_RE.test(compact)) return null
  return Buffer.from(compact, 'base64')
}

/** El cuerpo de un bloque sin los encabezados RFC 1421 (`Proc-Type: …`) de las claves viejas. */
function pemBody(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !line.includes(':'))
    .join('')
}

/** Todos los bloques PEM del texto, en orden. Los que no decodifican se saltean. */
export function pemBlocks(text: string): PemBlock[] {
  const out: PemBlock[] = []
  for (const m of text.matchAll(PEM_BLOCK_RE)) {
    const der = decodeBase64Strict(pemBody(m[2] ?? ''))
    if (der) out.push({ label: m[1] ?? '', der })
  }
  return out
}

/** El primer bloque PEM del texto (tolera texto antes y después, CRLF y BOM). */
export function fromPem(text: string): PemBlock | null {
  return pemBlocks(text)[0] ?? null
}

// ─── Forma ASN.1 ────────────────────────────────────────────────────────────

function safeChildren(node: Tlv | undefined): Tlv[] | null {
  if (!node) return null
  try {
    return children(node)
  } catch {
    return null
  }
}

function smallInt(node: Tlv | undefined): number | null {
  if (node?.tag !== TAG.INTEGER || node.len > 4) return null
  try {
    return Number(readInteger(node))
  } catch {
    return null
  }
}

const isTime = (node: Tlv): boolean =>
  node.tag === TAG.UTC_TIME || node.tag === TAG.GENERALIZED_TIME

/** TBSCertificate: `[0] versión?`, serie, algoritmo, emisor, vigencia (dos fechas), sujeto, clave… */
function isTbsCertificate(fields: Tlv[]): boolean {
  const offset = fields[0]?.tag === contextTag(0) ? 1 : 0
  const [serial, algorithm, issuer, validity, subject, spki] = fields.slice(offset)
  if (
    serial?.tag !== TAG.INTEGER ||
    algorithm?.tag !== TAG.SEQUENCE ||
    issuer?.tag !== TAG.SEQUENCE ||
    validity?.tag !== TAG.SEQUENCE ||
    subject?.tag !== TAG.SEQUENCE ||
    spki?.tag !== TAG.SEQUENCE
  ) {
    return false
  }
  const dates = safeChildren(validity)
  return dates !== null && dates.length === 2 && dates.every(isTime)
}

/** CertificationRequestInfo (PKCS#10): versión 0, sujeto, clave pública y `[0]` atributos. */
function isCertificationRequestInfo(fields: Tlv[]): boolean {
  const [version, subject, spki, attributes] = fields
  return (
    fields.length === 4 &&
    smallInt(version) === 0 &&
    subject?.tag === TAG.SEQUENCE &&
    spki?.tag === TAG.SEQUENCE &&
    attributes?.tag === contextTag(0)
  )
}

/** Algoritmos de cifrado por contraseña: PBES1/PBES2 (PKCS#5) y los PBE de PKCS#12. */
function isPasswordAlgorithm(algorithm: Tlv): boolean {
  const first = safeChildren(algorithm)?.[0]
  if (first?.tag !== TAG.OID) return false
  try {
    const dotted = readOid(first)
    return dotted.startsWith('1.2.840.113549.1.5.') || dotted.startsWith('1.2.840.113549.1.12.1.')
  } catch {
    return false
  }
}

function isPrivateKey(parts: Tlv[]): boolean {
  const [a, b, c] = parts
  // PKCS#8 (PrivateKeyInfo / OneAsymmetricKey): versión, algoritmo, OCTET STRING con la clave.
  if (a?.tag === TAG.INTEGER && b?.tag === TAG.SEQUENCE && c?.tag === TAG.OCTET_STRING) return true
  // PKCS#8 cifrada: algoritmo por contraseña + OCTET STRING.
  if (parts.length === 2 && a?.tag === TAG.SEQUENCE && b?.tag === TAG.OCTET_STRING) {
    return isPasswordAlgorithm(a)
  }
  // PKCS#1 (RSAPrivateKey): versión + 8 INTEGER (n, e, d, p, q, dp, dq, qi).
  if (parts.length >= 9 && parts.every((p) => p.tag === TAG.INTEGER)) return true
  // SEC1 (ECPrivateKey): versión 1 + OCTET STRING con la clave.
  return smallInt(a) === 1 && b?.tag === TAG.OCTET_STRING
}

/**
 * PFX (PKCS#12): `SEQUENCE { INTEGER 3, ContentInfo, … }`. Muchas veces viene en
 * BER (largo indefinido), así que se mira el encabezado a mano.
 */
function looksLikePkcs12(bytes: Buffer): boolean {
  const first = bytes[1]
  if (bytes[0] !== TAG.SEQUENCE || first === undefined) return false
  // Largo corto o indefinido (0x80): 2 bytes de encabezado; largo largo: 2 + n.
  const header = first <= 0x80 ? 2 : 2 + (first & 0x7f)
  return (
    bytes[header] === TAG.INTEGER &&
    bytes[header + 1] === 0x01 &&
    bytes[header + 2] === 0x03 &&
    bytes[header + 3] === TAG.SEQUENCE
  )
}

function classifyDer(der: Buffer): UploadKind {
  if (looksLikePkcs12(der)) return 'pkcs12'
  let root: Tlv
  try {
    root = parseDer(der)
  } catch {
    return 'unknown'
  }
  if (root.tag !== TAG.SEQUENCE) return 'unknown'
  const parts = safeChildren(root)
  if (!parts) return 'unknown'
  const [signed, algorithm, signature] = parts
  // Certificado y CSR: SEQUENCE { lo firmado, AlgorithmIdentifier, BIT STRING }.
  if (
    parts.length === 3 &&
    signed?.tag === TAG.SEQUENCE &&
    algorithm?.tag === TAG.SEQUENCE &&
    signature?.tag === TAG.BIT_STRING
  ) {
    const fields = safeChildren(signed)
    if (fields && isTbsCertificate(fields)) return 'certificate'
    if (fields && isCertificationRequestInfo(fields)) return 'csr'
    return 'unknown'
  }
  return isPrivateKey(parts) ? 'private_key' : 'unknown'
}

// ─── Entrada de la persona ──────────────────────────────────────────────────

const CERT_LABELS = new Set(['CERTIFICATE', 'X509 CERTIFICATE'])
const CSR_LABELS = new Set(['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST'])

type Decoded = { kind: 'pem'; text: string } | { kind: 'der'; der: Buffer }

/** PEM (por encabezado), base64 sin encabezados o DER crudo. */
function decodeInput(input: string | Uint8Array): Decoded | null {
  const text = typeof input === 'string' ? input : toBuffer(input).toString('latin1')
  if (text.includes('-----BEGIN ')) return { kind: 'pem', text }
  const fromBase64 = decodeBase64Strict(text)
  if (fromBase64) return { kind: 'der', der: fromBase64 }
  return typeof input === 'string' ? null : { kind: 'der', der: toBuffer(input) }
}

function classifyPemText(text: string): UploadKind {
  const labels = Array.from(text.matchAll(PEM_LABEL_RE), (m) => m[1] ?? '')
  // Una clave privada gana siempre: ese archivo no se guarda ni se procesa.
  if (labels.some((label) => label.includes('PRIVATE KEY'))) return 'private_key'
  if (labels.includes('PKCS12')) return 'pkcs12'
  const blocks = pemBlocks(text)
  const has = (accepted: Set<string>, kind: UploadKind) =>
    blocks.some((b) => accepted.has(b.label) && classifyDer(b.der) === kind)
  if (has(CERT_LABELS, 'certificate')) return 'certificate'
  if (has(CSR_LABELS, 'csr')) return 'csr'
  return 'unknown'
}

function inputSize(input: string | Uint8Array): number {
  return typeof input === 'string' ? input.length : input.byteLength
}

/**
 * Qué es el archivo: PEM por su encabezado y DER por la forma ASN.1. Nunca tira.
 * Vacío o más grande que `CERT_UPLOAD_MAX_BYTES` → `'unknown'`.
 */
export function classifyUpload(bytes: Uint8Array): UploadKind {
  if (bytes.byteLength === 0 || bytes.byteLength > CERT_UPLOAD_MAX_BYTES) return 'unknown'
  const decoded = decodeInput(bytes)
  if (!decoded) return 'unknown'
  return decoded.kind === 'pem' ? classifyPemText(decoded.text) : classifyDer(decoded.der)
}

/**
 * El DER del certificado: el primer bloque `CERTIFICATE` de un PEM, un DER crudo
 * o base64 sin encabezados. `null` si no hay un certificado (solo mira la forma:
 * quien lo use igual lo tiene que abrir con `X509Certificate`).
 */
export function extractCertificateDer(input: string | Uint8Array): Buffer | null {
  const size = inputSize(input)
  if (size === 0 || size > CERT_UPLOAD_MAX_BYTES) return null
  const decoded = decodeInput(input)
  if (!decoded) return null
  if (decoded.kind === 'der') {
    return classifyDer(decoded.der) === 'certificate' ? Buffer.from(decoded.der) : null
  }
  const block = pemBlocks(decoded.text).find(
    (b) => CERT_LABELS.has(b.label) && classifyDer(b.der) === 'certificate',
  )
  return block?.der ?? null
}
