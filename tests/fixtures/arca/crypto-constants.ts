/**
 * Datos fijos de los fixtures de cripto de ARCA (WP1). Todo es sintético: CUIT
 * con dígito verificador válido que no son de nadie, una AC de prueba propia y
 * fechas fijas, así los tests no dependen del día en que corren.
 *
 * `scripts/arca/make-fixtures.sh` usa los mismos valores (si se cambia uno acá,
 * cambiarlo allá y regenerar); los tests verifican que coincidan con lo que
 * quedó en los archivos. Puro: lo importa también `scripts/arca/emit-cms-fixture.ts`.
 */

/** 20-12345678-6: la persona que usa WSASS (en homologación el certificado sale a su nombre). */
export const PERSONA_CUIT = '20123456786'

/** 30-71234567-1: la SAS (en producción el certificado es de la SAS). */
export const SAS_CUIT = '30712345671'

/** Sujeto del CSR de OpenSSL (`openssl.csr`) y del certificado autofirmado (`test.crt`). */
export const SELF_SIGNED_SUBJECT = {
  cuit: '20-12345678-6',
  organization: 'Bar de Prueba SAS',
  commonName: 'plataformatest',
} as const

/** El «ahora» de `tra.xml` y de los CMS dorados. */
export const FIXED_NOW = new Date('2026-10-08T12:00:00.000Z')

/** `test.crt`: autofirmado con `test.key`, sujeto = emisor = `SELF_SIGNED_SUBJECT`. */
export const TEST_CRT = {
  serialHex: '0123456789ABCDEF',
  notBefore: new Date('2026-01-01T00:00:00.000Z'),
  notAfter: new Date('2036-01-01T00:00:00.000Z'),
  subjectText: 'C=AR, O=Bar de Prueba SAS, CN=plataformatest, serialNumber=CUIT 20123456786',
} as const

/** `ca.crt`: la AC de prueba. Vence en 2050, así su `notAfter` es GeneralizedTime. */
export const CA_CRT = {
  serialHex: '01',
  notBefore: new Date('2026-01-01T00:00:00.000Z'),
  notAfter: new Date('2050-01-01T00:00:00.000Z'),
  subjectText: 'C=AR, O=AC de Prueba, CN=AC de Prueba Computadores',
} as const

/**
 * `issued.crt`: emitido por la AC de prueba para la clave de `test.key`, con el
 * sujeto como lo reescribe ARCA (solo `serialNumber` y `CN`), dos años de
 * vigencia y un número de serie con el bit alto prendido (DER le agrega un 0x00).
 */
export const ISSUED_CRT = {
  serialHex: '8F3A5C7E9B1D2F40',
  notBefore: new Date('2026-09-10T00:00:00.000Z'),
  notAfter: new Date('2028-09-10T00:00:00.000Z'),
  subjectText: 'serialNumber=CUIT 30712345671, CN=hubplataforma',
  commonName: 'hubplataforma',
} as const

/** Contraseña de `test.p12` (trae `test.key` y `test.crt`). */
export const P12_PASSWORD = 'prueba'

/** Nombres de los archivos en `tests/fixtures/arca/`. */
export const ARCA_CRYPTO_FILES = {
  /** RSA 2048, PKCS#8 PEM. La única clave privada commiteada (sintética). */
  testKey: 'test.key',
  /** `openssl req -new` con `test.key` y `SELF_SIGNED_SUBJECT`. */
  opensslCsr: 'openssl.csr',
  testCrt: 'test.crt',
  testCrtDer: 'test.crt.der',
  caCrt: 'ca.crt',
  issuedCrt: 'issued.crt',
  testP12: 'test.p12',
  /** TRA fijo (servicio `wsfe`, `FIXED_NOW`), escrito por el script, no por nuestro código. */
  tra: 'tra.xml',
  /** `openssl cms -sign -nodetach` de `tra.xml` con `test.crt` + `test.key`. */
  opensslCms: 'openssl.cms.der',
  /** Nuestro `signTra(tra.xml, test.crt, test.key, FIXED_NOW)`, verificado con OpenSSL. */
  ourCms: 'our.cms.der',
  /** Nuestro `signTra(tra.xml, issued.crt, test.key, FIXED_NOW)`, verificado con OpenSSL y la AC. */
  ourIssuedCms: 'our-issued.cms.der',
} as const
