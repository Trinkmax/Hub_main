import { readFileSync } from 'node:fs'
import { children, type Tlv } from '@/lib/arca/der'
import { fromPem } from '@/lib/arca/pem'
import type { ARCA_CRYPTO_FILES } from './crypto-constants'

/**
 * Lectura de los fixtures de cripto de ARCA para los tests (Vitest, ESM). Las
 * constantes viven en `crypto-constants.ts` (que también usa el script que los
 * genera); acá se re-exportan para importar todo de un lugar.
 */
export * from './crypto-constants'

export type ArcaCryptoFile = (typeof ARCA_CRYPTO_FILES)[keyof typeof ARCA_CRYPTO_FILES]

/** Bytes del archivo. */
export function fixtureBytes(name: ArcaCryptoFile): Buffer {
  return readFileSync(new URL(`./${name}`, import.meta.url))
}

/** Texto (UTF-8) del archivo. */
export function fixtureText(name: ArcaCryptoFile): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
}

/** El DER del primer bloque de un fixture PEM. */
export function fixturePemDer(name: ArcaCryptoFile): Buffer {
  const block = fromPem(fixtureText(name))
  if (!block) throw new Error(`${name} no es PEM`)
  return block.der
}

/** El hijo `i` de un TLV; tira si no está (así los tests no adivinan). */
export function childAt(node: Tlv, i: number): Tlv {
  const child = children(node)[i]
  if (!child) throw new Error(`El TLV (etiqueta 0x${node.tag.toString(16)}) no tiene hijo ${i}`)
  return child
}
