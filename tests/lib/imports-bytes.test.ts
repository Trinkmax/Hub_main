import { describe, expect, it } from 'vitest'
import {
  decodeText,
  decodeWindows1252,
  fixMojibake,
  looksLikeMojibake,
  sniffContainer,
} from '@/lib/imports/bytes'
import { encodeCp1252, utf8 } from '@/tests/fixtures/imports/synth'

const utf16le = (text: string, bom = true): Uint8Array => {
  const out = new Uint8Array(text.length * 2 + (bom ? 2 : 0))
  let at = 0
  if (bom) {
    out[0] = 0xff
    out[1] = 0xfe
    at = 2
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out[at++] = c & 0xff
    out[at++] = c >> 8
  }
  return out
}

describe('decodeText', () => {
  it('UTF-8 sin BOM (como bajan los CSV de ARCA)', () => {
    const r = decodeText(utf8('"Fecha de Emisión";"Cód. Autorización"'))
    expect(r).toEqual({
      text: '"Fecha de Emisión";"Cód. Autorización"',
      encoding: 'utf-8',
      bom: false,
      mojibake: false,
      repaired: false,
    })
  })

  it('saca el BOM de UTF-8', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Fecha;Tipo')])
    expect(decodeText(bytes)).toMatchObject({ text: 'Fecha;Tipo', encoding: 'utf-8', bom: true })
  })

  it('si no es UTF-8 válido, Windows-1252 (los CSV viejos y los TXT de bancos)', () => {
    const r = decodeText(encodeCp1252('Fecha de Emisión;Denominación;PANADERÍA LA ÑATA;€ 5'))
    expect(r.encoding).toBe('windows-1252')
    expect(r.text).toBe('Fecha de Emisión;Denominación;PANADERÍA LA ÑATA;€ 5')
  })

  it('Windows-1252 según la tabla de WHATWG en los 256 bytes', () => {
    // Ojo: el TextDecoder('windows-1252') de Node 25 decodifica 0x80–0x9F como
    // Latin-1 (controles C1) y no como € ‚ ƒ…; los navegadores usan la tabla de
    // WHATWG. Por eso el decodificador está escrito a mano.
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    const high = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ'
    const expected = Array.from({ length: 256 }, (_, b) =>
      b >= 0x80 && b <= 0x9f ? high[b - 0x80] : String.fromCharCode(b),
    ).join('')
    expect(decodeWindows1252(all)).toBe(expected)
  })

  it('UTF-16 con BOM (little y big endian) y sin BOM', () => {
    expect(decodeText(utf16le('Fecha\tImporte\r\n01/10/2026\t1.234,56'))).toMatchObject({
      text: 'Fecha\tImporte\r\n01/10/2026\t1.234,56',
      encoding: 'utf-16le',
      bom: true,
    })
    const be = utf16le('Saldo', false)
    for (let i = 0; i < be.length; i += 2) {
      const a = be[i] ?? 0
      be[i] = be[i + 1] ?? 0
      be[i + 1] = a
    }
    expect(decodeText(new Uint8Array([0xfe, 0xff, ...be]))).toMatchObject({
      text: 'Saldo',
      encoding: 'utf-16be',
    })
    expect(decodeText(utf16le('Fecha;Descripción;Importe', false))).toMatchObject({
      text: 'Fecha;Descripción;Importe',
      encoding: 'utf-16le',
      bom: false,
    })
  })

  it('detecta y arregla el mojibake («EmisiÃ³n» → «Emisión»)', () => {
    const broken = '"Fecha de EmisiÃ³n";"CÃ³d. AutorizaciÃ³n";"PANADERÃ\u008dA LA Ã‘ATA"'
    expect(looksLikeMojibake(broken)).toBe(true)
    const r = decodeText(utf8(broken))
    expect(r).toMatchObject({ encoding: 'utf-8', mojibake: false, repaired: true })
    expect(r.text).toBe('"Fecha de Emisión";"Cód. Autorización";"PANADERÍA LA ÑATA"')
  })

  it('si la vuelta no es limpia, no toca nada y avisa', () => {
    const mixed = 'EmisiÃ³n y 東京'
    expect(fixMojibake(mixed)).toBeNull()
    expect(decodeText(utf8(mixed))).toMatchObject({ text: mixed, mojibake: true, repaired: false })
  })

  it('el castellano normal no es mojibake', () => {
    expect(looksLikeMojibake('ÑANDÚ, CAFÉ & CÍA. — Año 2026 · São Paulo')).toBe(false)
  })
})

describe('sniffContainer', () => {
  const text = (s: string) => utf8(s)
  it('reconoce cada clase de archivo por sus primeros bytes', () => {
    expect(sniffContainer(new Uint8Array())).toBe('empty')
    expect(sniffContainer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe('zip')
    expect(sniffContainer(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]))).toBe(
      'zip',
    )
    expect(
      sniffContainer(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])),
    ).toBe('ole')
    expect(sniffContainer(text('%PDF-1.7\n'))).toBe('pdf')
    expect(sniffContainer(new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe('gzip')
    expect(sniffContainer(text('Fecha;Descripción;Importe\n01/10/2026;X;1,00\n'))).toBe('text')
    expect(sniffContainer(utf16le('Fecha\tImporte'))).toBe('text')
  })

  it('el «.xls» que es HTML o XML de Excel 2003', () => {
    expect(sniffContainer(text('﻿  \n<html><body><table><tr><td>1</td></tr></table>'))).toBe('html')
    expect(sniffContainer(text('<table border="1"><tr><th>Fecha</th></tr></table>'))).toBe('html')
    expect(
      sniffContainer(
        text(
          '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"></Workbook>',
        ),
      ),
    ).toBe('spreadsheetml')
  })

  it('bytes de control: binario', () => {
    const junk = Uint8Array.from({ length: 512 }, (_, i) => (i * 37) % 256)
    expect(sniffContainer(junk)).toBe('binary')
  })
})
