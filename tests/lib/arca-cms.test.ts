import { createHash, generateKeyPairSync, verify, X509Certificate } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readTbsCertificate } from '@/lib/arca/cert'
import { buildTra, signTra, TRA_SERVICES, TRA_WINDOW_MS } from '@/lib/arca/cms'
import {
  ArcaCryptoError,
  children,
  contextTag,
  OID,
  parseDer,
  readInteger,
  readOid,
  readTime,
  TAG,
  type Tlv,
} from '@/lib/arca/der'
import {
  childAt,
  ARCA_CRYPTO_FILES as F,
  FIXED_NOW,
  fixtureBytes,
  fixturePemDer,
  fixtureText,
} from '@/tests/fixtures/arca/crypto-fixtures'

const testKeyPem = fixtureText(F.testKey)
const testCrtPem = fixtureText(F.testCrt)
const issuedCrtPem = fixtureText(F.issuedCrt)
const tra = fixtureText(F.tra)

function errorCode(fn: () => unknown): string | null {
  try {
    fn()
  } catch (e) {
    return e instanceof ArcaCryptoError ? e.code : `otro: ${String(e)}`
  }
  return null
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest()

/** Desarma un CMS SignedData (RFC 5652 §5) en las partes que importan para el WSAA. */
function dissectCms(der: Buffer) {
  const root = parseDer(der)
  const signedData = childAt(childAt(root, 1), 0)
  const fields = children(signedData)
  const [version, digestAlgorithms, encap, certificates, signerInfos] = fields
  if (!version || !digestAlgorithms || !encap || !certificates || !signerInfos) {
    throw new Error('SignedData incompleto')
  }
  const signerInfo = childAt(signerInfos, 0)
  const sid = childAt(signerInfo, 1)
  const signedAttrs = childAt(signerInfo, 3)
  const attributes = children(signedAttrs).map((attr) => ({
    oid: readOid(childAt(attr, 0)),
    values: children(childAt(attr, 1)),
  }))
  return {
    root,
    contentType: readOid(childAt(root, 0)),
    wrapperTag: childAt(root, 1).tag,
    signedDataFields: fields.length,
    version: readInteger(version),
    digestAlgorithms: children(digestAlgorithms),
    eContentType: readOid(childAt(encap, 0)),
    eContentWrapper: childAt(encap, 1),
    eContent: childAt(childAt(encap, 1), 0),
    certificates,
    signerInfos: children(signerInfos),
    signerInfoFields: children(signerInfo).length,
    signerVersion: readInteger(childAt(signerInfo, 0)),
    sidIssuer: childAt(sid, 0),
    sidSerial: childAt(sid, 1),
    sidFields: children(sid).length,
    digestAlgorithm: childAt(signerInfo, 2),
    signedAttrs,
    attributes,
    signatureAlgorithm: childAt(signerInfo, 4),
    signature: childAt(signerInfo, 5),
  }
}

/** Lo que se firma: el DER de los atributos con la etiqueta de SET (0x31), no la [0]. */
const asSet = (signedAttrs: Tlv): Buffer =>
  Buffer.concat([Buffer.from([TAG.SET]), signedAttrs.raw.subarray(1)])

const attribute = (cms: ReturnType<typeof dissectCms>, dotted: string): Tlv => {
  const found = cms.attributes.find((a) => a.oid === dotted)
  const value = found?.values[0]
  if (!found || found.values.length !== 1 || !value) throw new Error(`falta el atributo ${dotted}`)
  return value
}

describe('buildTra', () => {
  it('con FIXED_NOW da exactamente tra.xml (lo escribió el script a mano, no este código)', () => {
    expect(buildTra('wsfe', FIXED_NOW)).toBe(tra)
  })

  it('uniqueId en segundos unix y ventana de ±10 minutos en ISO UTC con milisegundos', () => {
    const now = new Date('2026-10-08T12:00:00.999Z')
    const xml = buildTra(TRA_SERVICES.wsfe, now)
    const pick = (tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]
    expect(pick('uniqueId')).toBe('1791460800')
    expect(pick('generationTime')).toBe('2026-10-08T11:50:00.999Z')
    expect(pick('expirationTime')).toBe('2026-10-08T12:10:00.999Z')
    expect(TRA_WINDOW_MS).toBe(600_000)
    expect(xml).not.toContain('<source>')
    expect(xml).not.toContain('<destination>')
  })

  it('el servicio del padrón', () => {
    expect(buildTra(TRA_SERVICES.padron, FIXED_NOW)).toContain(
      '<service>ws_sr_constancia_inscripcion</service>',
    )
  })

  it.each([
    'abc',
    'a'.repeat(32),
    'ws_sr_padron_a13',
    'Wsfe1',
  ])('acepta el servicio %j', (service) => {
    expect(buildTra(service, FIXED_NOW)).toContain(`<service>${service}</service>`)
  })

  it.each([
    '',
    'ws',
    '1wsfe',
    '_wsfe',
    'ws-fe',
    'wsfe ',
    'ws fe',
    'wsfe<x>',
    'a'.repeat(33),
  ])('rechaza el servicio %j', (service) => {
    expect(errorCode(() => buildTra(service, FIXED_NOW))).toBe('invalid_service')
  })

  it('rechaza una fecha inválida', () => {
    expect(errorCode(() => buildTra('wsfe', new Date('no')))).toBe('invalid_input')
  })
})

describe('signTra: fixtures dorados (verificados a mano con openssl cms -verify)', () => {
  it('test.crt (autofirmado) + test.key + FIXED_NOW → our.cms.der, byte a byte', () => {
    const cms = signTra(tra, testCrtPem, testKeyPem, FIXED_NOW)
    expect(Buffer.from(cms, 'base64').equals(fixtureBytes(F.ourCms))).toBe(true)
  })

  it('issued.crt (emitido por la AC) + test.key + FIXED_NOW → our-issued.cms.der, byte a byte', () => {
    const cms = signTra(tra, issuedCrtPem, testKeyPem, FIXED_NOW)
    expect(Buffer.from(cms, 'base64').equals(fixtureBytes(F.ourIssuedCms))).toBe(true)
  })

  it('determinístico, base64 de una sola línea, y el certificado puede venir en DER', () => {
    const a = signTra(tra, testCrtPem, testKeyPem, FIXED_NOW)
    expect(signTra(tra, testCrtPem, testKeyPem, FIXED_NOW)).toBe(a)
    expect(signTra(tra, fixtureBytes(F.testCrtDer), testKeyPem, FIXED_NOW)).toBe(a)
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  })
})

describe('signTra: estructura (RFC 5652) con un certificado de emisor ≠ sujeto', () => {
  const certDer = fixturePemDer(F.issuedCrt)
  const tbs = readTbsCertificate(certDer)
  const cms = dissectCms(Buffer.from(signTra(tra, issuedCrtPem, testKeyPem, FIXED_NOW), 'base64'))

  it('ContentInfo signedData con [0] EXPLICIT; SignedData versión 1 sin CRL', () => {
    expect(cms.contentType).toBe(OID.signedData)
    expect(cms.wrapperTag).toBe(contextTag(0))
    expect(cms.version).toBe(1n)
    expect(cms.signedDataFields).toBe(5)
  })

  it('digestAlgorithms: solo sha256, sin parámetros (RFC 5754)', () => {
    expect(cms.digestAlgorithms).toHaveLength(1)
    const [algorithm] = cms.digestAlgorithms
    if (!algorithm) throw new Error('sin algoritmo')
    expect(children(algorithm)).toHaveLength(1)
    expect(readOid(childAt(algorithm, 0))).toBe(OID.sha256)
  })

  it('el TRA va adentro (adjunto), como OCTET STRING en [0] EXPLICIT', () => {
    expect(cms.eContentType).toBe(OID.data)
    expect(cms.eContentWrapper.tag).toBe(contextTag(0))
    expect(cms.eContent.tag).toBe(TAG.OCTET_STRING)
    expect(cms.eContent.body.toString('utf8')).toBe(tra)
  })

  it('certificates [0] IMPLICIT con exactamente el certificado', () => {
    expect(cms.certificates.tag).toBe(contextTag(0))
    const certs = children(cms.certificates)
    expect(certs).toHaveLength(1)
    expect(certs[0]?.raw.equals(certDer)).toBe(true)
  })

  it('un SignerInfo v1 con sid = emisor + serie copiados byte a byte del certificado', () => {
    expect(cms.signerInfos).toHaveLength(1)
    expect(cms.signerInfoFields).toBe(6)
    expect(cms.signerVersion).toBe(1n)
    expect(cms.sidFields).toBe(2)
    expect(cms.sidIssuer.raw.equals(tbs.issuer.raw)).toBe(true)
    expect(cms.sidIssuer.raw.equals(tbs.subject.raw)).toBe(false) // el emisor, no el sujeto
    expect(cms.sidSerial.raw.equals(tbs.serial.raw)).toBe(true)
  })

  it('digestAlgorithm sha256 y signatureAlgorithm rsaEncryption con NULL', () => {
    expect(readOid(childAt(cms.digestAlgorithm, 0))).toBe(OID.sha256)
    expect(children(cms.digestAlgorithm)).toHaveLength(1)
    expect(readOid(childAt(cms.signatureAlgorithm, 0))).toBe(OID.rsaEncryption)
    expect(childAt(cms.signatureAlgorithm, 1).tag).toBe(TAG.NULL)
  })

  it('atributos firmados: contentType, signingTime y messageDigest, en orden DER', () => {
    expect(cms.signedAttrs.tag).toBe(contextTag(0))
    expect(cms.attributes.map((a) => a.oid)).toEqual([
      OID.contentType,
      OID.signingTime,
      OID.messageDigest,
    ])
    expect(readOid(attribute(cms, OID.contentType))).toBe(OID.data)
    const signingTime = attribute(cms, OID.signingTime)
    expect(signingTime.tag).toBe(TAG.UTC_TIME)
    expect(readTime(signingTime).toISOString()).toBe(FIXED_NOW.toISOString())
    const digest = attribute(cms, OID.messageDigest)
    expect(digest.tag).toBe(TAG.OCTET_STRING)
    expect(digest.body.equals(sha256(Buffer.from(tra, 'utf8')))).toBe(true)
  })

  it('la firma RSA verifica sobre el SET (0x31) y no sobre el [0] (0xa0)', () => {
    const publicKey = new X509Certificate(certDer).publicKey
    expect(cms.signature.tag).toBe(TAG.OCTET_STRING)
    expect(cms.signature.len).toBe(256) // RSA 2048
    expect(verify('sha256', asSet(cms.signedAttrs), publicKey, cms.signature.body)).toBe(true)
    expect(verify('sha256', cms.signedAttrs.raw, publicKey, cms.signature.body)).toBe(false)
  })

  it('desde 2050 el signingTime va en GeneralizedTime (RFC 5652 §11.3)', () => {
    const later = new Date('2050-01-01T00:00:00Z')
    const other = dissectCms(Buffer.from(signTra(tra, issuedCrtPem, testKeyPem, later), 'base64'))
    const signingTime = attribute(other, OID.signingTime)
    expect(signingTime.tag).toBe(TAG.GENERALIZED_TIME)
    expect(readTime(signingTime).toISOString()).toBe(later.toISOString())
  })
})

describe('signTra: el mismo esqueleto que el CMS de OpenSSL (openssl.cms.der)', () => {
  const ours = dissectCms(Buffer.from(signTra(tra, testCrtPem, testKeyPem, FIXED_NOW), 'base64'))
  const theirs = dissectCms(fixtureBytes(F.opensslCms))
  const oids = (nodes: Tlv[]) => nodes.map((n) => readOid(childAt(n, 0)))

  it('mismos tipos, algoritmos, contenido, certificado y sid', () => {
    expect(ours.contentType).toBe(theirs.contentType)
    expect(ours.version).toBe(theirs.version)
    expect(oids(ours.digestAlgorithms)).toEqual(oids(theirs.digestAlgorithms))
    expect(ours.eContentType).toBe(theirs.eContentType)
    expect(ours.eContent.raw.equals(theirs.eContent.raw)).toBe(true)
    expect(ours.certificates.raw.equals(theirs.certificates.raw)).toBe(true)
    expect(ours.signerVersion).toBe(theirs.signerVersion)
    expect(ours.sidIssuer.raw.equals(theirs.sidIssuer.raw)).toBe(true)
    expect(ours.sidSerial.raw.equals(theirs.sidSerial.raw)).toBe(true)
    expect(readOid(childAt(ours.digestAlgorithm, 0))).toBe(
      readOid(childAt(theirs.digestAlgorithm, 0)),
    )
    expect(readOid(childAt(ours.signatureAlgorithm, 0))).toBe(
      readOid(childAt(theirs.signatureAlgorithm, 0)),
    )
  })

  it('nuestros atributos firmados están en los de OpenSSL (que suma SMIMECapabilities) y el digest es el mismo', () => {
    const theirOids = theirs.attributes.map((a) => a.oid)
    for (const attr of ours.attributes) expect(theirOids).toContain(attr.oid)
    expect(
      attribute(ours, OID.messageDigest).raw.equals(attribute(theirs, OID.messageDigest).raw),
    ).toBe(true)
  })

  it('OpenSSL también firma el SET con 0x31: su firma verifica con la misma regla', () => {
    const publicKey = new X509Certificate(testCrtPem).publicKey
    expect(verify('sha256', asSet(theirs.signedAttrs), publicKey, theirs.signature.body)).toBe(true)
  })
})

describe('signTra: errores', () => {
  const otherKeyPem = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()

  it('otra clave → key_mismatch (no se gasta un pedido al WSAA)', () => {
    expect(errorCode(() => signTra(tra, testCrtPem, otherKeyPem, FIXED_NOW))).toBe('key_mismatch')
    expect(errorCode(() => signTra(tra, issuedCrtPem, otherKeyPem, FIXED_NOW))).toBe('key_mismatch')
  })

  it('lo que no es certificado → not_a_certificate; la clave ilegible → invalid_key', () => {
    expect(errorCode(() => signTra(tra, fixtureText(F.opensslCsr), testKeyPem, FIXED_NOW))).toBe(
      'not_a_certificate',
    )
    expect(errorCode(() => signTra(tra, 'basura', testKeyPem, FIXED_NOW))).toBe('not_a_certificate')
    expect(errorCode(() => signTra(tra, testCrtPem, 'no es una clave', FIXED_NOW))).toBe(
      'invalid_key',
    )
  })

  it('TRA vacío o fecha inválida → invalid_input', () => {
    expect(errorCode(() => signTra('', testCrtPem, testKeyPem, FIXED_NOW))).toBe('invalid_input')
    expect(errorCode(() => signTra(tra, testCrtPem, testKeyPem, new Date('no')))).toBe(
      'invalid_input',
    )
  })
})
