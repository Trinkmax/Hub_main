import { describe, expect, it } from 'vitest'
import { parseArcaQr, voucherTypeFromArcaCode } from '@/lib/accounting/arca-qr'

/** El ejemplo de la especificación de ARCA, con un comprobante de cada tipo que se quiera. */
const payload = (patch: Record<string, unknown> = {}) => ({
  ver: 1,
  fecha: '2026-11-04',
  cuit: 30712345689,
  ptoVta: 3,
  tipoCmp: 1,
  nroCmp: 1290,
  importe: 72358,
  moneda: 'PES',
  ctz: 1,
  tipoDocRec: 80,
  nroDocRec: 30998877665,
  tipoCodAut: 'E',
  codAut: 70417054367476,
  ...patch,
})

const qr = (data: unknown, host = 'https://www.afip.gob.ar/fe/qr/?p=') =>
  `${host}${btoa(typeof data === 'string' ? data : JSON.stringify(data))}`

describe('el QR de ARCA', () => {
  it('lee el comprobante: fecha, CUIT, punto de venta, tipo, número y total', () => {
    expect(parseArcaQr(qr(payload()))).toEqual({
      date: '2026-11-04',
      cuit: '30712345689',
      pointOfSale: 3,
      voucherType: 'factura_a',
      number: 1290,
      totalCents: 7_235_800,
    })
  })

  it('el importe con centavos no se corre por la coma flotante', () => {
    expect(parseArcaQr(qr(payload({ importe: 1234.56 })))?.totalCents).toBe(123_456)
    expect(parseArcaQr(qr(payload({ importe: 19.99 })))?.totalCents).toBe(1_999)
    expect(parseArcaQr(qr(payload({ importe: 1.1 })))?.totalCents).toBe(110)
  })

  it('vale en los tres dominios, con y sin www, y con el camino que sea', () => {
    for (const host of [
      'https://www.afip.gob.ar/fe/qr/?p=',
      'https://afip.gob.ar/fe/qr/?p=',
      'https://serviciosweb.afip.gob.ar/genericos/comprobantes/cae.aspx?p=',
      'https://www.arca.gob.ar/fe/qr/?p=',
      'https://arca.gob.ar/fe/qr/?p=',
      'http://www.afip.gob.ar/fe/qr/?p=',
    ]) {
      expect(parseArcaQr(qr(payload(), host))?.number, host).toBe(1290)
    }
  })

  it('otro sitio no es un QR de ARCA, aunque traiga el mismo parámetro', () => {
    for (const host of [
      'https://afip.gob.ar.estafa.com/fe/qr/?p=',
      'https://estafa.com/fe/qr/?p=',
      'https://notafip.gob.ar/fe/qr/?p=',
      'ftp://www.afip.gob.ar/fe/qr/?p=',
    ]) {
      expect(parseArcaQr(qr(payload(), host)), host).toBeNull()
    }
  })

  it('lo que no es un QR de factura vuelve null, sin romper', () => {
    for (const text of [
      '',
      'hola',
      'https://www.afip.gob.ar/',
      'https://www.afip.gob.ar/fe/qr/?p=',
      'https://www.afip.gob.ar/fe/qr/?p=@@@',
      qr('esto no es JSON'),
      qr('[]'),
      qr('null'),
      `https://www.afip.gob.ar/fe/qr/?p=${'a'.repeat(5000)}`,
      12345,
      null,
      undefined,
    ]) {
      expect(parseArcaQr(text)).toBeNull()
    }
  })

  it('sin lo que identifica al comprobante, no hay lectura', () => {
    expect(parseArcaQr(qr(payload({ fecha: 'ayer' })))).toBeNull()
    expect(parseArcaQr(qr(payload({ fecha: '2026-02-31' })))).toBeNull()
    expect(parseArcaQr(qr(payload({ cuit: 123 })))).toBeNull()
    expect(parseArcaQr(qr(payload({ ptoVta: 0 })))).toBeNull()
    expect(parseArcaQr(qr(payload({ ptoVta: 100_000 })))).toBeNull()
    expect(parseArcaQr(qr(payload({ nroCmp: 0 })))).toBeNull()
    expect(parseArcaQr(qr(payload({ nroCmp: 100_000_000 })))).toBeNull()
    expect(parseArcaQr(qr({ fecha: '2026-11-04' }))).toBeNull()
  })

  it('un importe que no sirve no tira abajo la lectura: el total queda para tipear', () => {
    const read = parseArcaQr(qr(payload({ importe: 0 })))
    expect(read?.number).toBe(1290)
    expect(read?.totalCents).toBeNull()
  })

  it('el tipo sale de los códigos de ARCA, y uno desconocido no inventa nada', () => {
    const typeOf = (tipoCmp: unknown) => parseArcaQr(qr(payload({ tipoCmp })))?.voucherType
    expect(typeOf(1)).toBe('factura_a')
    expect(typeOf(2)).toBe('nota_debito_a')
    expect(typeOf(3)).toBe('nota_credito_a')
    expect(typeOf(6)).toBe('factura_b')
    expect(typeOf(8)).toBe('nota_credito_b')
    expect(typeOf(11)).toBe('factura_c')
    expect(typeOf(13)).toBe('nota_credito_c')
    expect(typeOf(51)).toBe('factura_m')
    expect(typeOf(81)).toBe('tique_factura_a')
    expect(typeOf(83)).toBe('tique')
    expect(typeOf(777)).toBeNull()
    expect(voucherTypeFromArcaCode(0)).toBeNull()
  })

  it('una factura en dólares se pasa a pesos con su cotización', () => {
    expect(parseArcaQr(qr(payload({ importe: 100, moneda: 'DOL', ctz: 1250.5 })))?.totalCents).toBe(
      12_505_000,
    )
    // En otra moneda y sin cotización no se puede saber: se tipea.
    expect(parseArcaQr(qr(payload({ importe: 100, moneda: 'DOL', ctz: 0 })))?.totalCents).toBeNull()
    expect(
      parseArcaQr(qr({ ...payload({ importe: 100, moneda: 'DOL' }), ctz: undefined }))?.totalCents,
    ).toBeNull()
  })

  it('tolera lo que mandan algunos sistemas: textos, base64url, sin relleno, espacios', () => {
    const strings = payload({
      cuit: '30-71234568-9',
      ptoVta: '3',
      tipoCmp: '1',
      nroCmp: '1290',
      importe: '72358,50',
      fecha: '20261104',
    })
    expect(parseArcaQr(qr(strings))).toMatchObject({
      date: '2026-11-04',
      cuit: '30712345689',
      pointOfSale: 3,
      number: 1290,
      totalCents: 7_235_850,
    })
    expect(parseArcaQr(`  ${qr(payload())}\n`)?.number).toBe(1290)

    const base = btoa(JSON.stringify(payload({ tipoCodAut: '>>>???' })))
    const urlSafe = base.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(parseArcaQr(`https://www.afip.gob.ar/fe/qr/?p=${urlSafe}`)?.number).toBe(1290)
    // Un «+» sin escapar llega como espacio.
    expect(parseArcaQr(`https://www.afip.gob.ar/fe/qr/?p=${base}`)?.number).toBe(1290)
    expect(
      parseArcaQr(`https://www.afip.gob.ar/fe/qr/?p=${encodeURIComponent(base)}`)?.number,
    ).toBe(1290)
  })
})
