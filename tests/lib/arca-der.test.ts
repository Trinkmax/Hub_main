import { describe, expect, it } from 'vitest'
import {
  ArcaCryptoError,
  bitString,
  children,
  contextTag,
  derTime,
  explicit,
  generalizedTime,
  implicitConstructed,
  int,
  nul,
  OID,
  octet,
  oid,
  parseDer,
  printable,
  readInteger,
  readOid,
  readString,
  readTime,
  readTLV,
  seq,
  set,
  setOf,
  TAG,
  tlv,
  utcTime,
  utf8,
} from '@/lib/arca/der'
import {
  childAt,
  ARCA_CRYPTO_FILES as F,
  fixtureBytes,
} from '@/tests/fixtures/arca/crypto-fixtures'

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const fromHex = (text: string): Buffer => Buffer.from(text, 'hex')

/** El `code` del ArcaCryptoError que tira `fn` (o `null` si no tira). */
function errorCode(fn: () => unknown): string | null {
  try {
    fn()
  } catch (e) {
    return e instanceof ArcaCryptoError ? e.code : `otro: ${String(e)}`
  }
  return null
}

describe('tlv: largos cortos y largos, ida y vuelta', () => {
  it.each([
    [0, 2],
    [1, 2],
    [127, 2],
    [128, 3],
    [255, 3],
    [256, 4],
    [65_535, 4],
    [65_536, 5],
  ])('contenido de %i bytes → encabezado de %i', (size, hdrLen) => {
    const body = Buffer.alloc(size, 0xab)
    const encoded = tlv(TAG.OCTET_STRING, body)
    const node = readTLV(encoded)
    expect(node.tag).toBe(TAG.OCTET_STRING)
    expect(node.len).toBe(size)
    expect(node.hdrLen).toBe(hdrLen)
    expect(node.end).toBe(encoded.length)
    expect(node.body.equals(body)).toBe(true)
    expect(node.raw.equals(encoded)).toBe(true)
  })

  it('codifica el largo como pide X.690 (0x81 / 0x82 cuando no entra en 7 bits)', () => {
    expect(hex(tlv(TAG.OCTET_STRING, Buffer.alloc(128))).slice(0, 6)).toBe('048180')
    expect(hex(tlv(TAG.OCTET_STRING, Buffer.alloc(256))).slice(0, 8)).toBe('04820100')
    expect(hex(seq(int(1), nul()))).toBe('30050201010500')
  })

  it('rechaza etiquetas inválidas', () => {
    expect(errorCode(() => tlv(0x1f))).toBe('invalid_der')
    expect(errorCode(() => tlv(256))).toBe('invalid_der')
    expect(errorCode(() => tlv(-1))).toBe('invalid_der')
  })
})

describe('INTEGER', () => {
  it.each([
    [0, '020100'],
    [1, '020101'],
    [127, '02017f'],
    [128, '02020080'],
    [255, '020200ff'],
    [256, '02020100'],
    [65_537, '0203010001'],
  ])('%i → %s (con 0x00 adelante si el bit alto está prendido)', (value, expected) => {
    expect(hex(int(value))).toBe(expected)
    expect(readInteger(readTLV(int(value)))).toBe(BigInt(value))
  })

  it('bigint grandes', () => {
    expect(hex(int(2n ** 64n))).toBe('0209010000000000000000')
    expect(readInteger(readTLV(int(2n ** 64n)))).toBe(2n ** 64n)
  })

  it('bytes (magnitud sin signo): quita ceros de más y agrega el 0x00 de signo', () => {
    expect(hex(int(Uint8Array.from([0x80, 0x01])))).toBe('0203008001')
    expect(hex(int(Uint8Array.from([0x00, 0x00, 0x01])))).toBe('020101')
    expect(hex(int(Uint8Array.from([0x00, 0x80])))).toBe('02020080')
    expect(hex(int(new Uint8Array(0)))).toBe('020100')
  })

  it('lee negativos en complemento a dos', () => {
    expect(readInteger(readTLV(fromHex('0201ff')))).toBe(-1n)
    expect(readInteger(readTLV(fromHex('02020080')))).toBe(128n)
    expect(readInteger(readTLV(fromHex('020180')))).toBe(-128n)
  })

  it('rechaza negativos y no enteros', () => {
    expect(errorCode(() => int(-1))).toBe('invalid_input')
    expect(errorCode(() => int(-1n))).toBe('invalid_input')
    expect(errorCode(() => int(1.5))).toBe('invalid_input')
    expect(errorCode(() => int(Number.MAX_SAFE_INTEGER + 1))).toBe('invalid_input')
    expect(errorCode(() => readInteger(readTLV(fromHex('0200'))))).toBe('invalid_der')
  })
})

