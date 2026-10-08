/**
 * Fixtures «dorados» de la cripto de ARCA (WP1), hechos con NUESTRO código.
 *
 *   npx tsx --conditions=react-server scripts/arca/emit-cms-fixture.ts [carpeta]
 *
 * Lo corre `scripts/arca/make-fixtures.sh` después de generar con OpenSSL la
 * clave, los certificados y `tra.xml`. Escribe en la carpeta (por defecto
 * `tests/fixtures/arca`):
 *
 * - `our.cms.der`: `signTra(tra.xml, test.crt, test.key, FIXED_NOW)` (autofirmado).
 * - `our-issued.cms.der`: lo mismo con `issued.crt` (emitido por la AC de prueba:
 *   emisor ≠ sujeto, como los de ARCA).
 *
 * y avisa si nuestro CSR no sale idéntico al de OpenSSL. La firma RSA PKCS#1 v1.5
 * es determinística y la fecha es fija, así que con los mismos insumos los bytes
 * son siempre los mismos; `make-fixtures.sh` los verifica después con
 * `openssl cms -verify` y los tests comparan contra estos archivos.
 *
 * `--conditions=react-server` hace que `import 'server-only'` resuelva al módulo
 * vacío: fuera de Next el paquete tira a propósito.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { signTra } from '@/lib/arca/cms'
import { buildCsr } from '@/lib/arca/csr'
import {
  ARCA_CRYPTO_FILES as F,
  FIXED_NOW,
  SELF_SIGNED_SUBJECT,
} from '@/tests/fixtures/arca/crypto-constants'

function main(): void {
  const dir = resolve(process.argv[2] ?? 'tests/fixtures/arca')
  const read = (name: string) => readFileSync(join(dir, name), 'utf8')
  const tra = read(F.tra)
  const key = read(F.testKey)

  const outputs: Array<[cert: string, out: string]> = [
    [F.testCrt, F.ourCms],
    [F.issuedCrt, F.ourIssuedCms],
  ]
  for (const [cert, out] of outputs) {
    const cms = signTra(tra, read(cert), key, FIXED_NOW)
    writeFileSync(join(dir, out), Buffer.from(cms, 'base64'))
    console.log(`${out}: listo (${cms.length} caracteres en base64)`)
  }

  const csr = buildCsr({ ...SELF_SIGNED_SUBJECT, privateKeyPem: key })
  if (csr === read(F.opensslCsr)) {
    console.log(`buildCsr: idéntico byte a byte a ${F.opensslCsr}`)
  } else {
    console.error(`buildCsr: DISTINTO de ${F.opensslCsr}`)
    process.exitCode = 1
  }
}

main()
