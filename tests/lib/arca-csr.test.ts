import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildCsr,
  generateKeyAndCsr,
  generateRsaKeyPair,
  loadRsaPrivateKey,
  normalizeCsrSubject,
  publicKeySha256,
  RSA_MODULUS_BITS,
} from '@/lib/arca/csr'
import {
  ArcaCryptoError,
  children,
  OID,
  parseDer,
  readInteger,
  readOid,
  readString,
  TAG,
} from '@/lib/arca/der'
import { classifyUpload, fromPem } from '@/lib/arca/pem'
import {
  childAt,
  ARCA_CRYPTO_FILES as F,
  fixtureText,
  PERSONA_CUIT,
  SAS_CUIT,
  SELF_SIGNED_SUBJECT,
} from '@/tests/fixtures/arca/crypto-fixtures'

const testKeyPem = fixtureText(F.testKey)

function errorCode(fn: () => unknown): string | null {
  try {
    fn()
  } catch (e) {
    return e instanceof ArcaCryptoError ? e.code : `otro: ${String(e)}`
  }
  return null
}

/** Desarma un CSR PEM en sus partes (PKCS#10, RFC 2986 §4). */
function dissect(csrPem: string) {
  const block = fromPem(csrPem)
  if (block?.label !== 'CERTIFICATE REQUEST') throw new Error('no es un CSR PEM')
  const root = parseDer(block.der)
  const info = childAt(root, 0)
  const algorithm = childAt(root, 1)
  const signature = childAt(root, 2)
  const rdns = children(childAt(info, 1)).map((rdn) => {
    const atv = childAt(rdn, 0)
    const value = childAt(atv, 1)
    return {
      oid: readOid(childAt(atv, 0)),
      tag: value.tag,
      value: readString(value),
      size: children(rdn).length,
    }
  })
  return {
    root,
    info,
    version: readInteger(childAt(info, 0)),
    rdns,
    spki: childAt(info, 2),
    attributes: childAt(info, 3),
    algorithm,
    signature,
    infoChildren: children(info).length,
  }
}

/** La firma del CSR verifica con `crypto.verify` sobre el CertificationRequestInfo. */
function signatureVerifies(csrPem: string, publicKeyDer: Uint8Array): boolean {
  const { info, signature } = dissect(csrPem)
  expect(signature.tag).toBe(TAG.BIT_STRING)
  expect(signature.body[0]).toBe(0) // sin bits sobrantes
  const key = createPublicKey({ key: Buffer.from(publicKeyDer), format: 'der', type: 'spki' })
  return verify('sha256', info.raw, key, signature.body.subarray(1))
}