describe('OBJECT IDENTIFIER', () => {
  it.each([
    [OID.signedData, '06092a864886f70d010702'],
    [OID.sha256, '0609608648016503040201'],
    [OID.serialNumber, '0603550405'],
    [OID.sha256WithRSAEncryption, '06092a864886f70d01010b'],
    ['2.999.3', '0603883703'], // X.690 §8.19.5: el primer subidentificador también va en base 128
  ])('%s → %s', (dotted, expected) => {
    expect(hex(oid(dotted))).toBe(expected)
    expect(readOid(readTLV(oid(dotted)))).toBe(dotted)
  })

  it('ida y vuelta de todos los OID que usa la cripto de ARCA', () => {
    for (const dotted of Object.values(OID)) expect(readOid(readTLV(oid(dotted)))).toBe(dotted)
  })

  it.each([
    '',
    '1',
    '3.1',
    '1.40',
    '0.40',
    '1.2.abc',
    '1..2',
    '01.2',
    '1.2.',
  ])('rechaza %j', (dotted) => {
    expect(errorCode(() => oid(dotted))).toBe('invalid_input')
  })

  it('rechaza un OID cortado (el último byte sigue)', () => {
    expect(errorCode(() => readOid(readTLV(fromHex('06022a86'))))).toBe('invalid_der')
    expect(errorCode(() => readOid(readTLV(int(1))))).toBe('invalid_der')
  })
})

describe('SET y SET OF', () => {
  const contentType = seq(oid(OID.contentType), set(oid(OID.data)))
  const signingTime = seq(oid(OID.signingTime), set(utcTime(new Date('2026-10-08T12:00:00Z'))))
  const messageDigest = seq(oid(OID.messageDigest), set(octet(Buffer.alloc(32, 7))))

  it('SET OF ordena por codificación (X.690 §11.6), venga en el orden que venga', () => {
    const sorted = setOf(messageDigest, signingTime, contentType)
    expect(sorted.equals(setOf(contentType, signingTime, messageDigest))).toBe(true)
    expect(children(readTLV(sorted)).map((c) => hex(c.raw))).toEqual(
      [contentType, signingTime, messageDigest].map(hex),
    )
  })

  it('SET deja el orden en que llegan', () => {
    const kept = set(messageDigest, contentType)
    expect(children(readTLV(kept)).map((c) => hex(c.raw))).toEqual(
      [messageDigest, contentType].map(hex),
    )
  })

  it('no modifica los argumentos', () => {
    const parts = [messageDigest, contentType]
    setOf(...parts)
    expect(parts).toEqual([messageDigest, contentType])
  })
})

