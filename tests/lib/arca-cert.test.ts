import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  X509Certificate,
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  type CertificateInfo,
  certificateValidity,
  certMatchesKey,
  inspectCertificate,
  parseCertificate,
  readTbsCertificate,
} from '@/lib/arca/cert'
import { publicKeySha256 } from '@/lib/arca/csr'
import { ArcaCryptoError, children, readTime, TAG } from '@/lib/arca/der'
import {
  CERT_UPLOAD_MAX_BYTES,
  classifyUpload,
  extractCertificateDer,
  fromPem,
  pemBlocks,
  toPem,
  type UploadKind,
} from '@/lib/arca/pem'
import {
  CA_CRT,
  ARCA_CRYPTO_FILES as F,
  FIXED_NOW,
  fixtureBytes,
  fixturePemDer,
  fixtureText,
  ISSUED_CRT,
  PERSONA_CUIT,
  SAS_CUIT,
  SELF_SIGNED_SUBJECT,
  TEST_CRT,
} from '@/tests/fixtures/arca/crypto-fixtures'

const testKeyPem = fixtureText(F.testKey)
const testCrtPem = fixtureText(F.testCrt)
const issuedCrtPem = fixtureText(F.issuedCrt)
const caCrtPem = fixtureText(F.caCrt)
const csrPem = fixtureText(F.opensslCsr)

