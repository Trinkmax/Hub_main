import 'server-only'
import { Buffer } from 'node:buffer'
import { constants, createHash, sign, X509Certificate } from 'node:crypto'
import { readTbsCertificate } from './cert'
import { loadRsaPrivateKey } from './csr'
import {
  ArcaCryptoError,
  derTime,
  explicit,
  implicitConstructed,
  int,
  nul,
  OID,
  octet,
  oid,
  seq,
  set,
  setOf,
} from './der'
import { extractCertificateDer } from './pem'

/**
 * El pedido de ticket del WSAA (TRA) y su firma CMS (diseño §2.4.1;
 * `arca-tecnico.md` §2.2–§2.3).
 *
 * Port de `research/ref/cms.mjs`, verificado: `openssl cms -verify -noverify`
 * da «CMS Verification successful» con el contenido idéntico, y el WSAA de
 * homologación lo parsea (con un certificado autofirmado responde
 * `cms.cert.untrusted`, o sea que la estructura pasó).
 *
 * CMS SignedData (RFC 5652): SHA-256 + RSA PKCS#1 v1.5, contenido adjunto
 * (`-nodetach`), el certificado incluido, `sid` = IssuerAndSerialNumber copiado
 * byte a byte del certificado y atributos firmados `contentType`, `signingTime` y
 * `messageDigest`. Lo mismo que `openssl cms -sign … -nodetach` sin
 * `SMIMECapabilities`.
 *
 * Solo servidor: usa la clave privada. Nunca loguear el TRA firmado ni el PEM.
 */

/** Servicios que usa la plataforma (el WSAA acepta cualquiera que cumpla el patrón). */
export const TRA_SERVICES = {
  wsfe: 'wsfe',
  padron: 'ws_sr_constancia_inscripcion',
} as const

/** Margen de `generationTime` y `expirationTime` alrededor de `now` (como `@arcasdk/core`). */
export const TRA_WINDOW_MS = 10 * 60_000

/** XSD del WSAA: `service` empieza con letra y sigue con letras, números o `_`; largo 3–32. */
const TRA_SERVICE_RE = /^[A-Za-z][A-Za-z0-9_]{2,31}$/

/**
 * TRA (`loginTicketRequest` 1.0) para `service`. `uniqueId` = segundos unix de
 * `now`; ventana de ±10 minutos en ISO UTC con milisegundos (`toISOString()`).
 * Sin `source` ni `destination` (lo recomienda el manual, FAQ 10.5).
 */
export function buildTra(service: string, now: Date = new Date()): string {
  if (!TRA_SERVICE_RE.test(service)) {
    throw new ArcaCryptoError('invalid_service', 'El servicio del TRA no es válido')
  }
  const at = now.getTime()
  if (Number.isNaN(at) || at < 0) {
    throw new ArcaCryptoError('invalid_input', 'Fecha del TRA inválida')
  }
  const iso = (ms: number) => new Date(ms).toISOString()
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(at / 1000)}</uniqueId>` +
    `<generationTime>${iso(at - TRA_WINDOW_MS)}</generationTime>` +
    `<expirationTime>${iso(at + TRA_WINDOW_MS)}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`
  )
}

/**
 * Firma el TRA y devuelve el CMS en base64 de una sola línea (va en `<in0>` del
 * `loginCms`). `cert` es el certificado de ARCA en PEM o DER; `privateKeyPem`, la
 * clave del pedido. Es determinístico: los mismos datos y `now` dan los mismos
 * bytes. Tira `key_mismatch` si el certificado no es de esa clave (así no se
 * gasta un pedido al WSAA que va a volver con `cms.sign.invalid`).
 */
export function signTra(
  traXml: string,
  cert: string | Uint8Array,
  privateKeyPem: string,
  now: Date = new Date(),
): string {
  if (typeof traXml !== 'string' || traXml.length === 0) {
    throw new ArcaCryptoError('invalid_input', 'No hay TRA para firmar')
  }
  const certDer = extractCertificateDer(cert)
  let x509: X509Certificate | null = null
  try {
    if (certDer) x509 = new X509Certificate(certDer) // que OpenSSL lo abra, no solo que tenga la forma
  } catch {
    x509 = null
  }
  if (!certDer || !x509) {
    throw new ArcaCryptoError('not_a_certificate', 'El certificado no se puede leer')
  }
  const key = loadRsaPrivateKey(privateKeyPem)
  if (!x509.checkPrivateKey(key)) {
    throw new ArcaCryptoError('key_mismatch', 'El certificado no corresponde a la clave privada')
  }
  const { serial, issuer } = readTbsCertificate(certDer)

  const content = Buffer.from(traXml, 'utf8')
  const sha256 = seq(oid(OID.sha256)) // parámetros ausentes (RFC 5754)
  const signedAttrs = setOf(
    seq(oid(OID.contentType), set(oid(OID.data))),
    seq(oid(OID.signingTime), set(derTime(now))),
    seq(oid(OID.messageDigest), set(octet(createHash('sha256').update(content).digest()))),
  )
  // Se firma el SET con la etiqueta 0x31; en el SignerInfo va como [0] IMPLICIT (0xa0).
  const signature = sign('sha256', signedAttrs, { key, padding: constants.RSA_PKCS1_PADDING })
  const signerInfo = seq(
    int(1),
    seq(issuer.raw, serial.raw), // IssuerAndSerialNumber, tal cual del certificado
    sha256,
    implicitConstructed(0, signedAttrs),
    seq(oid(OID.rsaEncryption), nul()),
    octet(signature),
  )
  const signedData = seq(
    int(1),
    set(sha256),
    seq(oid(OID.data), explicit(0, octet(content))), // encapContentInfo con el TRA adentro
    implicitConstructed(0, set(certDer)), // certificates [0] IMPLICIT
    set(signerInfo),
  )
  return seq(oid(OID.signedData), explicit(0, signedData)).toString('base64')
}
