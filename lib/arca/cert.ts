import 'server-only'
import { createHash, X509Certificate } from 'node:crypto'
import { loadRsaPrivateKey, publicKeySha256 } from './csr'
import {
  ArcaCryptoError,
  children,
  contextTag,
  OID,
  parseDer,
  readOid,
  readString,
  readTime,
  TAG,
  type Tlv,
} from './der'
import { extractCertificateDer, toPem } from './pem'

/**
 * Lectura del certificado que la persona baja de ARCA (diseño §2.4.1, §2.4.2).
 *
 * Acepta PEM y DER (P-T2). Los campos se leen del DER (no del texto que arma
 * OpenSSL), así lo que se compara —CUIT, alias, fechas— es exactamente lo que
 * está en el certificado. Ojo: ARCA reescribe el sujeto; el certificado que
 * devuelve trae solo `serialNumber=CUIT …` y `CN=<alias>` (sin `C` ni `O`).
 *
 * Solo servidor: `certMatchesKey` abre la clave privada.
 */

export interface NameAttribute {
  oid: string
  /** Nombre corto (`C`, `O`, `CN`, `serialNumber`…) o el OID si no se conoce. */
  name: string
  value: string
}

export interface CertificateName {
  /** En el orden del certificado. */
  attributes: NameAttribute[]
  country: string | null
  organization: string | null
  commonName: string | null
  /** `serialNumber` del nombre (OID 2.5.4.5): en ARCA, `CUIT nnnnnnnnnnn`. */
  serialNumber: string | null
  /** Una línea para mostrar o guardar: `C=AR, O=…, CN=…, serialNumber=CUIT …`. */
  text: string
}

export interface CertificateInfo {
  /** PEM normalizado (`-----BEGIN CERTIFICATE-----`, líneas de 64, salto final): lo que se guarda. */
  pem: string
  /** Número de serie del certificado en hex mayúsculas, como `openssl x509 -serial` y Node. */
  serialHex: string
  subject: CertificateName
  issuerName: CertificateName
  /** `issuerName.text`. */
  issuer: string
  /** CUIT (11 dígitos) del `serialNumber` del sujeto, o `null` si no tiene la forma `CUIT nnnnnnnnnnn`. */
  subjectCuit: string | null
  /** `CN` del sujeto (el alias en ARCA). */
  subjectCn: string | null
  notBefore: Date
  notAfter: Date
  /** sha256 (hex en minúsculas) del certificado en DER. */
  fingerprintSha256: string
  /** sha256 (hex en minúsculas) del SPKI DER: se compara con el de la clave guardada. */
  publicKeySha256: string
}

/** Los campos del TBSCertificate, con los bytes tal cual están en el certificado. */
export interface TbsCertificate {
  serial: Tlv
  issuer: Tlv
  validity: Tlv
  subject: Tlv
  spki: Tlv
}

const notACertificate = () =>
  new ArcaCryptoError('not_a_certificate', 'El archivo no es un certificado X.509 legible')

/** Recorre el TBSCertificate de un certificado DER (no valida firmas). */
export function readTbsCertificate(certDer: Uint8Array): TbsCertificate {
  try {
    const [tbs] = children(parseDer(certDer))
    const fields = tbs?.tag === TAG.SEQUENCE ? children(tbs) : []
    const offset = fields[0]?.tag === contextTag(0) ? 1 : 0
    const [serial, , issuer, validity, subject, spki] = fields.slice(offset)
    if (
      serial?.tag !== TAG.INTEGER ||
      issuer?.tag !== TAG.SEQUENCE ||
      validity?.tag !== TAG.SEQUENCE ||
      subject?.tag !== TAG.SEQUENCE ||
      spki?.tag !== TAG.SEQUENCE
    ) {
      throw notACertificate()
    }
    return { serial, issuer, validity, subject, spki }
  } catch (e) {
    if (e instanceof ArcaCryptoError && e.code === 'not_a_certificate') throw e
    throw notACertificate()
  }
}

const SHORT_NAMES: Readonly<Record<string, string>> = {
  [OID.countryName]: 'C',
  [OID.stateOrProvinceName]: 'ST',
  [OID.localityName]: 'L',
  [OID.organizationName]: 'O',
  [OID.organizationalUnitName]: 'OU',
  [OID.commonName]: 'CN',
  [OID.serialNumber]: 'serialNumber',
  [OID.emailAddress]: 'emailAddress',
}

function attributeValue(node: Tlv): string {
  try {
    return readString(node)
  } catch {
    return `#${node.raw.toString('hex')}` // tipo raro: como RFC 4514
  }
}

