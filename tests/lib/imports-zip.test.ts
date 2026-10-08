import { constants, deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  crc32,
  defaultInflateRaw,
  inflateRawSync,
  inflateRawWithStreams,
  listZip,
  readZipEntry,
  ZipError,
} from '@/lib/imports/zip'
import { IMPORT_FIXTURES, importFixture, nodeInflateRaw } from '@/tests/fixtures/imports/fixtures'
import { makeRng, utf8 } from '@/tests/fixtures/imports/synth'
import { buildZip } from '@/tests/fixtures/imports/zip-writer'

const deflate = (data: Uint8Array) => new Uint8Array(deflateRawSync(data, { level: 6 }))

async function zipError(p: Promise<unknown> | (() => unknown)): Promise<string | null> {
  try {
    if (typeof p === 'function') p()
    else await p
  } catch (e) {
    if (e instanceof ZipError) return e.code
    throw e
  }
  return null
}

describe('crc32', () => {
  it('el valor de referencia', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('inflateRawSync (RFC 1951 propio) contra zlib', () => {
  const rng = makeRng(42)
  const samples: Uint8Array[] = [new Uint8Array(), utf8('hola hola hola hola')]
  for (let n = 0; n < 12; n++) {
    const len = rng.int(1, 80_000)
    const kind = n % 3
    samples.push(
      Uint8Array.from({ length: len }, (_, i) =>
        kind === 0
          ? rng.int(0, 255)
          : kind === 1
            ? 65 + rng.int(0, 3)
            : ';0123456789,\n'.charCodeAt(i % 13),
      ),
    )
  }

  it('niveles 0, 1, 6 y 9 y las estrategias fija, Huffman y RLE', () => {
    for (const data of samples) {
      for (const level of [0, 1, 6, 9]) {
        for (const strategy of [
          constants.Z_DEFAULT_STRATEGY,
          constants.Z_FIXED,
          constants.Z_HUFFMAN_ONLY,
          constants.Z_RLE,
        ]) {
          const out = inflateRawSync(new Uint8Array(deflateRawSync(data, { level, strategy })))
          expect(out.length).toBe(data.length)
          expect(crc32(out)).toBe(crc32(data))
        }
      }
    }
  })

  it('varios bloques guardados seguidos (más de 64 KB sin comprimir)', () => {
    const data = Uint8Array.from({ length: 200_000 }, () => rng.int(0, 255))
    const out = inflateRawSync(new Uint8Array(deflateRawSync(data, { level: 0 })))
    expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true)
  })

  it('flujos rotos tiran ZipError', async () => {
    const good = new Uint8Array(deflateRawSync(utf8('Fecha;Tipo;Total\n'.repeat(500))))
    expect(await zipError(() => inflateRawSync(good.subarray(0, good.length - 5)))).toBe(
      'zip_corrupt',
    )
    // Bloque de tipo 3 (reservado).
    expect(await zipError(() => inflateRawSync(new Uint8Array([0x07])))).toBe('zip_corrupt')
    // Bloque guardado con LEN y NLEN que no se complementan.
    expect(
      await zipError(() => inflateRawSync(new Uint8Array([0x01, 0x05, 0x00, 0x00, 0x00]))),
    ).toBe('zip_corrupt')
    // Bloque fijo: largo 3 a distancia 1 sin nada escrito antes (zlib: «too far back»).
    expect(() => nodeInflateRaw(new Uint8Array([0x03, 0x02, 0x00]))).toThrow()
    expect(await zipError(() => inflateRawSync(new Uint8Array([0x03, 0x02, 0x00])))).toBe(
      'zip_corrupt',
    )
  })

  it('corta en maxSize (contra bombas)', async () => {
    const bomb = new Uint8Array(deflateRawSync(new Uint8Array(1_000_000)))
    expect(await zipError(() => inflateRawSync(bomb, 10_000))).toBe('zip_too_big')
    expect(await zipError(inflateRawWithStreams(bomb, 10_000))).toBe('zip_too_big')
  })

  it('DecompressionStream da lo mismo', async () => {
    for (const data of samples.slice(0, 6)) {
      const out = await inflateRawWithStreams(deflate(data))
      expect(crc32(out)).toBe(crc32(data))
    }
    const viaDefault = await defaultInflateRaw(deflate(utf8('Imp. Total')))
    expect(new TextDecoder().decode(viaDefault)).toBe('Imp. Total')
  })
})

describe('listZip y readZipEntry', () => {
  it('el ZIP como lo arma ARCA (en streaming, bit 3, nombre UTF-8)', async () => {
    const bytes = importFixture(IMPORT_FIXTURES.mcG3Dic)
    const [entry, ...rest] = listZip(bytes)
    expect(rest).toEqual([])
    expect(entry).toMatchObject({
      name: 'comprobantes_consulta_csv_recibidos_124446425_20123456786_20260102-1056 (montos expresados en pesos).csv',
      method: 8,
      encrypted: false,
      isDirectory: false,
      isJunk: false,
    })
    if (!entry) throw new Error('sin entrada')
    // El encabezado local trae ceros: los tamaños salen del directorio central.
    const local = new DataView(bytes.buffer, bytes.byteOffset)
    expect(local.getUint32(18, true)).toBe(0)
    const viaDefault = await readZipEntry(bytes, entry)
    const viaPure = await readZipEntry(bytes, entry, inflateRawSync)
    const viaNode = await readZipEntry(bytes, entry.name, nodeInflateRaw)
    expect(viaDefault.length).toBe(entry.size)
    expect(Buffer.from(viaPure).equals(Buffer.from(viaDefault))).toBe(true)
    expect(Buffer.from(viaNode).equals(Buffer.from(viaDefault))).toBe(true)
    expect(new TextDecoder().decode(viaDefault.subarray(0, 19))).toBe('"Fecha de Emisión"')
  })

  it('guardado (método 0), ZIP64 forzado y basura de macOS', async () => {
    const files = [
      { name: 'extracto.csv', data: utf8('Fecha;Importe\n01/10/2026;5,00\n'), method: 0 as const },
      { name: '__MACOSX/._extracto.csv', data: utf8('x') },
      { name: 'carpeta/', data: new Uint8Array(), method: 0 as const },
    ]
    for (const zip64 of [false, true]) {
      const bytes = buildZip(files, { deflateRaw: deflate, zip64 })
      const entries = listZip(bytes)
      expect(entries.map((e) => [e.name, e.isJunk, e.isDirectory])).toEqual([
        ['extracto.csv', false, false],
        ['__MACOSX/._extracto.csv', true, false],
        ['carpeta/', false, true],
      ])
      const first = entries[0]
      if (!first) throw new Error('sin entrada')
      expect(new TextDecoder().decode(await readZipEntry(bytes, first))).toBe(
        'Fecha;Importe\n01/10/2026;5,00\n',
      )
    }
  })

  it('nombres sin la marca UTF-8 (Windows-1252)', () => {
    const name = 'Liquidación.csv'
    const bytes = buildZip([{ name, data: utf8('a') }], { deflateRaw: deflate, utf8Names: false })
    expect(listZip(bytes)[0]?.name).toBe(name)
  })

  it('contraseña, CRC roto, método no soportado, inexistente y demasiado grande', async () => {
    const data = utf8('Fecha;Tipo\n'.repeat(100))
    const enc = buildZip([{ name: 'a.csv', data }], { deflateRaw: deflate, encrypted: true })
    expect(listZip(enc)[0]?.encrypted).toBe(true)
    expect(await zipError(readZipEntry(enc, 'a.csv'))).toBe('zip_encrypted')

    const bad = buildZip([{ name: 'a.csv', data }], { deflateRaw: deflate, corruptCrc: true })
    expect(await zipError(readZipEntry(bad, 'a.csv'))).toBe('zip_corrupt')

    const bzip = buildZip([{ name: 'a.csv', data }], { deflateRaw: deflate })
    // Método 12 (bzip2) en el directorio central: 46 bytes antes del nombre, desplazamiento 10.
    const cd = bzip.length - 22 - (46 + 'a.csv'.length)
    bzip[cd + 10] = 12
    expect(await zipError(readZipEntry(bzip, 'a.csv'))).toBe('zip_unsupported')

    const ok = buildZip([{ name: 'a.csv', data }], { deflateRaw: deflate })
    expect(await zipError(readZipEntry(ok, 'b.csv'))).toBe('zip_not_found')
    expect(await zipError(readZipEntry(ok, 'a.csv', undefined, 10))).toBe('zip_too_big')
  })

  it('archivos que no son ZIP o están cortados', async () => {
    expect(await zipError(() => listZip(utf8('no soy un zip')))).toBe('zip_corrupt')
    const ok = buildZip([{ name: 'a.csv', data: utf8('hola') }], { deflateRaw: deflate })
    expect(await zipError(() => listZip(ok.subarray(0, ok.length - 30)))).toBe('zip_corrupt')
  })
})