describe('fechas', () => {
  it('UTCTime sin milisegundos y vuelta', () => {
    const node = readTLV(utcTime(new Date('2026-10-08T12:34:56.789Z')))
    expect(node.tag).toBe(TAG.UTC_TIME)
    expect(node.body.toString('ascii')).toBe('261008123456Z')
    expect(readTime(node).toISOString()).toBe('2026-10-08T12:34:56.000Z')
  })

  it('UTCTime cubre 1950–2049 (los dos dígitos del año pivotan en 50)', () => {
    expect(readTime(readTLV(utcTime(new Date('1950-01-01T00:00:00Z')))).toISOString()).toBe(
      '1950-01-01T00:00:00.000Z',
    )
    expect(readTime(readTLV(utcTime(new Date('2049-12-31T23:59:59Z')))).toISOString()).toBe(
      '2049-12-31T23:59:59.000Z',
    )
    expect(errorCode(() => utcTime(new Date('2050-01-01T00:00:00Z')))).toBe('invalid_input')
    expect(errorCode(() => utcTime(new Date('1949-12-31T23:59:59Z')))).toBe('invalid_input')
  })

  it('derTime elige UTCTime hasta 2049 y GeneralizedTime desde 2050', () => {
    expect(readTLV(derTime(new Date('2049-12-31T23:59:59Z'))).tag).toBe(TAG.UTC_TIME)
    const node = readTLV(derTime(new Date('2050-01-01T00:00:00Z')))
    expect(node.tag).toBe(TAG.GENERALIZED_TIME)
    expect(node.body.toString('ascii')).toBe('20500101000000Z')
    expect(hex(generalizedTime(new Date('2050-01-01T00:00:00Z')))).toBe(hex(node.raw))
  })

  it('lee variantes válidas: sin segundos, con offset y con fracción', () => {
    const at = (tag: number, text: string) => readTime(readTLV(tlv(tag, Buffer.from(text))))
    expect(at(TAG.UTC_TIME, '2610081234-0300').toISOString()).toBe('2026-10-08T15:34:00.000Z')
    expect(at(TAG.GENERALIZED_TIME, '20261008123456.5Z').toISOString()).toBe(
      '2026-10-08T12:34:56.500Z',
    )
    expect(at(TAG.GENERALIZED_TIME, '20261008123456+0130').toISOString()).toBe(
      '2026-10-08T11:04:56.000Z',
    )
  })

  it.each([
    [TAG.UTC_TIME, '261308000000Z'], // mes 13
    [TAG.UTC_TIME, '260230000000Z'], // 30 de febrero
    [TAG.UTC_TIME, '261008123456'], // sin zona
    [TAG.UTC_TIME, '261008246000Z'], // 24:60
    [TAG.GENERALIZED_TIME, '2026100812Z0'],
    [TAG.INTEGER, '261008123456Z'], // no es una fecha
  ])('rechaza (etiqueta %i) %s', (tag, text) => {
    expect(errorCode(() => readTime(readTLV(tlv(tag, Buffer.from(text)))))).toBe('invalid_der')
  })

  it('rechaza una fecha inválida al codificar', () => {
    expect(errorCode(() => utcTime(new Date('no es fecha')))).toBe('invalid_input')
    expect(errorCode(() => derTime(new Date(Number.NaN)))).toBe('invalid_input')
  })
})

describe('textos', () => {
  it('PrintableString solo con su alfabeto', () => {
    expect(readString(readTLV(printable('CUIT 20123456786')))).toBe('CUIT 20123456786')
    expect(readTLV(printable('AR')).tag).toBe(TAG.PRINTABLE_STRING)
    expect(errorCode(() => printable('HUB & Bar'))).toBe('invalid_input')
    expect(errorCode(() => printable('Ñandú'))).toBe('invalid_input')
  })

  it('UTF8String con tildes, eñes y &', () => {
    const node = readTLV(utf8('Café & Bar Ñandú'))
    expect(node.tag).toBe(TAG.UTF8_STRING)
    expect(readString(node)).toBe('Café & Bar Ñandú')
  })

  it('lee BMPString, UniversalString y TeletexString', () => {
    expect(readString(readTLV(tlv(TAG.BMP_STRING, fromHex('004100d1'))))).toBe('AÑ')
    expect(readString(readTLV(tlv(TAG.UNIVERSAL_STRING, fromHex('00000041000000d1'))))).toBe('AÑ')
    expect(readString(readTLV(tlv(TAG.TELETEX_STRING, fromHex('41d1'))))).toBe('AÑ')
    expect(errorCode(() => readString(readTLV(tlv(TAG.BMP_STRING, fromHex('0041ff')))))).toBe(
      'invalid_der',
    )
    expect(errorCode(() => readString(readTLV(int(1))))).toBe('invalid_der')
  })
})

