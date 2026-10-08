import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { openTable } from '@/lib/imports/detect'
import type { InflateRaw } from '@/lib/imports/types'
import { XLSX_MAX_ROWS } from '@/lib/imports/xlsx'
import {
  defaultInflateRaw,
  inflateRawSync,
  inflateRawWithStreams,
  listZip,
  readZipEntry,
  ZipError,
} from '@/lib/imports/zip'
import { nodeInflateRaw } from '@/tests/fixtures/imports/fixtures'
import { utf8 } from '@/tests/fixtures/imports/synth'
import { buildZip } from '@/tests/fixtures/imports/zip-writer'

/**
 * Topes de los importadores contra archivos armados para tumbar la página o el
 * servidor (cierre de la fase 1): un ZIP que declara un tamaño y descomprime
 * mucho más (bomba) y un CSV con más filas que el tope.
 */

const deflate = (data: Uint8Array) => new Uint8Array(deflateRawSync(data, { level: 9 }))

async function zipError(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
  } catch (e) {
    if (e instanceof ZipError) return e.code
    throw e
  }
  return null
}

/** Un ZIP con `real` bytes adentro que en el directorio central declara `declared`. */
function lyingZip(real: number, declared: number): Uint8Array {
  const bytes = buildZip([{ name: 'a.csv', data: new Uint8Array(real) }], { deflateRaw: deflate })
  // Tamaño descomprimido de la entrada del directorio central: 46 bytes de encabezado, desplazamiento 24.
  const cd = bytes.length - 22 - (46 + 'a.csv'.length)
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(cd + 24, declared, true)
  return bytes
}

describe('bombas: el ZIP declara menos de lo que descomprime', () => {
  it('cada descompresor recibe el tamaño declarado como tope y corta ahí', async () => {
    const zip = lyingZip(1_000_000, 10)
    expect(listZip(zip)[0]?.size).toBe(10)
    const asked: Array<number | undefined> = []
    const produced: number[] = []
    const spy =
      (inflate: InflateRaw): InflateRaw =>
      async (data, maxSize) => {
        asked.push(maxSize)
        const out = await inflate(data, maxSize)
        produced.push(out.length)
        return out
      }
    const inflaters: InflateRaw[] = [defaultInflateRaw, inflateRawSync, inflateRawWithStreams]
    for (const inflate of inflaters) {
      expect(await zipError(readZipEntry(zip, 'a.csv', spy(inflate)))).toBe('zip_corrupt')
    }
    expect(asked).toEqual([10, 10, 10])
    // Ninguno llegó a devolver el millón de bytes: cortaron antes.
    expect(produced).toEqual([])
  })

  it('un descompresor que ignora el tope igual termina en zip_corrupt por el tamaño', async () => {
    expect(await zipError(readZipEntry(lyingZip(50_000, 10), 'a.csv', nodeInflateRaw))).toBe(
      'zip_corrupt',
    )
  })

  it('un ZIP honesto sigue andando con el tope exacto', async () => {
    const data = utf8('Fecha;Importe\n01/10/2026;5,00\n'.repeat(2_000))
    const zip = buildZip([{ name: 'a.csv', data }], { deflateRaw: deflate })
    for (const inflate of [defaultInflateRaw, inflateRawSync, inflateRawWithStreams]) {
      expect((await readZipEntry(zip, 'a.csv', inflate)).length).toBe(data.length)
    }
  })
})

describe('CSV con más filas que el tope', () => {
  it('avisa file_too_many_rows', async () => {
    const r = await openTable({ bytes: utf8('Fecha;Importe\n'.repeat(XLSX_MAX_ROWS + 5)) })
    expect(r.ok ? null : r.issue.code).toBe('file_too_many_rows')
  })
})
