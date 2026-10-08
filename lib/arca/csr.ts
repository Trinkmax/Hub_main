import 'server-only'
import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from 'node:crypto'
import { parseCuit } from '@/lib/fiscal/cuit'
import {
  ArcaCryptoError,
  bitString,
  int,
  nul,
  OID,
  oid,
  printable,
  seq,
  set,
  tlv,
  utf8,
} from './der'
import { toPem } from './pem'

/**
 * Clave privada y pedido de certificado (CSR, PKCS#10) para ARCA (diseño §2.4.1).
 *
 * Lo que pide ARCA (WSASS «Cómo generar CSR» y spec WSAA 1.2.2): RSA 2048, firma
 * SHA-256 con RSA y sujeto `C=AR`, `O=<empresa>`, `CN=<alias>`,
 * `serialNumber=CUIT nnnnnnnnnnn`. Es lo mismo que arma
 * `openssl req -new -key x.key -subj "/C=AR/O=…/CN=…/serialNumber=CUIT …"`, byte
 * a byte (lo verifica `tests/lib/arca-csr.test.ts` contra el CSR de OpenSSL).
 *
 * Solo servidor: genera y usa la clave privada, que nunca sale del servidor.
 */

export const RSA_MODULUS_BITS = 2048

/** Lo que va en el sujeto del pedido. */
export interface CsrSubject {
  /** CUIT del titular del certificado, con o sin guiones (va en `serialNumber`). */
  cuit: string
  /** Razón social (`O`), hasta 64 caracteres. */
  organization: string
  /** Alias del certificado en ARCA (`CN`), hasta 64 caracteres. */
  commonName: string
}

export interface KeyAndCsr {
  /** PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`). Secreto: se guarda cifrado y nunca se loguea. */
  privateKeyPem: string
  /** PKCS#10 PEM (`-----BEGIN CERTIFICATE REQUEST-----`). Público: es lo que se sube a ARCA. */
  csrPem: string
  /** sha256 (hex en minúsculas) del SPKI DER: con esto se reconoce el certificado que vuelve. */
  publicKeySha256: string
}

/** sha256 en hex (minúsculas) del SPKI DER de una clave pública. */
export function publicKeySha256(spkiDer: Uint8Array): string {
  return createHash('sha256').update(spkiDer).digest('hex')
}

/** Par RSA 2048 nuevo (e = 65537). */
export function generateRsaKeyPair(): { privateKeyPem: string; publicKeySpkiDer: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_BITS,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { privateKeyPem: privateKey, publicKeySpkiDer: publicKey }
}

/** Abre una clave privada RSA PEM (PKCS#8 o PKCS#1) de al menos 2048 bits. */
export function loadRsaPrivateKey(privateKeyPem: string): KeyObject {
  let key: KeyObject
  try {
    key = createPrivateKey(privateKeyPem)
  } catch {
    throw new ArcaCryptoError('invalid_key', 'No se pudo leer la clave privada')
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new ArcaCryptoError('invalid_key', 'La clave privada tiene que ser RSA')
  }
  if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < RSA_MODULUS_BITS) {
    throw new ArcaCryptoError('invalid_key', 'La clave RSA tiene que ser de 2048 bits o más')
  }
  return key
}

const MAX_NAME_CHARS = 64 // ub-organization-name y ub-common-name (RFC 5280, anexo A)

function hasControlChars(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

function cleanName(value: string, field: 'organization' | 'commonName'): string {
  const text = (typeof value === 'string' ? value : '').normalize('NFC').trim()
  const chars = Array.from(text).length
  if (chars === 0 || chars > MAX_NAME_CHARS || hasControlChars(text)) {
    const label = field === 'organization' ? 'La razón social (O)' : 'El alias (CN)'
    throw new ArcaCryptoError(
      'invalid_subject',
      `${label} tiene que tener entre 1 y ${MAX_NAME_CHARS} caracteres, sin caracteres de control`,
    )
  }
  return text
}

/** Valida y normaliza el sujeto: CUIT de 11 dígitos con verificador, O y CN sin espacios de más. */
export function normalizeCsrSubject(subject: CsrSubject): CsrSubject {
  const cuit = parseCuit(subject.cuit)
  if (!cuit.ok) throw new ArcaCryptoError('invalid_cuit', 'La CUIT del certificado no es válida')
  return {
    cuit: cuit.cuit,
    organization: cleanName(subject.organization, 'organization'),
    commonName: cleanName(subject.commonName, 'commonName'),
  }
}

const rdn = (type: string, value: Buffer): Buffer => set(seq(oid(type), value))

/**
 * El pedido (PEM) firmado con la clave. `C` y `serialNumber` van como
 * PrintableString; `O` y `CN` como UTF8String (aceptan `&`, tildes y eñes);
 * atributos `[0]` vacíos; firma `sha256WithRSAEncryption` (PKCS#1 v1.5).
 */
export function buildCsr(input: CsrSubject & { privateKeyPem: string }): string {
  const subject = normalizeCsrSubject(input)
  const privateKey = loadRsaPrivateKey(input.privateKeyPem)
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  const name = seq(
    rdn(OID.countryName, printable('AR')),
    rdn(OID.organizationName, utf8(subject.organization)),
    rdn(OID.commonName, utf8(subject.commonName)),
    rdn(OID.serialNumber, printable(`CUIT ${subject.cuit}`)),
  )
  const info = seq(int(0), name, spki, tlv(0xa0))
  const signature = sign('sha256', info, { key: privateKey, padding: constants.RSA_PKCS1_PADDING })
  const der = seq(info, seq(oid(OID.sha256WithRSAEncryption), nul()), bitString(signature))
  return toPem(der, 'CERTIFICATE REQUEST')
}

/**
 * Lo que hace «Generar pedido» (§2.3, `startArcaCertificate`): clave RSA 2048
 * nueva + CSR para subir a ARCA + el hash de la clave pública para reconocer
 * después el certificado. Valida el sujeto antes de generar la clave.
 */
export function generateKeyAndCsr(subject: CsrSubject): KeyAndCsr {
  const normalized = normalizeCsrSubject(subject)
  const { privateKeyPem, publicKeySpkiDer } = generateRsaKeyPair()
  const csrPem = buildCsr({ ...normalized, privateKeyPem })
  return { privateKeyPem, csrPem, publicKeySha256: publicKeySha256(publicKeySpkiDer) }
}