describe('buildCsr', () => {
  it('con test.key da exactamente el CSR de OpenSSL (openssl req -new -subj …)', () => {
    expect(buildCsr({ ...SELF_SIGNED_SUBJECT, privateKeyPem: testKeyPem })).toBe(
      fixtureText(F.opensslCsr),
    )
  })

  it('estructura PKCS#10: versión 0, sujeto C/O/CN/serialNumber con sus tipos, atributos vacíos', () => {
    const csr = dissect(buildCsr({ ...SELF_SIGNED_SUBJECT, privateKeyPem: testKeyPem }))
    expect(csr.version).toBe(0n)
    expect(csr.infoChildren).toBe(4)
    expect(csr.rdns).toEqual([
      { oid: OID.countryName, tag: TAG.PRINTABLE_STRING, value: 'AR', size: 1 },
      { oid: OID.organizationName, tag: TAG.UTF8_STRING, value: 'Bar de Prueba SAS', size: 1 },
      { oid: OID.commonName, tag: TAG.UTF8_STRING, value: 'plataformatest', size: 1 },
      { oid: OID.serialNumber, tag: TAG.PRINTABLE_STRING, value: `CUIT ${PERSONA_CUIT}`, size: 1 },
    ])
    expect(csr.attributes.tag).toBe(0xa0)
    expect(csr.attributes.len).toBe(0)
    expect(readOid(childAt(csr.algorithm, 0))).toBe(OID.sha256WithRSAEncryption)
    expect(childAt(csr.algorithm, 1).tag).toBe(TAG.NULL)
  })

  it('la clave pública es la de la clave privada y la firma verifica', () => {
    const csrPem = buildCsr({ ...SELF_SIGNED_SUBJECT, privateKeyPem: testKeyPem })
    const spki = createPublicKey(testKeyPem).export({ type: 'spki', format: 'der' })
    expect(dissect(csrPem).spki.raw.equals(spki)).toBe(true)
    expect(signatureVerifies(csrPem, spki)).toBe(true)
  })

  it('si se toca un byte del sujeto, la firma ya no verifica', () => {
    const csrPem = buildCsr({ ...SELF_SIGNED_SUBJECT, privateKeyPem: testKeyPem })
    const { info, signature } = dissect(csrPem)
    const tampered = Buffer.from(info.raw)
    const at = tampered.indexOf(Buffer.from('plataformatest'))
    tampered[at] = 'P'.charCodeAt(0)
    expect(
      verify('sha256', tampered, createPublicKey(testKeyPem), signature.body.subarray(1)),
    ).toBe(false)
  })

  it('CUIT con o sin guiones y espacios; la de la SAS (30) también', () => {
    for (const cuit of [SAS_CUIT, '30-71234567-1', ' 30 71234567 1 ']) {
      const csr = dissect(buildCsr({ ...SELF_SIGNED_SUBJECT, cuit, privateKeyPem: testKeyPem }))
      expect(csr.rdns.at(-1)?.value).toBe(`CUIT ${SAS_CUIT}`)
    }
  })

  it('O y CN en UTF-8: tildes, eñes y & (normalizados a NFC, sin espacios en los bordes)', () => {
    const csrPem = buildCsr({
      cuit: SAS_CUIT,
      organization: '  Café & Bar Ñandú S.A.S. ',
      commonName: 'hubplataforma',
      privateKeyPem: testKeyPem,
    })
    const [, organization, commonName] = dissect(csrPem).rdns
    expect(organization).toEqual({
      oid: OID.organizationName,
      tag: TAG.UTF8_STRING,
      value: 'Café & Bar Ñandú S.A.S.',
      size: 1,
    })
    expect(commonName?.value).toBe('hubplataforma')
    expect(classifyUpload(Buffer.from(csrPem))).toBe('csr')
  })

  it('64 caracteres entran; 65 no', () => {
    const ok = buildCsr({
      ...SELF_SIGNED_SUBJECT,
      organization: 'Ñ'.repeat(64),
      privateKeyPem: testKeyPem,
    })
    expect(dissect(ok).rdns[1]?.value).toBe('Ñ'.repeat(64))
    expect(
      errorCode(() =>
        buildCsr({
          ...SELF_SIGNED_SUBJECT,
          organization: 'x'.repeat(65),
          privateKeyPem: testKeyPem,
        }),
      ),
    ).toBe('invalid_subject')
  })

  it.each([
    ['dígito verificador', '20123456789'],
    ['10 dígitos', '2012345678'],
    ['prefijo', '12123456786'],
    ['vacía', ''],
    ['con letras', '20-1234567A-6'],
  ])('rechaza la CUIT (%s)', (_label, cuit) => {
    expect(
      errorCode(() => buildCsr({ ...SELF_SIGNED_SUBJECT, cuit, privateKeyPem: testKeyPem })),
    ).toBe('invalid_cuit')
  })

  it.each([
    ['organization', ''],
    ['organization', '   '],
    ['organization', 'Bar\nde Prueba'],
    ['commonName', ''],
    ['commonName', 'alias\u0000'],
  ])('rechaza %s = %j', (field, value) => {
    expect(
      errorCode(() =>
        buildCsr({ ...SELF_SIGNED_SUBJECT, [field]: value, privateKeyPem: testKeyPem }),
      ),
    ).toBe('invalid_subject')
  })

  it('rechaza claves que no sirven: EC, RSA 1024, una pública o basura', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const small = generateKeyPairSync('rsa', { modulusLength: 1024 })
    const keys = [
      ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      small.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      createPublicKey(testKeyPem).export({ type: 'spki', format: 'pem' }).toString(),
      'no es una clave',
    ]
    for (const privateKeyPem of keys) {
      expect(errorCode(() => buildCsr({ ...SELF_SIGNED_SUBJECT, privateKeyPem }))).toBe(
        'invalid_key',
      )
    }
  })

  it('acepta la clave en PKCS#1 (RSA PRIVATE KEY) y da el mismo CSR', () => {
    const pkcs1 = createPrivateKey(testKeyPem).export({ type: 'pkcs1', format: 'pem' }).toString()
    expect(pkcs1.startsWith('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(buildCsr({ ...SELF_SIGNED_SUBJECT, privateKeyPem: pkcs1 })).toBe(
      fixtureText(F.opensslCsr),
    )
  })
})