describe('etiquetas de contexto y primitivos', () => {
  it('[n] EXPLICIT envuelve', () => {
    expect(contextTag(0)).toBe(0xa0)
    expect(hex(explicit(0, int(1)))).toBe('a003020101')
    expect(hex(explicit(3, nul()))).toBe('a3020500')
  })

  it('[n] IMPLICIT cambia solo la etiqueta y no toca el original', () => {
    const original = set(int(1))
    expect(hex(implicitConstructed(0, original))).toBe('a003020101')
    expect(hex(original)).toBe('3103020101')
  })

  it('no re-etiqueta un primitivo ni acepta números de contexto fuera de rango', () => {
    expect(errorCode(() => implicitConstructed(0, int(1)))).toBe('invalid_der')
    expect(errorCode(() => implicitConstructed(0, new Uint8Array(0)))).toBe('invalid_der')
    expect(errorCode(() => explicit(31))).toBe('invalid_der')
    expect(errorCode(() => explicit(-1))).toBe('invalid_der')
  })

  it('BIT STRING, OCTET STRING y NULL', () => {
    expect(hex(bitString(fromHex('ff')))).toBe('030200ff')
    expect(hex(octet(fromHex('ff')))).toBe('0401ff')
    expect(hex(nul())).toBe('0500')
  })
})

describe('lector', () => {
  it('children: hijos en orden, con posiciones relativas al contenido del padre', () => {
    const node = readTLV(seq(int(1), utf8('a'), nul()))
    const kids = children(node)
    expect(kids.map((k) => k.tag)).toEqual([TAG.INTEGER, TAG.UTF8_STRING, TAG.NULL])
    expect(kids.map((k) => k.start)).toEqual([0, 3, 6])
  })

  it('acepta Uint8Array además de Buffer', () => {
    expect(readTLV(Uint8Array.from([0x05, 0x00])).tag).toBe(TAG.NULL)
  })

  it.each([
    ['vacío', ''],
    ['solo la etiqueta', '30'],
    ['declara 5 bytes y trae 3', '3005020101'],
    ['largo indefinido (BER)', '30800201010000'],
    ['largo de 5 bytes', '30850000000001'],
    ['largo largo cortado', '3082'],
    ['etiqueta de varios bytes', '1f810100'],
  ])('rechaza DER %s', (_label, text) => {
    expect(errorCode(() => readTLV(fromHex(text)))).toBe('invalid_der')
  })

  it('parseDer exige que no sobren bytes; readTLV fuera del buffer tira', () => {
    expect(errorCode(() => parseDer(Buffer.concat([nul(), fromHex('00')])))).toBe('invalid_der')
    expect(errorCode(() => readTLV(nul(), 5))).toBe('invalid_der')
    expect(parseDer(nul()).tag).toBe(TAG.NULL)
  })

  it('lee el certificado DER que generó OpenSSL (test.crt.der)', () => {
    const der = fixtureBytes(F.testCrtDer)
    const root = parseDer(der)
    expect(root.raw.equals(der)).toBe(true)
    expect(children(root).map((c) => c.tag)).toEqual([TAG.SEQUENCE, TAG.SEQUENCE, TAG.BIT_STRING])
    expect(readOid(childAt(childAt(root, 1), 0))).toBe(OID.sha256WithRSAEncryption)
  })

  it('lee el CMS que generó OpenSSL (openssl.cms.der)', () => {
    const root = parseDer(fixtureBytes(F.opensslCms))
    expect(readOid(childAt(root, 0))).toBe(OID.signedData)
    expect(childAt(root, 1).tag).toBe(contextTag(0))
  })
})