/** `Name` (SEQUENCE OF RDN) → atributos legibles. */
function readName(name: Tlv): CertificateName {
  const attributes: NameAttribute[] = []
  const rdnTexts: string[] = []
  for (const rdn of children(name)) {
    const inRdn: string[] = []
    for (const atv of children(rdn)) {
      const [type, value] = children(atv)
      if (type?.tag !== TAG.OID || !value) throw notACertificate()
      const dotted = readOid(type)
      const attribute = {
        oid: dotted,
        name: SHORT_NAMES[dotted] ?? dotted,
        value: attributeValue(value),
      }
      attributes.push(attribute)
      inRdn.push(`${attribute.name}=${attribute.value}`)
    }
    rdnTexts.push(inRdn.join(' + '))
  }
  const first = (dotted: string) => attributes.find((a) => a.oid === dotted)?.value ?? null
  return {
    attributes,
    country: first(OID.countryName),
    organization: first(OID.organizationName),
    commonName: first(OID.commonName),
    serialNumber: first(OID.serialNumber),
    text: rdnTexts.join(', '),
  }
}

const CUIT_SERIAL_RE = /^CUIT\s*(\d{11})$/i

/** Magnitud del INTEGER en hex mayúsculas (sin el 0x00 de signo), como OpenSSL. */
function serialHexOf(serial: Tlv): string {
  let start = 0
  while (start < serial.body.length - 1 && serial.body[start] === 0x00) start++
  return serial.body.subarray(start).toString('hex').toUpperCase()
}

function loadCertificate(input: string | Uint8Array): { der: Buffer; x509: X509Certificate } {
  const der = extractCertificateDer(input)
  if (!der) throw notACertificate()
  try {
    return { der, x509: new X509Certificate(der) }
  } catch {
    throw notACertificate()
  }
}

/**
 * Lee un certificado en PEM (string o bytes) o DER. Tira `not_a_certificate` si
 * no es un X.509 que OpenSSL pueda abrir. No mira vigencia ni CUIT: eso lo
 * decide quien llama (§2.3, `uploadArcaCertificate`).
 */
export function parseCertificate(input: string | Uint8Array): CertificateInfo {
  const { der, x509 } = loadCertificate(input)
  const tbs = readTbsCertificate(der)
  let subject: CertificateName
  let issuerName: CertificateName
  let notBefore: Date
  let notAfter: Date
  try {
    subject = readName(tbs.subject)
    issuerName = readName(tbs.issuer)
    const [from, to] = children(tbs.validity)
    if (!from || !to) throw notACertificate()
    notBefore = readTime(from)
    notAfter = readTime(to)
  } catch {
    throw notACertificate()
  }
  const spki = x509.publicKey.export({ type: 'spki', format: 'der' })
  return {
    pem: toPem(der, 'CERTIFICATE'),
    serialHex: serialHexOf(tbs.serial),
    subject,
    issuerName,
    issuer: issuerName.text,
    subjectCuit: CUIT_SERIAL_RE.exec(subject.serialNumber?.trim() ?? '')?.[1] ?? null,
    subjectCn: subject.commonName,
    notBefore,
    notAfter,
    fingerprintSha256: createHash('sha256').update(der).digest('hex'),
    publicKeySha256: publicKeySha256(spki),
  }
}

/** Nombre del diseño (§2.4.1): lo mismo que `parseCertificate`. */
export const inspectCertificate = parseCertificate

/**
 * ¿El certificado es de esta clave privada? Compara la clave pública del
 * certificado con la de la clave (`X509Certificate.checkPrivateKey`). Tira
 * `not_a_certificate` si el certificado no se puede leer e `invalid_key` si la
 * clave no se puede leer o no es RSA de 2048 bits o más.
 */
export function certMatchesKey(cert: string | Uint8Array, privateKeyPem: string): boolean {
  const { x509 } = loadCertificate(cert)
  return x509.checkPrivateKey(loadRsaPrivateKey(privateKeyPem))
}

export interface CertificateValidity {
  status: 'valid' | 'expired' | 'not_yet_valid'
  /** Días enteros hasta `notAfter` (negativo si ya venció). */
  daysLeft: number
}

const DAY_MS = 86_400_000

/** Vigencia a una fecha dada (el aviso de renovación es con `daysLeft < 30`, §2.6). */
export function certificateValidity(
  cert: Pick<CertificateInfo, 'notBefore' | 'notAfter'>,
  now: Date,
): CertificateValidity {
  const at = now.getTime()
  const daysLeft = Math.floor((cert.notAfter.getTime() - at) / DAY_MS)
  if (at < cert.notBefore.getTime()) return { status: 'not_yet_valid', daysLeft }
  if (at > cert.notAfter.getTime()) return { status: 'expired', daysLeft }
  return { status: 'valid', daysLeft }
}