describe('normalizeCsrSubject', () => {
  it('deja la CUIT en 11 dígitos y recorta O y CN', () => {
    expect(
      normalizeCsrSubject({ cuit: '20-12345678-6', organization: ' Bar ', commonName: ' alias ' }),
    ).toEqual({ cuit: PERSONA_CUIT, organization: 'Bar', commonName: 'alias' })
  })
})

describe('generateKeyAndCsr', () => {
  it('clave PKCS#8 RSA 2048, CSR que verifica y hash de la clave pública que coincide', () => {
    const out = generateKeyAndCsr({
      cuit: SAS_CUIT,
      organization: 'Bar de Prueba SAS',
      commonName: 'hubplataforma',
    })
    // Formas que valida la base (acc_arca_store_keypair / aacn_pem / aacn_key_hash).
    expect(out.privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true)
    expect(out.privateKeyPem.length).toBeLessThanOrEqual(4000)
    expect(out.csrPem.startsWith('-----BEGIN CERTIFICATE REQUEST-----\n')).toBe(true)
    expect(out.csrPem.length).toBeLessThanOrEqual(4000)
    expect(out.publicKeySha256).toMatch(/^[0-9a-f]{64}$/)

    const key = loadRsaPrivateKey(out.privateKeyPem)
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(RSA_MODULUS_BITS)
    expect(key.asymmetricKeyDetails?.publicExponent).toBe(65_537n)

    const csr = dissect(out.csrPem)
    const spki = createPublicKey(key).export({ type: 'spki', format: 'der' })
    expect(csr.spki.raw.equals(spki)).toBe(true)
    expect(out.publicKeySha256).toBe(createHash('sha256').update(csr.spki.raw).digest('hex'))
    expect(signatureVerifies(out.csrPem, spki)).toBe(true)
    expect(csr.rdns.map((r) => r.value)).toEqual([
      'AR',
      'Bar de Prueba SAS',
      'hubplataforma',
      `CUIT ${SAS_CUIT}`,
    ])
  })

  it('cada llamada genera una clave nueva', () => {
    const subject = {
      cuit: SAS_CUIT,
      organization: 'Bar de Prueba SAS',
      commonName: 'hubplataforma',
    }
    const a = generateKeyAndCsr(subject)
    const b = generateKeyAndCsr(subject)
    expect(a.publicKeySha256).not.toBe(b.publicKeySha256)
    expect(a.privateKeyPem).not.toBe(b.privateKeyPem)
  })

  it('valida el sujeto (CUIT, O, CN) antes de generar la clave', () => {
    expect(
      errorCode(() =>
        generateKeyAndCsr({ cuit: '20123456789', organization: 'Bar', commonName: 'x' }),
      ),
    ).toBe('invalid_cuit')
    expect(
      errorCode(() => generateKeyAndCsr({ cuit: SAS_CUIT, organization: '', commonName: 'x' })),
    ).toBe('invalid_subject')
  })
})

describe('generateRsaKeyPair y publicKeySha256', () => {
  it('RSA 2048; el SPKI es el de la clave privada; el hash es sha256 hex del SPKI', () => {
    const { privateKeyPem, publicKeySpkiDer } = generateRsaKeyPair()
    const key = createPrivateKey(privateKeyPem)
    expect(key.asymmetricKeyType).toBe('rsa')
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048)
    const spki = createPublicKey(key).export({ type: 'spki', format: 'der' })
    expect(Buffer.from(publicKeySpkiDer).equals(spki)).toBe(true)
    expect(publicKeySha256(publicKeySpkiDer)).toBe(createHash('sha256').update(spki).digest('hex'))
  })
})
