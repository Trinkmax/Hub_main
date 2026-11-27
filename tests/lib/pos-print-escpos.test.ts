// @vitest-environment node
import { deflateSync, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { type PrintDoc, p } from '@/lib/pos/print/doc'
import {
  COLUMNS,
  encodeText,
  escposJob,
  heroScale,
  type Raster,
  ruleBytes,
  wrap,
} from '@/lib/pos/print/escpos'
import { decodePng } from '@/lib/pos/print/png'
import { type Rgba, toRaster } from '@/lib/pos/print/raster'

/**
 * El tique en el idioma de la impresora (ESC/POS) para las comanderas por WiFi, y el logo pasado a
 * puntos. Lo que sale se probó además contra una impresora de mentira y se dibujó (`docs`).
 */

const ESC = 0x1b
const GS = 0x1d

/** ¿Aparece esta secuencia de bytes? */
function has(bytes: Uint8Array, sequence: number[]): boolean {
  outer: for (let at = 0; at <= bytes.length - sequence.length; at++) {
    for (let k = 0; k < sequence.length; k++) if (bytes[at + k] !== sequence[k]) continue outer
    return true
  }
  return false
}
const count = (bytes: Uint8Array, sequence: number[]) => {
  let total = 0
  outer: for (let at = 0; at <= bytes.length - sequence.length; at++) {
    for (let k = 0; k < sequence.length; k++) if (bytes[at + k] !== sequence[k]) continue outer
    total++
  }
  return total
}
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0))

describe('las letras', () => {
  it('las tildes van en la página 850', () => {
    expect(encodeText('Ñandú ¿sí?')).toEqual([
      0xa5,
      ...ascii('and'),
      0xa3,
      0x20,
      0xa8,
      0x73,
      0xa1,
      0x3f,
    ])
    expect(encodeText('«bien cocido» · x2')).toEqual([
      0xae,
      ...ascii('bien cocido'),
      0xaf,
      0x20,
      0xfa,
      ...ascii(' x2'),
    ])
  })

  it('sin la página 850, sin tildes', () => {
    expect(encodeText('Ñandú ¿sí? «ok»', 'ascii')).toEqual(ascii('Nandu si? "ok"'))
  })

  it('lo tipográfico pasa a lo común, y un emoji no se imprime', () => {
    expect(encodeText('Café — 2…')).toEqual([...ascii('Caf'), 0x82, ...ascii(' - 2...')])
    expect(encodeText('Pizza 🍕 grande')).toEqual(ascii('Pizza  grande'))
  })

  it('corta en renglones sin partir palabras, salvo las que no entran solas', () => {
    expect(wrap('Bondiola braseada con cremoso de zapallo', 16)).toEqual([
      'Bondiola',
      'braseada con',
      'cremoso de',
      'zapallo',
    ])
    expect(wrap('Supercalifragilístico', 8)).toEqual(['Supercal', 'ifragilí', 'stico'])
    expect(wrap('', 10)).toEqual([''])
  })
})

describe('el tique', () => {
  const doc: PrintDoc = {
    title: 'Comanda Mesa 12',
    lines: [
      { kind: 'logo' },
      p.banner('Cocina'),
      { kind: 'hero', caption: 'Mesa', text: '12' },
      p.center('Mozo: Sofía', { size: 'lg', bold: true }),
      p.rule('double'),
      { kind: 'item', qty: 'x2', name: 'Clásica triple', marks: ['sin cebolla'], variants: [] },
    ],
  }
  const logo: Raster = { width: 16, height: 2, data: Uint8Array.from([0xff, 0x00, 0x0f, 0xf0]) }

  it('arranca de fábrica, sin modo chino y con la página de las tildes', () => {
    const bytes = escposJob({ paper: 80, docs: [doc] })
    expect(Array.from(bytes.slice(0, 7))).toEqual([ESC, 0x40, 0x1c, 0x2e, ESC, 0x74, 2])
    // Sin tildes no se cambia la página.
    expect(has(escposJob({ paper: 80, docs: [doc] }, { codepage: 'ascii' }), [ESC, 0x74, 2])).toBe(
      false,
    )
  })

  it('la mesa sale enorme y la estación en negativo', () => {
    const bytes = escposJob({ paper: 80, docs: [doc] })
    // «12» a 8 veces la letra.
    expect(has(bytes, [GS, 0x21, 0x77, ...ascii('12')])).toBe(true)
    expect(has(bytes, [GS, 0x42, 1])).toBe(true)
    expect(has(bytes, ascii('COCINA'))).toBe(true)
    expect(has(bytes, ascii('MOZO')) || has(bytes, ascii('Mozo'))).toBe(true)
    // El producto en letra alta y en mayúsculas.
    expect(has(bytes, [GS, 0x21, 0x01])).toBe(true)
    expect(has(bytes, [...ascii('x2 CL'), 0xb5, ...ascii('SICA TRIPLE')])).toBe(true)
  })

  it('el logo va como dibujo, y sin logo no hay ningún dibujo', () => {
    const withLogo = escposJob({ paper: 80, docs: [doc] }, { logo })
    expect(has(withLogo, [GS, 0x76, 0x30, 0, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0])).toBe(true)
    const without = escposJob({ paper: 80, docs: [doc] })
    // Las rayas van en letras: sin logo, el tique no lleva ningún dibujo.
    expect(count(without, [GS, 0x76, 0x30, 0])).toBe(0)
    expect(has(without, [...Array.from({ length: 48 }, () => 0xcd), 0x0a])).toBe(true)
  })

  it('cada tique se corta; sin cortador, se deja papel', () => {
    const two = escposJob({ paper: 80, docs: [doc, doc] })
    expect(count(two, [GS, 0x56, 0x42, 0])).toBe(2)
    // Cada tique arranca de fábrica.
    expect(count(two, [ESC, 0x40])).toBe(2)
    const loose = escposJob({ paper: 58, docs: [doc] }, { cut: false })
    expect(has(loose, [GS, 0x56])).toBe(false)
    expect(has(loose, [ESC, 0x64, 5])).toBe(true)
  })

  it('el número de mesa: el más grande que entra en el rollo', () => {
    expect(heroScale('12', 80)).toBe(8)
    expect(heroScale('105', 80)).toBe(8)
    expect(heroScale('Martín', 80)).toBe(8)
    expect(heroScale('Mostrador', 80)).toBe(5)
    expect(heroScale('Delivery', 58)).toBe(4)
    expect(heroScale('un nombre larguísimo de verdad', 58)).toBe(2)
    expect(COLUMNS[80]).toBe(48)
  })

  it('las rayas son letras de lado a lado', () => {
    expect(ruleBytes(80, 'double', 'cp850')).toEqual(Array.from({ length: 48 }, () => 0xcd))
    expect(ruleBytes(58, 'solid', 'cp850')).toEqual(Array.from({ length: 32 }, () => 0xc4))
    expect(ruleBytes(58, 'double', 'ascii')).toEqual(Array.from({ length: 32 }, () => 0x3d))
    expect(ruleBytes(80, 'dashed', 'cp850').slice(0, 4)).toEqual([0x2d, 0x20, 0x2d, 0x20])
  })
})