function errorCode(fn: () => unknown): string | null {
  try {
    fn()
  } catch (e) {
    return e instanceof ArcaCryptoError ? e.code : `otro: ${String(e)}`
  }
  return null
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const bytesOf = (text: string) => Buffer.from(text, 'utf8')

/** Otra clave RSA 2048 (una sola vez por archivo): para «el certificado es de otro pedido». */
const otherKeyPem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()

describe('parseCertificate: test.crt (autofirmado, CUIT de persona)', () => {
  const info = parseCertificate(testCrtPem)

  it('lee sujeto, CUIT, alias, emisor, serie y fechas del DER', () => {
    expect(info.subject.text).toBe(TEST_CRT.subjectText)
    expect(info.subject.country).toBe('AR')
    expect(info.subject.organization).toBe(SELF_SIGNED_SUBJECT.organization)
    expect(info.subject.commonName).toBe(SELF_SIGNED_SUBJECT.commonName)
    expect(info.subject.serialNumber).toBe(`CUIT ${PERSONA_CUIT}`)
    expect(info.subjectCuit).toBe(PERSONA_CUIT)
    expect(info.subjectCn).toBe('plataformatest')
    expect(info.issuer).toBe(TEST_CRT.subjectText) // autofirmado
    expect(info.issuerName).toEqual(info.subject)
    expect(info.serialHex).toBe(TEST_CRT.serialHex)
    expect(info.notBefore.toISOString()).toBe(TEST_CRT.notBefore.toISOString())
    expect(info.notAfter.toISOString()).toBe(TEST_CRT.notAfter.toISOString())
  })

  it('el PEM normalizado es el de OpenSSL y los hashes cuadran', () => {
    expect(info.pem).toBe(testCrtPem)
    const der = fixtureBytes(F.testCrtDer)
    expect(info.fingerprintSha256).toBe(sha256(der))
    const spki = createPublicKey(testKeyPem).export({ type: 'spki', format: 'der' })
    expect(info.publicKeySha256).toBe(publicKeySha256(spki))
    expect(info.publicKeySha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('coincide con lo que lee Node (X509Certificate)', () => {
    const x509 = new X509Certificate(testCrtPem)
    expect(info.serialHex).toBe(x509.serialNumber)
    expect(info.fingerprintSha256).toBe(x509.fingerprint256.replaceAll(':', '').toLowerCase())
  })

  it('el DER (test.crt.der) da exactamente lo mismo que el PEM', () => {
    expect(parseCertificate(fixtureBytes(F.testCrtDer))).toEqual(info)
    expect(parseCertificate(bytesOf(testCrtPem))).toEqual(info)
  })

  it('inspectCertificate (nombre del diseño) es la misma función', () => {
    expect(inspectCertificate).toBe(parseCertificate)
  })
})

describe('parseCertificate: issued.crt (como el de ARCA: emitido por una AC, CUIT de la SAS)', () => {
  const info = parseCertificate(issuedCrtPem)

  it('sujeto con solo serialNumber y CN; emisor = la AC', () => {
    expect(info.subject.text).toBe(ISSUED_CRT.subjectText)
    expect(info.subject.attributes.map((a) => a.name)).toEqual(['serialNumber', 'CN'])
    expect(info.subject.country).toBeNull()
    expect(info.subject.organization).toBeNull()
    expect(info.subjectCuit).toBe(SAS_CUIT)
    expect(info.subjectCn).toBe(ISSUED_CRT.commonName)
    expect(info.issuer).toBe(CA_CRT.subjectText)
    expect(info.issuerName.commonName).toBe('AC de Prueba Computadores')
    expect(info.issuer).not.toBe(info.subject.text)
  })

  it('número de serie con el bit alto: el DER lleva 0x00 adelante pero serialHex no', () => {
    const tbs = readTbsCertificate(fixturePemDer(F.issuedCrt))
    expect(tbs.serial.body[0]).toBe(0x00)
    expect(tbs.serial.len).toBe(9)
    expect(info.serialHex).toBe(ISSUED_CRT.serialHex)
    expect(info.serialHex).toBe(new X509Certificate(issuedCrtPem).serialNumber)
  })

  it('dos años de vigencia', () => {
    expect(info.notBefore.toISOString()).toBe(ISSUED_CRT.notBefore.toISOString())
    expect(info.notAfter.toISOString()).toBe(ISSUED_CRT.notAfter.toISOString())
  })

  it('es de la misma clave que test.crt', () => {
    expect(info.publicKeySha256).toBe(parseCertificate(testCrtPem).publicKeySha256)
  })
})

describe('parseCertificate: ca.crt (vence en 2050 → GeneralizedTime)', () => {
  it('lee notAfter en GeneralizedTime', () => {
    const tbs = readTbsCertificate(fixturePemDer(F.caCrt))
    const [from, to] = children(tbs.validity)
    expect(from?.tag).toBe(TAG.UTC_TIME)
    expect(to?.tag).toBe(TAG.GENERALIZED_TIME)
    if (to) expect(readTime(to).toISOString()).toBe(CA_CRT.notAfter.toISOString())
    const info = parseCertificate(caCrtPem)
    expect(info.notAfter.toISOString()).toBe(CA_CRT.notAfter.toISOString())
    expect(info.serialHex).toBe(CA_CRT.serialHex)
    expect(info.subject.text).toBe(CA_CRT.subjectText)
    expect(info.subjectCuit).toBeNull()
  })
})

describe('parseCertificate: formas de entrada que se toleran', () => {
  const expected = parseCertificate(testCrtPem).fingerprintSha256
  const body = testCrtPem
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('-----'))
    .join('\n')

  it.each<[string, string | Uint8Array]>([
    ['CRLF', testCrtPem.replaceAll('\n', '\r\n')],
    ['BOM (string)', `﻿${testCrtPem}`],
    ['BOM (bytes)', bytesOf(`﻿${testCrtPem}`)],
    [
      'texto antes y después',
      `Bag Attributes\n    localKeyID: 01\n${testCrtPem}\nfin del archivo\n`,
    ],
    ['base64 sin BEGIN/END', body],
    ['base64 sin BEGIN/END (bytes)', bytesOf(body)],
    ['cadena (toma el primero)', `${testCrtPem}${caCrtPem}`],
  ])('%s', (_label, input) => {
    expect(parseCertificate(input).fingerprintSha256).toBe(expected)
  })
})

describe('parseCertificate: lo que no es un certificado', () => {
  const der = fixtureBytes(F.testCrtDer)
  const csrDer = fromPem(csrPem)?.der ?? Buffer.alloc(0)

  it.each<[string, string | Uint8Array]>([
    ['el CSR', csrPem],
    ['el CSR en DER', csrDer],
    ['una clave privada', testKeyPem],
    ['texto cualquiera', 'hola, esto no es un certificado'],
    ['vacío', ''],
    ['DER cortado', der.subarray(0, 300)],
    ['DER con un byte de más', Buffer.concat([der, Buffer.from([0])])],
    ['base64 roto', testCrtPem.replace('MII', 'M*I')],
    [
      'etiqueta CERTIFICATE con un CSR adentro',
      csrPem.replaceAll('CERTIFICATE REQUEST', 'CERTIFICATE'),
    ],
    ['un PKCS#12', fixtureBytes(F.testP12)],
  ])('%s → not_a_certificate', (_label, input) => {
    expect(errorCode(() => parseCertificate(input))).toBe('not_a_certificate')
  })
})

describe('certMatchesKey', () => {
  it('true con la clave del pedido (PEM, DER y el emitido por la AC)', () => {
    expect(certMatchesKey(testCrtPem, testKeyPem)).toBe(true)
    expect(certMatchesKey(fixtureBytes(F.testCrtDer), testKeyPem)).toBe(true)
    expect(certMatchesKey(issuedCrtPem, testKeyPem)).toBe(true)
  })

  it('false con otra clave', () => {
    expect(certMatchesKey(testCrtPem, otherKeyPem)).toBe(false)
    expect(certMatchesKey(issuedCrtPem, otherKeyPem)).toBe(false)
  })

  it('tira si alguno no se puede leer', () => {
    expect(errorCode(() => certMatchesKey(testCrtPem, 'no es una clave'))).toBe('invalid_key')
    expect(errorCode(() => certMatchesKey(csrPem, testKeyPem))).toBe('not_a_certificate')
  })
})

describe('certificateValidity', () => {
  const cert: Pick<CertificateInfo, 'notBefore' | 'notAfter'> = parseCertificate(issuedCrtPem)
  const at = (ms: number) => certificateValidity(cert, new Date(ms))
  const from = ISSUED_CRT.notBefore.getTime()
  const to = ISSUED_CRT.notAfter.getTime()

  it('antes, durante y después de la vigencia (los dos bordes son válidos)', () => {
    expect(at(from - 1).status).toBe('not_yet_valid')
    expect(at(from).status).toBe('valid')
    expect(at(to)).toEqual({ status: 'valid', daysLeft: 0 })
    expect(at(to + 1)).toEqual({ status: 'expired', daysLeft: -1 })
  })

  it('días que faltan (el aviso de renovación es con menos de 30)', () => {
    expect(certificateValidity(cert, FIXED_NOW)).toEqual({ status: 'valid', daysLeft: 702 })
    expect(at(to - 29 * 86_400_000).daysLeft).toBe(29)
    expect(at(to - 29 * 86_400_000 - 1).daysLeft).toBe(29)
    expect(at(to - 30 * 86_400_000).daysLeft).toBe(30)
  })
})

describe('classifyUpload (§2.4.2)', () => {
  const key = createPrivateKey(testKeyPem)
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
  const csrDer = fromPem(csrPem)?.der ?? Buffer.alloc(0)

  it.each<[string, Uint8Array, UploadKind]>([
    ['test.crt (PEM)', bytesOf(testCrtPem), 'certificate'],
    ['test.crt.der (DER)', fixtureBytes(F.testCrtDer), 'certificate'],
    ['issued.crt', bytesOf(issuedCrtPem), 'certificate'],
    [
      'certificado en base64 sin BEGIN/END',
      bytesOf(testCrtPem.replace(/-----[^\n]+-----\n?/g, '')),
      'certificate',
    ],
    ['el pedido (.csr)', bytesOf(csrPem), 'csr'],
    ['el pedido en DER', csrDer, 'csr'],
    ['clave PKCS#8 PEM', bytesOf(testKeyPem), 'private_key'],
    ['clave PKCS#8 DER', key.export({ type: 'pkcs8', format: 'der' }), 'private_key'],
    [
      'clave PKCS#1 PEM',
      bytesOf(key.export({ type: 'pkcs1', format: 'pem' }).toString()),
      'private_key',
    ],
    ['clave PKCS#1 DER', key.export({ type: 'pkcs1', format: 'der' }), 'private_key'],
    [
      'clave PKCS#8 cifrada (PEM)',
      bytesOf(
        key
          .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' })
          .toString(),
      ),
      'private_key',
    ],
    [
      'clave PKCS#8 cifrada (DER)',
      key.export({ type: 'pkcs8', format: 'der', cipher: 'aes-256-cbc', passphrase: 'x' }),
      'private_key',
    ],
    [
      'clave PKCS#1 cifrada con Proc-Type',
      bytesOf(
        key
          .export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' })
          .toString(),
      ),
      'private_key',
    ],
    ['clave EC (SEC1 DER)', ec.export({ type: 'sec1', format: 'der' }), 'private_key'],
    ['clave EC (PKCS#8 DER)', ec.export({ type: 'pkcs8', format: 'der' }), 'private_key'],
    [
      'certificado y clave en el mismo archivo',
      bytesOf(`${testCrtPem}${testKeyPem}`),
      'private_key',
    ],
    ['test.p12 (PKCS#12)', fixtureBytes(F.testP12), 'pkcs12'],
    ['PEM PKCS12', bytesOf('-----BEGIN PKCS12-----\nMAA=\n-----END PKCS12-----\n'), 'pkcs12'],
    ['PKCS#7 (.p7b)', bytesOf('-----BEGIN PKCS7-----\nMAA=\n-----END PKCS7-----\n'), 'unknown'],
    ['texto cualquiera', bytesOf('hola'), 'unknown'],
    ['vacío', new Uint8Array(0), 'unknown'],
    [
      'BEGIN CERTIFICATE con basura',
      bytesOf('-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----'),
      'unknown',
    ],
    [
      'CSR con etiqueta de certificado',
      bytesOf(csrPem.replaceAll('CERTIFICATE REQUEST', 'CERTIFICATE')),
      'unknown',
    ],
    [
      'más grande que el tope',
      bytesOf(`${testCrtPem}${'#'.repeat(CERT_UPLOAD_MAX_BYTES)}`),
      'unknown',
    ],
  ])('%s → %s', (_label, bytes, expected) => {
    expect(classifyUpload(bytes)).toBe(expected)
  })

  it('nunca tira: DER cortado en cada largo y bytes al azar (semilla fija)', () => {
    const der = fixtureBytes(F.testCrtDer)
    const kinds = new Set<UploadKind>()
    for (let n = 0; n < der.length; n++) kinds.add(classifyUpload(der.subarray(0, n)))
    expect([...kinds]).toEqual(['unknown'])
    let seed = 42
    const next = () => {
      seed = (seed * 48_271) % 2_147_483_647 // MINSTD: entero exacto en double
      return seed
    }
    for (let i = 0; i < 300; i++) {
      const bytes = Uint8Array.from({ length: next() % 3000 }, () => next() % 256)
      if (i % 3 === 0) bytes[0] = TAG.SEQUENCE
      expect(['unknown', 'private_key', 'csr', 'certificate', 'pkcs12']).toContain(
        classifyUpload(bytes),
      )
    }
  })
})

describe('PEM', () => {
  it('toPem arma líneas de 64 con salto final, igual que OpenSSL', () => {
    const der = fixtureBytes(F.testCrtDer)
    const pem = toPem(der, 'CERTIFICATE')
    expect(pem).toBe(testCrtPem)
    expect(pem.endsWith('-----END CERTIFICATE-----\n')).toBe(true)
    for (const line of pem.split('\n')) expect(line.length).toBeLessThanOrEqual(64)
    expect(errorCode(() => toPem(new Uint8Array(0), 'CERTIFICATE'))).toBe('invalid_input')
  })

  it('fromPem y pemBlocks: ida y vuelta, varios bloques y encabezados Proc-Type', () => {
    expect(fromPem(testCrtPem)?.der.equals(fixtureBytes(F.testCrtDer))).toBe(true)
    expect(pemBlocks(`${testCrtPem}${csrPem}`).map((b) => b.label)).toEqual([
      'CERTIFICATE',
      'CERTIFICATE REQUEST',
    ])
    const legacy = createPrivateKey(testKeyPem)
      .export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' })
      .toString()
    expect(legacy).toContain('Proc-Type: 4,ENCRYPTED')
    expect(pemBlocks(legacy).map((b) => b.label)).toEqual(['RSA PRIVATE KEY'])
    expect(fromPem('sin PEM')).toBeNull()
  })

  it('extractCertificateDer devuelve una copia (no comparte memoria con lo que llegó)', () => {
    const input = Buffer.from(fixtureBytes(F.testCrtDer))
    const der = extractCertificateDer(input)
    expect(der?.equals(input)).toBe(true)
    if (der) der[0] = 0
    expect(input[0]).toBe(TAG.SEQUENCE)
    expect(extractCertificateDer(csrPem)).toBeNull()
  })
})