/** Un PNG chiquito armado a mano: `rows` de píxeles RGBA. */
function png(width: number, height: number, rgba: number[], colorType = 6): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: number[]) => {
    let c = 0xffffffff
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const u32 = (value: number) => [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]
  const chunk = (type: string, body: number[]) => {
    const typed = [...ascii(type), ...body]
    return [...u32(body.length), ...typed, ...u32(crc(typed))]
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const raw: number[] = []
  for (let y = 0; y < height; y++) {
    // Cada fila con un filtro distinto (ninguno, resta, arriba): el lector tiene que deshacer los tres.
    const filter = y % 3
    raw.push(filter)
    for (let x = 0; x < width * channels; x++) {
      const value = rgba[y * width * channels + x] ?? 0
      const left = x >= channels ? (rgba[y * width * channels + x - channels] ?? 0) : 0
      const up = y > 0 ? (rgba[(y - 1) * width * channels + x] ?? 0) : 0
      raw.push(filter === 1 ? (value - left) & 255 : filter === 2 ? (value - up) & 255 : value)
    }
  }
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, colorType, 0, 0, 0]),
    ...chunk('IDAT', [...deflateSync(Uint8Array.from(raw))]),
    ...chunk('IEND', []),
  ])
}
const inflate = (data: Uint8Array) => Uint8Array.from(inflateSync(data))

describe('el logo', () => {
  it('lee un PNG con transparencia y deshace los filtros', () => {
    const pixels = [
      0, 0, 0, 255, 255, 255, 255, 0, 201, 162, 39, 255, 10, 20, 30, 128, 255, 255, 255, 255, 0, 0,
      0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]
    const image = decodePng(png(3, 3, pixels), inflate)
    expect(image.width).toBe(3)
    expect(image.height).toBe(3)
    expect([...image.data]).toEqual(pixels)
  })

  it('lee uno sin transparencia (RGB)', () => {
    const image = decodePng(png(2, 1, [255, 0, 0, 0, 0, 255], 2), inflate)
    expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  })

  it('lo que no es PNG no se lee', () => {
    expect(() => decodePng(Uint8Array.from([1, 2, 3]), inflate)).toThrow('no es un PNG')
  })

  it('pasa a puntos negros: lo de color también, lo blanco y lo transparente no', () => {
    // 8×1: negro, dorado, blanco, transparente, negro, gris claro, negro a media transparencia, blanco.
    const row = [
      [0, 0, 0, 255],
      [201, 162, 39, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 255],
      [235, 235, 235, 255],
      [0, 0, 0, 128],
      [255, 255, 255, 255],
    ].flat()
    const image: Rgba = { width: 8, height: 1, data: Uint8Array.from(row) }
    const raster = toRaster(image, 64)
    if (!raster) throw new Error('sin dibujo')
    // Recortado a lo que tiene tinta (del 1.º al 7.º punto), sin achicar.
    expect(raster.width).toBe(8)
    expect(raster.height).toBe(1)
    // negro, dorado, blanco, transparente, negro, gris claro, medio negro → 1 1 0 0 1 0 1
    expect(raster.data[0]).toBe(0b11001010)
  })

  it('se achica al ancho pedido sin perder la proporción', () => {
    const width = 100
    const height = 40
    const data = new Uint8Array(width * height * 4).fill(0)
    for (let i = 3; i < data.length; i += 4) data[i] = 255
    const raster = toRaster({ width, height, data }, 50)
    expect(raster?.width).toBe(56)
    expect(raster?.height).toBe(20)
    // Una imagen sin nada que imprimir no da dibujo.
    expect(toRaster({ width: 4, height: 4, data: new Uint8Array(64) }, 32)).toBeNull()
  })
})
